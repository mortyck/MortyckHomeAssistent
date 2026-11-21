import { BaseDeviceAdapter } from './BaseDeviceAdapter.js';
import { Device, DeviceState } from '../types/index.js';
// @ts-ignore - tuyapi has untyped default export in some ts environments
import TuyAPI from 'tuyapi';

export class TuyaLocalAdapter extends BaseDeviceAdapter {
  private tuyaClient: any = null;
  private localState: DeviceState;

  constructor(device: Device) {
    super(device);
    this.localState = {
      power: false,
      brightness: 100,
      color_temp: 5000,
      color_rgb: '#ffffff',
      current_power_w: 0,
      voltage_v: 230,
      current_a: 0,
      ...device.state
    };
  }

  public async connect(): Promise<boolean> {
    if (!this.device.tuya?.devId || !this.device.tuya?.localKey) {
      console.warn(`[TuyaAdapter:${this.device.id}] Missing devId or localKey.`);
      this.isConnected = false;
      this.emit('offline', 'Missing devId or localKey');
      return false;
    }

    try {
      const options: any = {
        id: this.device.tuya.devId,
        key: this.device.tuya.localKey,
        ip: this.device.ip || undefined,
        version: this.device.tuya.version || '3.3',
        issueGetOnConnect: true
      };
      this.tuyaClient = new TuyAPI(options);

      this.tuyaClient.on('connected', () => {
        console.log(`[TuyaAdapter:${this.device.id}] Connected to ${this.device.name} @ ${this.device.ip}`);
        this.isConnected = true;
        this.clearReconnect();
        this.emit('online');
      });

      this.tuyaClient.on('disconnected', () => {
        console.warn(`[TuyaAdapter:${this.device.id}] Disconnected.`);
        this.isConnected = false;
        this.emit('offline', 'Tuya socket disconnected');
        this.scheduleReconnect();
      });

      this.tuyaClient.on('error', (err: any) => {
        console.warn(`[TuyaAdapter:${this.device.id}] Socket warning:`, err?.message || err);
        // Do not bubble unhandled EventEmitter errors to prevent process abort
      });

      this.tuyaClient.on('data', (data: any) => {
        this.handleTuyaData(data);
      });

      this.tuyaClient.on('dp-refresh', (data: any) => {
        this.handleTuyaData(data);
      });

      // Attempt non-blocking connection with 4s timeout
      const connectPromise = this.tuyaClient.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 3500)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      return true;
    } catch (err: any) {
      console.warn(`[TuyaAdapter:${this.device.id}] Direct LAN connection failed (${err.message}). Device is offline.`);
      this.isConnected = false;
      this.emit('offline', err.message);
      this.scheduleReconnect();
      return false;
    }
  }

  private handleTuyaData(data: any): void {
    if (!data || !data.dps) return;
    const dps = data.dps;
    const updates: Partial<DeviceState> = {};

    // Standard Tuya DPS mappings:
    // DPS 1 or 20: Switch/Power
    if (dps['1'] !== undefined) updates.power = Boolean(dps['1']);
    if (dps['20'] !== undefined && typeof dps['20'] === 'boolean') updates.power = Boolean(dps['20']);

    // DPS 2 or 22: Brightness (0-1000 or 0-255)
    if (dps['2'] !== undefined) {
      updates.brightness = Math.round((Number(dps['2']) / 1000) * 100);
    } else if (dps['22'] !== undefined) {
      updates.brightness = Math.round((Number(dps['22']) / 1000) * 100);
    }

    // DPS 3 or 23: Color Temp (0-1000 -> 2700K - 6500K)
    if (dps['3'] !== undefined || dps['23'] !== undefined) {
      const raw = dps['3'] !== undefined ? dps['3'] : dps['23'];
      updates.color_temp = 2700 + Math.round((Number(raw) / 1000) * (6500 - 2700));
    }

    // DPS 18: Current (mA -> A)
    if (dps['18'] !== undefined) updates.current_a = Number(dps['18']) / 1000;
    // DPS 19: Power (0.1W -> W)
    if (dps['19'] !== undefined) updates.current_power_w = Number(dps['19']) / 10;
    // DPS 20: Voltage (0.1V -> V)
    if (dps['20'] !== undefined && typeof dps['20'] === 'number') updates.voltage_v = Number(dps['20']) / 10;

    this.localState = { ...this.localState, ...updates };
    this.emit('stateChange', updates);
  }

  public async disconnect(): Promise<void> {
    this.clearReconnect();
    if (this.tuyaClient) {
      try {
        await this.tuyaClient.disconnect();
      } catch {}
      this.tuyaClient = null;
    }
    this.isConnected = false;
    this.emit('offline', 'Manually disconnected');
  }

  public getState(): DeviceState {
    return { ...this.localState };
  }

  public async sendCommand(command: Record<string, any>): Promise<boolean> {
    const dpsPayload: Record<string, any> = {};

    if (command.power !== undefined) {
      const p = Boolean(command.power);
      this.localState.power = p;
      dpsPayload['1'] = p;
      dpsPayload['20'] = p;
    }

    if (command.brightness !== undefined) {
      const b = Number(command.brightness);
      this.localState.brightness = b;
      dpsPayload['2'] = Math.round((b / 100) * 1000);
      dpsPayload['22'] = Math.round((b / 100) * 1000);
    }

    if (command.color_temp !== undefined) {
      const ct = Number(command.color_temp);
      this.localState.color_temp = ct;
      const ratio = Math.max(0, Math.min(1, (ct - 2700) / (6500 - 2700)));
      dpsPayload['3'] = Math.round(ratio * 1000);
      dpsPayload['23'] = Math.round(ratio * 1000);
    }

    if (command.color_rgb !== undefined) {
      this.localState.color_rgb = String(command.color_rgb);
      dpsPayload['5'] = String(command.color_rgb).replace('#', '');
    }

    // Attempt local LAN transmission if physical client is connected
    if (this.tuyaClient && this.tuyaClient.isConnected()) {
      try {
        await this.tuyaClient.set({ multiple: true, data: dpsPayload });
        this.emit('stateChange', this.localState);
        return true;
      } catch (err: any) {
        console.warn(`[TuyaAdapter:${this.device.id}] Local set failed: ${err.message}. State maintained.`);
      }
    }

    // Optimistic state emit
    this.emit('stateChange', this.localState);
    return true;
  }
}
