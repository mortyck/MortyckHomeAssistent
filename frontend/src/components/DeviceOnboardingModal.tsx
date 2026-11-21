import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Key, Network, ShieldCheck, Zap } from 'lucide-react';
import { Device, DeviceCategory, ScanResult } from '../types';
import { addDevice, updateDevice, testDeviceConnection } from '../services/api';

interface DeviceOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefillScan?: ScanResult | null;
  editDevice?: Device | null;
  onDeviceAdded: (device: Device) => void;
  rooms: string[];
}

export const DeviceOnboardingModal: React.FC<DeviceOnboardingModalProps> = ({
  isOpen,
  onClose,
  prefillScan,
  editDevice,
  onDeviceAdded,
  rooms
}) => {
  const [activeTab, setActiveTab] = useState<'tuya' | 'camera' | 'bridge'>('tuya');

  // Form Fields
  const [name, setName] = useState('');
  const [location, setLocation] = useState<'Home' | 'Garage'>('Home');
  const [ip, setIp] = useState('');
  const [room, setRoom] = useState('Living Room');
  const [category, setCategory] = useState<DeviceCategory>('light');
  const [brand, setBrand] = useState<'Tuya' | 'Calex' | 'Amorom' | 'CamHi' | 'Wansview' | 'Blurams' | 'Generic'>('Tuya');

  // Tuya Specific
  const [devId, setDevId] = useState('');
  const [localKey, setLocalKey] = useState('');
  const [tuyaVersion, setTuyaVersion] = useState<'3.1' | '3.3' | '3.4' | '3.5'>('3.3');

  // Camera Specific
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [rtspPort, setRtspPort] = useState<number>(554);
  const [rtspPath, setRtspPath] = useState('/11');
  const [onvifPort, setOnvifPort] = useState(8899);

  // Bridge Specific
  const [bridgeType, setBridgeType] = useState<'blurams_rtsp' | 'homeassistant' | 'webhook'>('blurams_rtsp');
  const [bluramsDeviceId, setBluramsDeviceId] = useState('1800420411702000132815');
  const [bridgeRtspUrl, setBridgeRtspUrl] = useState('rtsp://127.0.0.1:8556/blurams_garage');
  const [bridgeStreamName, setBridgeStreamName] = useState('blurams_garage');
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');

  // Status & Testing
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editDevice) {
      setName(editDevice.name || '');
      setLocation(editDevice.location || 'Home');
      setIp(editDevice.ip || '');
      setRoom(editDevice.room || 'Living Room');
      setCategory(editDevice.category || 'light');
      setBrand(editDevice.brand || 'Tuya');

      if (editDevice.type === 'bridge') {
        setActiveTab('bridge');
        setBridgeType((editDevice.bridge?.bridgeType as any) || 'blurams_rtsp');
        setBluramsDeviceId(editDevice.bridge?.entityId || '1800420411702000132815');
        setBridgeRtspUrl(editDevice.camera?.rtspUrl || 'ffmpeg:rtsp://127.0.0.1:8556/blurams_garage#video=h264');
        setBridgeStreamName(editDevice.camera?.streamName || 'blurams_garage');
        setEndpoint(editDevice.bridge?.endpoint || '');
        setToken(editDevice.bridge?.token || '');
      } else if (editDevice.category === 'camera' || editDevice.type === 'camhi' || editDevice.type === 'wansview' || editDevice.type === 'onvif') {
        setActiveTab('camera');
        setUsername(editDevice.camera?.username || 'admin');
        setPassword(editDevice.camera?.password || '');
        setRtspPort(editDevice.port || 554);
        setRtspPath(editDevice.camera?.rtspPath || '/live/ch0');
        setOnvifPort(editDevice.camera?.onvifPort || 8899);
      } else {
        setActiveTab('tuya');
        setDevId(editDevice.tuya?.devId || '');
        setLocalKey(editDevice.tuya?.localKey || '');
        setTuyaVersion(editDevice.tuya?.version || '3.3');
      }
      return;
    }

    if (prefillScan) {
      setIp(prefillScan.ip);
      if (prefillScan.suggestedType === 'tuya') {
        setActiveTab('tuya');
        setBrand(prefillScan.suggestedBrand === 'Calex' ? 'Calex' : 'Tuya');
        setName(`${prefillScan.suggestedBrand} Device`);
        setCategory(prefillScan.suggestedCategory);
      } else if (prefillScan.suggestedType === 'camhi') {
        setActiveTab('camera');
        setBrand('CamHi');
        setName('CamHi PTZ Camera');
        setCategory('camera');
        setRtspPath('/11');
        setOnvifPort(8899);
      } else if (prefillScan.suggestedType === 'wansview') {
        setActiveTab('camera');
        setBrand('Wansview');
        setName('Wansview Camera');
        setCategory('camera');
        setRtspPath('/live/ch0');
        setOnvifPort(80);
      }
    }
  }, [prefillScan, editDevice, isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const isBridge = activeTab === 'bridge';
    const effectiveIp = isBridge ? (ip || '192.168.8.161') : ip;

    const partialDevice: Partial<Device> = {
      ip: effectiveIp,
      type: isBridge ? 'bridge' : (activeTab === 'camera' ? (brand === 'CamHi' ? 'camhi' : 'wansview') : activeTab),
      category: isBridge ? 'camera' : category,
      port: activeTab === 'tuya' ? 6668 : (isBridge ? 8556 : (rtspPort || 554)),
      tuya: activeTab === 'tuya' ? { devId, localKey, version: tuyaVersion } : undefined,
      camera: activeTab === 'camera'
        ? { username, password, rtspPath, onvifPort }
        : (isBridge ? { streamName: bridgeStreamName, rtspUrl: bridgeRtspUrl } : undefined),
      bridge: isBridge ? { bridgeType, endpoint, token, entityId: bluramsDeviceId } : undefined
    };

    try {
      const res = await testDeviceConnection(partialDevice);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const isBridge = activeTab === 'bridge';
    const cameraAuth = (username && password) ? `${username}:${password}@` : (username ? `${username}@` : '');
    const cameraDefaultPath = brand === 'CamHi' ? '/11' : '/live/ch0';
    const cameraCleanPath = (rtspPath || cameraDefaultPath).startsWith('/')
      ? (rtspPath || cameraDefaultPath)
      : '/' + (rtspPath || cameraDefaultPath);
    const effectiveRtspPort = rtspPort || 554;
    const cameraRtspUrl = isBridge
      ? (bridgeRtspUrl || 'ffmpeg:rtsp://127.0.0.1:8556/blurams_garage#video=h264')
      : `rtsp://${cameraAuth}${ip}:${effectiveRtspPort}${cameraCleanPath}`;

    const newDevice: Partial<Device> = {
      name: name || (isBridge ? (brand === 'Blurams' ? 'Blurams Garage' : 'Bridge Camera') : `${brand} Device`),
      location,
      category: isBridge ? 'camera' : category,
      type: isBridge ? 'bridge' : (activeTab === 'camera' ? (brand === 'CamHi' ? 'camhi' : 'wansview') : activeTab),
      brand: isBridge ? (brand || 'Blurams') : brand,
      room,
      ip: isBridge ? (ip || '192.168.8.161') : ip,
      port: activeTab === 'tuya' ? 6668 : (isBridge ? 8556 : (rtspPort || 554)),
      state: (activeTab === 'camera' || isBridge) ? { stream_status: 'ready', motion_detected: false } : { power: false },
      tuya: activeTab === 'tuya' ? { devId, localKey, version: tuyaVersion } : undefined,
      camera: (activeTab === 'camera' || isBridge) ? {
        username: isBridge ? undefined : username,
        password: isBridge ? undefined : password,
        rtspPath: isBridge ? `/${bridgeStreamName}` : rtspPath,
        onvifPort: isBridge ? undefined : onvifPort,
        rtspUrl: cameraRtspUrl,
        streamName: isBridge ? bridgeStreamName : undefined
      } : undefined,
      bridge: isBridge ? {
        bridgeType,
        endpoint: bridgeType === 'homeassistant' ? endpoint : bridgeRtspUrl,
        token,
        entityId: bluramsDeviceId
      } : undefined
    };

    try {
      const saved = editDevice
        ? await updateDevice(editDevice.id, newDevice)
        : await addDevice(newDevice);
      onDeviceAdded(saved);
      onClose();
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/80 p-4">
      <div className="relative w-full max-w-xl rounded-2xl bg-[#1A1D24] border border-[#2A2E39] p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2A2E39]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#262A34] text-[#10B981] flex items-center justify-center">
              <Network size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#FFFFFF]">Add Device</h3>
              <p className="text-xs text-[#8E95A5]">
                Configure Tuya local keys or camera RTSP streaming
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="touch-btn w-10 h-10 rounded-lg text-[#8E95A5] hover:text-[#FFFFFF] transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-3 gap-2 my-4 p-1.5 rounded-xl bg-[#0F1115] border border-[#2A2E39]">
          <button
            type="button"
            onClick={() => {
              setActiveTab('tuya');
              setCategory('light');
              setBrand('Tuya');
            }}
            className={`touch-btn py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeTab === 'tuya' ? 'bg-[#262A34] text-[#FFFFFF]' : 'text-[#8E95A5] hover:text-[#FFFFFF]'
            }`}
          >
            Tuya / Calex
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('camera');
              setCategory('camera');
              setBrand('CamHi');
            }}
            className={`touch-btn py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeTab === 'camera' ? 'bg-[#262A34] text-[#FFFFFF]' : 'text-[#8E95A5] hover:text-[#FFFFFF]'
            }`}
          >
            IP Cameras
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('bridge');
              setCategory('camera');
              setBrand('Blurams');
              setLocation('Garage');
              setRoom('Garage');
              setBridgeType('blurams_rtsp');
              setName((prev) => (prev && prev !== 'Tuya Device' && prev !== 'CamHi PTZ Camera' && prev !== 'Wansview Camera') ? prev : 'Blurams Garage');
              setIp('192.168.8.161');
              setBridgeRtspUrl('rtsp://127.0.0.1:8556/blurams_garage');
              setBridgeStreamName('blurams_garage');
            }}
            className={`touch-btn py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              activeTab === 'bridge' ? 'bg-[#262A34] text-[#FFFFFF]' : 'text-[#8E95A5] hover:text-[#FFFFFF]'
            }`}
          >
            HA Bridge
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1.5">
                Device Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Living Room Lamp"
                className="w-full h-12 bg-[#0F1115] border border-[#2A2E39] rounded-xl px-4 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1.5">
                Location
              </label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value as any)}
                className="w-full h-12 bg-[#0F1115] border border-[#2A2E39] rounded-xl px-4 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
              >
                <option value="Home">Home (192.168.1.x)</option>
                <option value="Garage">Garage (192.168.8.x)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1.5">
                Room
              </label>
              <select
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                className="w-full h-12 bg-[#0F1115] border border-[#2A2E39] rounded-xl px-4 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
              >
                {rooms.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                {!rooms.includes(room) && <option value={room}>{room}</option>}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1.5">
                IP Address
              </label>
              <input
                type="text"
                required
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.10"
                className="w-full h-12 bg-[#0F1115] border border-[#2A2E39] rounded-xl px-4 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1.5">
                Brand
              </label>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value as any)}
                className="w-full h-12 bg-[#0F1115] border border-[#2A2E39] rounded-xl px-4 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
              >
                {activeTab === 'tuya' && (
                  <>
                    <option value="Calex">Calex (Tuya protocol)</option>
                    <option value="Amorom">Amorom (Tuya protocol)</option>
                    <option value="Tuya">Tuya Standard</option>
                  </>
                )}
                {activeTab === 'camera' && (
                  <>
                    <option value="CamHi">CamHi</option>
                    <option value="Wansview">Wansview</option>
                    <option value="Generic">Generic ONVIF Camera</option>
                  </>
                )}
                {activeTab === 'bridge' && (
                  <>
                    <option value="Blurams">Blurams (via HA)</option>
                    <option value="Generic">Custom Webhook / REST</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Tuya Credentials */}
          {activeTab === 'tuya' && (
            <div className="p-4 rounded-xl bg-[#0F1115] border border-[#2A2E39] space-y-3">
              <div className="flex items-center space-x-2 text-xs text-[#10B981] font-bold">
                <Key size={16} />
                <span>Tuya Local Key & Protocol v3.3</span>
              </div>
              <div>
                <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                  Device ID (devId)
                </label>
                <input
                  type="text"
                  required
                  value={devId}
                  onChange={(e) => setDevId(e.target.value)}
                  placeholder="e.g. bf3894721a990021c3xyd"
                  className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    Local Key (16 chars)
                  </label>
                  <input
                    type="password"
                    required
                    value={localKey}
                    onChange={(e) => setLocalKey(e.target.value)}
                    placeholder="16-character key"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    Protocol Version
                  </label>
                  <select
                    value={tuyaVersion}
                    onChange={(e) => setTuyaVersion(e.target.value as any)}
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  >
                    <option value="3.3">v3.3 (Standard)</option>
                    <option value="3.4">v3.4 (Modern)</option>
                    <option value="3.5">v3.5 (Latest)</option>
                    <option value="3.1">v3.1 (Legacy)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Camera Credentials */}
          {activeTab === 'camera' && (
            <div className="p-4 rounded-xl bg-[#0F1115] border border-[#2A2E39] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs text-[#10B981] font-bold">
                  <ShieldCheck size={16} />
                  <span>RTSP Stream & ONVIF PTZ</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBrand('CamHi');
                      setRtspPort(554);
                      setRtspPath('/11');
                      setOnvifPort(8899);
                    }}
                    className="touch-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#262A34] text-[#FFFFFF] hover:bg-[#323744]"
                  >
                    CamHi (:554)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBrand('Wansview');
                      setRtspPort(554);
                      setRtspPath('/live/ch0');
                      setOnvifPort(80);
                    }}
                    className="touch-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#262A34] text-[#FFFFFF] hover:bg-[#323744]"
                  >
                    Wansview (:554)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBrand('Generic');
                      setRtspPort(8554);
                      setRtspPath('/live/ch0');
                      setOnvifPort(8000);
                    }}
                    className="touch-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#262A34] text-[#FFFFFF] hover:bg-[#323744]"
                  >
                    Custom (:8554/8000)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    RTSP Port
                  </label>
                  <input
                    type="number"
                    value={rtspPort}
                    onChange={(e) => setRtspPort(Number(e.target.value))}
                    placeholder="554 or 8554"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    ONVIF Port
                  </label>
                  <input
                    type="number"
                    value={onvifPort}
                    onChange={(e) => setOnvifPort(Number(e.target.value))}
                    placeholder="8899 or 8000"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                    RTSP Path
                  </label>
                  <input
                    type="text"
                    value={rtspPath}
                    onChange={(e) => setRtspPath(e.target.value)}
                    placeholder="/11 or /live/ch0"
                    className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bridge Fields */}
          {activeTab === 'bridge' && (
            <div className="p-4 rounded-xl bg-[#0F1115] border border-[#2A2E39] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs text-[#10B981] font-bold">
                  <Network size={16} />
                  <span>Cloud Camera & Bridge Adapters</span>
                </div>
                <div className="flex items-center space-x-1.5 p-1 bg-[#1A1D24] rounded-lg border border-[#2A2E39]">
                  <button
                    type="button"
                    onClick={() => {
                      setBridgeType('blurams_rtsp');
                      setBrand('Blurams');
                      setLocation('Garage');
                      setRoom('Garage');
                      setName('Blurams Garage');
                      setIp('192.168.8.161');
                      setBridgeRtspUrl('rtsp://127.0.0.1:8556/blurams_garage');
                      setBridgeStreamName('blurams_garage');
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      bridgeType === 'blurams_rtsp'
                        ? 'bg-[#10B981] text-[#FFFFFF]'
                        : 'text-[#8E95A5] hover:text-[#FFFFFF]'
                    }`}
                  >
                    Blurams RTSP
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBridgeType('homeassistant');
                      setName('HA Camera');
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      bridgeType === 'homeassistant'
                        ? 'bg-[#10B981] text-[#FFFFFF]'
                        : 'text-[#8E95A5] hover:text-[#FFFFFF]'
                    }`}
                  >
                    Home Assistant
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBridgeType('webhook');
                      setName('Webhook Stream');
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      bridgeType === 'webhook'
                        ? 'bg-[#10B981] text-[#FFFFFF]'
                        : 'text-[#8E95A5] hover:text-[#FFFFFF]'
                    }`}
                  >
                    Webhook
                  </button>
                </div>
              </div>

              {/* Blurams RTSP Container Mode */}
              {bridgeType === 'blurams_rtsp' && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                        Blurams Device ID
                      </label>
                      <input
                        type="text"
                        required
                        value={bluramsDeviceId}
                        onChange={(e) => setBluramsDeviceId(e.target.value)}
                        placeholder="1800420411702000132815"
                        className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                        go2rtc Stream Name
                      </label>
                      <input
                        type="text"
                        required
                        value={bridgeStreamName}
                        onChange={(e) => setBridgeStreamName(e.target.value)}
                        placeholder="blurams_garage"
                        className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                      Local RTSP Stream / Bridge URL
                    </label>
                    <input
                      type="text"
                      required
                      value={bridgeRtspUrl}
                      onChange={(e) => setBridgeRtspUrl(e.target.value)}
                      placeholder="rtsp://127.0.0.1:8556/blurams_garage"
                      className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                    />
                  </div>

                  <p className="text-[11px] text-[#8E95A5] bg-[#1A1D24] p-2.5 rounded-lg border border-[#2A2E39]/60">
                    Exposed by the <code className="text-[#10B981]">blurams-rtsp</code> container service on port 8556 and restreamed in WebRTC by <code className="text-[#10B981]">go2rtc</code> under <span className="text-[#FFFFFF] font-semibold">{bridgeStreamName}</span>.
                  </p>
                </div>
              )}

              {/* Home Assistant REST Mode */}
              {bridgeType === 'homeassistant' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                      HA Camera Proxy Endpoint
                    </label>
                    <input
                      type="text"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="http://192.168.1.200:8123/api/camera_proxy/camera.blurams"
                      className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                      Long-Lived Bearer Token
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                      className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                    />
                  </div>
                </div>
              )}

              {/* Webhook Mode */}
              {bridgeType === 'webhook' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs text-[#8E95A5] font-semibold mb-1">
                      Webhook Ingestion Path
                    </label>
                    <input
                      type="text"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder="/api/webhooks/blurams_motion"
                      className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] font-mono focus:outline-none focus:border-[#10B981]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Test Result Banner */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl flex items-center space-x-2.5 text-xs font-medium ${
                testResult.success
                  ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
                  : 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30'
              }`}
            >
              {testResult.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-[#2A2E39]">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || !ip}
              className="touch-btn px-4 py-2.5 rounded-xl bg-[#262A34] hover:bg-[#323744] text-xs text-[#FFFFFF] font-semibold transition cursor-pointer disabled:opacity-40"
            >
              <Zap size={15} className="mr-1.5 text-[#F59E0B]" />
              {isTesting ? 'Testing Link...' : 'Test Connection'}
            </button>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="touch-btn px-4 py-2.5 rounded-xl bg-[#262A34] hover:bg-[#323744] text-xs text-[#8E95A5] hover:text-[#FFFFFF] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="touch-btn px-5 py-2.5 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#FFFFFF] font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Device'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
