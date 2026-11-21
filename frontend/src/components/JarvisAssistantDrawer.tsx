import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Terminal,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Cpu,
  Database,
  Zap
} from 'lucide-react';
import { sendJarvisCommand, fetchJarvisMemoryHistory } from '../services/api';
import { JarvisToolResult, JarvisTokenUsage, LocationType } from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'jarvis';
  text: string;
  timestamp: string;
  provider?: string;
  toolResults?: JarvisToolResult[];
  tokenUsage?: JarvisTokenUsage;
}

interface JarvisAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation: (loc: LocationType | 'All') => void;
  onChangeViewMode: (mode: 'overview' | 'cameras' | 'devices' | 'pcs') => void;
  onOpenModal: (modal: 'scanner' | 'onboarding' | 'automations' | 'settings') => void;
  onRefreshData: () => void;
}

const QUICK_COMMANDS = [
  { label: 'Status (0 tok)', cmd: 'Status sistem' },
  { label: 'Aprinde Lumina (0 tok)', cmd: 'Aprinde lumina' },
  { label: 'Stinge Lumina (0 tok)', cmd: 'Stinge lumina' },
  { label: 'Pornește PC Garaj (0 tok)', cmd: 'Pornește calculatorul din garaj' },
  { label: 'Camere Garaj (0 tok)', cmd: 'Arată camerele din Garaj' },
  { label: 'RAG WebRTC (FTS5)', cmd: 'Arată codul funcției initWebRtc din WebRtcPlayer' },
  { label: 'Vezi go2rtc.yaml (0 tok)', cmd: 'Citește fișierul go2rtc.yaml' }
];

