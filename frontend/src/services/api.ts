import {
  Device,
  AutomationRule,
  ScanResult,
  SystemStatus,
  PTZCommand,
  RemotePc,
  JarvisChatResponse,
  BluramsBridgeStatus
} from '../types';

const API_BASE = '/api';

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch(`${API_BASE}/system/status`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function fetchDevices(): Promise<Device[]> {
  const res = await fetch(`${API_BASE}/devices`);
  if (!res.ok) throw new Error('Failed to fetch devices');
  return res.json();
}

export async function addDevice(device: Partial<Device>): Promise<Device> {
  const res = await fetch(`${API_BASE}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device)
  });
  if (!res.ok) throw new Error('Failed to add device');
  return res.json();
}

export async function updateDevice(id: string, device: Partial<Device>): Promise<Device> {
  const res = await fetch(`${API_BASE}/devices/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device)
  });
  if (!res.ok) throw new Error('Failed to update device');
  return res.json();
}

export async function deleteDevice(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/devices/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete device');
}

export async function sendDeviceCommand(id: string, command: Record<string, any>): Promise<void> {
  const res = await fetch(`${API_BASE}/devices/${id}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error('Failed to send command');
}

export async function sendPtzCommand(id: string, command: PTZCommand): Promise<void> {
  const res = await fetch(`${API_BASE}/devices/${id}/ptz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error('Failed to send PTZ command');
}

export async function triggerCameraMotion(id: string, detected: boolean = true): Promise<void> {
  const res = await fetch(`${API_BASE}/devices/${id}/motion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detected })
  });
  if (!res.ok) throw new Error('Failed to trigger motion');
}

export async function testDeviceConnection(device: Partial<Device>): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/devices/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device)
  });
  return res.json();
}

// --- REMOTE PCS & POWER MANAGEMENT ---
export async function fetchPcs(): Promise<RemotePc[]> {
  const res = await fetch(`${API_BASE}/pcs`);
  if (!res.ok) throw new Error('Failed to fetch PCs');
  return res.json();
}

export async function savePc(pc: Partial<RemotePc>): Promise<RemotePc> {
  const res = await fetch(`${API_BASE}/pcs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pc)
  });
  if (!res.ok) throw new Error('Failed to save PC');
  return res.json();
}

export async function updatePc(id: string, pc: Partial<RemotePc>): Promise<RemotePc> {
  const res = await fetch(`${API_BASE}/pcs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pc)
  });
  if (!res.ok) throw new Error('Failed to update PC');
  return res.json();
}

export async function deletePc(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/pcs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete PC');
}

export async function wakePc(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/pcs/${id}/wake`, { method: 'POST' });
  return res.json();
}

export async function triggerRelayPulse(id: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/pcs/${id}/relay-pulse`, { method: 'POST' });
  return res.json();
}

export async function pingPc(id: string): Promise<{ online: boolean; vncPortOpen?: boolean; latencyMs?: number }> {
  const res = await fetch(`${API_BASE}/pcs/${id}/ping`, { method: 'POST' });
  return res.json();
}

export async function fetchPcVncStatus(id: string): Promise<{
  id: string;
  name: string;
  ip: string;
  vncPort: number;
  online: boolean;
  vncPortOpen: boolean;
  latencyMs?: number;
  wsPath: string;
  viewerUrl: string;
  activeSessions: number;
}> {
  const res = await fetch(`${API_BASE}/pcs/${id}/vnc-status`);
  if (!res.ok) throw new Error('Failed to check VNC status');
  return res.json();
}

// --- NETWORK SCANNER ---
export async function startNetworkScan(subnetPrefix?: string): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/scan/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subnetPrefix })
  });
  return res.json();
}

export async function fetchScanResults(): Promise<{ isScanning: boolean; results: ScanResult[] }> {
  const res = await fetch(`${API_BASE}/scan/results`);
  return res.json();
}

// --- AUTOMATIONS ---
export async function fetchAutomations(): Promise<AutomationRule[]> {
  const res = await fetch(`${API_BASE}/automations`);
  if (!res.ok) throw new Error('Failed to fetch automations');
  return res.json();
}

export async function saveAutomation(rule: AutomationRule): Promise<AutomationRule> {
  const res = await fetch(`${API_BASE}/automations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule)
  });
  return res.json();
}

