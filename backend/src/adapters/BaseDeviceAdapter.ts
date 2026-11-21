import { EventEmitter } from 'events';
import { Device, DeviceState, PTZCommand } from '../types/index.js';

export interface AdapterEvents {
  stateChange: (state: Partial<DeviceState>) => void;
  online: () => void;
  offline: (reason?: string) => void;
  error: (err: Error) => void;
  motion: (detected: boolean) => void;
}

export abstract class BaseDeviceAdapter extends EventEmitter {
  protected device: Device;
  protected isConnected: boolean = false;
  protected reconnectTimer: NodeJS.Timeout | null = null;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 10;

  constructor(device: Device) {
    super();
    this.device = device;
  }

  public getDeviceId(): string {
    return this.device.id;
  }

  public getDevice(): Device {
    return this.device;
  }

  public updateConfig(device: Device): void {
    this.device = device;
  }

  public isOnline(): boolean {
    return this.isConnected;
  }

  public abstract connect(): Promise<boolean>;
  public abstract disconnect(): Promise<void>;
  public abstract getState(): DeviceState;
  public abstract sendCommand(command: Record<string, any>): Promise<boolean>;
  
  public ptzCommand?(command: PTZCommand): Promise<boolean>;
  public triggerMotion?(detected: boolean): void;

  protected scheduleReconnect(delayMs: number = 5000): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const backoff = Math.min(delayMs * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log(`[Adapter:${this.device.id}] Attempting reconnect #${this.reconnectAttempts}...`);
      try {
        await this.connect();
      } catch (err) {
        this.scheduleReconnect(delayMs);
      }
    }, backoff);
  }

  protected clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }
}