export const JarvisAssistantDrawer: React.FC<JarvisAssistantDrawerProps> = ({
  isOpen,
  onClose,
  onSelectLocation,
  onChangeViewMode,
  onOpenModal,
  onRefreshData
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'jarvis',
      text: 'M.A.R.V.I.N. SQLite Memory & FTS5 RAG Engine Online (data/marvin_memory.db). Istoricul conversației, command_cache și indexul de cod FTS5 rulează local pe laptop pentru >95% economie de tokeni Gemini.',
      timestamp: new Date().toLocaleTimeString(),
      provider: 'SQLite FTS5 + Gemini 2.5 Flash-Lite'
    }
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'ro-RO' | 'en-US'>('ro-RO');
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // Persistent SQLite Token Savings Telemetry
  const [localCacheHits, setLocalCacheHits] = useState<number>(0);
  const [geminiTokensUsed, setGeminiTokensUsed] = useState<number>(0);
  const [estimatedTokensSaved, setEstimatedTokensSaved] = useState<number>(0);
  const [savingsPercent, setSavingsPercent] = useState<number>(100);
  const [indexedFilesCount, setIndexedFilesCount] = useState<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      fetchJarvisMemoryHistory()
        .then((data) => {
          if (data.telemetry) {
            setLocalCacheHits(data.telemetry.localCacheHits);
            setGeminiTokensUsed(data.telemetry.geminiTokensUsed);
            setEstimatedTokensSaved(data.telemetry.estimatedTokensSaved);
            setSavingsPercent(data.telemetry.savingsPercent);
            setIndexedFilesCount(data.telemetry.indexedFilesCount);
          }
          if (data.history && data.history.length > 0) {
            const loaded: ChatMessage[] = data.history.map((h) => {
              let parsedTools: JarvisToolResult[] | undefined;
              try {
                if (h.toolCallsJson) parsedTools = JSON.parse(h.toolCallsJson);
              } catch {}
              return {
                id: `sql-${h.id}`,
                role: h.role,
                text: h.message,
                timestamp: new Date(h.createdAt).toLocaleTimeString(),
                provider: h.provider,
                toolResults: parsedTools,
                tokenUsage:
                  h.role === 'jarvis'
                    ? {
                        promptTokens: 0,
                        outputTokens: 0,
                        totalTokens: h.tokensUsed,
                        sessionTokens: data.telemetry?.geminiTokensUsed || 0,
                        estimatedCostUsd: 0,
                        fastPath: h.cacheHit
                      }
                    : undefined
              };
            });
            setMessages(loaded);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const speakReply = (rawText: string) => {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const clean = rawText
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[*_`#]/g, '')
        .slice(0, 320);
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = voiceLang;
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    } catch {}
  };

  const handleSend = async (customPrompt?: string) => {
    const promptText = (customPrompt ?? input).trim();
    if (!promptText || isSending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput('');
    setIsSending(true);

    try {
      const res = await sendJarvisCommand(promptText);

      if (res.tokenUsage) {
        if (res.tokenUsage.localCacheHits !== undefined) {
          setLocalCacheHits(res.tokenUsage.localCacheHits);
        } else if (res.tokenUsage.fastPath) {
          setLocalCacheHits((c) => c + 1);
        }
        if (res.tokenUsage.sessionTokens !== undefined) {
          setGeminiTokensUsed(res.tokenUsage.sessionTokens);
        }
        if (res.tokenUsage.estimatedTokensSaved !== undefined) {
          setEstimatedTokensSaved(res.tokenUsage.estimatedTokensSaved);
        }
        if (res.tokenUsage.savingsPercent !== undefined) {
          setSavingsPercent(res.tokenUsage.savingsPercent);
        }
      }

      const jarvisMsg: ChatMessage = {
        id: `j-${Date.now()}`,
        role: 'jarvis',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString(),
        provider: res.provider,
        toolResults: res.toolResults,
        tokenUsage: res.tokenUsage
      };
      setMessages((prev) => [...prev, jarvisMsg]);
      speakReply(res.reply);

      if (res.uiAction) {
        if (res.uiAction.location) onSelectLocation(res.uiAction.location);
        if (res.uiAction.viewMode) onChangeViewMode(res.uiAction.viewMode);
        if (res.uiAction.openModal) onOpenModal(res.uiAction.openModal);
      }

      if (res.toolResults && res.toolResults.length > 0) {
        onRefreshData();
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'jarvis',
          text: `Eroare comunicare nucleu tactic: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('Web Speech API is not supported in this browser.');
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = voiceLang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    rec.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setInput(transcript);
        handleSend(transcript);
      }
    };

    recognitionRef.current = rec;
    rec.start();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#000000]/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg h-full bg-[#060D1A]/95 border-l border-[#00F0FF]/40 shadow-2xl flex flex-col">
        {/* Top Tactical Header + SQLite Token Savings Telemetry */}
        <div className="p-4 border-b border-[#00F0FF]/25 bg-[#081326]/90 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-xl bg-[#00F0FF]/15 border border-[#00F0FF]/50 flex items-center justify-center text-[#00F0FF] hud-glow-cyan">
                <Cpu size={22} />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold font-hud text-[#00F0FF] tracking-wider">
                    M.A.R.V.I.N. // SQLITE RAG ENGINE
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30">
                    FTS5 ACTIVE
                  </span>
                </div>
                <p className="text-[11px] text-[#7C99B8] font-mono">
                  marvin_memory.db &bull; {indexedFilesCount} Indexed Files &bull; 60-Line RAG
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setVoiceLang((l) => (l === 'ro-RO' ? 'en-US' : 'ro-RO'))}
                title="Switch Voice Recognition Language (RO / EN)"
                className="touch-btn px-2.5 h-10 rounded-lg bg-[#0B192E] border border-[#00F0FF]/30 text-[11px] font-mono font-bold text-[#00F0FF] hover:bg-[#00F0FF]/15 cursor-pointer"
              >
                {voiceLang === 'ro-RO' ? 'RO' : 'EN'}
              </button>
              <button
                onClick={() => setTtsEnabled(!ttsEnabled)}
                title="Toggle Voice Speech Output"
                className={`touch-btn w-10 h-10 rounded-lg border transition cursor-pointer ${
                  ttsEnabled
                    ? 'bg-[#00F0FF]/20 border-[#00F0FF] text-[#00F0FF]'
                    : 'bg-[#0B192E] border-[#00F0FF]/20 text-[#7C99B8]'
                }`}
              >
                {ttsEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </button>
              <button
                onClick={onClose}
                className="touch-btn w-10 h-10 rounded-lg bg-[#0B192E] border border-[#00F0FF]/20 text-[#7C99B8] hover:text-[#FFFFFF] cursor-pointer"
              >
                <X size={19} />
              </button>
            </div>
          </div>

          {/* Token Savings Telemetry Bar: LOCAL CACHE HITS vs GEMINI API TOKENS USED */}
          <div className="grid grid-cols-3 gap-2 p-2 rounded-xl bg-[#050A14] border border-[#00F0FF]/25 text-[10px] font-mono">
            <div className="px-2 py-1 rounded bg-[#10B981]/10 border border-[#10B981]/30">
              <span className="text-[#7C99B8] block text-[9px] uppercase">LOCAL CACHE HITS</span>
              <span className="text-xs font-bold text-[#10B981]">
                {localCacheHits} <span className="text-[10px] font-normal">(0 TOK)</span>
              </span>
            </div>
            <div className="px-2 py-1 rounded bg-[#00F0FF]/10 border border-[#00F0FF]/30">
              <span className="text-[#7C99B8] block text-[9px] uppercase">GEMINI API TOKENS</span>
              <span className="text-xs font-bold text-[#00F0FF]">
                {geminiTokensUsed} <span className="text-[10px] font-normal">USED</span>
              </span>
            </div>
            <div className="px-2 py-1 rounded bg-[#FF9E00]/10 border border-[#FF9E00]/30">
              <span className="text-[#7C99B8] block text-[9px] uppercase">TOKEN SAVINGS</span>
              <span className="text-xs font-bold text-[#FF9E00]">
                {savingsPercent}% <span className="text-[10px] font-normal">(~{estimatedTokensSaved})</span>
              </span>
            </div>
          </div>
        </div>

        {/* Quick Tactical Chips */}
        <div className="px-4 py-2.5 bg-[#050A14]/90 border-b border-[#00F0FF]/15 flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <Sparkles size={14} className="text-[#FF9E00] shrink-0" />
          {QUICK_COMMANDS.map((q, i) => (
            <button
              key={i}
              onClick={() => handleSend(q.cmd)}
              className="px-3 py-1.5 rounded-lg bg-[#0B192E] hover:bg-[#00F0FF]/20 border border-[#00F0FF]/25 text-xs font-mono text-[#E2F1FF] whitespace-nowrap transition cursor-pointer"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* Chat Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#00F0FF]/20 border border-[#00F0FF]/50 text-[#FFFFFF]'
                    : 'bg-[#0A172A]/95 border border-[#00F0FF]/25 text-[#E2F1FF]'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5 text-[10px] font-mono text-[#7C99B8]">
                  <span className="font-bold text-[#00F0FF]">
                    {m.role === 'user' ? 'COMMANDER // MORTYCK' : 'J.A.R.V.I.S. // HUD'}
                  </span>
                  <div className="flex items-center space-x-2">
                    {m.tokenUsage && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 ${
                          m.tokenUsage.fastPath
                            ? 'bg-[#10B981]/15 text-[#10B981]'
                            : 'bg-[#00F0FF]/15 text-[#00F0FF]'
                        }`}
                      >
                        {m.tokenUsage.fastPath ? (
                          <>
                            <Database size={10} /> 0 TOK (SQLITE CACHE)
                          </>
                        ) : (
                          <>
                            <Zap size={10} /> {m.tokenUsage.totalTokens} TOK (GEMINI)
                          </>
                        )}
                      </span>
                    )}
                    <span>{m.timestamp}</span>
                  </div>
                </div>

                <div className="whitespace-pre-wrap font-sans text-xs">{m.text}</div>

                {/* Executed Tool Calls & FTS5 RAG Badges */}
                {m.toolResults && m.toolResults.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-[#00F0FF]/20 space-y-1.5">
                    {m.toolResults.map((tr, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-[#050A14] border border-[#10B981]/40 flex items-center justify-between text-[11px] font-mono"
                      >
                        <div className="flex items-center space-x-2 text-[#10B981]">
                          <CheckCircle2 size={13} />
                          <span>
                            [{tr.tool}] {tr.summary}
                          </span>
                        </div>
                        {tr.backupFile && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FF9E00]/15 text-[#FF9E00] text-[10px] flex items-center gap-1">
                            <ShieldCheck size={11} /> Backup
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="flex items-center space-x-2 text-xs font-mono text-[#00F0FF] animate-pulse px-2">
              <Terminal size={14} />
              <span>M.A.R.V.I.N. querying SQLite FTS5 &amp; executing subroutine...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input & Voice Command Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3.5 bg-[#081326] border-t border-[#00F0FF]/30 flex items-center space-x-2"
        >
          <button
            type="button"
            onClick={toggleVoiceInput}
            title="Voice Command (Microphone)"
            className={`touch-btn w-12 h-12 rounded-xl border flex items-center justify-center transition cursor-pointer ${
              isListening
                ? 'bg-[#EF4444] border-[#EF4444] text-[#FFFFFF] animate-pulse'
                : 'bg-[#0B192E] border-[#00F0FF]/35 text-[#00F0FF] hover:bg-[#00F0FF]/15'
            }`}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              voiceLang === 'ro-RO'
                ? 'Comandă M.A.R.V.I.N. (SQLite Cache / FTS5 RAG)...'
                : 'Command M.A.R.V.I.N. (SQLite Cache / FTS5 RAG)...'
            }
            className="flex-1 h-12 rounded-xl bg-[#050A14] border border-[#00F0FF]/35 px-4 text-sm text-[#FFFFFF] placeholder-[#7C99B8] focus:outline-none focus:border-[#00F0FF]"
          />

          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="touch-btn w-12 h-12 rounded-xl bg-[#00F0FF] hover:bg-[#00C8FF] text-[#050A14] font-bold flex items-center justify-center transition cursor-pointer disabled:opacity-40"
          >
            <Send size={19} />
          </button>
        </form>
      </div>
    </div>
  );
};
