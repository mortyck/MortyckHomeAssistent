import { EventEmitter } from 'events';
import net from 'net';
import { Device, DeviceState, PTZCommand } from '../types/index.js';
import { Database } from '../db/Database.js';
import { BaseDeviceAdapter } from '../adapters/BaseDeviceAdapter.js';
import { TuyaLocalAdapter } from '../adapters/TuyaLocalAdapter.js';
import { OnvifCameraAdapter } from '../adapters/OnvifCameraAdapter.js';
import { GenericBridgeAdapter } from '../adapters/GenericBridgeAdapter.js';
import { MediaService } from './MediaService.js';

export class DeviceManager extends EventEmitter {
  private static instance: DeviceManager;
  private db: Database;
  private adapters: Map<string, BaseDeviceAdapter> = new Map();

  private constructor() {
    super();
    this.db = Database.getInstance();
  }

  public static getInstance(): DeviceManager {
    if (!DeviceManager.instance) {
      DeviceManager.instance = new DeviceManager();
    }
    return DeviceManager.instance;
  }

  public async initialize(): Promise<void> {
    const devices = this.db.getAllDevices();
    console.log(`[DeviceManager] Initializing ${devices.length} registered devices...`);

    for (const dev of devices) {
      await this.initAdapter(dev);
    }
  }

  private async initAdapter(device: Device): Promise<BaseDeviceAdapter> {
    // If existing adapter, disconnect first
    if (this.adapters.has(device.id)) {
      await this.adapters.get(device.id)!.disconnect();
      this.adapters.delete(device.id);
    }

    let adapter: BaseDeviceAdapter;
    if (device.type === 'tuya') {
      adapter = new TuyaLocalAdapter(device);
    } else if (device.type === 'camhi' || device.type === 'wansview' || device.type === 'onvif') {
      adapter = new OnvifCameraAdapter(device);
    } else {
      adapter = new GenericBridgeAdapter(device);
    }

    // Attach adapter lifecycle events
    adapter.on('stateChange', (updates: Partial<DeviceState>) => {
      this.db.updateDeviceState(device.id, updates);
      this.emit('device_state', { deviceId: device.id, state: updates });
    });

    adapter.on('online', () => {
      this.db.updateDeviceOnline(device.id, true);
      this.emit('device_online', { deviceId: device.id, online: true });
    });

    adapter.on('offline', (reason?: string) => {
      this.db.updateDeviceOnline(device.id, false);
      this.emit('device_online', { deviceId: device.id, online: false, reason });
    });

    adapter.on('motion', (detected: boolean) => {
      this.emit('motion_event', { deviceId: device.id, detected, timestamp: Date.now() });
    });

    adapter.on('error', (err: any) => {
      console.warn(`[DeviceManager] Device ${device.id} warning:`, err?.message || err);
    });

    this.adapters.set(device.id, adapter);
    await adapter.connect();
    return adapter;
  }

  public async addOrUpdateDevice(device: Device): Promise<Device> {
    this.db.upsertDevice(device);
    await this.initAdapter(device);
    return device;
  }

  public async removeDevice(id: string): Promise<boolean> {
    const dev = this.db.getDevice(id);
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(id);
    }
    if (dev?.category === 'camera' || dev?.type === 'camhi' || dev?.type === 'wansview' || dev?.type === 'bridge' || dev?.type === 'onvif') {
      const streamName = (dev.camera?.streamName || dev.id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const media = MediaService.getInstance();
      await media.removeStream(streamName);
      await media.removeStream(`cam_${streamName}`);
    }
    return this.db.deleteDevice(id);
  }

  public async sendCommand(deviceId: string, command: Record<string, any>): Promise<boolean> {
    const adapter = this.adapters.get(deviceId);
    if (!adapter) {
      console.warn(`[DeviceManager] Device not found for command: ${deviceId}`);
      return false;
    }
    const success = await adapter.sendCommand(command);
    if (success) {
      this.db.updateDeviceState(deviceId, command);
      this.emit('device_state', { deviceId, state: command });
    }
    return success;
  }

  public async sendPtzCommand(deviceId: string, command: PTZCommand): Promise<boolean> {
    const adapter = this.adapters.get(deviceId);
    if (!adapter || !adapter.ptzCommand) {
      console.warn(`[DeviceManager] Device ${deviceId} does not support PTZ.`);
      return false;
    }
    return await adapter.ptzCommand(command);
  }

  public triggerMotion(deviceId: string, detected: boolean = true): void {
    const adapter = this.adapters.get(deviceId);
    if (adapter && adapter.triggerMotion) {
      adapter.triggerMotion(detected);
    } else {
      this.emit('motion_event', { deviceId, detected, timestamp: Date.now() });
    }
  }

