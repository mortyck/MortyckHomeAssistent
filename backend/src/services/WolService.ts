import dgram from 'dgram';
import net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RemotePc } from '../types/index.js';
import { DeviceManager } from './DeviceManager.js';

const execAsync = promisify(exec);

export class WolService {
  private static instance: WolService;

  private constructor() {}

  public static getInstance(): WolService {
    if (!WolService.instance) {
      WolService.instance = new WolService();
    }
    return WolService.instance;
  }

  /**
   * Create and broadcast standard Wake-on-LAN Magic Packet
   * Magic packet: 6 bytes of 0xFF followed by 16 repetitions of the 6-byte MAC address
   */
  public async sendWol(macAddress: string, broadcastIp: string = '255.255.255.255', port: number = 9): Promise<boolean> {
    const cleanMac = macAddress.replace(/[:-]/g, '').trim();
    if (cleanMac.length !== 12) {
      throw new Error(`Invalid MAC address length: ${macAddress}`);
    }

    const macBuffer = Buffer.from(cleanMac, 'hex');
    const magicPacket = Buffer.alloc(102);

    // 6 bytes of 0xFF
    for (let i = 0; i < 6; i++) {
      magicPacket[i] = 0xff;
    }

    // 16 repetitions of the MAC
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6);
    }

    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      client.bind(0, () => {
        client.setBroadcast(true);
        client.send(magicPacket, 0, magicPacket.length, port, broadcastIp, (err) => {
          client.close();
          if (err) {
            console.error(`[WolService] Error sending WoL to ${macAddress} via ${broadcastIp}:`, err);
            reject(err);
          } else {
            console.log(`[WolService] Magic packet successfully broadcast to ${macAddress} via ${broadcastIp}:${port}`);
            resolve(true);
          }
        });
      });
    });
  }

  /**
   * Hardware Relay Pulse (e.g. Tuya dry-contact relay or Arduino connected to motherboard power pins)
   * Turns ON relay, waits 1000ms, turns OFF relay (momentary contact)
   */
  public async triggerRelayPulse(relayDeviceId: string, pulseMs: number = 1000): Promise<boolean> {
    const deviceManager = DeviceManager.getInstance();
    console.log(`[WolService] Triggering momentary hardware relay pulse on ${relayDeviceId} (${pulseMs}ms)...`);
    
    // Pulse ON
    const onRes = await deviceManager.sendCommand(relayDeviceId, { power: true });
    if (!onRes) return false;

    // Wait momentary contact duration
    await new Promise((resolve) => setTimeout(resolve, pulseMs));

    // Release OFF
    await deviceManager.sendCommand(relayDeviceId, { power: false });
    return true;
  }

  /**
   * Fast health probe for PC: tests TCP ports (AnyDesk 7070, RDP 3389, SMB 445, HTTP 80)
   * fallback to OS ping
   */
  public async checkPcOnline(ip: string, timeoutMs: number = 800): Promise<{ online: boolean; latencyMs?: number }> {
    const start = Date.now();
    const probePorts = [7070, 3389, 445, 80, 22];

    for (const port of probePorts) {
      const isPortOpen = await new Promise<boolean>((resolve) => {
        const s = new net.Socket();
        s.setTimeout(timeoutMs);
        s.once('connect', () => {
          s.destroy();
          resolve(true);
        });
        s.once('timeout', () => {
          s.destroy();
          resolve(false);
        });
        s.once('error', () => {
          s.destroy();
          resolve(false);
        });
        s.connect(port, ip);
      });

      if (isPortOpen) {
        return { online: true, latencyMs: Date.now() - start };
      }
    }

    // Ping check fallback
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `ping -n 1 -w ${timeoutMs} ${ip}` : `ping -c 1 -W 1 ${ip}`;
      await execAsync(cmd);
      return { online: true, latencyMs: Date.now() - start };
    } catch {
      return { online: false };
    }
  }
}
