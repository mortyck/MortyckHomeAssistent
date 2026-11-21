import React, { useState } from 'react';
import { Lightbulb, Power, Zap, Sliders, Sun, Flame, Trash2, Edit3 } from 'lucide-react';
import { Device } from '../types';
import { sendDeviceCommand, deleteDevice } from '../services/api';

interface TuyaDeviceCardProps {
  device: Device;
  onEdit?: (device: Device) => void;
  onDelete?: (id: string) => void;
}

const COLOR_PRESETS = [
  '#FFFFFF', // Pure White
  '#00F0FF', // Arc Cyan
  '#FF9E00', // Tactical Amber
  '#10B981', // Clean Emerald
  '#EC4899', // Rose Pink
  '#8B5CF6'  // Violet
];

export const TuyaDeviceCard: React.FC<TuyaDeviceCardProps> = ({ device, onEdit, onDelete }) => {
  const isLight = device.category === 'light';
  const isPlug = device.category === 'plug';
  const isPowerOn = Boolean(device.state.power);

  const [localBrightness, setLocalBrightness] = useState<number>(device.state.brightness || 80);
  const [localColorTemp, setLocalColorTemp] = useState<number>(device.state.color_temp || 4000);

  const handleTogglePower = async () => {
    await sendDeviceCommand(device.id, { power: !isPowerOn });
  };

  const handleBrightnessChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setLocalBrightness(val);
    await sendDeviceCommand(device.id, { brightness: val });
  };

  const handleColorTempChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setLocalColorTemp(val);
    await sendDeviceCommand(device.id, { color_temp: val });
  };

  const handleSelectColor = async (hex: string) => {
    await sendDeviceCommand(device.id, { color_rgb: hex, power: true });
  };

  const handleDeleteClick = async () => {
    if (onDelete) {
      onDelete(device.id);
    } else if (window.confirm(`Are you sure you want to remove ${device.name}?`)) {
      try {
        await deleteDevice(device.id);
      } catch (err: any) {
        alert(`Failed to delete device: ${err.message}`);
      }
    }
  };

  return (
    <div
      className={`dash-card p-5 flex flex-col justify-between transition-all ${
        isPowerOn ? 'dash-card-active' : ''
      }`}
    >
      <div>
        {/* Header: Title, Edit/Delete Controls & Master Power Button */}
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center space-x-3">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                isPowerOn
                  ? 'bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/50 hud-glow-cyan'
                  : 'bg-[#081326] text-[#7C99B8] border border-[#00F0FF]/20'
              }`}
            >
              {isLight ? <Lightbulb size={24} /> : isPlug ? <Zap size={24} /> : <Sliders size={24} />}
            </div>
            <div>
              <h3 className="text-sm font-bold font-hud text-[#FFFFFF]">{device.name}</h3>
              <div className="flex items-center space-x-2 text-xs text-[#7C99B8] mt-0.5 font-mono">
                <span>{device.room}</span>
                <span>&bull;</span>
                <span className="text-[#00F0FF]">{device.brand}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {onEdit && (
              <button
                onClick={() => onEdit(device)}
                title="Edit Device Configuration"
                className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/25 text-[#7C99B8] hover:text-[#00F0FF] hover:border-[#00F0FF] transition cursor-pointer"
              >
                <Edit3 size={17} />
              </button>
            )}

            <button
              onClick={handleDeleteClick}
              title="Delete Device"
              className="touch-btn w-11 h-11 rounded-xl bg-[#081326] border border-[#00F0FF]/25 text-[#7C99B8] hover:text-[#EF4444] hover:border-[#EF4444] hover:bg-[#EF4444]/15 transition cursor-pointer"
            >
              <Trash2 size={17} />
            </button>

            {/* Master Touch Toggle (52x52px tap target) */}
            <button
              onClick={handleTogglePower}
              title={isPowerOn ? 'Turn OFF' : 'Turn ON'}
              className={`touch-btn w-13 h-13 rounded-xl flex items-center justify-center transition cursor-pointer ${
                isPowerOn
                  ? 'bg-[#00F0FF] text-[#050A14] hud-glow-cyan hover:bg-[#00C8FF]'
                  : 'bg-[#081326] text-[#7C99B8] border border-[#00F0FF]/25 hover:text-[#FFFFFF]'
              }`}
            >
              <Power size={21} />
            </button>
          </div>
        </div>

        {/* Live Power Metrics Bar */}
        {(device.state.current_power_w !== undefined || isPlug) && (
          <div className="grid grid-cols-3 gap-2 py-2.5 px-3 rounded-xl bg-[#050A14]/90 border border-[#00F0FF]/20 text-xs mb-4 font-mono">
            <div>
              <span className="text-[#7C99B8] block text-[10px] uppercase font-semibold">LOAD</span>
              <span className={`text-sm font-bold ${isPowerOn ? 'text-[#FF9E00]' : 'text-[#7C99B8]'}`}>
                {device.state.current_power_w ?? 0} W
              </span>
            </div>
            <div>
              <span className="text-[#7C99B8] block text-[10px] uppercase font-semibold">VOLTAGE</span>
              <span className="text-sm font-bold text-[#E2F1FF]">{device.state.voltage_v ?? 230} V</span>
            </div>
            <div>
              <span className="text-[#7C99B8] block text-[10px] uppercase font-semibold">CURRENT</span>
              <span className="text-sm font-bold text-[#00F0FF]">{device.state.current_a ?? 0} A</span>
            </div>
          </div>
        )}

        {/* Touch Sliders for Lights */}
        {isLight && (
          <div className="space-y-4 pt-1">
            {/* Brightness Slider */}
            <div>
              <div className="flex justify-between text-xs text-[#7C99B8] mb-2 font-mono">
                <span className="flex items-center gap-1.5 text-[#E2F1FF]">
                  <Sun size={14} className="text-[#00F0FF]" /> LUMEN OUTPUT
                </span>
                <span className="text-sm font-bold text-[#00F0FF]">{localBrightness}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={localBrightness}
                onChange={handleBrightnessChange}
                disabled={!isPowerOn}
                className="w-full touch-manipulation cursor-pointer disabled:opacity-30"
              />
            </div>

            {/* Color Temp Slider */}
            <div>
              <div className="flex justify-between text-xs text-[#7C99B8] mb-2 font-mono">
                <span className="flex items-center gap-1.5 text-[#E2F1FF]">
                  <Flame size={14} className="text-[#FF9E00]" /> KELVIN SPECTRUM
                </span>
                <span className="text-sm font-bold text-[#FF9E00]">{localColorTemp}K</span>
              </div>
              <input
                type="range"
                min="2700"
                max="6500"
                step="100"
                value={localColorTemp}
                onChange={handleColorTempChange}
                disabled={!isPowerOn}
                className="w-full touch-manipulation cursor-pointer disabled:opacity-30"
              />
            </div>

            {/* Large Color Swatches */}
            <div>
              <span className="text-[10px] font-hud text-[#7C99B8] uppercase font-bold block mb-2">
                CHROMA MATRIX
              </span>
              <div className="flex items-center justify-between">
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleSelectColor(color)}
                    style={{ backgroundColor: color }}
                    className="touch-btn w-10 h-10 rounded-full border-2 border-[#081326] hover:border-[#FFFFFF] transition-transform active:scale-95 cursor-pointer shadow-md"
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div className="mt-5 pt-3 border-t border-[#00F0FF]/20 flex items-center justify-between text-xs text-[#7C99B8] font-mono">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${device.online ? 'bg-[#10B981]' : 'bg-[#FF9E00]'}`} />
          <span>
            {device.type === 'tuya'
              ? `TUYA LAN v${device.tuya?.version || '3.3'}`
              : `${device.type.toUpperCase()} NODE`}
          </span>
        </div>
        <span className="text-[#00F0FF]">{device.ip}</span>
      </div>
    </div>
  );
};
