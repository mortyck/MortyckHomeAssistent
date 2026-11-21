export type LocationType = 'Home' | 'Garage';
export type DeviceType = 'tuya' | 'camhi' | 'wansview' | 'onvif' | 'bridge';
export type DeviceCategory = 'light' | 'plug' | 'switch' | 'sensor' | 'camera' | 'custom';

export interface TuyaCredentials {
  devId: string;
  localKey: string;
  version?: '3.1' | '3.3' | '3.4' | '3.5';
}

export interface CameraCredentials {
  username?: string;
  password?: string;
  rtspPath?: string;
  subStreamPath?: string;
  rtspUrl?: string;
  streamName?: string;
  onvifPort?: number;
}

export interface BridgeCredentials {
  bridgeType: 'homeassistant' | 'webhook' | 'proxy' | 'blurams_rtsp';
  endpoint?: string;
  token?: string;
  entityId?: string;
}

export interface DeviceState {
  power?: boolean;
  brightness?: number;
  color_temp?: number;
  color_rgb?: string;
  current_power_w?: number;
  voltage_v?: number;
  current_a?: number;
  motion_detected?: boolean;
  temperature?: number;
  humidity?: number;
  stream_status?: 'ready' | 'starting' | 'error' | 'offline';
  webrtc_url?: string;
  [key: string]: any;
}

export interface Device {
  id: string;
  name: string;
  location: LocationType;
  category: DeviceCategory;
  type: DeviceType;
  brand: 'Tuya' | 'Calex' | 'Amorom' | 'CamHi' | 'Wansview' | 'Blurams' | 'Generic';
  room: string;
  ip: string;
  port?: number;
  mac?: string;
  online: boolean;
  lastSeen: number;
  tuya?: TuyaCredentials;
  camera?: CameraCredentials;
  bridge?: BridgeCredentials;
  state: DeviceState;
}

export interface RemotePc {
  id: string;
  name: string;
  location: LocationType;
  ip: string;
  mac: string;
  broadcastAddress?: string;
  vncPort?: number;
  vncPassword?: string;
  anydeskId: string;
  webViewerUrl?: string;
  relayDeviceId?: string;
  online: boolean;
  vncPortOpen?: boolean;
  lastPingMs?: number;
  lastSeen?: number;
}

export type PTZDirection = 'up' | 'down' | 'left' | 'right' | 'zoom_in' | 'zoom_out' | 'stop';

export interface PTZCommand {
  action: PTZDirection | 'preset';
  speed?: number;
  presetId?: number | string;
}

export interface AutomationTrigger {
  type: 'motion' | 'state_change' | 'webhook';
  deviceId?: string;
  property?: string;
  operator?: '==' | '!=' | '>' | '<' | 'is_true';
  value?: any;
}

export interface AutomationAction {
  type: 'device_command' | 'webhook_notify';
  deviceId: string;
  command: Record<string, any>;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  lastTriggered?: number;
}

export interface ScanResult {
  ip: string;
  mac?: string;
  vendor?: string;
  openPorts: number[];
  suggestedBrand: 'Tuya' | 'Calex' | 'Amorom' | 'CamHi' | 'Wansview' | 'ONVIF' | 'Unknown';
  suggestedType: DeviceType;
  suggestedCategory: DeviceCategory;
}

export interface BluramsBridgeStatus {
  online: boolean;
  deviceId?: string;
  cameraIp?: string;
  rtspPort?: number;
  streamName?: string;
  email?: string;
  hasCredentials?: boolean;
  hasCookie?: boolean;
  hasDirectStreamUrl?: boolean;
  directStreamUrl?: string;
  authenticated?: boolean;
  streamMode?: string;
  activeUrl?: string | null;
  lastError?: string | null;
  cameraPingReachable?: boolean;
}

export interface SystemStatus {
  backendUptime: number;
  go2rtcConnected: boolean;
  deviceCount: number;
  onlineCount: number;
  activeStreams: number;
  go2rtcUrl: string;
  pcCount?: number;
  pcsOnlineCount?: number;
  tailscaleConnected?: boolean;
  bluramsBridge?: BluramsBridgeStatus;
  aiProvider?: string;
}

export interface JarvisTraceStep {
  id: string;
  tag: 'SCAN' | 'RAG' | 'LIST' | 'READ' | 'EDIT' | 'WRITE' | 'DELETE' | 'BACKUP' | 'RESTART' | 'GEMINI' | 'CACHE' | 'EXEC' | 'ERROR';
  message: string;
  filePath?: string;
  lineRange?: string;
  backupFile?: string;
  timestamp: number;
}

export interface JarvisToolResult {
  tool: string;
  success: boolean;
  summary: string;
  backupFile?: string;
}

export interface JarvisTokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessionTokens: number;
  estimatedCostUsd: number;
  fastPath: boolean;
  localCacheHits?: number;
  estimatedTokensSaved?: number;
  savingsPercent?: number;
  ragSnippetFile?: string;
}

export interface JarvisChatResponse {
  reply: string;
  provider: string;
  toolResults: JarvisToolResult[];
  executionLog?: JarvisTraceStep[];
  tokenUsage?: JarvisTokenUsage;
  uiAction?: {
    location?: LocationType | 'All';
    viewMode?: 'overview' | 'cameras' | 'devices' | 'pcs';
    openModal?: 'scanner' | 'onboarding' | 'automations' | 'settings';
  };
}
