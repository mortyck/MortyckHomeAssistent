import net from 'net';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ScanResult, DeviceType, DeviceCategory } from '../types/index.js';

const execAsync = promisify(exec);

export class NetworkScannerService {
  private static instance: NetworkScannerService;
  private isScanning: boolean = false;
  private lastResults: ScanResult[] = [];

  // Target discovery ports:
  // 6668: Tuya Encrypted LAN
  // 554:  RTSP Video Streaming
  // 80:   ONVIF / HTTP Web UI (CamHi / Wansview)
  // 8080: ONVIF Alternative Port
  // 8899: CamHi ONVIF Port
  private TARGET_PORTS = [6668, 554, 80, 8080, 8899];

  private constructor() {}

  public static getInstance(): NetworkScannerService {
    if (!NetworkScannerService.instance) {
      NetworkScannerService.instance = new NetworkScannerService();
    }
    return NetworkScannerService.instance;
  }

  public isScanActive(): boolean {
    return this.isScanning;
  }

  public getLastResults(): ScanResult[] {
    return this.lastResults;
  }

  public async scanSubnet(
    subnetPrefix?: string,
    onProgress?: (scanned: number, total: number, found: ScanResult) => void
  ): Promise<ScanResult[]> {
    if (this.isScanning) {
      return this.lastResults;
    }
    this.isScanning = true;

    try {
      const prefix = subnetPrefix || this.detectLocalSubnetPrefix();
      console.log(`[NetworkScanner] Starting deep LAN scan on ${prefix}.0/24...`);

      // 1. Fetch ARP table to identify active MAC addresses
      const arpTable = await this.getArpTable();

      const results: ScanResult[] = [];
      const ipsToScan: string[] = [];
      for (let i = 1; i <= 254; i++) {
        ipsToScan.push(`${prefix}.${i}`);
      }

      const total = ipsToScan.length;
      let scannedCount = 0;

      // Scan concurrently in batches of 25 to balance speed and socket descriptor limits
      const BATCH_SIZE = 25;
      for (let b = 0; b < total; b += BATCH_SIZE) {
        const batch = ipsToScan.slice(b, b + BATCH_SIZE);
        const batchPromises = batch.map(async (ip) => {
          const openPorts = await this.probePorts(ip, this.TARGET_PORTS, 400);
          scannedCount++;

          if (openPorts.length > 0) {
            const mac = arpTable.get(ip);
            const classified = this.classifyDevice(ip, openPorts, mac);
            results.push(classified);
            if (onProgress) {
              onProgress(scannedCount, total, classified);
            }
          }
        });

        await Promise.all(batchPromises);
      }

      this.lastResults = results;
      console.log(`[NetworkScanner] Scan finished. Discovered ${results.length} IoT devices.`);
      return results;
    } finally {
      this.isScanning = false;
    }
  }

  private detectLocalSubnetPrefix(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const netInfo of interfaces[name] || []) {
        if (!netInfo.internal && netInfo.family === 'IPv4' && netInfo.address.startsWith('192.168.')) {
          const parts = netInfo.address.split('.');
          return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
      }
    }
    return '192.168.1';
  }

  private async probePorts(ip: string, ports: number[], timeoutMs: number): Promise<number[]> {
    const open: number[] = [];
    await Promise.all(
      ports.map(
        (port) =>
          new Promise<void>((resolve) => {
            const socket = new net.Socket();
            let isResolved = false;

            socket.setTimeout(timeoutMs);

            socket.once('connect', () => {
              open.push(port);
              socket.destroy();
              if (!isResolved) {
                isResolved = true;
                resolve();
              }
            });

            socket.once('timeout', () => {
              socket.destroy();
              if (!isResolved) {
                isResolved = true;
                resolve();
              }
            });

            socket.once('error', () => {
              socket.destroy();
              if (!isResolved) {
                isResolved = true;
                resolve();
              }
            });

            socket.connect(port, ip);
          })
      )
    );
    return open;
  }

  private async getArpTable(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const { stdout } = await execAsync('arp -a');
      const lines = stdout.split('\n');
      // Supports Windows ("192.168.1.1 00-11-22-33-44-55") and Linux ("? (192.168.1.1) at 00:11:22:33:44:55")
      const arpRegex = /(?:^|[(\s])([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})[)\s]+(?:at\s+)?([0-9a-fA-F[:-]{11,17})/i;
      for (const line of lines) {
        const match = line.match(arpRegex);
        if (match) {
          const ip = match[1];
          const mac = match[2].replace(/-/g, ':').toUpperCase();
          map.set(ip, mac);
        }
      }
    } catch {
      // ARP retrieval optional
    }
    return map;
  }

  private classifyDevice(ip: string, openPorts: number[], mac?: string): ScanResult {
    let suggestedBrand: 'Tuya' | 'CamHi' | 'Wansview' | 'ONVIF' | 'Unknown' = 'Unknown';
    let suggestedType: DeviceType = 'bridge';
    let suggestedCategory: DeviceCategory = 'custom';
    let vendor = 'Network Device';

    // Tuya Detection: Port 6668 is definitive for Tuya/Calex/Amorom LAN protocol
    if (openPorts.includes(6668)) {
      suggestedBrand = 'Tuya';
      suggestedType = 'tuya';
      suggestedCategory = 'light';
      vendor = 'Tuya Smart (Calex/Amorom compatible)';
    }

    // CamHi Detection: RTSP port 554 + ONVIF port 8899 is unique to CamHi HiSilicon firmware
    else if (openPorts.includes(8899) && openPorts.includes(554)) {
      suggestedBrand = 'CamHi';
      suggestedType = 'camhi';
      suggestedCategory = 'camera';
      vendor = 'CamHi IP Camera';
    }

    // Wansview / ONVIF Detection: RTSP 554 + HTTP 80/8080
    else if (openPorts.includes(554)) {
      suggestedBrand = 'Wansview';
      suggestedType = 'wansview';
      suggestedCategory = 'camera';
      vendor = 'Wansview / ONVIF IP Camera';
    }

    return {
      ip,
      mac,
      vendor,
      openPorts,
      suggestedBrand,
      suggestedType,
      suggestedCategory
    };
  }
}

