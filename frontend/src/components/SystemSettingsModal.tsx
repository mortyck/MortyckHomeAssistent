import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Camera,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Key
} from 'lucide-react';
import { fetchSystemSettings, updateSystemSettings, reloadBluramsBridge } from '../services/api';
import { BluramsBridgeStatus } from '../types';

interface SystemSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const SystemSettingsModal: React.FC<SystemSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved
}) => {
  const [bluramsEmail, setBluramsEmail] = useState('');
  const [bluramsPassword, setBluramsPassword] = useState('');
  const [bluramsCookie, setBluramsCookie] = useState('');
  const [bluramsToken, setBluramsToken] = useState('');
  const [bluramsDeviceId, setBluramsDeviceId] = useState('1800420411702000132815');
  const [bluramsCameraIp, setBluramsCameraIp] = useState('192.168.8.161');
  const [bluramsStreamUrl, setBluramsStreamUrl] = useState('');

  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash-lite');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.1');

  const [bluramsStatus, setBluramsStatus] = useState<BluramsBridgeStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      fetchSystemSettings()
        .then((data) => {
          setBluramsEmail(data.env.BLURAMS_EMAIL || '');
          setBluramsPassword(data.env.BLURAMS_PASSWORD || '');
          setBluramsCookie(data.env.BLURAMS_COOKIE || '');
          setBluramsToken(data.env.BLURAMS_TOKEN || '');
          setBluramsDeviceId(data.env.BLURAMS_DEVICE_ID || '1800420411702000132815');
          setBluramsCameraIp(data.env.BLURAMS_CAMERA_IP || '192.168.8.161');
          setBluramsStreamUrl(data.env.BLURAMS_STREAM_URL || '');
          setGeminiApiKey(data.env.GEMINI_API_KEY || '');
          setGeminiModel(data.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
          setOllamaUrl(data.env.OLLAMA_URL || 'http://localhost:11434');
          setOllamaModel(data.env.OLLAMA_MODEL || 'llama3.1');
          setBluramsStatus(data.bluramsStatus);
          setAiStatus(data.aiStatus);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const updates: Record<string, string> = {
        BLURAMS_EMAIL: bluramsEmail,
        BLURAMS_COOKIE: bluramsCookie,
        BLURAMS_TOKEN: bluramsToken,
        BLURAMS_DEVICE_ID: bluramsDeviceId,
        BLURAMS_CAMERA_IP: bluramsCameraIp,
        BLURAMS_STREAM_URL: bluramsStreamUrl,
        GEMINI_MODEL: geminiModel,
        OLLAMA_URL: ollamaUrl,
        OLLAMA_MODEL: ollamaModel
      };
      if (bluramsPassword && bluramsPassword !== '********') {
        updates.BLURAMS_PASSWORD = bluramsPassword;
      }
      if (geminiApiKey && geminiApiKey !== '********') {
        updates.GEMINI_API_KEY = geminiApiKey;
      }

      const res = await updateSystemSettings(updates);
      setBluramsStatus(res.bluramsStatus);
      setAiStatus(res.aiStatus);
      setFeedback({
        type: 'ok',
        text: `Settings written to .env (Backup: ${res.backupFile || 'saved'}) & Blurams bridge reloaded!`
      });
      onSaved();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReloadBridge = async () => {
    setIsReloading(true);
    try {
      const res = await reloadBluramsBridge();
      const refreshed = await fetchSystemSettings();
      setBluramsStatus(refreshed.bluramsStatus);
      setFeedback({
        type: 'ok',
        text: `Blurams Bridge reloaded. Mode: ${res.streamMode || refreshed.bluramsStatus?.streamMode}`
      });
      onSaved();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#000000]/85 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl dash-card p-6 flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#00F0FF]/25">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#00F0FF]/15 border border-[#00F0FF]/40 text-[#00F0FF] flex items-center justify-center">
              <Settings size={20} />
            </div>
            <div>
              <h3 className="text-sm md:text-base font-bold font-hud text-[#00F0FF]">
                SYSTEM CONFIGURATION // .ENV &amp; CLOUD BRIDGES
              </h3>
              <p className="text-xs text-[#7C99B8] font-mono">
                Google Gemini 3.5 Flash-Lite API &amp; Blurams CAPTCHA-Bypass Session Bridge
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-[#7C99B8] hover:text-[#FFFFFF] flex items-center justify-center cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 mt-4">
          {/* Section 1: Blurams Garage Camera (192.168.8.161) with CAPTCHA Bypass Cookie/Token */}
          <div className="p-4 rounded-xl bg-[#050A14]/90 border border-[#00F0FF]/25 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-hud text-[#00F0FF] font-bold">
                <Camera size={16} />
                <span>BLURAMS GARAGE LIVE STREAM BRIDGE (PORT 8556)</span>
              </div>
              <button
                type="button"
                onClick={handleReloadBridge}
                disabled={isReloading}
                className="px-3 py-1 rounded-lg bg-[#0B192E] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/35 text-[11px] font-mono text-[#00F0FF] flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={12} className={isReloading ? 'animate-spin' : ''} />
                <span>Hot-Reload Bridge</span>
              </button>
            </div>

            {bluramsStatus && (
              <div className="p-3 rounded-lg bg-[#081326] border border-[#00F0FF]/20 text-xs font-mono space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#7C99B8]">Bridge Status:</span>
                  <span className={bluramsStatus.online ? 'text-[#10B981] font-bold' : 'text-[#EF4444]'}>
                    {bluramsStatus.online ? `ONLINE (Mode: ${bluramsStatus.streamMode})` : 'OFFLINE'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#7C99B8]">Camera Ping ({bluramsStatus.cameraIp}):</span>
                  <span className={bluramsStatus.cameraPingReachable ? 'text-[#10B981]' : 'text-[#FF9E00]'}>
                    {bluramsStatus.cameraPingReachable ? 'REACHABLE VIA TAILSCALE' : 'NO ICMP REPLY'}
                  </span>
                </div>
                {bluramsStatus.lastError && (
                  <div className="text-[11px] text-[#FF9E00] pt-1 break-words">
                    Note: {bluramsStatus.lastError}
                  </div>
                )}
              </div>
            )}

            {/* CAPTCHA BYPASS: Browser Session Cookie or Token */}
            <div className="p-3 rounded-xl bg-[#07152B]/90 border border-[#00F0FF]/40 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#00F0FF]">
                <Key size={14} />
                <span>CAPTCHA BYPASS: Browser Session Cookie / Token (Recommended)</span>
              </div>
              <p className="text-[11px] text-[#E2F1FF]/80 leading-relaxed">
                Since <code>client.blurams.com</code> blocks automated password login with a CAPTCHA (<code>code -1</code>), log into{' '}
                <a
                  href="https://client.blurams.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#00F0FF] underline"
                >
                  client.blurams.com
                </a>{' '}
                in your browser once, open DevTools (<code>F12</code> &rarr; Network or Console <code>document.cookie</code>), and paste your session <strong>Cookie</strong> (or token) below:
              </p>
              <div>
                <label className="block text-[11px] text-[#7C99B8] font-mono mb-1">
                  BLURAMS_COOKIE (Full Cookie header from client.blurams.com)
                </label>
                <input
                  type="text"
                  value={bluramsCookie}
                  onChange={(e) => setBluramsCookie(e.target.value)}
                  placeholder="e.g. SESSION=...; JSESSIONID=...; _csrf=..."
                  className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/35 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#7C99B8] font-mono mb-1">
                  BLURAMS_TOKEN (Optional Bearer / Auth Token)
                </label>
                <input
                  type="text"
                  value={bluramsToken}
                  onChange={(e) => setBluramsToken(e.target.value)}
                  placeholder="Optional token if copied from localStorage / Network header"
                  className="w-full h-10 bg-[#050A14] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                Direct Live Stream URL Override (BLURAMS_STREAM_URL — HLS .m3u8 / FLV / RTSP)
              </label>
              <input
                type="text"
                value={bluramsStreamUrl}
                onChange={(e) => setBluramsStreamUrl(e.target.value)}
                placeholder="https://.../live.m3u8 or https://.../live.flv"
                className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Blurams Email (Fallback)
                </label>
                <input
                  type="email"
                  value={bluramsEmail}
                  onChange={(e) => setBluramsEmail(e.target.value)}
                  placeholder="your-blurams-email@example.com"
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Blurams Password (Fallback)
                </label>
                <input
                  type="password"
                  value={bluramsPassword}
                  onChange={(e) => setBluramsPassword(e.target.value)}
                  placeholder="Enter Blurams password"
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Blurams Device ID
                </label>
                <input
                  type="text"
                  value={bluramsDeviceId}
                  onChange={(e) => setBluramsDeviceId(e.target.value)}
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Camera IP (Garage Subnet)
                </label>
                <input
                  type="text"
                  value={bluramsCameraIp}
                  onChange={(e) => setBluramsCameraIp(e.target.value)}
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Google Gemini 3.5 Flash-Lite */}
          <div className="p-4 rounded-xl bg-[#050A14]/90 border border-[#00F0FF]/25 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-hud text-[#FF9E00] font-bold">
                <Cpu size={16} />
                <span>M.A.R.V.I.N. AI // GOOGLE GEMINI 3.5 FLASH-LITE</span>
              </div>
              <span className="text-[11px] font-mono text-[#10B981]">
                {aiStatus?.activeProvider || 'Gemini 3.5 Flash-Lite Active'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Google Gemini API Key (GEMINI_API_KEY)
                </label>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#7C99B8] font-semibold mb-1">
                  Gemini Model
                </label>
                <input
                  type="text"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="gemini-3.5-flash-lite"
                  className="w-full h-10 bg-[#081326] border border-[#00F0FF]/30 rounded-lg px-3 text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#00F0FF]"
                />
              </div>
            </div>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
                feedback.type === 'ok'
                  ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                  : 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444]'
              }`}
            >
              {feedback.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{feedback.text}</span>
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-[#0B192E] text-xs font-bold text-[#7C99B8] hover:text-[#FFFFFF] cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-[#00F0FF] hover:bg-[#00C8FF] text-[#050A14] font-bold text-xs flex items-center space-x-2 transition cursor-pointer"
            >
              <ShieldCheck size={16} />
              <span>{isSaving ? 'Saving & Reloading...' : 'Save to .env & Reload'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