export async function toggleAutomation(id: string): Promise<AutomationRule> {
  const res = await fetch(`${API_BASE}/automations/${id}/toggle`, { method: 'POST' });
  return res.json();
}

export async function deleteAutomation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/automations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete rule');
}

export async function fetchRooms(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/rooms`);
  return res.json();
}

// --- M.A.R.V.I.N. AI ASSISTANT & SQLITE MEMORY ENGINE ---
export async function sendJarvisCommand(message: string): Promise<JarvisChatResponse> {
  const res = await fetch(`${API_BASE}/marvin/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.error || data?.reply || `Google Gemini API / Backend Error (HTTP ${res.status})`
    );
  }
  return data;
}

export const sendMarvinCommand = sendJarvisCommand;

export async function fetchJarvisMemoryHistory(): Promise<{
  history: Array<{
    id: number;
    role: 'user' | 'jarvis';
    message: string;
    provider: string;
    tokensUsed: number;
    cacheHit: boolean;
    toolCallsJson?: string;
    createdAt: number;
  }>;
  telemetry: {
    localCacheHits: number;
    geminiApiCalls: number;
    geminiTokensUsed: number;
    estimatedTokensSaved: number;
    savingsPercent: number;
    indexedFilesCount: number;
    cachedIntentsCount: number;
    dbPath: string;
  };
}> {
  const res = await fetch(`${API_BASE}/marvin/history`);
  if (!res.ok) throw new Error('Failed to fetch SQLite memory history');
  return res.json();
}

export const fetchMarvinMemoryHistory = fetchJarvisMemoryHistory;

export async function rollbackLastAiChange(): Promise<{
  success: boolean;
  timestamp?: string;
  revertedCommit?: string;
  message?: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/marvin/rollback`, { method: 'POST' });
  const data = await res.json().catch(() => ({ success: false, error: 'Network response error' }));
  if (!res.ok) {
    throw new Error(data?.error || `Rollback failed (HTTP ${res.status})`);
  }
  return data;
}

export async function fetchGitStatus(): Promise<{
  initialized: boolean;
  branch?: string;
  commit?: string;
  hasOrigin?: boolean;
  remoteUrl?: string | null;
  isClean?: boolean;
  uncommittedFiles?: number;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/marvin/git-status`);
  if (!res.ok) throw new Error('Failed to fetch Git status');
  return res.json();
}

export async function fetchAiChangelog(): Promise<{ changelog: string }> {
  const res = await fetch(`${API_BASE}/marvin/changelog`);
  if (!res.ok) throw new Error('Failed to fetch changelog');
  return res.json();
}

export async function fetchMarvinTasks(): Promise<{ tasks: any[] }> {
  const res = await fetch(`${API_BASE}/marvin/tasks`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function saveMarvinTasks(tasks: any): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/marvin/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tasks)
  });
  if (!res.ok) throw new Error('Failed to save tasks');
  return res.json();
}

export async function fetchSystemSettings(): Promise<{
  settings: Record<string, any>;
  env: Record<string, any>;
  bluramsStatus: BluramsBridgeStatus;
  aiStatus: any;
}> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error('Failed to load system settings');
  return res.json();
}

export async function updateSystemSettings(envUpdates: Record<string, string>): Promise<{
  success: boolean;
  backupFile?: string;
  bluramsStatus: BluramsBridgeStatus;
  aiStatus: any;
}> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envUpdates })
  });
  if (!res.ok) throw new Error('Failed to save system settings');
  return res.json();
}

export async function reloadBluramsBridge(): Promise<any> {
  const res = await fetch(`${API_BASE}/blurams/reload`, { method: 'POST' });
  return res.json();
}
