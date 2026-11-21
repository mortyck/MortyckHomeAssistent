import net from 'net';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { Database } from '../db/Database.js';

export interface VncSessionInfo {
  id: string;
  pcId: string;
  targetHost: string;
  targetPort: number;
  connectedAt: number;
  bytesFromVnc: number;
  bytesToVnc: number;
}

export class VncProxyService {
  private static instance: VncProxyService;
  private wss: WebSocketServer;
  private db: Database;
  private activeSessions: Map<string, VncSessionInfo> = new Map();

  private constructor() {
    this.db = Database.getInstance();
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols: Set<string>) => {
        if (protocols.has('binary')) return 'binary';
        if (protocols.has('base64')) return 'base64';
        const first = protocols.values().next().value;
        return first || false;
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleVncWebSocketConnection(ws, req);
    });
  }

  public static getInstance(): VncProxyService {
    if (!VncProxyService.instance) {
      VncProxyService.instance = new VncProxyService();
    }
    return VncProxyService.instance;
  }

  public handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  public getActiveSessions(): VncSessionInfo[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Probe whether a VNC TCP port (default 5900) is accepting connections.
   */
  public checkVncPort(
    host: string,
    port = 5900,
    timeoutMs = 1500
  ): Promise<{ open: boolean; latencyMs?: number }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (open: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({
          open,
          latencyMs: open ? Date.now() - start : undefined
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));

      try {
        socket.connect(port, host);
      } catch {
        finish(false);
      }
    });
  }

  private isAllowedLanOrTailscaleHost(host: string): boolean {
    const clean = (host || '').trim();
    if (!clean) return false;
    return (
      clean === '127.0.0.1' ||
      clean === 'localhost' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(clean) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) ||
      /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(clean)
    );
  }

  private resolveTarget(req: IncomingMessage): { pcId: string; host: string; port: number } {
    const rawUrl = req.url || '/websockify';
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const pcIdParam = (parsedUrl.searchParams.get('pcId') || '').trim();
    const hostParam = (parsedUrl.searchParams.get('host') || '').trim();
    const portParam = parseInt(parsedUrl.searchParams.get('port') || '5900', 10);

    // 1. Check by pcId in database
    if (pcIdParam) {
      const pc = this.db.getPc(pcIdParam);
      if (pc && pc.ip) {
        return {
          pcId: pc.id,
          host: pc.ip,
          port: pc.vncPort || (Number.isFinite(portParam) && portParam > 0 ? portParam : 5900)
        };
      }
    }

    // 2. Check explicit host/port query params (validated to LAN / Tailscale IP ranges)
    if (hostParam && this.isAllowedLanOrTailscaleHost(hostParam)) {
      const matchingPc = this.db.getAllPcs().find((p) => p.ip === hostParam);
      return {
        pcId: matchingPc?.id || 'custom',
        host: hostParam,
        port: Number.isFinite(portParam) && portParam > 0 ? portParam : 5900
      };
    }

    // 3. Default to Garage PC (192.168.8.116:5900)
    const garagePc = this.db.getPc('pc-garage');
    return {
      pcId: garagePc?.id || 'pc-garage',
      host: garagePc?.ip || '192.168.8.116',
      port: garagePc?.vncPort || 5900
    };
  }

  private handleVncWebSocketConnection(ws: WebSocket, req: IncomingMessage): void {
    const target = this.resolveTarget(req);
    const sessionId = `vnc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const sessionInfo: VncSessionInfo = {
      id: sessionId,
      pcId: target.pcId,
      targetHost: target.host,
      targetPort: target.port,
      connectedAt: Date.now(),
      bytesFromVnc: 0,
      bytesToVnc: 0
    };

    this.activeSessions.set(sessionId, sessionInfo);
    console.log(
      `[Websockify] Opening VNC bridge ${sessionId} -> ${target.host}:${target.port} (PC: ${target.pcId})`
    );

    const pendingWsChunks: Buffer[] = [];
    let tcpConnected = false;

    const tcpSocket = net.createConnection({
      host: target.host,
      port: target.port
    });

    tcpSocket.setNoDelay(true);
    tcpSocket.setKeepAlive(true, 15000);

    tcpSocket.on('connect', () => {
      tcpConnected = true;
      console.log(`[Websockify] Connected to VNC server ${target.host}:${target.port}`);
      while (pendingWsChunks.length > 0) {
        const chunk = pendingWsChunks.shift();
        if (chunk && !tcpSocket.destroyed) {
          tcpSocket.write(chunk);
        }
      }
    });

    tcpSocket.on('data', (chunk: Buffer) => {
      sessionInfo.bytesFromVnc += chunk.length;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(chunk, { binary: true });
        } catch (err: any) {
          console.error(`[Websockify] WS send error (${sessionId}):`, err.message);
        }
      }
    });

    tcpSocket.on('end', () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'VNC TCP stream ended');
      }
    });

    tcpSocket.on('close', () => {
      this.activeSessions.delete(sessionId);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'VNC server closed connection');
      }
    });

    tcpSocket.on('error', (err: any) => {
      console.warn(
        `[Websockify] TCP error to ${target.host}:${target.port} (${sessionId}): ${err.message}`
      );
      this.activeSessions.delete(sessionId);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1011, `VNC TCP error: ${err.message}`);
      }
    });

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      let buf: Buffer;
      if (Buffer.isBuffer(data)) {
        buf = data;
      } else if (data instanceof ArrayBuffer) {
        buf = Buffer.from(data);
      } else if (Array.isArray(data)) {
        buf = Buffer.concat(data);
      } else {
        buf = Buffer.from(String(data));
      }

      sessionInfo.bytesToVnc += buf.length;
      if (tcpConnected && !tcpSocket.destroyed) {
        tcpSocket.write(buf);
      } else if (!tcpSocket.destroyed) {
        pendingWsChunks.push(buf);
      }
    });

    ws.on('close', () => {
      this.activeSessions.delete(sessionId);
      if (!tcpSocket.destroyed) {
        tcpSocket.destroy();
      }
      console.log(`[Websockify] Closed VNC bridge ${sessionId} (${target.host}:${target.port})`);
    });

    ws.on('error', () => {
      this.activeSessions.delete(sessionId);
      if (!tcpSocket.destroyed) {
        tcpSocket.destroy();
      }
    });
  }
}
