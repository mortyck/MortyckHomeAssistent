import fs from 'fs';
import path from 'path';
import { Device, AutomationRule, RemotePc } from '../types/index.js';

const DATA_DIR = process.env.DATA_DIR ||
  (fs.existsSync(path.join(process.cwd(), 'backend', 'data'))
    ? path.join(process.cwd(), 'backend', 'data')
    : path.join(process.cwd(), 'data'));

const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const AUTOMATIONS_FILE = path.join(DATA_DIR, 'automations.json');
const PCS_FILE = path.join(DATA_DIR, 'pcs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const INITIAL_DEVICES: Device[] = [];

const INITIAL_PCS: RemotePc[] = [
  {
    id: 'pc-home',
    name: 'Home PC',
    location: 'Home',
    ip: '192.168.1.80',
    mac: '18:99:F5:07:15:E5',
    broadcastAddress: '192.168.1.255',
    vncPort: 5900,
    vncPassword: '',
    anydeskId: '984 120 442',
    webViewerUrl: '/novnc/vnc.html?autoconnect=true&resize=scale&pcId=pc-home&host=192.168.1.80&port=5900',
    online: false,
    lastPingMs: undefined,
    lastSeen: Date.now()
  },
  {
    id: 'pc-garage',
    name: 'Garage PC',
    location: 'Garage',
    ip: '192.168.8.116',
    mac: 'D8:12:65:04:28:B5',
    broadcastAddress: '192.168.8.255',
    vncPort: 5900,
    vncPassword: '',
    anydeskId: '542 819 003',
    webViewerUrl: '/novnc/vnc.html?autoconnect=true&resize=scale&pcId=pc-garage&host=192.168.8.116&port=5900',
    relayDeviceId: '',
    online: true,
    vncPortOpen: true,
    lastPingMs: 124,
    lastSeen: Date.now()
  }
];

const INITIAL_AUTOMATIONS: AutomationRule[] = [];

export function normalizeStreamId(id: string): string {
  return (id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

export class Database {
  private static instance: Database;
  private devices: Map<string, Device> = new Map();
  private automations: Map<string, AutomationRule> = new Map();
  private pcs: Map<string, RemotePc> = new Map();
  private settings: Record<string, any> = {
    go2rtcUrl: process.env.GO2RTC_API_URL || 'http://127.0.0.1:1984',
    locations: ['Home', 'Garage'],
    rooms: ['Living Room', 'Workshop', 'Exterior', 'Garage', 'Office']
  };

  private constructor() {
    this.ensureDataDir();
    this.loadData();
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private normalizeCameraDevice(d: Device): Device {
    if (!d.location) {
      d.location = d.ip?.startsWith('192.168.8.') ? 'Garage' : 'Home';
    }
    if (d.category === 'camera' || d.type === 'camhi' || d.type === 'wansview' || d.type === 'onvif' || d.type === 'bridge') {
      const streamId = normalizeStreamId(d.camera?.streamName || d.id);
      if (!d.camera) d.camera = {};
      d.camera.streamName = streamId;
      if (!d.camera.rtspUrl && d.ip) {
        if (d.type === 'bridge') {
          d.camera.rtspUrl = `ffmpeg:rtsp://127.0.0.1:${d.port || 8556}/${streamId}#video=h264`;
        } else {
          const creds = d.camera;
          const auth = (creds.username && creds.password)
            ? `${creds.username}:${creds.password}@`
            : (creds.username ? `${creds.username}@` : '');
          const port = d.port || 554;
          const defaultPath = d.brand === 'CamHi' ? '/11' : '/live/ch0';
          const rtspPath = creds.rtspPath || defaultPath;
          d.camera.rtspUrl = `rtsp://${auth}${d.ip}:${port}${rtspPath.startsWith('/') ? rtspPath : '/' + rtspPath}`;
        }
      }
      if (!d.state) d.state = {};
      d.state.webrtc_url = `/api/streams/${streamId}/webrtc`;
    }
    return d;
  }

  private loadData(): void {
    try {
      if (fs.existsSync(DEVICES_FILE)) {
        const raw = fs.readFileSync(DEVICES_FILE, 'utf-8');
        const list: Device[] = JSON.parse(raw);
        list.forEach((d) => {
          this.devices.set(d.id, this.normalizeCameraDevice(d));
        });
      } else {
        INITIAL_DEVICES.forEach((d) => this.devices.set(d.id, d));
        this.saveDevices();
      }

      if (fs.existsSync(PCS_FILE)) {
        const raw = fs.readFileSync(PCS_FILE, 'utf-8');
        const list: RemotePc[] = JSON.parse(raw);
        list.forEach((p) => this.pcs.set(p.id, p));
      } else {
        INITIAL_PCS.forEach((p) => this.pcs.set(p.id, p));
        this.savePcs();
      }

      if (fs.existsSync(AUTOMATIONS_FILE)) {
        const raw = fs.readFileSync(AUTOMATIONS_FILE, 'utf-8');
        const list: AutomationRule[] = JSON.parse(raw);
        list.forEach((a) => this.automations.set(a.id, a));
      } else {
        INITIAL_AUTOMATIONS.forEach((a) => this.automations.set(a.id, a));
        this.saveAutomations();
      }

      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      } else {
        this.saveSettings();
      }
    } catch (err) {
      console.error('[Database] Error loading persistence data, fallback to defaults:', err);
      INITIAL_DEVICES.forEach((d) => this.devices.set(d.id, d));
      INITIAL_PCS.forEach((p) => this.pcs.set(p.id, p));
      INITIAL_AUTOMATIONS.forEach((a) => this.automations.set(a.id, a));
    }
  }

  public saveDevices(): void {
    try {
      const list = Array.from(this.devices.values());
      fs.writeFileSync(DEVICES_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Failed to save devices:', err);
    }
  }

  public savePcs(): void {
    try {
      const list = Array.from(this.pcs.values());
      fs.writeFileSync(PCS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Failed to save PCs:', err);
    }
  }

  public saveAutomations(): void {
    try {
      const list = Array.from(this.automations.values());
      fs.writeFileSync(AUTOMATIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Failed to save automations:', err);
    }
  }

  public saveSettings(): void {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Database] Failed to save settings:', err);
    }
  }

  // Devices CRUD
  public getAllDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  public getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  public upsertDevice(device: Device): Device {
    const normalized = this.normalizeCameraDevice(device);
    this.devices.set(normalized.id, normalized);
    this.saveDevices();
    return normalized;
  }

  public updateDeviceState(id: string, partialState: Partial<Device['state']>): Device | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    dev.state = { ...dev.state, ...partialState };
    dev.lastSeen = Date.now();
    this.saveDevices();
    return dev;
  }

  public updateDeviceOnline(id: string, online: boolean): Device | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    dev.online = online;
    dev.lastSeen = Date.now();
    this.saveDevices();
    return dev;
  }

  public deleteDevice(id: string): boolean {
    const deleted = this.devices.delete(id);
    if (deleted) this.saveDevices();
    return deleted;
  }

  // Remote PCs CRUD
  public getAllPcs(): RemotePc[] {
    return Array.from(this.pcs.values());
  }

  public getPc(id: string): RemotePc | undefined {
    return this.pcs.get(id);
  }

  public upsertPc(pc: RemotePc): RemotePc {
    this.pcs.set(pc.id, pc);
    this.savePcs();
    return pc;
  }

  public updatePcStatus(id: string, online: boolean, latencyMs?: number): RemotePc | undefined {
    const pc = this.pcs.get(id);
    if (!pc) return undefined;
    pc.online = online;
    if (latencyMs !== undefined) pc.lastPingMs = latencyMs;
    if (online) pc.lastSeen = Date.now();
    this.savePcs();
    return pc;
  }

  public deletePc(id: string): boolean {
    const deleted = this.pcs.delete(id);
    if (deleted) this.savePcs();
    return deleted;
  }

  // Automations CRUD
  public getAllAutomations(): AutomationRule[] {
    return Array.from(this.automations.values());
  }

  public getAutomation(id: string): AutomationRule | undefined {
    return this.automations.get(id);
  }

  public upsertAutomation(rule: AutomationRule): AutomationRule {
    this.automations.set(rule.id, rule);
    this.saveAutomations();
    return rule;
  }

  public deleteAutomation(id: string): boolean {
    const deleted = this.automations.delete(id);
    if (deleted) this.saveAutomations();
    return deleted;
  }

  // Locations & Rooms
  public getLocations(): string[] {
    return this.settings.locations || ['Home', 'Garage'];
  }

  public getRooms(): string[] {
    return this.settings.rooms || ['Living Room', 'Workshop', 'Exterior', 'Garage', 'Office'];
  }

  public addRoom(room: string): string[] {
    if (!this.settings.rooms.includes(room)) {
      this.settings.rooms.push(room);
      this.saveSettings();
    }
    return this.settings.rooms;
  }

  public getSettings(): Record<string, any> {
    return this.settings;
  }

  public updateSettings(partial: Record<string, any>): Record<string, any> {
    this.settings = { ...this.settings, ...partial };
    this.saveSettings();
    return this.settings;
  }
}
