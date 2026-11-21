import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Terminal,
  CheckCircle2,
  ShieldCheck,
  Cpu,
  Database,
  Zap,
  ChevronRight,
  ChevronLeft,
  Activity,
  Trash2,
  Undo2
} from 'lucide-react';
import {
  sendJarvisCommand,
  fetchJarvisMemoryHistory,
  rollbackLastAiChange
} from '../services/api';
import { WebSocketClient } from '../services/websocket';
import {
  JarvisToolResult,
  JarvisTokenUsage,
  JarvisTraceStep,
  LocationType
} from '../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'jarvis';
  text: string;
  timestamp: string;
  provider?: string;
  toolResults?: JarvisToolResult[];
  executionLog?: JarvisTraceStep[];
  tokenUsage?: JarvisTokenUsage;
}

interface JarvisMainTerminalProps {
  onSelectLocation: (loc: LocationType | 'All') => void;
  onChangeViewMode: (mode: 'overview' | 'cameras' | 'devices' | 'pcs') => void;
  onOpenModal: (modal: 'scanner' | 'onboarding' | 'automations' | 'settings') => void;
  onRefreshData: () => void;
}

const TAG_BADGE_STYLES: Record<JarvisTraceStep['tag'], string> = {
  SCAN: 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/40',
  RAG: 'bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/40',
  LIST: 'bg-[#A78BFA]/15 text-[#A78BFA] border-[#A78BFA]/40',
  READ: 'bg-[#60A5FA]/15 text-[#60A5FA] border-[#60A5FA]/40',
  EDIT: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50',
  WRITE: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/50',
  BACKUP: 'bg-[#FF9E00]/15 text-[#FF9E00] border-[#FF9E00]/40',
  DELETE: 'bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444]/50',
  RESTART: 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/50',
  GEMINI: 'bg-[#00F0FF]/20 text-[#00F0FF] border-[#00F0FF]/50',
  CACHE: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/40',
  EXEC: 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/40',
  ERROR: 'bg-[#EF4444]/25 text-[#EF4444] border-[#EF4444]/60'
};

