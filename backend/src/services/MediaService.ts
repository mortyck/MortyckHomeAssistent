import fs from 'fs';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';

export interface StreamInfo {
  name: string;
  url: string;
  producers?: any[];
  consumers?: any[];
}

export class MediaService {
  private static instance: MediaService;
  private go2rtcUrl: string;
  private registeredStreams: Map<string, string> = new Map();
  private isConnected: boolean = false;
  private isSpawning: boolean = false;
  private isSpawningBridge: boolean = false;

  private constructor() {
    this.go2rtcUrl = process.env.GO2RTC_API_URL || 'http://127.0.0.1:1984';
  }

  public static getInstance(): MediaService {
    if (!MediaService.instance) {
      MediaService.instance = new MediaService();
    }
    return MediaService.instance;
  }

  public setGo2RtcUrl(url: string) {
    this.go2rtcUrl = url.replace(/\/$/, '');
  }

  public getGo2RtcUrl(): string {
    return this.go2rtcUrl;
  }

  /**
   * Locate the bundled go2rtc binary and config file in the project (Windows & Linux)
   */
  private findBinaryAndConfig(): { exePath: string | null; configPath: string | null } {
    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'go2rtc.exe' : 'go2rtc';

    const candidateDirs = [
      path.resolve(process.cwd(), 'docker'),
      path.resolve(process.cwd(), '..', 'docker'),
      path.resolve(__dirname, '..', '..', 'docker'),
      path.resolve(__dirname, '..', '..', '..', 'docker')
    ];

    let exePath: string | null = null;
    let configPath: string | null = null;

    for (const dir of candidateDirs) {
      const exeCandidate = path.join(dir, binaryName);
      if (fs.existsSync(exeCandidate)) {
        exePath = exeCandidate;
        if (!isWin) {
          try {
            fs.chmodSync(exeCandidate, 0o755);
          } catch {}
        }
        const configCandidate = path.join(dir, 'go2rtc.yaml');
        if (fs.existsSync(configCandidate)) {
          configPath = configCandidate;
        }
        break;
      }
    }

    // Fallback on Linux if in PATH or local directory
    if (!exePath && !isWin) {
      const localRel = path.resolve(process.cwd(), 'docker', 'go2rtc');
      if (fs.existsSync(localRel)) {
        exePath = localRel;
        try { fs.chmodSync(localRel, 0o755); } catch {}
      }
    }

    return { exePath, configPath };
  }

  /**
   * Verify if go2rtc is running, and if not, auto-spawn the local binary
   */
  public async ensureGo2RtcRunning(): Promise<boolean> {
    const health = await this.checkHealth();
    if (health.ok) {
      this.isConnected = true;
      return true;
    }

    if (this.isSpawning) {
      // Avoid duplicate concurrent spawn attempts
      await new Promise((r) => setTimeout(r, 1000));
      return (await this.checkHealth()).ok;
    }

    this.isSpawning = true;
    console.log(`[MediaService] go2rtc not responding at ${this.go2rtcUrl}. Auto-starting local instance...`);

    const { exePath, configPath } = this.findBinaryAndConfig();
    if (!exePath) {
      console.warn('[MediaService] Could not find docker/go2rtc.exe binary to auto-start.');
      this.isSpawning = false;
      return false;
    }

    try {
      const args = configPath ? ['-config', configPath] : [];
      console.log(`[MediaService] Launching go2rtc process: ${exePath} ${args.join(' ')}`);

      const child = spawn(exePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      // Poll health for up to 4 seconds
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const recheck = await this.checkHealth();
        if (recheck.ok) {
          console.log('[MediaService] go2rtc started successfully and is listening on port 1984.');
          this.isConnected = true;
          this.isSpawning = false;

          // Re-sync all saved streams
          await this.syncRegisteredStreams();
          return true;
        }
      }
    } catch (err: any) {
      console.error(`[MediaService] Failed to auto-start go2rtc: ${err.message}`);
    } finally {
      this.isSpawning = false;
    }

    return false;
  }

  /**
   * Fast TCP connect probe to test if a service is actively listening on a given port
   */
  private probePort(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  }

  /**
   * Ensure native Blurams RTSP bridge script is running on port 8556
   */
  public async ensureBluramsBridgeRunning(): Promise<boolean> {
    const isRunning = await this.probePort('127.0.0.1', 8556, 1000);
    if (isRunning) {
      return true;
    }

    if (this.isSpawningBridge) {
      await new Promise((r) => setTimeout(r, 1000));
      return await this.probePort('127.0.0.1', 8556, 1000);
    }

    this.isSpawningBridge = true;
    console.log('[MediaService] Blurams RTSP bridge not detected on port 8556. Auto-starting native script...');

    const candidateScripts = [
      path.resolve(process.cwd(), 'scripts', 'blurams_bridge.py'),
      path.resolve(process.cwd(), '..', 'scripts', 'blurams_bridge.py'),
      path.resolve(__dirname, '..', '..', 'scripts', 'blurams_bridge.py'),
      path.resolve(__dirname, '..', '..', '..', 'scripts', 'blurams_bridge.py')
    ];

    let scriptPath: string | null = null;
    for (const cand of candidateScripts) {
      if (fs.existsSync(cand)) {
        scriptPath = cand;
        break;
      }
    }

    if (!scriptPath) {
      console.warn('[MediaService] Could not locate scripts/blurams_bridge.py to auto-start.');
      this.isSpawningBridge = false;
      return false;
    }

    const isWin = process.platform === 'win32';
    const rootDir = path.dirname(path.dirname(scriptPath));
    let pythonCmd = isWin ? 'python' : 'python3';

    if (isWin) {
      const venvWin = path.join(rootDir, 'venv', 'Scripts', 'python.exe');
      if (fs.existsSync(venvWin)) pythonCmd = venvWin;
    } else {
      const venvLinux = path.join(rootDir, 'venv', 'bin', 'python');
      if (fs.existsSync(venvLinux)) {
        pythonCmd = venvLinux;
      } else {
        const venvLinux3 = path.join(rootDir, 'venv', 'bin', 'python3');
        if (fs.existsSync(venvLinux3)) {
          pythonCmd = venvLinux3;
        }
      }
    }

    try {
      console.log(`[MediaService] Launching Blurams bridge (${isWin ? 'Windows' : 'Linux'}): ${pythonCmd} ${scriptPath}`);
      const child = spawn(pythonCmd, [scriptPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: rootDir
      });
      child.unref();

      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const ok = await this.probePort('127.0.0.1', 8556, 500);
        if (ok) {
          console.log('[MediaService] Blurams RTSP bridge started successfully and is listening on port 8556.');
          this.isSpawningBridge = false;
          return true;
        }
      }
    } catch (err: any) {
      console.error(`[MediaService] Failed to auto-start Blurams bridge: ${err.message}`);
    } finally {
      this.isSpawningBridge = false;
    }

