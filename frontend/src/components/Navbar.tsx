import React from 'react';
import {
  Home,
  Radar,
  Plus,
  Zap,
  Camera,
  LayoutDashboard,
  Monitor,
  Settings,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { SystemStatus, LocationType } from '../types';

interface NavbarProps {
  status: SystemStatus | null;
  selectedLocation: LocationType | 'All';
  onSelectLocation: (loc: LocationType | 'All') => void;
  onOpenScanner: () => void;
  onOpenAddDevice: () => void;
  onOpenAutomations: () => void;
  onOpenSettings: () => void;
  viewMode: 'overview' | 'cameras' | 'devices' | 'pcs';
  onChangeViewMode: (mode: 'overview' | 'cameras' | 'devices' | 'pcs') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  status,
  selectedLocation,
  onSelectLocation,
  onOpenScanner,
  onOpenAddDevice,
  onOpenAutomations,
  onOpenSettings,
  viewMode,
  onChangeViewMode
}) => {
  return (
    <header className="shrink-0 z-40 w-full bg-[#050A14]/95 backdrop-blur-md border-b border-[#00F0FF]/25 px-4 lg:px-6 py-2.5 shadow-lg">
      {/* Top Row: Branding + View Switcher + System Actions */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3">
        {/* Left: Custom Arc Reactor SVG Logo & Tactical Branding */}
        <div className="flex items-center space-x-3">
          <div className="relative w-10 h-10 rounded-xl bg-[#071224] border border-[#00F0FF]/50 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 120 120" className="w-8 h-8">
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="#00F0FF"
                strokeWidth="3"
                strokeDasharray="16 6 4 6"
                strokeOpacity="0.6"
              />
              <polygon
                points="60,14 100,37 100,83 60,106 20,83 20,37"
                fill="rgba(0, 240, 255, 0.08)"
                stroke="#00F0FF"
                strokeWidth="4"
              />
              <circle
                cx="60"
                cy="60"
                r="31"
                fill="none"
                stroke="#00F0FF"
                strokeWidth="6"
                strokeDasharray="11 5.5"
              />
              <circle
                cx="60"
                cy="60"
                r="22"
                fill="none"
                stroke="#FF9E00"
                strokeWidth="2.5"
                strokeDasharray="7 5"
              />
              <path
                d="M47 68 L47 51 L60 60 L73 51 L73 68"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm md:text-base font-extrabold font-hud tracking-wider text-[#FFFFFF]">
                MORTYCK<span className="text-[#00F0FF]">HOME</span>ASSISTENT
              </span>
              <span className="hidden sm:inline-flex px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/35">
                STARK HUD v4.5
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#7C99B8] font-mono">
              <span className="flex items-center gap-1 text-[#10B981]">
                <ShieldCheck size={11} />
                TAILSCALE: {status?.tailscaleConnected !== false ? 'LINKED' : 'STANDBY'}
              </span>
              <span>&bull;</span>
              <span className="text-[#00F0FF]">
                STREAMS: {status?.activeStreams ?? 3}
              </span>
              <span>&bull;</span>
              <span className="text-[#FF9E00]">
                NODES: {status?.onlineCount ?? 3}/{status?.deviceCount ?? 4}
              </span>
            </div>
          </div>
        </div>

        {/* Center: View Mode Tabs */}
        <div className="flex items-center bg-[#081326]/90 p-1 rounded-xl border border-[#00F0FF]/25 overflow-x-auto">
          <button
            onClick={() => onChangeViewMode('overview')}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold flex items-center transition cursor-pointer ${
              viewMode === 'overview'
                ? 'bg-[#00F0FF] text-[#050A14] shadow-sm'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <LayoutDashboard size={14} className="mr-1.5" />
            Overview
          </button>
          <button
            onClick={() => onChangeViewMode('cameras')}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold flex items-center transition cursor-pointer ${
              viewMode === 'cameras'
                ? 'bg-[#00F0FF] text-[#050A14] shadow-sm'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <Camera size={14} className="mr-1.5" />
            Cameras
          </button>
          <button
            onClick={() => onChangeViewMode('devices')}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold flex items-center transition cursor-pointer ${
              viewMode === 'devices'
                ? 'bg-[#00F0FF] text-[#050A14] shadow-sm'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <Home size={14} className="mr-1.5" />
            Smart IoT
          </button>
          <button
            onClick={() => onChangeViewMode('pcs')}
            className={`px-3.5 h-9 rounded-lg text-xs font-bold flex items-center transition cursor-pointer ${
              viewMode === 'pcs'
                ? 'bg-[#00F0FF] text-[#050A14] shadow-sm'
                : 'text-[#7C99B8] hover:text-[#FFFFFF]'
            }`}
          >
            <Monitor size={14} className="mr-1.5" />
            Remote PCs
          </button>
        </div>

        {/* Right: Tactical Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenScanner}
            title="Scan local subnet for devices"
            className="px-3 h-9 rounded-xl bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-xs text-[#E2F1FF] font-semibold flex items-center transition cursor-pointer"
          >
            <Radar size={14} className="mr-1.5 text-[#00F0FF]" />
            <span className="hidden sm:inline">Scan LAN</span>
          </button>

          <button
            onClick={onOpenAutomations}
            title="Manage IFTTT Motion Rules"
            className="px-3 h-9 rounded-xl bg-[#081326] hover:bg-[#0F2242] border border-[#FF9E00]/40 text-xs text-[#E2F1FF] font-semibold flex items-center transition cursor-pointer"
          >
            <Zap size={14} className="mr-1.5 text-[#FF9E00]" />
            <span className="hidden sm:inline">Rules</span>
          </button>

          <button
            onClick={onOpenSettings}
            title="Blurams Cloud Cookie & AI System Settings"
            className="w-9 h-9 rounded-xl bg-[#081326] hover:bg-[#0F2242] border border-[#00F0FF]/30 text-[#00F0FF] flex items-center justify-center transition cursor-pointer"
          >
            <Settings size={16} />
          </button>

          <button
            onClick={onOpenAddDevice}
            className="px-3.5 h-9 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-bold text-xs flex items-center transition cursor-pointer shadow-sm"
          >
            <Plus size={15} className="mr-1" />
            <span>Add Device</span>
          </button>
        </div>
      </div>

      {/* Bottom Sub-Bar: Sector Selector & Blurams Bridge Status */}
      <div className="w-full mt-2 pt-2 border-t border-[#00F0FF]/15 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-hud uppercase text-[#00F0FF] font-bold mr-1 shrink-0">
            SECTOR:
          </span>
          <button
            onClick={() => onSelectLocation('Home')}
            className={`px-3.5 h-8 rounded-lg text-xs font-hud font-bold transition cursor-pointer shrink-0 ${
              selectedLocation === 'Home'
                ? 'bg-[#00F0FF] text-[#050A14]'
                : 'bg-[#081326] text-[#7C99B8] hover:text-[#FFFFFF] border border-[#00F0FF]/20'
            }`}
          >
            HOME (192.168.1.x)
          </button>
          <button
            onClick={() => onSelectLocation('Garage')}
            className={`px-3.5 h-8 rounded-lg text-xs font-hud font-bold transition cursor-pointer shrink-0 ${
              selectedLocation === 'Garage'
                ? 'bg-[#00F0FF] text-[#050A14]'
                : 'bg-[#081326] text-[#7C99B8] hover:text-[#FFFFFF] border border-[#00F0FF]/20'
            }`}
          >
            GARAGE / WORKSHOP (192.168.8.x &bull; TAILSCALE)
          </button>
          <button
            onClick={() => onSelectLocation('All')}
            className={`px-3.5 h-8 rounded-lg text-xs font-hud font-bold transition cursor-pointer shrink-0 ${
              selectedLocation === 'All'
                ? 'bg-[#FF9E00] text-[#050A14]'
                : 'bg-[#081326] text-[#7C99B8] hover:text-[#FFFFFF] border border-[#00F0FF]/20'
            }`}
          >
            ALL SECTORS
          </button>
        </div>

        {status?.bluramsBridge && (
          <button
            onClick={onOpenSettings}
            title="Click to configure Blurams Session Cookie / Stream URL"
            className="hidden md:flex items-center space-x-2 px-3 h-8 rounded-lg bg-[#081326] border border-[#00F0FF]/30 text-[11px] font-mono hover:border-[#00F0FF] transition cursor-pointer shrink-0"
          >
            <Radio
              size={12}
              className={
                status.bluramsBridge.authenticated
                  ? 'text-[#10B981]'
                  : 'text-[#FF9E00] animate-pulse'
              }
            />
            <span className="text-[#E2F1FF]">
              BLURAMS BRIDGE:{' '}
              <strong
                className={
                  status.bluramsBridge.authenticated ? 'text-[#10B981]' : 'text-[#FF9E00]'
                }
              >
                {status.bluramsBridge.authenticated
                  ? 'LIVE STREAM'
                  : status.bluramsBridge.hasCookie
                    ? 'COOKIE LINKED'
                    : 'CONFIG CREDENTIALS'}
              </strong>
            </span>
          </button>
        )}
      </div>
    </header>
  );
};