export const JarvisMainTerminal: React.FC<JarvisMainTerminalProps> = ({
  onSelectLocation,
  onChangeViewMode,
  onOpenModal,
  onRefreshData
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-core',
      role: 'jarvis',
      text: 'NUCLEUL M.A.R.V.I.N. (Mortyck Automated Reconnaissance & Virtual Infrastructure Node - models/gemini-3.5-flash-lite + SQLite FTS5 + Git tracking) ESTE ACTIV. Am acces complet de citire și scriere asupra fișierelor proiectului cu auto-commit, backup .bak și suport de rollback instant.',
      timestamp: new Date().toLocaleTimeString(),
      provider: 'GEMINI 3.5 FLASH-LITE // FULL FS AGENT'
    }
  ]);
  const [liveTraces, setLiveTraces] = useState<JarvisTraceStep[]>([
    {
      id: 'boot-1',
      tag: 'SCAN',
      message: 'SQLite FTS5 + Git tracking initialized (data/marvin_memory.db)',
      timestamp: Date.now()
    },
    {
      id: 'boot-2',
      tag: 'GEMINI',
      message: 'Connected to models/gemini-3.5-flash-lite with M.A.R.V.I.N. toolset',
      timestamp: Date.now()
    }
  ]);

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'ro-RO' | 'en-US'>('ro-RO');
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // Telemetry stats
  const [localCacheHits, setLocalCacheHits] = useState<number>(0);
  const [geminiTokensUsed, setGeminiTokensUsed] = useState<number>(0);
  const [savingsPercent, setSavingsPercent] = useState<number>(100);
  const [indexedFilesCount, setIndexedFilesCount] = useState<number>(46);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const traceEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    fetchJarvisMemoryHistory()
      .then((data) => {
        if (data.telemetry) {
          setLocalCacheHits(data.telemetry.localCacheHits);
          setGeminiTokensUsed(data.telemetry.geminiTokensUsed);
          setSavingsPercent(data.telemetry.savingsPercent);
          setIndexedFilesCount(data.telemetry.indexedFilesCount);
        }
        if (data.history && data.history.length > 0) {
          const loaded: ChatMessage[] = data.history.slice(-16).map((h) => {
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

    // Subscribe to real-time execution trace events from backend over WebSocket
    const ws = WebSocketClient.getInstance();
    const unsub = ws.subscribe((event, data) => {
      if ((event === 'jarvis_trace' || event === 'marvin_trace') && data && data.tag) {
        setLiveTraces((prev) => [...prev.slice(-35), data as JarvisTraceStep]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveTraces]);

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
        }
        if (res.tokenUsage.sessionTokens !== undefined) {
          setGeminiTokensUsed(res.tokenUsage.sessionTokens);
        }
        if (res.tokenUsage.savingsPercent !== undefined) {
          setSavingsPercent(res.tokenUsage.savingsPercent);
        }
      }

      if (res.executionLog && res.executionLog.length > 0) {
        setLiveTraces((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const merged = [...prev];
          for (const step of res.executionLog!) {
            if (!existingIds.has(step.id)) {
              merged.push(step);
            }
          }
          return merged.slice(-40);
        });
      }

      const jarvisMsg: ChatMessage = {
        id: `j-${Date.now()}`,
        role: 'jarvis',
        text: res.reply,
        timestamp: new Date().toLocaleTimeString(),
        provider: res.provider,
        toolResults: res.toolResults,
        executionLog: res.executionLog,
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
      const errStep: JarvisTraceStep = {
        id: `err-tr-${Date.now()}`,
        tag: 'ERROR',
        message: err.message,
        timestamp: Date.now()
      };
      setLiveTraces((prev) => [...prev.slice(-35), errStep]);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'jarvis',
          text: `EROARE NUCLEU AI: ${err.message}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleRollback = async () => {
    if (!confirm('Ești sigur că vrei să dai Rollback (git revert) la ultima modificare de cod făcută de AI?')) {
      return;
    }
    setIsRollingBack(true);
    try {
      const res = await rollbackLastAiChange();
      if (res.success) {
        const rollbackTrace: JarvisTraceStep = {
          id: `rb-${Date.now()}`,
          tag: 'BACKUP',
          message: res.message || 'Rollback efectuat cu succes (git revert HEAD)',
          timestamp: Date.now()
        };
        setLiveTraces((prev) => [...prev.slice(-35), rollbackTrace]);
        setMessages((prev) => [
          ...prev,
          {
            id: `rb-msg-${Date.now()}`,
            role: 'jarvis',
            text: `ROLLBACK EFECTUAT CU SUCCES: ${res.revertedCommit || 'Ultimul commit AI a fost anulat'}. Toate fișierele au fost restaurate la starea anterioară.`,
            timestamp: new Date().toLocaleTimeString(),
            provider: 'M.A.R.V.I.N. // GIT REVERT'
          }
        ]);
        onRefreshData();
      } else {
        alert(`Rollback eșuat: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Eroare la rollback: ${err.message}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  const toggleVoiceInput = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('Web Speech API nu este suportat în acest browser.');
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

  // Collapsed slim vertical rail on the right side
  if (isCollapsed) {
    return (
      <aside className="w-12 h-full bg-[#040A15]/95 border-l border-[#00F0FF]/35 flex flex-col items-center justify-between py-4 shrink-0 z-30 select-none">
        <button
          onClick={() => setIsCollapsed(false)}
          title="Expand M.A.R.V.I.N. Vertical Console"
          className="w-9 h-9 rounded-xl bg-[#07152B] border border-[#00F0FF]/50 text-[#00F0FF] flex items-center justify-center hover:bg-[#00F0FF] hover:text-[#050A14] transition cursor-pointer hud-glow-cyan"
        >
          <ChevronLeft size={18} />
        </button>

        <div
          onClick={() => setIsCollapsed(false)}
          className="writing-vertical-rl rotate-180 text-[11px] font-hud font-bold tracking-[0.25em] text-[#00F0FF] cursor-pointer flex items-center gap-2"
          style={{ writingMode: 'vertical-rl' }}
        >
          M.A.R.V.I.N. // TACTICAL NODE
        </div>

        <div className="flex flex-col items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full bg-[#10B981] shadow-[0_0_8px_#10B981]"
            title="AI Core Online"
          />
          <Cpu size={16} className="text-[#00F0FF]" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-[390px] xl:w-[430px] h-full bg-[#040914]/95 border-l border-[#00F0FF]/35 flex flex-col justify-between shrink-0 z-30 shadow-[-10px_0_30px_rgba(0,0,0,0.65)] overflow-hidden">
      {/* 1. Top Docked Sidebar Header */}
      <div className="p-3 bg-gradient-to-r from-[#040B18] via-[#091A34] to-[#040B18] border-b border-[#00F0FF]/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#050E1F] border border-[#00F0FF] flex items-center justify-center hud-glow-cyan shrink-0">
              <Cpu size={18} className="text-[#00F0FF]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-extrabold font-hud tracking-wider text-[#FFFFFF] truncate">
                  M.A.R.V.I.N. <span className="text-[#00F0FF]">// TACTICAL NODE</span>
                </h2>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#00F0FF]/20 text-[#00F0FF] border border-[#00F0FF]/50 shrink-0">
                  3.5 FLASH-LITE
                </span>
              </div>
              <p className="text-[10px] text-[#7C99B8] font-mono truncate">
                Git Tracked &bull; FTS5 ({indexedFilesCount} files) &bull; Auto .bak &bull; Relative Paths
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleRollback}
              disabled={isRollingBack}
              title="Rollback Last AI Change (Git Revert HEAD)"
              className={`h-8 px-2 rounded-lg border flex items-center gap-1 transition cursor-pointer text-[10px] font-mono font-bold ${
                isRollingBack
                  ? 'bg-[#EF4444]/20 border-[#EF4444] text-[#EF4444] animate-pulse'
                  : 'bg-[#081529] border-[#FF9E00]/40 text-[#FF9E00] hover:bg-[#FF9E00]/20'
              }`}
            >
              <Undo2 size={13} />
              <span>REVERT</span>
            </button>
            <button
              onClick={() => setVoiceLang((l) => (l === 'ro-RO' ? 'en-US' : 'ro-RO'))}
              title="Voice Recognition Language (RO / EN)"
              className="px-2 h-8 rounded-lg bg-[#081529] border border-[#00F0FF]/30 text-[10px] font-mono font-bold text-[#00F0FF] hover:bg-[#00F0FF]/20 cursor-pointer"
            >
              {voiceLang === 'ro-RO' ? 'RO' : 'EN'}
            </button>
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              title="Toggle Voice Speech Output"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition cursor-pointer ${
                ttsEnabled
                  ? 'bg-[#00F0FF]/25 border-[#00F0FF] text-[#00F0FF]'
                  : 'bg-[#081529] border-[#00F0FF]/25 text-[#7C99B8]'
              }`}
            >
              {ttsEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <button
              onClick={() => setIsCollapsed(true)}
              title="Collapse Sidebar"
              className="w-8 h-8 rounded-lg bg-[#081529] border border-[#00F0FF]/25 text-[#00F0FF] hover:bg-[#00F0FF]/20 flex items-center justify-center cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Compact Token Telemetry Bar */}
        <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-[#00F0FF]/15 text-[10px] font-mono">
          <div className="px-2 py-1 rounded bg-[#030711] border border-[#10B981]/30 flex items-center justify-between">
            <span className="text-[#7C99B8]">CACHE:</span>
            <strong className="text-[#10B981]">{localCacheHits} (0T)</strong>
          </div>
          <div className="px-2 py-1 rounded bg-[#030711] border border-[#00F0FF]/30 flex items-center justify-between">
            <span className="text-[#7C99B8]">GEMINI:</span>
            <strong className="text-[#00F0FF]">{geminiTokensUsed}T</strong>
          </div>
          <div className="px-2 py-1 rounded bg-[#030711] border border-[#FF9E00]/30 flex items-center justify-between">
            <span className="text-[#7C99B8]">SAVED:</span>
            <strong className="text-[#FF9E00]">{savingsPercent}%</strong>
          </div>
        </div>
      </div>

      {/* 2. Real-Time Execution Trace / Action Log Panel */}
      <div className="bg-[#02060D] border-b border-[#00F0FF]/25 flex flex-col">
        <div className="px-3 py-1.5 bg-[#061020] border-b border-[#00F0FF]/15 flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-[10px] font-hud font-bold text-[#00F0FF] tracking-wider">
            <Activity size={12} className={isSending ? 'animate-spin text-[#FF9E00]' : 'text-[#10B981]'} />
            <span>LIVE EXECUTION TRACE // ACTION LOG</span>
          </div>
          <button
            onClick={() => setLiveTraces([])}
            title="Clear Execution Trace"
            className="text-[10px] font-mono text-[#7C99B8] hover:text-[#EF4444] flex items-center gap-1 cursor-pointer"
          >
            <Trash2 size={11} /> Clear
          </button>
        </div>

        <div className="h-36 overflow-y-auto px-2.5 py-2 space-y-1 font-mono text-[11px]">
          {liveTraces.length === 0 ? (
            <div className="text-[#7C99B8]/60 text-[10px] italic py-4 text-center">
              Awaiting M.A.R.V.I.N. file or system operations...
            </div>
          ) : (
            liveTraces.map((step) => (
              <div
                key={step.id}
                className="flex items-start gap-1.5 py-0.5 border-b border-[#00F0FF]/5 last:border-0 leading-tight"
              >
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-bold border shrink-0 ${
                    TAG_BADGE_STYLES[step.tag] || 'bg-[#00F0FF]/15 text-[#00F0FF] border-[#00F0FF]/30'
                  }`}
                >
                  [{step.tag}]
                </span>
                <span className="text-[#E2F1FF] break-all flex-1">{step.message}</span>
                <span className="text-[9px] text-[#7C99B8] shrink-0">
                  {new Date(step.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
              </div>
            ))
          )}
          <div ref={traceEndRef} />
        </div>
      </div>

      {/* 3. Main Vertical Conversation & Modification Output Stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#030711] font-mono">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-3 rounded-xl border transition-all ${
              m.role === 'user'
                ? 'bg-[#081A35]/85 border-[#00F0FF]/40 ml-4'
                : 'bg-[#050E1D]/95 border-[#00F0FF]/25 mr-2 shadow-[inset_0_1px_0_rgba(0,240,255,0.1)]'
            }`}
          >
            {/* Prompt Header */}
            <div className="flex items-center justify-between gap-1.5 mb-1.5 text-[10px]">
              <span
                className={`font-bold truncate ${
                  m.role === 'user' ? 'text-[#FF9E00]' : 'text-[#00F0FF]'
                }`}
              >
                {m.role === 'user' ? 'CMD // USER' : 'M.A.R.V.I.N. // CORE'}
              </span>

              <div className="flex items-center gap-1.5 shrink-0">
                {m.tokenUsage && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 ${
                      m.tokenUsage.fastPath
                        ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
                        : 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/40'
                    }`}
                  >
                    {m.tokenUsage.fastPath ? (
                      <>
                        <Database size={9} /> 0 TOK
                      </>
                    ) : (
                      <>
                        <Zap size={9} /> {m.tokenUsage.totalTokens} TOK
                      </>
                    )}
                  </span>
                )}
                <span className="text-[9px] text-[#7C99B8]">{m.timestamp}</span>
              </div>
            </div>

            {/* Message Text */}
            <div className="whitespace-pre-wrap text-xs text-[#E2F1FF] leading-relaxed font-sans break-words">
              {m.text}
            </div>

            {/* Executed File / Device Tool Badges */}
            {m.toolResults && m.toolResults.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[#00F0FF]/15 flex flex-col gap-1">
                {m.toolResults.map((tr, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 rounded bg-[#02060D] border border-[#10B981]/35 flex items-center justify-between gap-1.5 text-[10px] font-mono text-[#10B981]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <CheckCircle2 size={11} className="shrink-0" />
                      <span className="truncate">
                        [{tr.tool}] {tr.summary}
                      </span>
                    </div>
                    {tr.backupFile && (
                      <span className="px-1.5 py-0.2 rounded bg-[#FF9E00]/15 text-[#FF9E00] text-[9px] flex items-center gap-0.5 shrink-0">
                        <ShieldCheck size={9} /> .bak
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {isSending && (
          <div className="p-2.5 rounded-xl bg-[#050E1D] border border-[#00F0FF]/40 flex items-center space-x-2 text-xs font-mono text-[#00F0FF] animate-pulse">
            <Terminal size={14} className="shrink-0" />
            <span>Executing via models/gemini-3.5-flash-lite...</span>
          </div>
        )}
        <div ref={consoleEndRef} />
      </div>

      {/* 4. Bottom Docked Command Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-2.5 bg-[#061124] border-t border-[#00F0FF]/35 flex items-center space-x-2"
      >
        <button
          type="button"
          onClick={toggleVoiceInput}
          title="Comandă Vocală (RO / EN)"
          className={`w-10 h-10 rounded-xl border flex items-center justify-center transition cursor-pointer shrink-0 ${
            isListening
              ? 'bg-[#EF4444] border-[#EF4444] text-[#FFFFFF] animate-pulse'
              : 'bg-[#091A36] border-[#00F0FF]/40 text-[#00F0FF] hover:bg-[#00F0FF]/20'
          }`}
        >
          {isListening ? <MicOff size={17} /> : <Mic size={17} />}
        </button>

        <div className="flex-1 flex items-center h-10 rounded-xl bg-[#030711] border border-[#00F0FF]/40 px-3 focus-within:border-[#00F0FF]">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Comandă M.A.R.V.I.N. sau modificare fișier..."
            className="w-full bg-transparent text-xs text-[#FFFFFF] placeholder-[#7C99B8] font-mono focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSending || !input.trim()}
          title="Execute Command"
          className="px-3.5 h-10 rounded-xl bg-[#00F0FF] hover:bg-[#33F3FF] text-[#050A14] font-hud font-bold text-xs flex items-center justify-center transition cursor-pointer disabled:opacity-40 shrink-0"
        >
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
};
