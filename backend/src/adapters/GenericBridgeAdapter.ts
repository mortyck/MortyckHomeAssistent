import { BaseDeviceAdapter } from './BaseDeviceAdapter.js';
import { Device, DeviceState, PTZCommand } from '../types/index.js';
import { MediaService } from '../services/MediaService.js';

export class GenericBridgeAdapter extends BaseDeviceAdapter {
  private mediaService: MediaService;
  private localState: DeviceState;
  private streamId: string;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(device: Device) {
    super(device);
    this.mediaService = MediaService.getInstance();
    this.streamId = (this.device.camera?.streamName || this.device.id).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    this.localState = {
      stream_status: 'ready',
      motion_detected: false,
      webrtc_url: `/api/streams/${this.streamId}/webrtc`,
      ...device.state
    };
  }

  public async connect(): Promise<boolean> {
    console.log(`[GenericBridge:${this.device.id}] Connecting via ${this.device.bridge?.bridgeType || 'webhook'} adapter. Stream: ${this.streamId}`);

    // If an RTSP URL or HA stream source exists, register with go2rtc
    if (this.device.camera?.rtspUrl) {
      await this.mediaService.ensureGo2RtcRunning();
      await this.mediaService.ensureBluramsBridgeRunning();
      const rawUrl = this.device.camera.rtspUrl;
      const effectiveSource = (this.device.bridge?.bridgeType === 'blurams_rtsp' || this.streamId.includes('blurams'))
        ? (rawUrl.startsWith('ffmpeg:') ? rawUrl : `ffmpeg:${rawUrl}#video=h264`)
        : rawUrl;
      await this.mediaService.registerStream(this.streamId, effectiveSource);
      this.localState.webrtc_url = this.mediaService.getWebRtcEndpoint(this.streamId);
    }

    this.isConnected = true;
    this.emit('online');
    this.emit('stateChange', this.localState);

    // If Home Assistant REST endpoint configured, start polling state
    if (this.device.bridge?.bridgeType === 'homeassistant' && this.device.bridge.endpoint) {
      this.startHaPolling();
    }

    return true;
  }

  private startHaPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(async () => {
      try {
        const endpoint = this.device.bridge?.endpoint;
        const token = this.device.bridge?.token;
        if (!endpoint) return;

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(endpoint, { headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = (await res.json()) as any;
          // Extract attributes from Home Assistant entity
          const isMotion = data?.state === 'on' || data?.attributes?.motion_detected === true;
          if (isMotion !== this.localState.motion_detected) {
            this.triggerMotion(isMotion);
          }
        }
      } catch {
        // HA bridge quiet polling error
      }
    }, 5000);
  }

  public triggerMotion(detected: boolean): void {
    this.localState.motion_detected = detected;
    this.emit('motion', detected);
    this.emit('stateChange', { motion_detected: detected });

    if (detected) {
      setTimeout(() => {
        if (this.localState.motion_detected) {
          this.localState.motion_detected = false;
          this.emit('motion', false);
          this.emit('stateChange', { motion_detected: false });
        }
      }, 8000);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isConnected = false;
    this.emit('offline', 'Bridge adapter disconnected');
  }

  public getState(): DeviceState {
    return { ...this.localState };
  }

  public async sendCommand(command: Record<string, any>): Promise<boolean> {
    this.localState = { ...this.localState, ...command };
    this.emit('stateChange', this.localState);
    return true;
  }

  public async ptzCommand(command: PTZCommand): Promise<boolean> {
    console.log(`[GenericBridge:${this.device.id}] Bridge PTZ routed: ${command.action}`);
    return true;
  }
}