    return false;
  }

  public async checkHealth(): Promise<{ ok: boolean; version?: string; streams?: any }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.go2rtcUrl}/api/streams`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        this.isConnected = true;
        const streams = await res.json();
        return { ok: true, streams };
      }
      this.isConnected = false;
      return { ok: false };
    } catch {
      this.isConnected = false;
      return { ok: false };
    }
  }

  public isGo2RtcOnline(): boolean {
    return this.isConnected;
  }

  /**
   * Dynamically register or update an RTSP camera stream into go2rtc
   * Official go2rtc REST API: PUT /api/streams?name=<id>&src=<rtsp_url>
   */
  public async registerStream(streamName: string, rtspSource: string): Promise<boolean> {
    if (!streamName || !rtspSource) return false;
    const normalizedName = (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    this.registeredStreams.set(normalizedName, rtspSource);

    // Auto-launch go2rtc if it is not yet active
    if (!this.isConnected) {
      await this.ensureGo2RtcRunning();
    }

    try {
      // Primary registration using URLSearchParams for RFC-compliant encoding (semicolons become %3B, etc.)
      const params = new URLSearchParams({
        name: normalizedName,
        src: rtspSource
      });
      const url = `${this.go2rtcUrl}/api/streams?${params.toString()}`;
      const res = await fetch(url, { method: 'PUT' });

      // Also register 'cam_<normalizedName>' alias if it doesn't already start with cam_
      // so any legacy caller is guaranteed to resolve
      if (!normalizedName.startsWith('cam_')) {
        const aliasParams = new URLSearchParams({
          name: `cam_${normalizedName}`,
          src: rtspSource
        });
        const aliasUrl = `${this.go2rtcUrl}/api/streams?${aliasParams.toString()}`;
        fetch(aliasUrl, { method: 'PUT' }).catch(() => {});
      }

      if (res.ok) {
        const masked = rtspSource.replace(/:[^:@]+@/, ':***@');
        console.log(`[MediaService] Registered stream '${normalizedName}' in go2rtc -> ${masked}`);
        return true;
      } else {
        const text = await res.text();
        console.warn(`[MediaService] Failed to register stream '${normalizedName}' in go2rtc: ${res.status} ${text}`);
      }
    } catch (err: any) {
      console.warn(`[MediaService] Could not reach go2rtc server at ${this.go2rtcUrl} (${err.message}). Stream '${normalizedName}' cached locally.`);
    }
    return false;
  }

  /**
   * Re-sync all registered streams into go2rtc (e.g. after daemon restart)
   */
  public async syncRegisteredStreams(): Promise<void> {
    if (this.registeredStreams.size === 0) return;
    console.log(`[MediaService] Re-syncing ${this.registeredStreams.size} streams into go2rtc...`);
    for (const [name, url] of this.registeredStreams.entries()) {
      try {
        const params = new URLSearchParams({ name, src: url });
        const putUrl = `${this.go2rtcUrl}/api/streams?${params.toString()}`;
        await fetch(putUrl, { method: 'PUT' });
      } catch {}
    }
  }

  /**
   * Delete stream from go2rtc
   */
  public async removeStream(streamName: string): Promise<boolean> {
    const normalizedName = (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    this.registeredStreams.delete(normalizedName);
    try {
      const params = new URLSearchParams({ name: normalizedName, src: normalizedName });
      const url = `${this.go2rtcUrl}/api/streams?${params.toString()}`;
      const res = await fetch(url, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all currently active streams from go2rtc
   */
  public async getStreams(): Promise<Record<string, any>> {
    try {
      const res = await fetch(`${this.go2rtcUrl}/api/streams`);
      if (res.ok) {
        return (await res.json()) as Record<string, any>;
      }
    } catch {
      // return local registry if go2rtc is unavailable
    }
    const fallback: Record<string, any> = {};
    for (const [key, val] of this.registeredStreams.entries()) {
      fallback[key] = { producers: [{ url: val }] };
    }
    return fallback;
  }

  /**
   * Get WebRTC WHEP/Offer endpoint for browser playback
   */
  public getWebRtcEndpoint(streamName: string): string {
    const params = new URLSearchParams({ src: (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') });
    return `${this.go2rtcUrl}/api/webrtc?${params.toString()}`;
  }

  /**
   * Get MJPEG / snapshot preview URL
   */
  public getSnapshotEndpoint(streamName: string): string {
    const params = new URLSearchParams({ src: (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') });
    return `${this.go2rtcUrl}/api/frame.jpeg?${params.toString()}`;
  }
}
