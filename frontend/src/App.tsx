import React, { useState, useEffect, useCallback } from 'react';
import { Device, AutomationRule, ScanResult, SystemStatus, RemotePc, LocationType } from './types';
import {
  fetchDevices,
  fetchAutomations,
  fetchRooms,
  fetchSystemStatus,
  fetchPcs,
  deleteDevice,
  savePc
} from './services/api';
import { WebSocketClient } from './services/websocket';
import { Navbar } from './components/Navbar';
import { MultiCameraWall } from './components/MultiCameraWall';
import { TuyaDeviceCard } from './components/TuyaDeviceCard';
import { RemotePcCard } from './components/RemotePcCard';
import { NetworkScannerModal } from './components/NetworkScannerModal';
import { DeviceOnboardingModal } from './components/DeviceOnboardingModal';
import { AutomationsModal } from './components/AutomationsModal';
import { JarvisMainTerminal } from './components/JarvisMainTerminal';
import { SystemSettingsModal } from './components/SystemSettingsModal';
import { Zap, AlertCircle, Monitor, Plus, X, Save } from 'lucide-react';

export const App: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pcs, setPcs] = useState<RemotePc[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);

  // Two Locations: 'Home' and 'Garage' (or 'All')
  const [selectedLocation, setSelectedLocation] = useState<LocationType | 'All'>('Garage');

  // View modes
  const [viewMode, setViewMode] = useState<'overview' | 'cameras' | 'devices' | 'pcs'>('overview');

  // Modals state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [prefillScan, setPrefillScan] = useState<ScanResult | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);

  // Add Remote PC form state (shared across Overview and Remote PCs tabs)
  const [isAddPcOpen, setIsAddPcOpen] = useState(false);
  const [newPcName, setNewPcName] = useState('');
  const [newPcLocation, setNewPcLocation] = useState<LocationType>('Garage');
  const [newPcIp, setNewPcIp] = useState('');
  const [newPcMac, setNewPcMac] = useState('');
  const [newPcVncPort, setNewPcVncPort] = useState<number>(5900);
  const [newPcAnydesk, setNewPcAnydesk] = useState('');
  const [isSavingPc, setIsSavingPc] = useState(false);

  // Active motion alert toast
  const [activeMotionAlert, setActiveMotionAlert] = useState<{
    deviceName: string;
    time: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [devs, remotePcs, autos, rms, stat] = await Promise.all([
        fetchDevices(),
        fetchPcs().catch(() => []),
        fetchAutomations(),
        fetchRooms(),
        fetchSystemStatus().catch(() => null)
      ]);
      setDevices(devs);
      setPcs(remotePcs);
      setAutomations(autos);
      setRooms(rms);
      if (stat) setStatus(stat);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }, []);

  useEffect(() => {
    loadData();

    const ws = WebSocketClient.getInstance();
    const unsubscribe = ws.subscribe((event, data) => {
      switch (event) {
        case 'device_state':
          setDevices((prev) =>
            prev.map((d) =>
              d.id === data.deviceId ? { ...d, state: { ...d.state, ...data.state } } : d
            )
          );
          break;

        case 'device_online':
          setDevices((prev) =>
            prev.map((d) => (d.id === data.deviceId ? { ...d, online: data.online } : d))
          );
          break;

        case 'pc_status':
          setPcs((prev) =>
            prev.map((p) =>
              p.id === data.id
                ? {
                    ...p,
                    online: data.online,
                    vncPortOpen: data.vncPortOpen,
                    lastPingMs: data.latencyMs,
                    lastSeen: Date.now()
                  }
                : p
            )
          );
          break;

        case 'pc_updated':
        case 'pc_deleted':
          fetchPcs().then(setPcs);
          break;

        case 'motion_event':
          setDevices((prev) => {
            const matched = prev.find((d) => d.id === data.deviceId);
            if (matched && data.detected) {
              setActiveMotionAlert({
                deviceName: matched.name,
                time: new Date().toLocaleTimeString()
              });
              setTimeout(() => setActiveMotionAlert(null), 5000);
            }
            return prev.map((d) =>
              d.id === data.deviceId
                ? { ...d, state: { ...d.state, motion_detected: data.detected } }
                : d
            );
          });
          break;

        case 'device_added':
        case 'device_updated':
        case 'device_removed':
          loadData();
          break;
      }
    });

    const statusInterval = setInterval(async () => {
      try {
        const stat = await fetchSystemStatus();
        setStatus(stat);
        const remotePcs = await fetchPcs();
        setPcs(remotePcs);
      } catch {}
    }, 15000);

    return () => {
      unsubscribe();
      clearInterval(statusInterval);
    };
  }, [loadData]);

  const handleDeviceAdded = (device: Device) => {
    setDevices((prev) => {
      const filtered = prev.filter((d) => d.id !== device.id);
      return [...filtered, device];
    });
    setEditingDevice(null);
  };

  const handleEditDevice = (device: Device) => {
    setPrefillScan(null);
    setEditingDevice(device);
    setIsOnboardingOpen(true);
  };

  const handleDeleteDevice = async (id: string) => {
    const dev = devices.find((d) => d.id === id);
    const name = dev?.name || 'this device';
    if (window.confirm(`Are you sure you want to remove "${name}"?`)) {
      try {
        await deleteDevice(id);
        setDevices((prev) => prev.filter((d) => d.id !== id));
      } catch (err: any) {
        alert(`Failed to delete: ${err.message}`);
      }
    }
  };

  const handleCreatePc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPcIp.trim() || !newPcMac.trim()) return;
    setIsSavingPc(true);
    try {
      const portNum = Number(newPcVncPort) || 5900;
      const pcId = `pc-${Date.now().toString(36)}`;
      const created = await savePc({
        id: pcId,
        name: newPcName.trim() || 'Remote Workstation',
        location: newPcLocation,
        ip: newPcIp.trim(),
        mac: newPcMac.trim(),
        vncPort: portNum,
        broadcastAddress: newPcLocation === 'Garage' ? '192.168.8.255' : '192.168.1.255',
        anydeskId: newPcAnydesk.trim() || 'noVNC',
        webViewerUrl: `/novnc/vnc.html?autoconnect=true&resize=scale&pcId=${encodeURIComponent(
          pcId
        )}&host=${encodeURIComponent(newPcIp.trim())}&port=${portNum}`,
        online: false
      });
      setPcs((prev) => [...prev, created]);
      setIsAddPcOpen(false);
      setNewPcName('');
      setNewPcIp('');
      setNewPcMac('');
      setNewPcVncPort(5900);
      setNewPcAnydesk('');
      await loadData();
    } catch (err: any) {
      alert(`Failed to add Workstation: ${err.message}`);
    } finally {
      setIsSavingPc(false);
    }
  };

  const handleSelectDeviceForOnboard = (scan: ScanResult) => {
    setEditingDevice(null);
    setPrefillScan(scan);
    setIsOnboardingOpen(true);
  };

  const handleOpenModalFromJarvis = (
    modal: 'scanner' | 'onboarding' | 'automations' | 'settings'
  ) => {
    if (modal === 'scanner') setIsScannerOpen(true);
    if (modal === 'onboarding') {
      setEditingDevice(null);
      setPrefillScan(null);
      setIsOnboardingOpen(true);
    }
    if (modal === 'automations') setIsAutomationsOpen(true);
    if (modal === 'settings') setIsSettingsOpen(true);
  };

  // Filter devices by selected location (Home, Garage, or All)
  const locationDevices =
    selectedLocation === 'All'
      ? devices
      : devices.filter((d) => (d.location || 'Home') === selectedLocation);

  const cameraDevices = locationDevices.filter((d) => d.category === 'camera');
  const iotDevices = locationDevices.filter((d) => d.category !== 'camera');

  const locationPcs =
    selectedLocation === 'All' ? pcs : pcs.filter((p) => p.location === selectedLocation);

  const renderAddWorkstationForm = () => {
    if (!isAddPcOpen) return null;
    return (
      <form
        onSubmit={handleCreatePc}
        className="dash-card p-4 border border-[#00F0FF]/45 space-y-3"
      >
        <div className="flex items-center justify-between border-b border-[#00F0FF]/20 pb-2">
          <div className="flex items-center gap-2 text-xs font-hud font-bold text-[#00F0FF]">
            <Monitor size={15} />
            <span>REGISTER NEW WORKSTATION // WAKE-ON-LAN &amp; noVNC</span>
          </div>
          <button
            type="button"
            onClick={() => setIsAddPcOpen(false)}
            className="w-7 h-7 rounded-lg bg-[#081326] text-[#7C99B8] hover:text-[#FFFFFF] flex items-center justify-center cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-mono text-[#7C99B8] uppercase mb-1">
              Workstation Name *
            </label>
            <input
              type="text"
              required
              value={newPcName}
              onChange={(e) => setNewPcName(e.target.value)}
              placeholder="e.g. Garage PC"
              className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] focus:outline-none focus:border-[#00F0FF]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-[#7C99B8] uppercase mb-1">
              Sector *
            </label>
            <select
              value={newPcLocation}
              onChange={(e) => setNewPcLocation(e.target.value as LocationType)}
              className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] focus:outline-none focus:border-[#00F0FF]"
            >
              <option value="Garage">Garage (192.168.8.x)</option>
              <option value="Home">Home (192.168.1.x)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono text-[#7C99B8] uppercase mb-1">
              IP Address *
            </label>
            <input
              type="text"
              required
              value={newPcIp}
              onChange={(e) => setNewPcIp(e.target.value)}
              placeholder="192.168.8.116"
              className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-[#7C99B8] uppercase mb-1">
              MAC Address (WoL) *
            </label>
            <input
              type="text"
              required
              value={newPcMac}
              onChange={(e) => setNewPcMac(e.target.value)}
              placeholder="D8:12:65:04:28:B5"
              className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-[#7C99B8] uppercase mb-1">
              VNC Port
            </label>
            <input
              type="number"
              value={newPcVncPort}
              onChange={(e) => setNewPcVncPort(parseInt(e.target.value || '5900', 10))}
              placeholder="5900"
              className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
            />
          </div>
          <button
            type="submit"
            disabled={isSavingPc}
            className="h-10 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Save size={14} />
            <span>{isSavingPc ? 'Saving...' : 'Save Workstation'}</span>
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="h-screen w-screen overflow-hidden text-[#E2F1FF] flex flex-col font-sans bg-[#050A14]">
      {/* Top M.A.R.V.I.N. Tactical HUD Bar */}
      <Navbar
        status={status}
        selectedLocation={selectedLocation}
        onSelectLocation={setSelectedLocation}
        onOpenScanner={() => setIsScannerOpen(true)}
        onOpenAddDevice={() => {
          setEditingDevice(null);
          setPrefillScan(null);
          setIsOnboardingOpen(true);
        }}
        onOpenAutomations={() => setIsAutomationsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
      />

      {/* Motion Trigger Alert Toast */}
      {activeMotionAlert && (
        <div className="fixed top-24 right-6 z-50">
          <div className="px-5 py-3.5 rounded-xl bg-[#EF4444]/95 text-[#FFFFFF] flex items-center space-x-3 shadow-2xl border border-[#FF9E00]">
            <AlertCircle size={20} />
            <div>
              <div className="font-bold font-hud text-xs">TACTICAL ALERT // MOTION DETECTED</div>
              <div className="text-xs text-[#FEE2E2] font-mono">
                {activeMotionAlert.deviceName} &bull; {activeMotionAlert.time}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Split Workspace: Left Fluid Grid + Right Docked Vertical J.A.R.V.I.S. Console */}
      <div className="flex-1 flex flex-row min-h-0 min-w-0 overflow-hidden">
        {/* Left Main Workspace (Never overflows horizontally, adapts to sidebar width) */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6 space-y-6">
          {/* VIEW MODE: OVERVIEW */}
          {viewMode === 'overview' && (
            <div className="space-y-6">
              {/* Remote Workstations Section */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#00F0FF]/15">
                  <div className="flex items-center space-x-2">
                    <Monitor className="text-[#00F0FF]" size={18} />
                    <h2 className="text-xs md:text-sm font-bold font-hud uppercase tracking-wider text-[#FFFFFF]">
                      REMOTE WORKSTATIONS // WOL &amp; LIVE VNC &bull; {selectedLocation}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddPcOpen((prev) => !prev)}
                    className="px-3.5 h-9 rounded-xl bg-[#00F0FF]/15 hover:bg-[#00F0FF] text-[#00F0FF] hover:text-[#050A14] border border-[#00F0FF]/45 text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Add Workstation</span>
                  </button>
                </div>

                {renderAddWorkstationForm()}

                {locationPcs.length > 0 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {locationPcs.map((pc) => (
                      <RemotePcCard key={pc.id} pc={pc} onRefresh={loadData} />
                    ))}
                  </div>
                )}
              </section>

              {/* Split Grid: Live Cameras + Smart IoT Units */}
              <div className="grid grid-cols-1 2xl:grid-cols-12 gap-6 items-start">
                {/* Live Camera Matrix */}
                <div className="2xl:col-span-8 space-y-3 min-w-0">
                  <MultiCameraWall
                    cameras={cameraDevices}
                    selectedRoom="All"
                    onAddCamera={() => {
                      setEditingDevice(null);
                      setPrefillScan(null);
                      setIsOnboardingOpen(true);
                    }}
                    onEditCamera={handleEditDevice}
                    onDeleteCamera={handleDeleteDevice}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                  />
                </div>

                {/* Smart Home IoT Controls */}
                <div className="2xl:col-span-4 space-y-3 min-w-0">
                  <div className="flex items-center justify-between pb-2 border-b border-[#00F0FF]/15">
                    <div className="flex items-center space-x-2">
                      <Zap className="text-[#FF9E00]" size={18} />
                      <h2 className="text-xs md:text-sm font-bold font-hud uppercase tracking-wider text-[#FFFFFF]">
                        SMART IOT UNITS ({iotDevices.length})
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDevice(null);
                        setPrefillScan(null);
                        setIsOnboardingOpen(true);
                      }}
                      className="px-3 h-8 rounded-lg bg-[#081326] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/30 text-xs font-mono text-[#00F0FF] flex items-center gap-1 cursor-pointer"
                    >
                      <Plus size={13} /> Add Unit
                    </button>
                  </div>

                  {iotDevices.length === 0 ? (
                    <div className="p-6 text-center rounded-2xl dash-card text-xs text-[#7C99B8] font-mono">
                      No smart devices in {selectedLocation}. Click &ldquo;Add Unit&rdquo; to onboard one.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {iotDevices.map((device) => (
                        <TuyaDeviceCard
                          key={device.id}
                          device={device}
                          onEdit={handleEditDevice}
                          onDelete={handleDeleteDevice}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIEW MODE: ALL CAMERAS */}
          {viewMode === 'cameras' && (
            <div className="space-y-4">
              <MultiCameraWall
                cameras={
                  selectedLocation === 'All'
                    ? devices.filter((d) => d.category === 'camera')
                    : cameraDevices
                }
                selectedRoom="All"
                onAddCamera={() => {
                  setEditingDevice(null);
                  setPrefillScan(null);
                  setIsOnboardingOpen(true);
                }}
                onEditCamera={handleEditDevice}
                onDeleteCamera={handleDeleteDevice}
                onOpenSettings={() => setIsSettingsOpen(true)}
              />
            </div>
          )}

          {/* VIEW MODE: SMART DEVICES */}
          {viewMode === 'devices' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#00F0FF]/15">
                <div className="flex items-center space-x-2">
                  <Zap className="text-[#FF9E00]" size={18} />
                  <h2 className="text-sm md:text-base font-bold font-hud text-[#FFFFFF]">
                    SMART IOT MATRIX &bull; {selectedLocation} ({iotDevices.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingDevice(null);
                    setPrefillScan(null);
                    setIsOnboardingOpen(true);
                  }}
                  className="px-4 h-9 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus size={15} /> Add Smart Device
                </button>
              </div>

              {iotDevices.length === 0 ? (
                <div className="p-10 text-center rounded-2xl dash-card text-sm text-[#7C99B8] font-mono">
                  No Smart IoT units registered in {selectedLocation}.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {iotDevices.map((device) => (
                    <TuyaDeviceCard
                      key={device.id}
                      device={device}
                      onEdit={handleEditDevice}
                      onDelete={handleDeleteDevice}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW MODE: REMOTE PCS */}
          {viewMode === 'pcs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#00F0FF]/15">
                <div className="flex items-center space-x-2">
                  <Monitor className="text-[#00F0FF]" size={18} />
                  <h2 className="text-sm md:text-base font-bold font-hud text-[#FFFFFF]">
                    REMOTE WORKSTATIONS // WOL &amp; LIVE VNC ({pcs.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddPcOpen((prev) => !prev)}
                  className="px-4 h-9 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Plus size={15} />
                  <span>Add Workstation</span>
                </button>
              </div>

              {renderAddWorkstationForm()}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {pcs.map((pc) => (
                  <RemotePcCard key={pc.id} pc={pc} onRefresh={loadData} />
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Sleek Vertical Docked M.A.R.V.I.N. AI Console Sidebar (Right Side, Full Viewport Height) */}
        <JarvisMainTerminal
          onSelectLocation={setSelectedLocation}
          onChangeViewMode={setViewMode}
          onOpenModal={handleOpenModalFromJarvis}
          onRefreshData={loadData}
        />
      </div>

      {/* System & Blurams Cloud Credentials Modal */}
      <SystemSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={loadData}
      />

      {/* Network Scanner Modal */}
      <NetworkScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onSelectDeviceForOnboard={handleSelectDeviceForOnboard}
      />

      {/* Device Onboarding & Edit Modal */}
      <DeviceOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => {
          setIsOnboardingOpen(false);
          setEditingDevice(null);
        }}
        prefillScan={prefillScan}
        editDevice={editingDevice}
        onDeviceAdded={handleDeviceAdded}
        rooms={rooms}
      />

      {/* Automations Modal */}
      <AutomationsModal
        isOpen={isAutomationsOpen}
        onClose={() => setIsAutomationsOpen(false)}
        automations={automations}
        devices={devices}
        onRefreshAutomations={loadData}
      />
    </div>
  );
};

export default App;
