import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createApiRouter } from './routes/api.js';
import { DeviceManager } from './services/DeviceManager.js';
import { AutomationEngine } from './services/AutomationEngine.js';
import { MediaService } from './services/MediaService.js';
import { VncProxyService } from './services/VncProxyService.js';

const ROOT_ENV_PATH = fs.existsSync(path.join(process.cwd(), '.env'))
  ? path.join(process.cwd(), '.env')
  : path.resolve(process.cwd(), '..', '.env');

dotenv.config({ path: ROOT_ENV_PATH, override: true });

const PORT = parseInt(process.env.PORT || '4000', 10);
const app = express();
const server = http.createServer(app);
const vncProxy = VncProxyService.getInstance();

const BACKEND_ROOT = fs.existsSync(path.join(process.cwd(), 'public', 'novnc'))
  ? process.cwd()
  : path.join(process.cwd(), 'backend');

const NOVNC_PUBLIC_DIR = path.join(BACKEND_ROOT, 'public', 'novnc');
const NOVNC_MODULE_DIR = path.join(BACKEND_ROOT, 'node_modules', '@novnc', 'novnc');

// Enable CORS and body parsing
app.use(cors());
app.use(express.json());
app.use(express.text({ type: ['text/plain', 'application/sdp', 'application/x-www-form-urlencoded'] }));

// Serve embedded J.A.R.V.I.S. noVNC HTML5 Viewer & @novnc/novnc ES modules
if (fs.existsSync(NOVNC_PUBLIC_DIR)) {
  app.use('/novnc', express.static(NOVNC_PUBLIC_DIR));
}
if (fs.existsSync(NOVNC_MODULE_DIR)) {
  app.use('/novnc', express.static(NOVNC_MODULE_DIR));
}

// Initialize WebSocket Server for real-time telemetry (noServer mode so /websockify shares the HTTP server cleanly)
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set<WebSocket>();

server.on('upgrade', (req, socket, head) => {
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0];

  if (
    pathname === '/websockify' ||
    pathname.startsWith('/websockify/') ||
    pathname === '/novnc/websockify' ||
    pathname === '/api/vnc/ws'
  ) {
    vncProxy.handleUpgrade(req, socket, head);
    return;
  }

  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

function broadcast(event: string, data: any) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WebSocket] Client connected (Active: ${wsClients.size})`);

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch {}
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WebSocket] Client disconnected (Active: ${wsClients.size})`);
  });
});

// Setup REST Routes
app.use('/api', createApiRouter(broadcast));

// Root health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'MortyckHomeAssistent Backend', uptime: process.uptime() });
});

// Forward DeviceManager internal events to WebSocket clients
const deviceManager = DeviceManager.getInstance();
deviceManager.on('device_state', (payload) => broadcast('device_state', payload));
deviceManager.on('device_online', (payload) => broadcast('device_online', payload));
deviceManager.on('motion_event', (payload) => broadcast('motion_event', payload));

// Start server and initialize subsystems
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`====================================================`);
  console.log(`  MortyckHomeAssistent Backend running on port ${PORT}`);
  console.log(`  WebSocket Endpoint: ws://localhost:${PORT}/ws`);
  console.log(`  REST API Endpoint:  http://localhost:${PORT}/api`);
  console.log(`====================================================`);

  // Initialize streaming engine and IoT adapters
  try {
    const media = MediaService.getInstance();
    const go2rtcOk = await media.ensureGo2RtcRunning();
    console.log(`[MediaService] go2rtc status: ${go2rtcOk ? 'ONLINE' : 'OFFLINE'}`);

    const bridgeOk = await media.ensureBluramsBridgeRunning();
    console.log(`[MediaService] Blurams RTSP bridge status: ${bridgeOk ? 'ONLINE (Port 8556)' : 'STANDBY'}`);

    await deviceManager.initialize();
    AutomationEngine.getInstance().initialize();
  } catch (err: any) {
    console.error('[MortyckHomeAssistent] Initialization error:', err.message);
  }
});