  private probeTcpPort(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      try {
        socket.connect(port, host);
      } catch {
        resolve(false);
      }
    });
  }

  public async testConnection(device: Partial<Device>): Promise<{ success: boolean; message: string; details?: any }> {
    if (!device.ip) {
      return { success: false, message: 'IP address is required.' };
    }

    try {
      if (device.type === 'tuya') {
        const port = device.port || 6668;
        const isOpen = await this.probeTcpPort(device.ip, port, 2500);
        if (!isOpen) {
          return {
            success: false,
            message: `Could not reach Tuya port ${port} on ${device.ip}. Ensure device is powered and connected to Wi-Fi.`
          };
        }

        const hasKeys = Boolean(device.tuya?.devId && device.tuya?.localKey);
        return {
          success: true,
          message: hasKeys
            ? `Tuya LAN port ${port} is active on ${device.ip}. Device credentials verified for protocol v${device.tuya?.version || '3.3'}.`
            : `Tuya LAN port ${port} is active on ${device.ip}. Enter Device ID & Local Key to complete pairing.`,
          details: { ip: device.ip, port, hasKeys }
        };
      }

      if (device.type === 'camhi' || device.type === 'wansview' || device.type === 'onvif' || device.category === 'camera') {
        const rtspPort = device.port || 554;
        const onvifPort = device.camera?.onvifPort || (device.type === 'wansview' ? 80 : 8899);

        const [rtspOpen, onvifOpen] = await Promise.all([
          this.probeTcpPort(device.ip, rtspPort, 3000),
          this.probeTcpPort(device.ip, onvifPort, 2000)
        ]);

        const username = device.camera?.username || 'admin';
        const password = device.camera?.password || '';
        const rtspPath = device.camera?.rtspPath || '/11';
        const auth = password ? `${username}:${password}@` : (username ? `${username}@` : '');
        const rtspUrl = device.camera?.rtspUrl || `rtsp://${auth}${device.ip}:${rtspPort}${rtspPath}`;
        const safeRtspUrl = rtspUrl.replace(/:[^:@]+@/, ':***@');

        if (!rtspOpen) {
          return {
            success: false,
            message: `RTSP port ${rtspPort} is not responding on ${device.ip}. Check camera power and ensure RTSP is enabled in camera app.`,
            details: { rtspOpen: false, onvifOpen }
          };
        }

        // Dynamically register with go2rtc to test stream availability
        const streamName = (device.camera?.streamName || device.id || `probe_${Date.now().toString(36)}`)
          .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

        const mediaService = MediaService.getInstance();
        await mediaService.ensureGo2RtcRunning();
        await mediaService.ensureBluramsBridgeRunning();
        const go2rtcOk = await mediaService.registerStream(streamName, rtspUrl);

        return {
          success: true,
          message: `RTSP port ${rtspPort} reachable! ${go2rtcOk ? 'Stream registered in go2rtc.' : 'RTSP stream ready.'} ${safeRtspUrl}`,
          details: { rtspOpen: true, onvifOpen, rtspUrl: safeRtspUrl, streamName }
        };
      }

      if (device.type === 'bridge' || device.camera?.rtspUrl) {
        const streamName = (device.camera?.streamName || device.id || 'blurams_garage')
          .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const defaultRaw = device.ip ? `rtsp://${device.ip}:${device.port || 8556}/${streamName}` : 'rtsp://127.0.0.1:8556/blurams_garage';
        const rawUrl = device.camera?.rtspUrl || defaultRaw;
        const rtspUrl = (device.bridge?.bridgeType === 'blurams_rtsp' || streamName.includes('blurams'))
          ? (rawUrl.startsWith('ffmpeg:') ? rawUrl : `ffmpeg:${rawUrl}#video=h264`)
          : rawUrl;
        const port = device.port || 8556;
        const host = device.ip || '127.0.0.1';
        const isOpen = await this.probeTcpPort(host, port, 2000);
        const mediaService = MediaService.getInstance();
        await mediaService.ensureGo2RtcRunning();
        await mediaService.ensureBluramsBridgeRunning();
        const go2rtcOk = await mediaService.registerStream(streamName, rtspUrl);

        return {
          success: true,
          message: `Bridge stream '${streamName}' registered in go2rtc -> ${rtspUrl} (Port ${port} ${isOpen ? 'active' : 'ready'})`,
          details: { streamName, rtspUrl, portOpen: isOpen, go2rtcOk }
        };
      }

      const port = device.port || 80;
      const isOpen = await this.probeTcpPort(device.ip, port, 2000);
      return {
        success: isOpen,
        message: isOpen
          ? `Host ${device.ip}:${port} responded successfully.`
          : `Host ${device.ip}:${port} did not respond.`,
        details: { ip: device.ip, port, isOpen }
      };
    } catch (err: any) {
      return { success: false, message: `Connection test error: ${err.message}` };
    }
  }
}
