import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Monitor,
  Power,
  ExternalLink,
  RefreshCw,
  Copy,
  Check,
  Radio,
  Terminal,
  Trash2,
  Edit3,
  Save,
  X,
  Maximize2,
  Minimize2,
  ScreenShare
} from 'lucide-react';
import { RemotePc, LocationType } from '../types';
import {
  wakePc,
  triggerRelayPulse,
  pingPc,
  deletePc,
  updatePc,
  fetchPcVncStatus
} from '../services/api';

interface RemotePcCardProps {
  pc: RemotePc;
  onRefresh: () => void;
}

export const RemotePcCard: React.FC<RemotePcCardProps> = ({ pc, onRefresh }) => {
  const [isWaking, setIsWaking] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Full-Viewport Portal Modal State for noVNC Live Screen
  const [showVncModal, setShowVncModal] = useState(false);
  const [vncResizeMode, setVncResizeMode] = useState<'scale' | 'remote' | 'none'>('scale');
  const [vncFrameKey, setVncFrameKey] = useState(0);
  const [vncPortOpen, setVncPortOpen] = useState<boolean>(Boolean(pc.vncPortOpen ?? pc.online));
  const [vncLatencyMs, setVncLatencyMs] = useState<number | undefined>(pc.lastPingMs);
  const [isModalFullscreen, setIsModalFullscreen] = useState(false);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Inline Edit Mode
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(pc.name);
  const [editIp, setEditIp] = useState(pc.ip);
  const [editMac, setEditMac] = useState(pc.mac);
  const [editVncPort, setEditVncPort] = useState<number>(pc.vncPort || 5900);
  const [editVncPassword, setEditVncPassword] = useState<string>(pc.vncPassword || '');
  const [editLocation, setEditLocation] = useState<LocationType>(pc.location);
  const [editAnydesk, setEditAnydesk] = useState(pc.anydeskId || '');
  const [editBroadcast, setEditBroadcast] = useState(pc.broadcastAddress || '');

  const vncPort = pc.vncPort || 5900;
  const cleanAnydesk = (pc.anydeskId || '').replace(/\s+/g, '');

  const buildNoVncIframeUrl = (
    resize: 'scale' | 'remote' | 'none' = vncResizeMode,
    embedded = true
  ): string => {
    const params = new URLSearchParams({
      autoconnect: 'true',
      resize,
      pcId: pc.id,
      host: pc.ip,
      port: String(vncPort)
    });
    if (embedded) {
      params.set('embedded', 'true');
    }
    if (pc.vncPassword) {
      params.set('password', pc.vncPassword);
    }
    return `/novnc/vnc.html?${params.toString()}`;
  };

  const handleOpenWebControl = async () => {
    setShowVncModal(true);
    try {
      const status = await fetchPcVncStatus(pc.id);
      setVncPortOpen(status.vncPortOpen);
      setVncLatencyMs(status.latencyMs);
    } catch {}
  };

  const handleToggleModalFullscreen = () => {
    if (!modalContainerRef.current) return;
    if (!document.fullscreenElement) {
      modalContainerRef.current
        .requestFullscreen()
        .then(() => setIsModalFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsModalFullscreen(false))
        .catch(() => {});
    }
  };

  const handleWake = async () => {
    setIsWaking(true);
    setActionMessage(null);
    try {
      const res = await wakePc(pc.id);
      setActionMessage(res.message || `Magic Packet sent (${pc.mac})`);

      if (pc.relayDeviceId) {
        await triggerRelayPulse(pc.id);
        setActionMessage('WoL Packet + Relay Pulse triggered');
      }

      setTimeout(() => {
        pingPc(pc.id).then(() => onRefresh());
      }, 3000);
    } catch (err: any) {
      setActionMessage(`Wake error: ${err.message}`);
    } finally {
      setIsWaking(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  const handleRelayPulse = async () => {
    setIsWaking(true);
    try {
      const res = await triggerRelayPulse(pc.id);
      setActionMessage(res.message);
    } catch (err: any) {
      setActionMessage(`Pulse error: ${err.message}`);
    } finally {
      setIsWaking(false);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const handlePing = async () => {
    setIsPinging(true);
    try {
      const res = await pingPc(pc.id);
      setVncPortOpen(Boolean(res.vncPortOpen ?? res.online));
      setVncLatencyMs(res.latencyMs);
      setActionMessage(
        res.online
          ? `Online (${res.latencyMs ?? 1}ms)${res.vncPortOpen ? ` • VNC :${vncPort} READY` : ''}`
          : 'Host Unreachable'
      );
      onRefresh();
    } catch {
      setActionMessage('Ping failed');
    } finally {
      setIsPinging(false);
      setTimeout(() => setActionMessage(null), 4000);
    }
  };

  const handleCopyMac = () => {
    navigator.clipboard.writeText(pc.mac);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete workstation "${pc.name}"?`)) {
      try {
        await deletePc(pc.id);
        onRefresh();
      } catch (err: any) {
        alert(`Failed to delete PC: ${err.message}`);
      }
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const portNum = Number(editVncPort) || 5900;
      await updatePc(pc.id, {
        name: editName,
        ip: editIp,
        mac: editMac,
        vncPort: portNum,
        vncPassword: editVncPassword,
        location: editLocation,
        anydeskId: editAnydesk,
        broadcastAddress:
          editBroadcast || (editLocation === 'Garage' ? '192.168.8.255' : '192.168.1.255'),
        webViewerUrl: `/novnc/vnc.html?autoconnect=true&resize=scale&pcId=${encodeURIComponent(
          pc.id
        )}&host=${encodeURIComponent(editIp)}&port=${portNum}`
      });
      setIsEditing(false);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to update PC: ${err.message}`);
    }
  };

  return (
    <>
      <div className="dash-card p-4 flex flex-col justify-between transition-all min-w-0 overflow-hidden">
        <div>
          {/* Compact Card Header: Icon, Name, Status, Edit & Delete */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center space-x-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  pc.online
                    ? 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/45'
                    : 'bg-[#081326] text-[#7C99B8] border border-[#00F0FF]/20'
                }`}
              >
                <Monitor size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold font-hud text-[#FFFFFF] truncate">{pc.name}</h3>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-[#081326] text-[#7C99B8] border border-[#00F0FF]/20 shrink-0">
                    {pc.location}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono text-[#00F0FF] truncate">
                  <span>
                    {pc.ip}:{vncPort}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1 shrink-0">
              <button
                onClick={handlePing}
                disabled={isPinging}
                title="Probe live status & VNC port"
                className="px-2.5 h-9 rounded-lg bg-[#050A14] border border-[#00F0FF]/30 text-[11px] hover:border-[#00F0FF] transition cursor-pointer flex items-center space-x-1.5"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    pc.online ? 'bg-[#10B981] shadow-[0_0_6px_#10B981]' : 'bg-[#7C99B8]'
                  }`}
                />
                <span className="font-mono font-bold text-[#E2F1FF]">
                  {pc.online ? (pc.lastPingMs ? `${pc.lastPingMs}ms` : 'ONLINE') : 'OFFLINE'}
                </span>
                <RefreshCw
                  size={11}
                  className={`text-[#00F0FF] ${isPinging ? 'animate-spin' : ''}`}
                />
              </button>

              <button
                onClick={() => setIsEditing(!isEditing)}
                title="Edit Workstation"
                className="w-9 h-9 rounded-lg bg-[#081326] border border-[#00F0FF]/25 text-[#7C99B8] hover:text-[#00F0FF] hover:border-[#00F0FF] flex items-center justify-center transition cursor-pointer"
              >
                {isEditing ? <X size={15} /> : <Edit3 size={15} />}
              </button>

              <button
                onClick={handleDelete}
                title="Delete Workstation"
                className="w-9 h-9 rounded-lg bg-[#081326] border border-[#00F0FF]/25 text-[#7C99B8] hover:text-[#EF4444] hover:border-[#EF4444] hover:bg-[#EF4444]/15 flex items-center justify-center transition cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {/* Inline Edit Form */}
          {isEditing ? (
            <form
              onSubmit={handleSaveEdit}
              className="p-3 rounded-xl bg-[#050A14] border border-[#00F0FF]/35 mb-3 space-y-2.5 text-xs"
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">PC Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">Location</label>
                  <select
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value as LocationType)}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF]"
                  >
                    <option value="Home">Home</option>
                    <option value="Garage">Garage</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">IP Address</label>
                  <input
                    type="text"
                    required
                    value={editIp}
                    onChange={(e) => setEditIp(e.target.value)}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">VNC Port</label>
                  <input
                    type="number"
                    required
                    value={editVncPort}
                    onChange={(e) => setEditVncPort(parseInt(e.target.value || '5900', 10))}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">MAC (WoL)</label>
                  <input
                    type="text"
                    required
                    value={editMac}
                    onChange={(e) => setEditMac(e.target.value)}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF] font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">
                    VNC Password (Optional)
                  </label>
                  <input
                    type="password"
                    value={editVncPassword}
                    onChange={(e) => setEditVncPassword(e.target.value)}
                    placeholder="Auto-saved on first login"
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-[#7C99B8] uppercase">
                    AnyDesk ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={editAnydesk}
                    onChange={(e) => setEditAnydesk(e.target.value)}
                    className="w-full h-9 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-2.5 text-[#FFFFFF] font-mono"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full h-9 rounded-lg bg-[#00F0FF] text-[#050A14] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save size={14} /> Save Workstation
              </button>
            </form>
          ) : (
            /* Clean Single-Line Telemetry Bar (MAC & VNC Endpoint) */
            <div className="px-3 py-2 rounded-lg bg-[#050A14]/85 border border-[#00F0FF]/15 mb-3 flex items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2 min-w-0 truncate">
                <span className="text-[#7C99B8] text-[10px] uppercase">MAC:</span>
                <span className="text-[#E2F1FF] font-semibold truncate">{pc.mac}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30 shrink-0">
                  noVNC :{vncPort}
                </span>
              </div>
              <button
                onClick={handleCopyMac}
                title="Copy MAC Address"
                className="w-7 h-7 rounded bg-[#081326] text-[#7C99B8] hover:text-[#00F0FF] border border-[#00F0FF]/20 flex items-center justify-center transition cursor-pointer shrink-0"
              >
                {copied ? <Check size={13} className="text-[#10B981]" /> : <Copy size={13} />}
              </button>
            </div>
          )}

          {/* Action Feedback */}
          {actionMessage && (
            <div className="mb-3 py-1.5 px-2.5 rounded-lg bg-[#081326] text-[11px] font-mono text-[#00F0FF] border border-[#00F0FF]/35 flex items-center gap-1.5">
              <Radio size={12} className="text-[#00F0FF] animate-pulse shrink-0" />
              <span className="truncate">{actionMessage}</span>
            </div>
          )}
        </div>

        {/* Primary Action Buttons: Wake PC (WOL) & Open Live Screen */}
        <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[#00F0FF]/15">
          <button
            onClick={handleWake}
            disabled={isWaking}
            className="h-11 rounded-xl bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/35 text-[#E2F1FF] font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <Power size={15} className="text-[#00F0FF] shrink-0" />
            <span className="truncate">{isWaking ? 'Sending...' : 'Wake PC (WOL)'}</span>
          </button>

          <button
            onClick={handleOpenWebControl}
            className="h-11 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-[0_0_14px_rgba(0,240,255,0.28)]"
          >
            <ScreenShare size={15} className="shrink-0" />
            <span className="truncate">Open Live Screen</span>
          </button>
        </div>

        {/* Optional Relay Pulse */}
        {pc.relayDeviceId && (
          <button
            onClick={handleRelayPulse}
            title="Hardware Relay Power Button Pulse (1000ms)"
            className="mt-2 w-full py-1.5 rounded-lg bg-[#050A14] hover:bg-[#081326] border border-[#00F0FF]/20 text-[10px] font-mono text-[#7C99B8] hover:text-[#FFFFFF] flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Terminal size={12} />
            <span>Relay Power Pulse (Pin)</span>
          </button>
        )}
      </div>

      {/* Portal Modal rendered directly on document.body so it is NEVER clipped by .dash-card backdrop-filter */}
      {showVncModal &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#02050B]/92 backdrop-blur-md p-2 sm:p-4">
            <div
              ref={modalContainerRef}
              className="w-[96vw] max-w-[1640px] h-[92vh] rounded-2xl border border-[#00F0FF]/50 shadow-[0_0_50px_rgba(0,240,255,0.22)] flex flex-col overflow-hidden bg-[#050A14]"
            >
              {/* Single Unified M.A.R.V.I.N. HUD Modal Header (No Duplicate Toolbars) */}
              <div className="px-4 py-2.5 bg-gradient-to-r from-[#050A14] via-[#091830] to-[#050A14] border-b border-[#00F0FF]/35 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#00F0FF]/15 border border-[#00F0FF]/50 flex items-center justify-center text-[#00F0FF]">
                    <Monitor size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-[#FFFFFF] font-hud tracking-wider">
                        {pc.name.toUpperCase()} // LIVE SCREEN
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                          vncPortOpen
                            ? 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40'
                            : 'bg-[#FF9E00]/15 text-[#FF9E00] border-[#FF9E00]/40'
                        }`}
                      >
                        {vncPortOpen
                          ? `VNC :${vncPort} LIVE${vncLatencyMs ? ` (${vncLatencyMs}ms)` : ''}`
                          : `VNC :${vncPort} STANDBY`}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-[#7C99B8]">
                      HOST: <span className="text-[#00F0FF]">{pc.ip}:{vncPort}</span> &bull; MAC:{' '}
                      <span className="text-[#E2F1FF]">{pc.mac}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center flex-wrap gap-2">
                  <button
                    onClick={handleWake}
                    disabled={isWaking}
                    title={`Send Wake-on-LAN Magic Packet to ${pc.mac}`}
                    className="h-9 px-3 rounded-lg bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-xs font-mono text-[#E2F1FF] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Power size={13} className="text-[#00F0FF]" />
                    <span>{isWaking ? 'Waking...' : 'Wake PC (WOL)'}</span>
                  </button>

                  <select
                    value={vncResizeMode}
                    onChange={(e) => {
                      setVncResizeMode(e.target.value as 'scale' | 'remote' | 'none');
                      setVncFrameKey((k) => k + 1);
                    }}
                    title="Display Scaling Mode"
                    className="h-9 px-2.5 rounded-lg bg-[#081326] border border-[#00F0FF]/30 text-xs font-mono text-[#00F0FF] cursor-pointer"
                  >
                    <option value="scale">Scale to Fit</option>
                    <option value="remote">Remote Resize</option>
                    <option value="none">1:1 Native</option>
                  </select>

                  <button
                    onClick={() => setVncFrameKey((k) => k + 1)}
                    title="Reload VNC Stream"
                    className="h-9 px-3 rounded-lg bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-xs font-mono text-[#E2F1FF] flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={13} className="text-[#00F0FF]" />
                    <span className="hidden sm:inline">Reload</span>
                  </button>

                  <a
                    href={buildNoVncIframeUrl(vncResizeMode, false)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open noVNC in separate browser tab"
                    className="h-9 px-3 rounded-lg bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-xs font-mono text-[#E2F1FF] flex items-center gap-1.5"
                  >
                    <ExternalLink size={13} className="text-[#00F0FF]" />
                    <span className="hidden md:inline">New Tab</span>
                  </a>

                  <button
                    onClick={handleToggleModalFullscreen}
                    title="Toggle Fullscreen"
                    className="h-9 px-3 rounded-lg bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-xs font-mono text-[#00F0FF] flex items-center gap-1.5 cursor-pointer"
                  >
                    {isModalFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    <span className="hidden sm:inline">
                      {isModalFullscreen ? 'Exit Full' : 'Fullscreen'}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                      }
                      setShowVncModal(false);
                    }}
                    className="h-9 px-3.5 rounded-lg bg-[#EF4444]/20 hover:bg-[#EF4444]/35 border border-[#EF4444]/50 text-xs font-mono font-bold text-[#EF4444] flex items-center gap-1.5 cursor-pointer"
                  >
                    <X size={15} />
                    <span>CLOSE</span>
                  </button>
                </div>
              </div>

              {/* Live noVNC Iframe Viewport */}
              <div className="relative flex-1 w-full bg-[#03070E] overflow-hidden">
                <iframe
                  key={`${pc.id}-${vncResizeMode}-${vncFrameKey}`}
                  src={buildNoVncIframeUrl(vncResizeMode, true)}
                  className="w-full h-full border-0"
                  title={`noVNC Remote Desktop - ${pc.name} (${pc.ip}:${vncPort})`}
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
