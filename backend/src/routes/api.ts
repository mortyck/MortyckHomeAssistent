import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { Database } from '../db/Database.js';
import { DeviceManager } from '../services/DeviceManager.js';
import { NetworkScannerService } from '../services/NetworkScannerService.js';
import { MediaService } from '../services/MediaService.js';
import { WolService } from '../services/WolService.js';
import { JarvisAiService } from '../services/JarvisAiService.js';
import { VncProxyService } from '../services/VncProxyService.js';
import { Device, AutomationRule, PTZCommand, RemotePc, BluramsBridgeStatus } from '../types/index.js';

const ROOT_DIR = fs.existsSync(path.join(process.cwd(), 'docker', 'go2rtc.yaml'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const ENV_FILE_PATH = path.join(ROOT_DIR, '.env');

let pcMonitorInterval: NodeJS.Timeout | null = null;
let isPollingPcs = false;

export function createApiRouter(broadcastWs: (event: string, data: any) => void): Router {
  const router = Router();
  const db = Database.getInstance();
  const deviceManager = DeviceManager.getInstance();
  const scanner = NetworkScannerService.getInstance();
  const mediaService = MediaService.getInstance();
  const wolService = WolService.getInstance();
  const jarvisAi = JarvisAiService.getInstance();
  const vncProxy = VncProxyService.getInstance();

  // Guarded singleton background ping & VNC TCP checker for PCs (every 20s, non-overlapping)
  if (pcMonitorInterval) {
    clearInterval(pcMonitorInterval);
  }
  pcMonitorInterval = setInterval(async () => {
    if (isPollingPcs) return;
    isPollingPcs = true;
    try {
      const pcs = db.getAllPcs();
      await Promise.all(
        pcs.map(async (pc) => {
          try {
            const [probe, vncCheck] = await Promise.all([
              wolService.checkPcOnline(pc.ip, 800),
              vncProxy.checkVncPort(pc.ip, pc.vncPort || 5900, 1200)
            ]);
            const isOnline = probe.online || vncCheck.open;
            const latencyMs = probe.latencyMs ?? vncCheck.latencyMs;
            if (isOnline !== pc.online || latencyMs !== pc.lastPingMs || vncCheck.open !== pc.vncPortOpen) {
              pc.vncPortOpen = vncCheck.open;
              db.updatePcStatus(pc.id, isOnline, latencyMs);
              broadcastWs('pc_status', {
                id: pc.id,
                online: isOnline,
                vncPortOpen: vncCheck.open,
                latencyMs
              });
            }
          } catch {}
        })
      );
    } finally {
      isPollingPcs = false;
    }
  }, 20000);

  async function fetchBluramsBridgeStatus(): Promise<BluramsBridgeStatus> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1200);
      const res = await fetch('http://127.0.0.1:8557/status', { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        return (await res.json()) as BluramsBridgeStatus;
      }
    } catch {}
    return { online: false };
  }

  // --- SYSTEM STATUS ---
  router.get('/system/status', async (_req: Request, res: Response) => {
    const devices = db.getAllDevices();
    const pcs = db.getAllPcs();
    const onlineCount = devices.filter((d) => d.online).length;
    const [go2rtcHealth, bluramsBridge, aiStatus] = await Promise.all([
      mediaService.checkHealth(),
      fetchBluramsBridgeStatus(),
      jarvisAi.checkAiStatus()
    ]);

    const garageDevicesOnline = devices.some((d) => d.location === 'Garage' && d.online);
    const tailscaleConnected = garageDevicesOnline || Boolean(bluramsBridge.cameraPingReachable);

    res.json({
      backendUptime: process.uptime(),
      go2rtcConnected: go2rtcHealth.ok,
      deviceCount: devices.length,
      onlineCount,
      activeStreams: Object.keys(go2rtcHealth.streams || {}).length,
      locations: db.getLocations(),
      rooms: db.getRooms(),
      pcCount: pcs.length,
      pcsOnlineCount: pcs.filter((p) => p.online).length,
      go2rtcUrl: mediaService.getGo2RtcUrl(),
      tailscaleConnected,
      bluramsBridge,
      aiProvider: aiStatus.activeProvider
    });
  });

  // --- DEVICES CRUD & CONTROL ---
  router.get('/devices', (_req: Request, res: Response) => {
    res.json(db.getAllDevices());
  });

  router.get('/devices/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const dev = db.getDevice(id);
    if (!dev) return res.status(404).json({ error: 'Device not found' });
    res.json(dev);
  });

  async function prepareAndRegisterCameraStream(payload: Device): Promise<void> {
    if (payload.type === 'bridge' || payload.bridge?.bridgeType === 'blurams_rtsp') {
      const streamId = (payload.camera?.streamName || payload.id || 'blurams_garage')
        .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const rawUrl = payload.camera?.rtspUrl || `rtsp://127.0.0.1:${payload.port || 8556}/${streamId}`;
      const effectiveUrl = (payload.bridge?.bridgeType === 'blurams_rtsp' || streamId.includes('blurams'))
        ? (rawUrl.startsWith('ffmpeg:') ? rawUrl : `ffmpeg:${rawUrl}#video=h264`)
        : rawUrl;

      payload.camera = {
        ...payload.camera,
        rtspUrl: effectiveUrl,
        streamName: streamId
      };
      payload.state = {
        ...payload.state,
        webrtc_url: `/api/streams/${streamId}/webrtc`
      };
      await mediaService.ensureGo2RtcRunning();
      await mediaService.ensureBluramsBridgeRunning();
      await mediaService.registerStream(streamId, effectiveUrl);
      return;
    }

    if (payload.category === 'camera' || payload.type === 'camhi' || payload.type === 'wansview' || payload.type === 'onvif') {
      const creds = payload.camera || {};
      const auth = (creds.username && creds.password)
        ? `${creds.username}:${creds.password}@`
        : (creds.username ? `${creds.username}@` : '');
      const port = payload.port || 554;
      const defaultPath = payload.brand === 'CamHi' ? '/11' : '/live/ch0';
      const rtspPath = creds.rtspPath || defaultPath;
      const fullRtspUrl = `rtsp://${auth}${payload.ip}:${port}${rtspPath.startsWith('/') ? rtspPath : '/' + rtspPath}`;

      const streamId = (payload.camera?.streamName || payload.id)
        .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

      payload.camera = {
        ...creds,
        rtspUrl: fullRtspUrl,
        streamName: streamId
      };
      payload.state = {
        ...payload.state,
        webrtc_url: `/api/streams/${streamId}/webrtc`
      };

      await mediaService.ensureGo2RtcRunning();
      await mediaService.registerStream(streamId, fullRtspUrl);
    }
  }

  router.post('/devices', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      // Support workstation payloads sent to POST /api/devices as well as POST /api/pcs
      if (body.category === 'pc' || body.type === 'pc' || body.vncPort !== undefined || body.anydeskId !== undefined) {
        const pcId = body.id || `pc-${Date.now().toString(36)}`;
        const vncPort = Number(body.vncPort) || 5900;
        const location = body.location || (body.ip?.startsWith('192.168.8.') ? 'Garage' : 'Home');
        const pcPayload: RemotePc = {
          id: pcId,
          name: body.name || 'Remote Workstation',
          location,
          ip: body.ip || '',
          mac: body.mac || '',
          vncPort,
          vncPassword: body.vncPassword || '',
          broadcastAddress: body.broadcastAddress || (location === 'Garage' ? '192.168.8.255' : '192.168.1.255'),
          anydeskId: body.anydeskId || 'noVNC',
          webViewerUrl:
            body.webViewerUrl ||
            `/novnc/vnc.html?autoconnect=true&resize=scale&pcId=${encodeURIComponent(pcId)}&host=${encodeURIComponent(body.ip || '')}&port=${vncPort}`,
          online: false
        };
        const savedPc = db.upsertPc(pcPayload);
        broadcastWs('pc_updated', savedPc);
        return res.status(201).json(savedPc);
      }

      const payload: Device = body;
      if (!payload.id) {
        payload.id = `${payload.type || 'dev'}-${Date.now().toString(36)}`;
      }
      if (!payload.state) {
        payload.state = { power: false };
      }
      if (!payload.location) {
        payload.location = payload.ip?.startsWith('192.168.8.') ? 'Garage' : 'Home';
      }
      payload.lastSeen = Date.now();
      payload.online = true;

      await prepareAndRegisterCameraStream(payload);

      const device = await deviceManager.addOrUpdateDevice(payload);
      broadcastWs('device_added', device);
      res.status(201).json(device);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/devices/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const existing = db.getDevice(id);
      if (!existing) return res.status(404).json({ error: 'Device not found' });

      const updated: Device = {
        ...existing,
        ...req.body,
        id,
        tuya: req.body.tuya !== undefined ? { ...existing.tuya, ...req.body.tuya } : existing.tuya,
        camera: req.body.camera !== undefined ? { ...existing.camera, ...req.body.camera } : existing.camera,
        bridge: req.body.bridge !== undefined ? { ...existing.bridge, ...req.body.bridge } : existing.bridge
      };

      await prepareAndRegisterCameraStream(updated);

      const result = await deviceManager.addOrUpdateDevice(updated);
      broadcastWs('device_updated', result);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/devices/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const success = await deviceManager.removeDevice(id);
    if (!success) return res.status(404).json({ error: 'Device not found' });
    broadcastWs('device_removed', { id });
    res.json({ success: true, id });
  });

  router.post('/devices/:id/command', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const command = req.body;
    const success = await deviceManager.sendCommand(id, command);
    if (!success) return res.status(400).json({ error: 'Failed to execute command' });
    res.json({ success: true, id, command });
  });

  router.post('/devices/:id/ptz', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const ptzCmd: PTZCommand = req.body;
    const success = await deviceManager.sendPtzCommand(id, ptzCmd);
    res.json({ success, action: ptzCmd.action });
  });

  router.post('/devices/:id/motion', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const detected = req.body.detected !== undefined ? Boolean(req.body.detected) : true;
    deviceManager.triggerMotion(id, detected);
    res.json({ success: true, id, detected });
  });

  router.post('/devices/test', async (req: Request, res: Response) => {
    const testResult = await deviceManager.testConnection(req.body);
    res.json(testResult);
  });

  // --- REMOTE PCS & POWER MANAGEMENT ---
  router.get('/pcs', (_req: Request, res: Response) => {
    res.json(db.getAllPcs());
  });

  router.post('/pcs', async (req: Request, res: Response) => {
    try {
      const payload: RemotePc = req.body || {};
      if (!payload.id) {
        payload.id = `pc-${Date.now().toString(36)}`;
      }
      if (!payload.location) {
        payload.location = payload.ip?.startsWith('192.168.8.') ? 'Garage' : 'Home';
      }
      payload.vncPort = Number(payload.vncPort) || 5900;
      if (!payload.broadcastAddress) {
        payload.broadcastAddress = payload.location === 'Garage' ? '192.168.8.255' : '192.168.1.255';
      }
      if (!payload.webViewerUrl && payload.ip) {
        payload.webViewerUrl = `/novnc/vnc.html?autoconnect=true&resize=scale&pcId=${encodeURIComponent(
          payload.id
        )}&host=${encodeURIComponent(payload.ip)}&port=${payload.vncPort}`;
      }
      const pc = db.upsertPc(payload);
      broadcastWs('pc_updated', pc);
      res.status(201).json(pc);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/pcs/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const existing = db.getPc(id);
    if (!existing) return res.status(404).json({ error: 'PC not found' });
    const updated: RemotePc = { ...existing, ...req.body, id };
    const saved = db.upsertPc(updated);
    broadcastWs('pc_updated', saved);
    res.json(saved);
  });

  router.delete('/pcs/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const deleted = db.deletePc(id);
    if (!deleted) return res.status(404).json({ error: 'PC not found' });
    broadcastWs('pc_deleted', { id });
    res.json({ success: true, id });
  });

  router.post('/pcs/:id/wake', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const pc = db.getPc(id);
    if (!pc) return res.status(404).json({ error: 'PC not found' });

    try {
      const broadcastIp = pc.broadcastAddress || (pc.location === 'Garage' ? '192.168.8.255' : '192.168.1.255');
      await wolService.sendWol(pc.mac, broadcastIp);
      res.json({ success: true, message: `Wake-on-LAN magic packet sent to ${pc.name} (${pc.mac})` });
    } catch (err: any) {
      res.status(500).json({ error: `WoL failed: ${err.message}` });
    }
  });

  router.post('/pcs/:id/relay-pulse', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const pc = db.getPc(id);
    if (!pc) return res.status(404).json({ error: 'PC not found' });
    if (!pc.relayDeviceId) {
      return res.status(400).json({ error: 'No relay device configured for this PC' });
    }

    try {
      const success = await wolService.triggerRelayPulse(pc.relayDeviceId, 1000);
      res.json({ success, message: `Hardware relay power pulse triggered for ${pc.name}` });
    } catch (err: any) {
      res.status(500).json({ error: `Relay pulse failed: ${err.message}` });
    }
  });

  router.post('/pcs/:id/ping', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const pc = db.getPc(id);
    if (!pc) return res.status(404).json({ error: 'PC not found' });

    const [result, vncCheck] = await Promise.all([
      wolService.checkPcOnline(pc.ip, 1000),
      vncProxy.checkVncPort(pc.ip, pc.vncPort || 5900, 1200)
    ]);
    const isOnline = result.online || vncCheck.open;
    const latencyMs = result.latencyMs ?? vncCheck.latencyMs;
    pc.vncPortOpen = vncCheck.open;
    const updated = db.updatePcStatus(id, isOnline, latencyMs);
    broadcastWs('pc_status', { id, online: isOnline, vncPortOpen: vncCheck.open, latencyMs });
    res.json({ online: isOnline, vncPortOpen: vncCheck.open, latencyMs, pc: updated });
  });

  router.get('/pcs/:id/vnc-status', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const pc = db.getPc(id);
    if (!pc) return res.status(404).json({ error: 'PC not found' });

    const vncPort = pc.vncPort || 5900;
    const [pingRes, vncRes] = await Promise.all([
      wolService.checkPcOnline(pc.ip, 1000),
      vncProxy.checkVncPort(pc.ip, vncPort, 1500)
    ]);
    const isOnline = pingRes.online || vncRes.open;
    const latencyMs = pingRes.latencyMs ?? vncRes.latencyMs;
    pc.vncPortOpen = vncRes.open;
    db.updatePcStatus(id, isOnline, latencyMs);

    const viewerParams = new URLSearchParams({
      autoconnect: 'true',
      resize: 'scale',
      pcId: pc.id,
      host: pc.ip,
      port: String(vncPort)
    });
    if (pc.vncPassword) {
      viewerParams.set('password', pc.vncPassword);
    }

    res.json({
      id: pc.id,
      name: pc.name,
      ip: pc.ip,
      vncPort,
      online: isOnline,
      vncPortOpen: vncRes.open,
      latencyMs,
      wsPath: `/websockify?pcId=${encodeURIComponent(pc.id)}&host=${encodeURIComponent(pc.ip)}&port=${vncPort}`,
      viewerUrl: `/novnc/vnc.html?${viewerParams.toString()}`,
      activeSessions: vncProxy.getActiveSessions().filter((s) => s.pcId === pc.id).length
    });
  });

  // --- NETWORK SCANNER ---
  router.post('/scan/start', async (req: Request, res: Response) => {
    const subnetPrefix = req.body.subnetPrefix;
    if (scanner.isScanActive()) {
      return res.json({ status: 'in_progress', message: 'Scan already in progress' });
    }

    scanner.scanSubnet(subnetPrefix, (scanned, total, found) => {
      broadcastWs('scan_progress', { scanned, total, found });
    }).then((results) => {
      broadcastWs('scan_complete', { results });
    }).catch((err) => {
      console.error('[NetworkScanner] Scan error:', err);
    });

    res.json({ status: 'started', message: 'Network scan initiated' });
  });

  router.get('/scan/results', (_req: Request, res: Response) => {
    res.json({
      isScanning: scanner.isScanActive(),
      results: scanner.getLastResults()
    });
  });

  // --- GO2RTC & STREAM MANAGEMENT ---
  router.get('/streams', async (_req: Request, res: Response) => {
    const streams = await mediaService.getStreams();
    res.json({
      go2rtcUrl: mediaService.getGo2RtcUrl(),
      streams
    });
  });

  router.post('/streams/register', async (req: Request, res: Response) => {
    const { streamName, rtspUrl } = req.body;
    if (!streamName || !rtspUrl) {
      return res.status(400).json({ error: 'streamName and rtspUrl are required' });
    }
    const registered = await mediaService.registerStream(streamName, rtspUrl);
    res.json({ success: registered, streamName });
  });

  router.post('/streams/:streamName/webrtc', async (req: Request, res: Response) => {
    const streamName = req.params.streamName as string;
    try {
      await mediaService.ensureGo2RtcRunning();
      const sdpOffer = typeof req.body === 'string' ? req.body : (req.body?.sdp || '');
      const go2rtcUrl = mediaService.getGo2RtcUrl();
      const params = new URLSearchParams({ src: (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') });
      const upstreamRes = await fetch(`${go2rtcUrl}/api/webrtc?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdpOffer
      });

      if (!upstreamRes.ok) {
        const text = await upstreamRes.text();
        return res.status(upstreamRes.status).send(text);
      }

      const answerSdp = await upstreamRes.text();
      res.setHeader('Content-Type', 'application/sdp');
      res.send(answerSdp);
    } catch (err: any) {
      res.status(502).json({ error: `go2rtc proxy error: ${err.message}` });
    }
  });

  router.get('/streams/:streamName/frame.jpeg', async (req: Request, res: Response) => {
    const streamName = req.params.streamName as string;
    try {
      const go2rtcUrl = mediaService.getGo2RtcUrl();
      const params = new URLSearchParams({ src: (streamName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') });
      const upstreamRes = await fetch(`${go2rtcUrl}/api/frame.jpeg?${params.toString()}`);
      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).json({ error: 'Snapshot not available' });
      }
      const buffer = await upstreamRes.arrayBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      res.status(502).json({ error: `Snapshot error: ${err.message}` });
    }
  });

  // --- BLURAMS BRIDGE CONTROL & SETTINGS ---
  router.get('/blurams/status', async (_req: Request, res: Response) => {
    const status = await fetchBluramsBridgeStatus();
    res.json(status);
  });

  router.post('/blurams/reload', async (_req: Request, res: Response) => {
    await mediaService.ensureBluramsBridgeRunning();
    try {
      const r = await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
      const data = await r.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: `Could not reach Blurams bridge control API: ${err.message}` });
    }
  });

  // --- ENVIRONMENT & SYSTEM SETTINGS ---
  router.get('/settings', async (_req: Request, res: Response) => {
    const envVars: Record<string, string> = {};
    try {
      if (fs.existsSync(ENV_FILE_PATH)) {
        const lines = fs.readFileSync(ENV_FILE_PATH, 'utf-8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const idx = trimmed.indexOf('=');
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim();
          envVars[k] = v;
        }
      }
    } catch {}

    const bluramsStatus = await fetchBluramsBridgeStatus();
    const aiStatus = await jarvisAi.checkAiStatus();

    res.json({
      settings: db.getSettings(),
      env: {
        GEMINI_API_KEY: envVars.GEMINI_API_KEY ? '********' : '',
        HAS_GEMINI_API_KEY: Boolean(envVars.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
        GEMINI_MODEL: envVars.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        BLURAMS_EMAIL: envVars.BLURAMS_EMAIL || process.env.BLURAMS_EMAIL || '',
        BLURAMS_PASSWORD: envVars.BLURAMS_PASSWORD ? '********' : '',
        HAS_BLURAMS_PASSWORD: Boolean(envVars.BLURAMS_PASSWORD || process.env.BLURAMS_PASSWORD),
        BLURAMS_COOKIE: envVars.BLURAMS_COOKIE || process.env.BLURAMS_COOKIE || '',
        BLURAMS_TOKEN: envVars.BLURAMS_TOKEN || process.env.BLURAMS_TOKEN || '',
        HAS_BLURAMS_COOKIE: Boolean(
          envVars.BLURAMS_COOKIE ||
            process.env.BLURAMS_COOKIE ||
            envVars.BLURAMS_TOKEN ||
            process.env.BLURAMS_TOKEN
        ),
        BLURAMS_DEVICE_ID: envVars.BLURAMS_DEVICE_ID || process.env.BLURAMS_DEVICE_ID || '1800420411702000132815',
        BLURAMS_CAMERA_IP: envVars.BLURAMS_CAMERA_IP || process.env.BLURAMS_CAMERA_IP || '192.168.8.161',
        BLURAMS_STREAM_URL: envVars.BLURAMS_STREAM_URL || process.env.BLURAMS_STREAM_URL || '',
        OLLAMA_URL: envVars.OLLAMA_URL || process.env.OLLAMA_URL || 'http://localhost:11434',
        OLLAMA_MODEL: envVars.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'llama3.1',
        AI_API_URL: envVars.AI_API_URL || process.env.AI_API_URL || '',
        AI_MODEL: envVars.AI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini',
        HAS_AI_API_KEY: Boolean(envVars.AI_API_KEY || process.env.AI_API_KEY)
      },
      bluramsStatus,
      aiStatus
    });
  });

  router.put('/settings', async (req: Request, res: Response) => {
    try {
      const { envUpdates } = req.body;
      let backupFile: string | undefined;

      if (envUpdates && typeof envUpdates === 'object') {
        backupFile = jarvisAi.createFileBackup(ENV_FILE_PATH);
        let content = fs.existsSync(ENV_FILE_PATH) ? fs.readFileSync(ENV_FILE_PATH, 'utf-8') : '';

        for (const [rawKey, rawVal] of Object.entries(envUpdates)) {
          if (rawVal === undefined || rawVal === null || rawVal === '********') continue;
          const key = rawKey.trim();
          const val = String(rawVal).trim();
          process.env[key] = val;

          const lineRegex = new RegExp(`^${key}=.*$`, 'm');
          if (lineRegex.test(content)) {
            content = content.replace(lineRegex, `${key}=${val}`);
          } else {
            content += `\n${key}=${val}`;
          }
        }

        fs.writeFileSync(ENV_FILE_PATH, content.trim() + '\n', 'utf-8');

        // Hot-reload Blurams bridge so new credentials take effect immediately
        await mediaService.ensureBluramsBridgeRunning();
        try {
          await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
        } catch {}
      }

      const bluramsStatus = await fetchBluramsBridgeStatus();
      const aiStatus = await jarvisAi.checkAiStatus();
      res.json({ success: true, backupFile, bluramsStatus, aiStatus });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- M.A.R.V.I.N. AI ASSISTANT & SQLITE MEMORY ENGINE ROUTES ---
  router.get(['/ai/status', '/marvin/status'], async (_req: Request, res: Response) => {
    const status = await jarvisAi.checkAiStatus();
    res.json(status);
  });

  router.get(['/ai/history', '/marvin/history'], (_req: Request, res: Response) => {
    const history = jarvisAi.getMemoryEngine().getRecentConversations(30);
    const telemetry = jarvisAi.getMemoryEngine().getTelemetryStats();
    res.json({ history, telemetry });
  });

  router.post(['/ai/reindex', '/marvin/reindex'], (_req: Request, res: Response) => {
    const count = jarvisAi.getMemoryEngine().indexCodebase();
    res.json({ success: true, indexedFilesCount: count });
  });

  router.get(['/ai/backups', '/marvin/backups'], (_req: Request, res: Response) => {
    res.json(jarvisAi.listBackups());
  });

  router.post(['/ai/rollback', '/marvin/rollback'], (_req: Request, res: Response) => {
    try {
      const marvinGitTracker = require(path.join(ROOT_DIR, 'scripts', 'marvin_git_tracker.js'));
      const result = marvinGitTracker.rollbackLastChange('M.A.R.V.I.N. Web Console');
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get(['/ai/git-status', '/marvin/git-status'], (_req: Request, res: Response) => {
    try {
      const marvinGitTracker = require(path.join(ROOT_DIR, 'scripts', 'marvin_git_tracker.js'));
      const status = marvinGitTracker.getGitStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get(['/ai/changelog', '/marvin/changelog'], (_req: Request, res: Response) => {
    try {
      const changelogPath = path.join(ROOT_DIR, 'CHANGELOG_AI.md');
      if (!fs.existsSync(changelogPath)) {
        return res.json({ changelog: '' });
      }
      const content = fs.readFileSync(changelogPath, 'utf-8');
      res.json({ changelog: content });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get(['/ai/tasks', '/marvin/tasks'], (_req: Request, res: Response) => {
    try {
      const tasksPath = path.join(ROOT_DIR, 'data', 'marvin_tasks.json');
      if (!fs.existsSync(tasksPath)) {
        return res.json({ tasks: [] });
      }
      const content = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
      res.json(content);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post(['/ai/tasks', '/marvin/tasks'], (req: Request, res: Response) => {
    try {
      const tasksPath = path.join(ROOT_DIR, 'data', 'marvin_tasks.json');
      fs.writeFileSync(tasksPath, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post(['/ai/chat', '/marvin/chat'], async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }
      const response = await jarvisAi.processCommand(message, broadcastWs);
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: `M.A.R.V.I.N. processing error: ${err.message}` });
    }
  });

  // --- AUTOMATION RULES ---
  router.get('/automations', (_req: Request, res: Response) => {
    res.json(db.getAllAutomations());
  });

  router.post('/automations', (req: Request, res: Response) => {
    const rule: AutomationRule = req.body;
    if (!rule.id) rule.id = `rule-${Date.now().toString(36)}`;
    const saved = db.upsertAutomation(rule);
    broadcastWs('automation_updated', saved);
    res.status(201).json(saved);
  });

  router.delete('/automations/:id', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const deleted = db.deleteAutomation(id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    broadcastWs('automation_deleted', { id });
    res.json({ success: true, id });
  });

  router.post('/automations/:id/toggle', (req: Request, res: Response) => {
    const id = req.params.id as string;
    const rule = db.getAutomation(id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    rule.enabled = !rule.enabled;
    db.upsertAutomation(rule);
    broadcastWs('automation_updated', rule);
    res.json(rule);
  });

  // --- ROOMS ---
  router.get('/rooms', (_req: Request, res: Response) => {
    res.json(db.getRooms());
  });

  router.post('/rooms', (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Room name required' });
    const rooms = db.addRoom(name);
    res.json(rooms);
  });

  // --- EXTENSIBLE WEBHOOK BRIDGE ---
  router.post('/webhooks/:deviceId', (req: Request, res: Response) => {
    const id = req.params.deviceId as string;
    const payload = req.body;
    console.log(`[Webhook] Ingested event for ${id}:`, payload);

    if (payload.motion !== undefined) {
      deviceManager.triggerMotion(id, Boolean(payload.motion));
    }
    if (payload.state) {
      db.updateDeviceState(id, payload.state);
      broadcastWs('device_state', { deviceId: id, state: payload.state });
    }

    res.json({ status: 'ok', received: true });
  });

  return router;
}
