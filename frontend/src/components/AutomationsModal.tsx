import React, { useState } from 'react';
import { X, Plus, Trash2, Zap, Play } from 'lucide-react';
import { AutomationRule, Device } from '../types';
import { saveAutomation, deleteAutomation, toggleAutomation, triggerCameraMotion } from '../services/api';

interface AutomationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  automations: AutomationRule[];
  devices: Device[];
  onRefreshAutomations: () => void;
}

export const AutomationsModal: React.FC<AutomationsModalProps> = ({
  isOpen,
  onClose,
  automations,
  devices,
  onRefreshAutomations
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [triggerDeviceId, setTriggerDeviceId] = useState('');
  const [actionDeviceId, setActionDeviceId] = useState('');
  const [targetBrightness, setTargetBrightness] = useState(100);

  if (!isOpen) return null;

  const cameraDevices = devices.filter((d) => d.category === 'camera');
  const lightDevices = devices.filter((d) => d.category === 'light' || d.category === 'plug');

  const handleToggle = async (id: string) => {
    await toggleAutomation(id);
    onRefreshAutomations();
  };

  const handleDelete = async (id: string) => {
    await deleteAutomation(id);
    onRefreshAutomations();
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const newRule: AutomationRule = {
      id: `rule-${Date.now().toString(36)}`,
      name: ruleName || 'Camera Motion Triggered Lighting',
      enabled: true,
      trigger: {
        type: 'motion',
        deviceId: triggerDeviceId || cameraDevices[0]?.id,
        property: 'motion_detected',
        operator: 'is_true'
      },
      action: {
        type: 'device_command',
        deviceId: actionDeviceId || lightDevices[0]?.id,
        command: {
          power: true,
          brightness: targetBrightness,
          color_rgb: '#ffffff'
        }
      }
    };

    await saveAutomation(newRule);
    setShowAddForm(false);
    setRuleName('');
    onRefreshAutomations();
  };

  const handleTestTrigger = async (rule: AutomationRule) => {
    if (rule.trigger.deviceId) {
      await triggerCameraMotion(rule.trigger.deviceId, true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/80 p-4">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#1A1D24] border border-[#2A2E39] p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2A2E39]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#262A34] text-[#F59E0B] flex items-center justify-center">
              <Zap size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#FFFFFF]">Automations & Rules</h3>
              <p className="text-xs text-[#8E95A5]">
                Local triggers: Camera Motion &rarr; Smart Lights & Plugs
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

        {/* Action Button */}
        {!showAddForm && (
          <div className="py-3 flex justify-end">
            <button
              onClick={() => setShowAddForm(true)}
              className="touch-btn px-4 py-2.5 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#FFFFFF] font-bold text-sm flex items-center gap-2 transition cursor-pointer"
            >
              <Plus size={16} /> New Rule
            </button>
          </div>
        )}

        {/* Create Rule Form */}
        {showAddForm && (
          <form onSubmit={handleCreateRule} className="p-4 my-3 rounded-xl bg-[#0F1115] border border-[#2A2E39] space-y-3">
            <div className="flex justify-between items-center mb-1">
              <h4 className="text-xs font-bold uppercase text-[#FFFFFF]">New Rule</h4>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-xs text-[#8E95A5] hover:text-[#FFFFFF]"
              >
                Cancel
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1">Rule Name</label>
              <input
                type="text"
                required
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. Garden Motion -> Turn On Light"
                className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1">
                  IF: Motion Camera
                </label>
                <select
                  value={triggerDeviceId}
                  onChange={(e) => setTriggerDeviceId(e.target.value)}
                  className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
                >
                  {cameraDevices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.brand})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8E95A5] uppercase mb-1">
                  THEN: Target Light / Plug
                </label>
                <select
                  value={actionDeviceId}
                  onChange={(e) => setActionDeviceId(e.target.value)}
                  className="w-full h-11 bg-[#1A1D24] border border-[#2A2E39] rounded-lg px-3 text-sm text-[#FFFFFF] focus:outline-none focus:border-[#10B981]"
                >
                  {lightDevices.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.room})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="touch-btn w-full py-3 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#FFFFFF] font-bold text-sm transition cursor-pointer"
            >
              Save Automation Rule
            </button>
          </form>
        )}

        {/* Existing Rules */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 my-2">
          {automations.length === 0 ? (
            <div className="py-12 text-center text-[#8E95A5] text-sm">
              No active automation rules.
            </div>
          ) : (
            automations.map((rule) => {
              const triggerDev = devices.find((d) => d.id === rule.trigger.deviceId);
              const actionDev = devices.find((d) => d.id === rule.action.deviceId);

              return (
                <div
                  key={rule.id}
                  className={`p-4 rounded-xl border transition-colors ${
                    rule.enabled
                      ? 'bg-[#0F1115] border-[#2A2E39]'
                      : 'bg-[#0F1115]/50 border-[#2A2E39] opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          rule.enabled ? 'bg-[#10B981]' : 'bg-[#8E95A5]'
                        }`}
                      />
                      <h4 className="text-sm font-bold text-[#FFFFFF]">{rule.name}</h4>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleTestTrigger(rule)}
                        className="touch-btn px-3 py-1.5 rounded-lg bg-[#262A34] hover:bg-[#323744] text-xs text-[#F59E0B] font-bold flex items-center gap-1 transition cursor-pointer"
                      >
                        <Play size={12} /> Test Fire
                      </button>
                      <button
                        onClick={() => handleToggle(rule.id)}
                        className={`touch-btn px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                          rule.enabled ? 'bg-[#10B981] text-[#FFFFFF]' : 'bg-[#262A34] text-[#8E95A5]'
                        }`}
                      >
                        {rule.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="touch-btn w-9 h-9 rounded-lg text-[#8E95A5] hover:text-[#EF4444] transition cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-[#8E95A5] mt-1">
                    <strong className="text-[#F59E0B]">IF</strong> {triggerDev?.name || 'Camera'} motion detected &rarr;{' '}
                    <strong className="text-[#10B981]">THEN</strong> turn on {actionDev?.name || 'Device'}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
