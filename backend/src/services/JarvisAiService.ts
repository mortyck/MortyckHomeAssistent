import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { Database } from '../db/Database.js';
import { DeviceManager } from './DeviceManager.js';
import { MediaService } from './MediaService.js';
import { WolService } from './WolService.js';
import { JarvisMemoryEngine, CachedCommandMatch } from './JarvisMemoryEngine.js';
import {
  JarvisChatResponse,
  JarvisToolResult,
  JarvisTokenUsage,
  JarvisTraceStep
} from '../types/index.js';

const ROOT_DIR = fs.existsSync(path.join(process.cwd(), 'docker', 'go2rtc.yaml'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const BACKUP_DIR = path.join(ROOT_DIR, 'backend', 'data', 'backups');
const ENV_PATH = path.join(ROOT_DIR, '.env');

const ALLOWED_CONFIG_FILES: Record<string, string> = {
  'go2rtc.yaml': path.join(ROOT_DIR, 'docker', 'go2rtc.yaml'),
  '.env': ENV_PATH,
  'devices.json': path.join(ROOT_DIR, 'backend', 'data', 'devices.json'),
  'pcs.json': path.join(ROOT_DIR, 'backend', 'data', 'pcs.json'),
  'automations.json': path.join(ROOT_DIR, 'backend', 'data', 'automations.json'),
  'settings.json': path.join(ROOT_DIR, 'backend', 'data', 'settings.json'),
  'blurams_bridge.log': path.join(ROOT_DIR, 'logs', 'blurams_bridge.log')
};

const BLOCKED_PATH_SEGMENTS = new Set(['.git', 'node_modules']);

const GEMINI_TOOLS: FunctionDeclaration[] = [
  {
    name: 'listFiles',
    description: 'Listează fișierele și directoarele din proiectul MortyckHomeAssistent (exclude .git și node_modules).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        directory: {
          type: Type.STRING,
          description: 'Calea relativă în proiect (ex: "", "frontend/src/components", "backend/src/services")'
        }
      }
    }
  },
  {
    name: 'readFile',
    description: 'Citește conținutul unui fișier din proiectul MortyckHomeAssistent (cu numere de linie opționale startLine / endLine).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: 'Calea relativă a fișierului în proiect (ex: "frontend/src/App.tsx", "backend/src/index.ts", ".env")'
        },
        startLine: {
          type: Type.NUMBER,
          description: 'Linia de start (1-indexed, opțional)'
        },
        endLine: {
          type: Type.NUMBER,
          description: 'Linia de final (inclusiv, opțional)'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'patchFile',
    description: 'Modifică o secțiune exactă dintr-un fișier existent din proiect (creează automat backup .bak înainte de modificare).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: 'Calea relativă a fișierului (ex: "frontend/src/App.tsx")'
        },
        targetContent: {
          type: Type.STRING,
          description: 'Textul exact existent care trebuie înlocuit'
        },
        replacementContent: {
          type: Type.STRING,
          description: 'Noul text care îl înlocuiește pe targetContent'
        }
      },
      required: ['filePath', 'targetContent', 'replacementContent']
    }
  },
  {
    name: 'editFile',
    description: 'Editează un fișier existent din proiect prin înlocuirea unei secțiuni exacte (targetContent -> replacementContent) sau suprascriere completă (content).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: 'Calea relativă a fișierului în proiect'
        },
        targetContent: {
          type: Type.STRING,
          description: 'Textul existent exact ce trebuie înlocuit'
        },
        replacementContent: {
          type: Type.STRING,
          description: 'Noul text care înlocuiește targetContent'
        },
        content: {
          type: Type.STRING,
          description: 'Alternativ: conținutul integral pentru suprascriere directă'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'writeFile',
    description: 'Creează sau suprascrie complet un fișier în proiectul MortyckHomeAssistent (creează automat backup .bak dacă fișierul există).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: 'Calea relativă a fișierului în proiect'
        },
        content: {
          type: Type.STRING,
          description: 'Conținutul complet care va fi scris în fișier'
        }
      },
      required: ['filePath', 'content']
    }
  },
  {
    name: 'deleteFile',
    description: 'Șterge un fișier din proiect după ce îi creează automat o copie de siguranță .bak.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filePath: {
          type: Type.STRING,
          description: 'Calea relativă a fișierului de șters'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'restartServer',
    description: 'Reîncarcă variabilele .env, reindexează baza SQLite FTS5, reîncarcă serviciile go2rtc / Blurams Bridge și recompilează backend-ul/frontend-ul dacă e necesar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: {
          type: Type.STRING,
          description: 'Serviciul țintă: "all", "backend", "blurams", "go2rtc"'
        }
      }
    }
  },
  {
    name: 'toggleDevice',
    description: 'Aprinde sau stinge un dispozitiv IoT (lumină/priză) și opțional setează luminozitatea.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID-ul dispozitivului din index (sau "all")' },
        power: { type: Type.BOOLEAN, description: 'true=ON, false=OFF' },
        brightness: { type: Type.NUMBER, description: 'Opțional 1-100' }
      },
      required: ['deviceId', 'power']
    }
  },
  {
    name: 'deleteDevice',
    description: 'Șterge un dispozitiv IoT sau o cameră după ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID-ul dispozitivului sau camerei' }
      },
      required: ['deviceId']
    }
  },
  {
    name: 'wakePC',
    description: 'Pornește un calculator prin Wake-on-LAN.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pcId: { type: Type.STRING, description: 'ID-ul PC-ului (ex: pc-home sau pc-garage)' }
      },
      required: ['pcId']
    }
  },
  {
    name: 'editConfig',
    description: 'Actualizează o cheie de configurare în .env (ex: BLURAMS_EMAIL, BLURAMS_PASSWORD) sau settings.json cu backup automat.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        file: { type: Type.STRING, description: 'Fișierul țintă: .env sau settings.json' },
        key: { type: Type.STRING, description: 'Cheia de modificat (ex: BLURAMS_EMAIL)' },
        value: { type: Type.STRING, description: 'Noua valoare' }
      },
      required: ['file', 'key', 'value']
    }
  }
];

export class JarvisAiService {
  private static instance: JarvisAiService;
  private db: Database;
  private deviceManager: DeviceManager;
  private mediaService: MediaService;
  private wolService: WolService;
  private memory: JarvisMemoryEngine;
  private defaultRoutingMode: 'antigravity' | 'api_fallback' = 'antigravity';

  private constructor() {
    this.db = Database.getInstance();
    this.deviceManager = DeviceManager.getInstance();
    this.mediaService = MediaService.getInstance();
    this.wolService = WolService.getInstance();
    this.memory = JarvisMemoryEngine.getInstance();
    this.reloadEnvFromDisk();
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  public static getInstance(): JarvisAiService {
    if (!JarvisAiService.instance) {
      JarvisAiService.instance = new JarvisAiService();
    }
    return JarvisAiService.instance;
  }

  public getMemoryEngine(): JarvisMemoryEngine {
    return this.memory;
  }

  public getRoutingMode(): 'antigravity' | 'api_fallback' {
    return this.defaultRoutingMode;
  }

  public setRoutingMode(mode: 'antigravity' | 'api_fallback'): void {
    this.defaultRoutingMode = mode;
  }

  public reloadEnvFromDisk(): void {
    try {
      if (!fs.existsSync(ENV_PATH)) return;
      dotenv.config({ path: ENV_PATH, override: true });
      const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (k) {
          process.env[k] = v;
        }
      }
    } catch {}
  }

  public resolveGeminiModel(isCodeTask: boolean = false): string {
    if (isCodeTask) {
      const codeModel = (process.env.GEMINI_CODE_MODEL || 'gemini-3.5-flash').trim().replace(/^models\//, '');
      if (codeModel === 'gemini-2.5-flash') {
        return 'gemini-3.5-flash';
      }
      return codeModel;
    }
    const raw = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim().replace(/^models\//, '');
    if (!raw || raw === 'gemini-2.5-flash-lite') {
      return 'gemini-3.5-flash-lite';
    }
    return raw;
  }

  public isCodeModificationTask(msg: string): boolean {
    const codeKeywords = [
      'modific', 'schimb', 'adaug', 'sterg', 'șterg', 'corecteaz', 'repar',
      'edit', 'patch', 'write', 'create', 'update', 'refactor', 'fix',
      'code', 'script', 'fisier', 'fișier', 'component', 'functie', 'funcție',
      'css', 'html', 'tsx', 'ts', 'js', 'py', 'json', 'yaml', 'yml',
      'scrie', 'rescrie', 'adauga', 'adaugă', 'redenumeste', 'redenumi'
    ];
    const lower = msg.toLowerCase();
    return codeKeywords.some((kw) => lower.includes(kw));
  }

  private extractGoogleApiErrorMessage(err: any): string {
    const rawMsg = String(err?.message || err || 'Unknown Google Gemini API error');
    try {
      const jsonStart = rawMsg.indexOf('{');
      if (jsonStart !== -1) {
        const parsed = JSON.parse(rawMsg.slice(jsonStart));
        if (parsed?.error?.message) {
          const code = parsed.error.code
            ? ` (HTTP ${parsed.error.code} ${parsed.error.status || ''})`.trimEnd()
            : '';
          return `${parsed.error.message}${code}`;
        }
      }
    } catch {}
    return rawMsg;
  }

  /**
   * Resolve and sandbox any project path inside D:\MortyckHome (excluding .git and node_modules).
   */
  private resolveSafeProjectPath(relOrAbsPath: string): { fullPath: string; relPath: string } {
    const cleaned = (relOrAbsPath || '')
      .trim()
      .replace(/^[/\\]+/, '');

    const fullPath = path.isAbsolute(relOrAbsPath)
      ? path.resolve(relOrAbsPath)
      : path.resolve(ROOT_DIR, cleaned);

    const normalizedRoot = path.resolve(ROOT_DIR);
    if (!fullPath.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
      throw new Error(`Access denied: Path outside project workspace (${relOrAbsPath})`);
    }

    const relPath = path.relative(normalizedRoot, fullPath).replace(/\\/g, '/');
    const segments = relPath.split('/');
    for (const seg of segments) {
      if (BLOCKED_PATH_SEGMENTS.has(seg)) {
        throw new Error(`Access denied: Restricted directory segment "${seg}"`);
      }
    }

    return { fullPath, relPath: relPath || '.' };
  }

  private pushTrace(
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void,
    tag: JarvisTraceStep['tag'],
    message: string,
    extra?: { filePath?: string; lineRange?: string; backupFile?: string }
  ): JarvisTraceStep {
    const step: JarvisTraceStep = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tag,
      message,
      filePath: extra?.filePath,
      lineRange: extra?.lineRange,
      backupFile: extra?.backupFile,
      timestamp: Date.now()
    };
    executionLog.push(step);
    broadcastWs('marvin_trace', step);
    broadcastWs('jarvis_trace', step);
    try {
      const traceLine = `[${new Date(step.timestamp).toISOString()}] [${step.tag}] ${step.message}\n`;
      fs.appendFileSync(path.join(ROOT_DIR, 'data', 'marvin_trace.log'), traceLine, 'utf8');
    } catch {}
    return step;
  }

  public createFileBackup(filePath: string): string | undefined {
    try {
      if (!fs.existsSync(filePath)) return undefined;
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }
      const baseName = path.basename(filePath);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `${baseName}.${stamp}.bak`;
      const backupPath = path.join(BACKUP_DIR, backupName);
      fs.copyFileSync(filePath, backupPath);
      return backupName;
    } catch (err: any) {
      console.warn(`[JarvisAI] Backup creation warning: ${err.message}`);
      return undefined;
    }
  }

  public listBackups(): { name: string; size: number; createdAt: number }[] {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return [];
      return fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.bak'))
        .map((f) => {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: stat.size, createdAt: stat.mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 25);
    } catch {
      return [];
    }
  }

  public buildMinifiedDeviceTable(): string {
    const devEntries = this.db.getAllDevices().map((d) => {
      const st = d.category === 'camera' ? (d.online ? 'READY' : 'OFF') : d.state?.power ? 'ON' : 'OFF';
      return `${d.id}|${d.name}|${d.location}|${st}`;
    });
    const pcEntries = this.db.getAllPcs().map((p) => {
      return `${p.id}|${p.name}|${p.location}|${p.online ? 'ON' : 'OFF'}`;
    });
    return [...devEntries, ...pcEntries].join(';');
  }

  public async checkAiStatus() {
    this.reloadEnvFromDisk();
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
    const geminiModel = this.resolveGeminiModel();
    const telemetry = this.memory.getTelemetryStats();
    const routingMode = this.defaultRoutingMode;

    const activeProvider = routingMode === 'antigravity'
      ? 'Antigravity MCP Queue (0 API calls)'
      : geminiConfigured
        ? `Gemini (${geminiModel}) + SQLite RAG`
        : 'SQLite FTS5 Local Engine (0-Token Mode)';

    return {
      geminiConfigured,
      geminiModel,
      activeProvider,
      routingMode,
      telemetry
    };
  }

  public async processCommand(
    userMessage: string,
    broadcastWs: (event: string, data: any) => void,
    requestedMode?: 'antigravity' | 'api_fallback'
  ): Promise<JarvisChatResponse> {
    this.reloadEnvFromDisk();
    const msg = (userMessage || '').trim();
    const toolResults: JarvisToolResult[] = [];
    const executionLog: JarvisTraceStep[] = [];
    const effectiveMode = requestedMode || this.defaultRoutingMode || 'antigravity';

    this.memory.saveConversationTurn('user', msg, 'USER', 0, false);

    // 1. STRICT 0-TOKEN CACHE: Only exact device control commands hit the cache
    const cachedMatch = this.memory.findCachedCommand(msg);
    if (cachedMatch) {
      this.pushTrace(
        executionLog,
        broadcastWs,
        'CACHE',
        `Matched SQLite command_cache intent "${cachedMatch.normalizedIntent}" (0 tokens)`
      );
      const execOut = await this.executeCachedIntent(
        cachedMatch,
        toolResults,
        executionLog,
        broadcastWs
      );
      const stats = this.memory.getTelemetryStats();
      const tokenUsage: JarvisTokenUsage = {
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        sessionTokens: stats.geminiTokensUsed,
        estimatedCostUsd: Number(((stats.geminiTokensUsed / 1_000_000) * 0.1).toFixed(6)),
        fastPath: true,
        localCacheHits: stats.localCacheHits,
        estimatedTokensSaved: stats.estimatedTokensSaved,
        savingsPercent: stats.savingsPercent
      };

      const providerLabel = `SQLite Command Cache (Hit #${cachedMatch.hitCount} • 0 TOK)`;
      this.memory.saveConversationTurn('jarvis', execOut.reply, providerLabel, 0, true, toolResults);

      return {
        reply: execOut.reply,
        provider: providerLabel,
        toolResults,
        executionLog,
        tokenUsage,
        uiAction: execOut.uiAction
      };
    }

    // 2. STRICT 0-TOKEN REGEX FAST-PATH: Only explicit imperative control commands
    const fastPathResult = await this.tryStrictZeroTokenFastPath(
      msg,
      toolResults,
      executionLog,
      broadcastWs
    );
    if (fastPathResult.matched) {
      this.memory.recordCacheHit();
      if (fastPathResult.learnedAction) {
        this.memory.learnCommandIntent(
          msg,
          fastPathResult.learnedAction.type,
          fastPathResult.learnedAction.payload,
          fastPathResult.reply
        );
      }

      const stats = this.memory.getTelemetryStats();
      const tokenUsage: JarvisTokenUsage = {
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        sessionTokens: stats.geminiTokensUsed,
        estimatedCostUsd: Number(((stats.geminiTokensUsed / 1_000_000) * 0.1).toFixed(6)),
        fastPath: true,
        localCacheHits: stats.localCacheHits,
        estimatedTokensSaved: stats.estimatedTokensSaved,
        savingsPercent: stats.savingsPercent
      };

      const providerLabel = 'M.A.R.V.I.N. Zero-Token Fast Path (0 API calls)';
      this.memory.saveConversationTurn(
        'jarvis',
        fastPathResult.reply,
        providerLabel,
        0,
        true,
        toolResults
      );

      return {
        reply: fastPathResult.reply,
        provider: providerLabel,
        toolResults,
        executionLog,
        tokenUsage,
        uiAction: fastPathResult.uiAction
      };
    }

    // 3. ALL OTHER MESSAGES (Questions, Diagnostics, Full Project Code/Config Edits)
    const isCodeTask = this.isCodeModificationTask(msg);
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

    // Check surgical RAG context
    this.pushTrace(
      executionLog,
      broadcastWs,
      'SCAN',
      'Searching SQLite FTS5 code_index across project files...'
    );
    const ragHit = this.memory.retrieveSurgicalCodeSnippet(msg, 60);
    if (ragHit) {
      this.pushTrace(
        executionLog,
        broadcastWs,
        'RAG',
        `Extracted ${ragHit.filePath} (lines ${ragHit.startLine}-${ragHit.endLine})`,
        {
          filePath: ragHit.filePath,
          lineRange: `L${ragHit.startLine}-L${ragHit.endLine}`
        }
      );
    }

    // 4. ANTIGRAVITY MCP QUEUE (0 Google API calls):
    // All code, configuration, or file modification tasks in ANTIGRAVITY mode are enqueued into data/marvin_tasks.json
    if (effectiveMode === 'antigravity' && (isCodeTask || !geminiKey)) {
      return this.enqueueAntigravityTask(
        msg,
        ragHit,
        toolResults,
        executionLog,
        broadcastWs
      );
    }

    // 5. API FALLBACK -> Direct Google Gemini API with surgical RAG
    if (geminiKey) {
      try {
        const geminiResult = await this.callGeminiWithSurgicalContext(
          msg,
          geminiKey,
          ragHit,
          toolResults,
          executionLog,
          broadcastWs
        );
        this.memory.saveConversationTurn(
          'jarvis',
          geminiResult.reply,
          geminiResult.provider,
          geminiResult.tokenUsage?.totalTokens || 0,
          false,
          toolResults
        );
        return geminiResult;
      } catch (err: any) {
        const cleanGoogleErr = this.extractGoogleApiErrorMessage(err);
        console.error(`[JarvisAI] Gemini API error:`, cleanGoogleErr);
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `Gemini API Error: ${cleanGoogleErr}`);
        const errReply = `Eroare Google Gemini API (${this.resolveGeminiModel()}): ${cleanGoogleErr}`;
        return {
          reply: errReply,
          provider: `Gemini API Error (${this.resolveGeminiModel()})`,
          toolResults,
          executionLog
        };
      }
    }

    const noKeyReply = `Cheia \`GEMINI_API_KEY\` nu este configurată în \`.env\`. Adăugați cheia în Setări pentru răspunsuri conversaționale AI.`;
    this.pushTrace(executionLog, broadcastWs, 'ERROR', 'Missing GEMINI_API_KEY in .env');
    return {
      reply: noKeyReply,
      provider: 'M.A.R.V.I.N. Local Core (Missing GEMINI_API_KEY)',
      toolResults,
      executionLog
    };
  }

  public async enqueueAntigravityTask(
    msg: string,
    ragHit: any,
    toolResults: JarvisToolResult[],
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void
  ): Promise<JarvisChatResponse> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tasksPath = path.join(ROOT_DIR, 'data', 'marvin_tasks.json');
    let taskData: any = {
      version: '1.0.0',
      assistant: 'M.A.R.V.I.N.',
      lastUpdated: new Date().toISOString(),
      activeTask: null,
      tasks: []
    };

    if (fs.existsSync(tasksPath)) {
      try {
        taskData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      } catch {}
    }

    const newTask = {
      id: taskId,
      prompt: msg,
      status: 'pending',
      createdAt: new Date().toISOString(),
      targetFile: ragHit?.filePath || null,
      lineRange: ragHit ? `L${ragHit.startLine}-L${ragHit.endLine}` : null,
      contextSnippet: ragHit?.snippet || null
    };

    taskData.activeTask = newTask;
    if (!taskData.tasks) taskData.tasks = [];
    taskData.tasks.unshift(newTask);
    taskData.lastUpdated = new Date().toISOString();

    try {
      fs.writeFileSync(tasksPath, JSON.stringify(taskData, null, 2), 'utf8');
    } catch (err: any) {
      console.warn(`[JarvisAI] Error writing marvin_tasks.json: ${err.message}`);
    }

    this.pushTrace(
      executionLog,
      broadcastWs,
      'EXEC',
      `Sarcina #${taskId} plasată în coada Antigravity MCP (status: pending)`
    );

    const stats = this.memory.getTelemetryStats();
    const tokenUsage: JarvisTokenUsage = {
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      sessionTokens: stats.geminiTokensUsed,
      estimatedCostUsd: Number(((stats.geminiTokensUsed / 1_000_000) * 0.1).toFixed(6)),
      fastPath: true,
      localCacheHits: stats.localCacheHits,
      estimatedTokensSaved: stats.estimatedTokensSaved + 2500,
      savingsPercent: stats.savingsPercent
    };

    const reply = `Sarcina de modificare a codului a fost plasată în coada Antigravity MCP [${taskId}]. Se execută prin abonamentul Antigravity (0 apeluri Google AI Studio). Urmăriți jurnalul live în consolă.`;
    const providerLabel = 'Antigravity MCP Queue (0 Google API calls)';

    this.memory.saveConversationTurn('jarvis', reply, providerLabel, 0, true, toolResults);

    return {
      reply,
      provider: providerLabel,
      toolResults,
      executionLog,
      tokenUsage
    };
  }

  public recordExternalTrace(
    tag: JarvisTraceStep['tag'],
    message: string,
    extra: { filePath?: string; lineRange?: string; backupFile?: string } = {},
    broadcastWs?: (event: string, data: any) => void
  ): JarvisTraceStep {
    const step: JarvisTraceStep = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tag,
      message,
      filePath: extra?.filePath,
      lineRange: extra?.lineRange,
      backupFile: extra?.backupFile,
      timestamp: Date.now()
    };
    if (broadcastWs) {
      broadcastWs('marvin_trace', step);
      broadcastWs('jarvis_trace', step);
    }
    try {
      const traceLine = `[${new Date(step.timestamp).toISOString()}] [${step.tag}] ${step.message}${extra?.filePath ? ` (${extra.filePath})` : ''}\n`;
      fs.appendFileSync(path.join(ROOT_DIR, 'data', 'marvin_trace.log'), traceLine, 'utf8');
    } catch {}
    return step;
  }

  public getRecentTraces(limit: number = 40): JarvisTraceStep[] {
    const traceFile = path.join(ROOT_DIR, 'data', 'marvin_trace.log');
    if (!fs.existsSync(traceFile)) return [];
    try {
      const content = fs.readFileSync(traceFile, 'utf8');
      const lines = content.trim().split(/\r?\n/).filter(Boolean);
      const recent = lines.slice(-limit);
      return recent.map((l, idx) => {
        const match = l.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(.*)$/);
        if (match) {
          const rawTag = match[2].toUpperCase();
          const validTags = new Set(['SCAN', 'RAG', 'LIST', 'READ', 'EDIT', 'WRITE', 'BACKUP', 'DELETE', 'RESTART', 'GEMINI', 'CACHE', 'EXEC', 'ERROR']);
          const tag = (validTags.has(rawTag) ? rawTag : 'EXEC') as JarvisTraceStep['tag'];
          return {
            id: `file-tr-${Date.now()}-${idx}`,
            timestamp: new Date(match[1]).getTime() || Date.now(),
            tag,
            message: match[3]
          };
        }
        return {
          id: `file-tr-${Date.now()}-${idx}`,
          timestamp: Date.now(),
          tag: 'EXEC',
          message: l
        };
      });
    } catch {
      return [];
    }
  }

  private async executeCachedIntent(
    cached: CachedCommandMatch,
    toolResults: JarvisToolResult[],
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void
  ): Promise<{ reply: string; uiAction?: JarvisChatResponse['uiAction'] }> {
    const { actionType, actionPayload, replyTemplate } = cached;
    const devices = this.db.getAllDevices();
    const pcs = this.db.getAllPcs();

    if (actionType === 'toggleDevice') {
      await this.executeGeminiFunctionCall(
        'toggleDevice',
        actionPayload,
        toolResults,
        executionLog,
        broadcastWs
      );
      return { reply: replyTemplate };
    }
    if (actionType === 'wakePC') {
      await this.executeGeminiFunctionCall(
        'wakePC',
        actionPayload,
        toolResults,
        executionLog,
        broadcastWs
      );
      return { reply: replyTemplate };
    }
    if (actionType === 'deleteDevice') {
      await this.executeGeminiFunctionCall(
        'deleteDevice',
        actionPayload,
        toolResults,
        executionLog,
        broadcastWs
      );
      return { reply: replyTemplate };
    }
    if (actionType === 'editConfig') {
      await this.executeGeminiFunctionCall(
        'editConfig',
        actionPayload,
        toolResults,
        executionLog,
        broadcastWs
      );
      return { reply: replyTemplate };
    }
    if (actionType === 'statusReport') {
      const camCount = devices.filter((d) => d.category === 'camera').length;
      const iotCount = devices.filter((d) => d.category !== 'camera').length;
      const onlinePcs = pcs.filter((p) => p.online).length;
      return {
        reply: `Toate sistemele sunt operaționale, domnule: ${camCount} camere WebRTC active, ${iotCount} unități IoT și ${onlinePcs}/${pcs.length} calculatoare online.`
      };
    }
    if (actionType === 'switchUi') {
      toolResults.push({
        tool: 'switch_ui',
        success: true,
        summary: `HUD -> ${actionPayload.location || ''} ${actionPayload.viewMode || ''}`.trim()
      });
      return {
        reply: replyTemplate,
        uiAction: actionPayload
      };
    }
    if (actionType === 'refreshStreams') {
      await this.mediaService.ensureGo2RtcRunning();
      await this.mediaService.ensureBluramsBridgeRunning();
      await this.mediaService.syncRegisteredStreams();
      try {
        await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
      } catch {}
      this.pushTrace(
        executionLog,
        broadcastWs,
        'RESTART',
        'Resynced go2rtc WebRTC streams & Blurams RTSP bridge'
      );
      toolResults.push({
        tool: 'refresh_streams',
        success: true,
        summary: 'Resincronizat go2rtc & Blurams Bridge'
      });
      return { reply: replyTemplate };
    }
    if (actionType === 'readConfig') {
      const fileKey = actionPayload.file || 'go2rtc.yaml';
      const fullPath = ALLOWED_CONFIG_FILES[fileKey];
      if (fullPath && fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8').slice(-1200);
        this.pushTrace(executionLog, broadcastWs, 'READ', `Read config file ${fileKey}`, {
          filePath: fileKey
        });
        toolResults.push({ tool: 'read_config', success: true, summary: `Citit ${fileKey}` });
        return { reply: `${replyTemplate}\n\`\`\`\n${content}\n\`\`\`` };
      }
    }

    return { reply: replyTemplate };
  }

  /**
   * Call Gemini with Surgical SQLite FTS5 RAG Context & Multi-Step File/Device Tool Execution
   * Uses models/gemini-3.5-flash for code modifications and models/gemini-3.5-flash-lite for general queries.
   */
  private async callGeminiWithSurgicalContext(
    userMessage: string,
    apiKey: string,
    ragHit: ReturnType<JarvisMemoryEngine['retrieveSurgicalCodeSnippet']>,
    toolResults: JarvisToolResult[],
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void
  ): Promise<JarvisChatResponse> {
    const isCodeTask = this.isCodeModificationTask(userMessage);
    const modelName = this.resolveGeminiModel(isCodeTask);
    const ai = new GoogleGenAI({ apiKey });
    const oneLineDevices = this.buildMinifiedDeviceTable();

    const promptParts: string[] = [`DEV:${oneLineDevices}`];

    if (
      /\b(blurams|camera|cameră|camere|garaj|garage|workshop|stream|video|rtsp|8556|161)\b/i.test(
        userMessage
      )
    ) {
      const hasBluramsCreds = Boolean(process.env.BLURAMS_EMAIL && process.env.BLURAMS_PASSWORD);
      const hasDirectUrl = Boolean(process.env.BLURAMS_STREAM_URL);
      promptParts.push(
        `BLURAMS_DIAG:deviceId=1800420411702000132815|ip=192.168.8.161(PING_OK_VIA_TAILSCALE)|rtsp=127.0.0.1:8556/blurams_garage|BLURAMS_EMAIL_SET=${hasBluramsCreds}|BLURAMS_STREAM_URL_SET=${hasDirectUrl}`
      );
    }

    if (ragHit) {
      promptParts.push(
        `RAG_FILE:${ragHit.filePath}(L${ragHit.startLine}-${ragHit.endLine}):\n${ragHit.snippet}`
      );
      toolResults.push({
        tool: 'sqlite_fts5_rag',
        success: true,
        summary: `FTS5 snippet: ${ragHit.filePath} (L${ragHit.startLine}-L${ragHit.endLine})`
      });
    }

    promptParts.push(`USER:${userMessage}`);

    const systemInstruction =
      'Ești M.A.R.V.I.N. (Mortyck Automated Reconnaissance & Virtual Infrastructure Node), inginerul AI autonom și asistentul tactic personal al lui Mortyck în MortyckHomeAssistent. ' +
      'Operezi cu căi relative și ai acces complet de citire și scriere asupra fișierelor proiectului prin uneltele: listFiles, readFile, patchFile, editFile, writeFile, deleteFile, restartServer, precum și controlul dispozitivelor prin toggleDevice, deleteDevice, wakePC, editConfig. ' +
      'Când utilizatorul îți cere să inspectezi sau să modifici codul/interfața/configurația, consultă mai întâi indexul structural (data/project_index.json) sau snippet-ul RAG_FILE, citește doar blocul exact de 30-60 linii necesar, apoi aplică modificarea chirurgicală cu patchFile, editFile sau writeFile. ' +
      'Orice modificare este înregistrată automat în CHANGELOG_AI.md și salvată într-un commit Git local. ' +
      'Răspunde în Română, concis, tehnic și sigur de sine (1-3 propoziții în stilul tactic M.A.R.V.I.N.), confirmând exact acțiunile și fișierele operate.';

    let totalPromptTokens = 0;
    let totalOutputTokens = 0;
    let finalReplyText = '';
    let rollingPrompt = promptParts.join('\n');

    // Up to 12 tool-execution rounds so M.A.R.V.I.N. can listFiles -> readFile -> patchFile -> verify -> confirm
    const MAX_ROUNDS = 12;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      this.pushTrace(
        executionLog,
        broadcastWs,
        'GEMINI',
        `Invoking models/${modelName} (step ${round}/${MAX_ROUNDS}${isCodeTask ? ' • CODE_ENGINE' : ''})...`
      );

      let response;
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: rollingPrompt,
          config: {
            systemInstruction,
            maxOutputTokens: 1024,
            temperature: 0.2,
            tools: [{ functionDeclarations: GEMINI_TOOLS }]
          }
        });
      } catch (err: any) {
        if (round === 1) {
          // Retry without tool declarations only if schema was rejected
          const msg = String(err?.message || '');
          if (msg.includes('INVALID_ARGUMENT') && msg.includes('tool')) {
            response = await ai.models.generateContent({
              model: modelName,
              contents: rollingPrompt,
              config: {
                systemInstruction,
                maxOutputTokens: 1024,
                temperature: 0.2
              }
            });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const usage = response.usageMetadata;
      totalPromptTokens += usage?.promptTokenCount || 0;
      totalOutputTokens += usage?.candidatesTokenCount || 0;

      if (response.text && response.text.trim()) {
        finalReplyText = response.text.trim();
      }

      const fnCalls = response.functionCalls || [];
      if (fnCalls.length === 0) {
        // Model reached final turn without requesting more tool executions
        break;
      }

      const toolOutputsForNextTurn: string[] = [];

      for (const call of fnCalls) {
        const args = (call.args || {}) as Record<string, any>;
        const fnName = call.name || '';
        const toolOutput = await this.executeGeminiFunctionCall(
          fnName,
          args,
          toolResults,
          executionLog,
          broadcastWs
        );
        if (toolOutput) {
          toolOutputsForNextTurn.push(`TOOL_RESULT[${fnName}]:\n${toolOutput}`);
        }
      }

      if (toolOutputsForNextTurn.length > 0 && round < MAX_ROUNDS) {
        rollingPrompt += `\n\n${toolOutputsForNextTurn.join('\n\n')}\n\nContinuă execuția cererii utilizatorului (folosind unelte suplimentare precum patchFile, editFile sau writeFile dacă sunt necesare) sau confirmă finalizarea completă printr-un răspuns explicativ detaliat în Română.`;
      } else {
        break;
      }
    }

    // If model finished executing tool calls but left an empty text response, run one final text-generation turn to summarize changes
    if (!finalReplyText && toolResults.length > 0) {
      try {
        this.pushTrace(
          executionLog,
          broadcastWs,
          'GEMINI',
          `Generating final change summary turn via models/${modelName}...`
        );
        const summaryPrompt = `${rollingPrompt}\n\nToate uneltele și modificările de fișiere au fost executate cu succes. Te rog să prezinți acum un rezumat final complet în limba Română (1-3 propoziții tehnice în stilul M.A.R.V.I.N.) care descrie exact ce modificări ai efectuat în sistem/cod.`;
        const summaryResponse = await ai.models.generateContent({
          model: modelName,
          contents: summaryPrompt,
          config: {
            systemInstruction,
            maxOutputTokens: 500,
            temperature: 0.2
          }
        });
        if (summaryResponse.text && summaryResponse.text.trim()) {
          finalReplyText = summaryResponse.text.trim();
          const sUsage = summaryResponse.usageMetadata;
          totalPromptTokens += sUsage?.promptTokenCount || 0;
          totalOutputTokens += sUsage?.candidatesTokenCount || 0;
        }
      } catch (sumErr: any) {
        console.warn('[JarvisAiService] Final summary generation note:', sumErr.message);
      }
    }

    const totalTokens = totalPromptTokens + totalOutputTokens;
    this.memory.recordGeminiApiUsage(totalTokens, ragHit ? 2200 : 1400);
    const stats = this.memory.getTelemetryStats();
    const estimatedCostUsd = Number(((stats.geminiTokensUsed / 1_000_000) * 0.1).toFixed(6));

    const textReply =
      finalReplyText ||
      (toolResults.length > 0
        ? `Am executat operațiunile în sistem, domnule: ${toolResults.map((t) => t.summary).join(' • ')}.`
        : 'Sunt online și conectat la nucleul Gemini 3.5 Flash-Lite, domnule. Cu ce vă pot asista?');

    return {
      reply: textReply,
      provider: `Gemini (${modelName})`,
      toolResults,
      executionLog,
      tokenUsage: {
        promptTokens: totalPromptTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        sessionTokens: stats.geminiTokensUsed,
        estimatedCostUsd,
        fastPath: false,
        localCacheHits: stats.localCacheHits,
        estimatedTokensSaved: stats.estimatedTokensSaved,
        savingsPercent: stats.savingsPercent,
        ragSnippetFile: ragHit?.filePath
      }
    };
  }

  private async executeGeminiFunctionCall(
    fnName: string,
    args: Record<string, any>,
    toolResults: JarvisToolResult[],
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void
  ): Promise<string | void> {
    const devices = this.db.getAllDevices();
    const pcs = this.db.getAllPcs();

    // --- 1. FULL PROJECT FILE & SERVER TOOLS ---
    if (fnName === 'listFiles') {
      try {
        const dirArg = String(args.directory || '').trim();
        const { fullPath, relPath } = this.resolveSafeProjectPath(dirArg);
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
          return `Directory not found: ${relPath}`;
        }
        const entries = fs
          .readdirSync(fullPath, { withFileTypes: true })
          .filter((e) => !BLOCKED_PATH_SEGMENTS.has(e.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

        this.pushTrace(
          executionLog,
          broadcastWs,
          'LIST',
          `${relPath === '.' ? '/' : relPath} (${entries.length} entries)`,
          { filePath: relPath }
        );
        toolResults.push({
          tool: 'listFiles',
          success: true,
          summary: `Listed ${relPath} (${entries.length} items)`
        });
        return entries.join('\n');
      } catch (err: any) {
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `listFiles failed: ${err.message}`);
        return `Error: ${err.message}`;
      }
    }

    if (fnName === 'readFile') {
      try {
        const rawPath = String(args.filePath || '').trim();
        const { fullPath, relPath } = this.resolveSafeProjectPath(rawPath);
        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
          return `File not found: ${relPath}`;
        }
        const allLines = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/);
        const startLine = Math.max(1, Number(args.startLine) || 1);
        const endLine = Math.min(
          allLines.length,
          Number(args.endLine) || Math.min(allLines.length, startLine + 140)
        );
        const numberedSlice = allLines
          .slice(startLine - 1, endLine)
          .map((line, i) => `${startLine + i}: ${line}`)
          .join('\n');

        this.pushTrace(
          executionLog,
          broadcastWs,
          'READ',
          `${relPath} (lines ${startLine}-${endLine} of ${allLines.length})`,
          { filePath: relPath, lineRange: `L${startLine}-L${endLine}` }
        );
        toolResults.push({
          tool: 'readFile',
          success: true,
          summary: `${relPath} (L${startLine}-L${endLine})`
        });
        return numberedSlice;
      } catch (err: any) {
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `readFile failed: ${err.message}`);
        return `Error: ${err.message}`;
      }
    }

    if (fnName === 'patchFile' || fnName === 'editFile' || fnName === 'modifyFile') {
      try {
        const rawPath = String(args.filePath || '').trim();
        if (!args.targetContent && !args.target && !args.oldContent && args.content !== undefined) {
          return await this.executeGeminiFunctionCall('writeFile', { filePath: rawPath, content: args.content }, toolResults, executionLog, broadcastWs);
        }
        const targetContent = String(args.targetContent || args.target || args.oldContent || '');
        const replacementContent = String(args.replacementContent ?? args.replacement ?? args.newContent ?? '');
        const { fullPath, relPath } = this.resolveSafeProjectPath(rawPath);

        if (!fs.existsSync(fullPath)) {
          return `File not found: ${relPath}`;
        }
        const original = fs.readFileSync(fullPath, 'utf-8');
        let idx = original.indexOf(targetContent);

        // Normalize CRLF vs LF if exact substring match differs only by line endings
        let workingOriginal = original;
        let workingTarget = targetContent;
        if (idx === -1) {
          workingOriginal = original.replace(/\r\n/g, '\n');
          workingTarget = targetContent.replace(/\r\n/g, '\n');
          idx = workingOriginal.indexOf(workingTarget);
        }

        if (idx === -1) {
          this.pushTrace(
            executionLog,
            broadcastWs,
            'ERROR',
            `Target block not found in ${relPath}`,
            { filePath: relPath }
          );
          return `Error: targetContent was not found in ${relPath}. Call readFile first to get exact lines.`;
        }

        const backup = this.createFileBackup(fullPath);
        if (backup) {
          this.pushTrace(executionLog, broadcastWs, 'BACKUP', `Created ${backup}`, {
            filePath: relPath,
            backupFile: backup
          });
        }

        const prefixLines = workingOriginal.slice(0, idx).split('\n').length;
        const replacedLineCount = replacementContent.replace(/\r\n/g, '\n').split('\n').length;
        const startLine = prefixLines;
        const endLine = prefixLines + replacedLineCount - 1;

        const updatedContent =
          workingOriginal.slice(0, idx) +
          replacementContent +
          workingOriginal.slice(idx + workingTarget.length);

        fs.writeFileSync(fullPath, updatedContent, 'utf-8');
        this.memory.indexCodebase();

        try {
          const marvinGitTracker = require(path.join(ROOT_DIR, 'scripts', 'marvin_git_tracker.js'));
          marvinGitTracker.recordChangeAndCommit({
            filePath: relPath,
            startLine,
            endLine,
            summary: `Edited ${relPath} (L${startLine}-L${endLine})`,
            reason: String(args.reason || 'Requested by user via M.A.R.V.I.N.'),
            actor: 'M.A.R.V.I.N. // CORE'
          });
        } catch (gitErr: any) {
          console.warn('[JarvisAiService] Git tracking note:', gitErr.message);
        }

        this.pushTrace(
          executionLog,
          broadcastWs,
          'EDIT',
          `Updated lines ${startLine}-${endLine} in ${relPath}`,
          {
            filePath: relPath,
            lineRange: `L${startLine}-L${endLine}`,
            backupFile: backup
          }
        );
        toolResults.push({
          tool: 'patchFile',
          success: true,
          summary: `Edited ${relPath} (L${startLine}-L${endLine})`,
          backupFile: backup
        });
        return `Successfully patched ${relPath} (lines ${startLine}-${endLine}, backup: ${backup || 'none'}).`;
      } catch (err: any) {
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `patchFile failed: ${err.message}`);
        return `Error: ${err.message}`;
      }
    }

    if (fnName === 'writeFile') {
      try {
        const rawPath = String(args.filePath || '').trim();
        const content = String(args.content ?? '');
        const { fullPath, relPath } = this.resolveSafeProjectPath(rawPath);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const backup = fs.existsSync(fullPath) ? this.createFileBackup(fullPath) : undefined;
        if (backup) {
          this.pushTrace(executionLog, broadcastWs, 'BACKUP', `Created ${backup}`, {
            filePath: relPath,
            backupFile: backup
          });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        const lineCount = content.split(/\r?\n/).length;
        this.memory.indexCodebase();

        try {
          const marvinGitTracker = require(path.join(ROOT_DIR, 'scripts', 'marvin_git_tracker.js'));
          marvinGitTracker.recordChangeAndCommit({
            filePath: relPath,
            startLine: 1,
            endLine: lineCount,
            summary: `Wrote ${lineCount} lines to ${relPath}`,
            reason: String(args.reason || 'Created/updated file via M.A.R.V.I.N.'),
            actor: 'M.A.R.V.I.N. // CORE'
          });
        } catch (gitErr: any) {
          console.warn('[JarvisAiService] Git tracking note:', gitErr.message);
        }

        this.pushTrace(
          executionLog,
          broadcastWs,
          'WRITE',
          `Wrote ${lineCount} lines to ${relPath}`,
          {
            filePath: relPath,
            lineRange: `L1-L${lineCount}`,
            backupFile: backup
          }
        );
        toolResults.push({
          tool: 'writeFile',
          success: true,
          summary: `Wrote ${relPath} (${lineCount} lines)`,
          backupFile: backup
        });
        return `Successfully wrote ${lineCount} lines to ${relPath} (backup: ${backup || 'new file'}).`;
      } catch (err: any) {
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `writeFile failed: ${err.message}`);
        return `Error: ${err.message}`;
      }
    }

    if (fnName === 'deleteFile') {
      try {
        const rawPath = String(args.filePath || '').trim();
        const { fullPath, relPath } = this.resolveSafeProjectPath(rawPath);
        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
          return `File not found: ${relPath}`;
        }
        const backup = this.createFileBackup(fullPath);
        if (backup) {
          this.pushTrace(executionLog, broadcastWs, 'BACKUP', `Created ${backup}`, {
            filePath: relPath,
            backupFile: backup
          });
        }
        fs.unlinkSync(fullPath);
        this.memory.indexCodebase();

        try {
          const marvinGitTracker = require(path.join(ROOT_DIR, 'scripts', 'marvin_git_tracker.js'));
          marvinGitTracker.recordChangeAndCommit({
            filePath: relPath,
            summary: `Deleted ${relPath}`,
            reason: String(args.reason || 'Deleted file via M.A.R.V.I.N.'),
            actor: 'M.A.R.V.I.N. // CORE'
          });
        } catch (gitErr: any) {
          console.warn('[JarvisAiService] Git tracking note:', gitErr.message);
        }

        this.pushTrace(executionLog, broadcastWs, 'DELETE', `Deleted ${relPath}`, {
          filePath: relPath,
          backupFile: backup
        });
        toolResults.push({
          tool: 'deleteFile',
          success: true,
          summary: `Deleted ${relPath}`,
          backupFile: backup
        });
        return `Successfully deleted ${relPath} (backup: ${backup || 'none'}).`;
      } catch (err: any) {
        this.pushTrace(executionLog, broadcastWs, 'ERROR', `deleteFile failed: ${err.message}`);
        return `Error: ${err.message}`;
      }
    }

    if (fnName === 'restartServer') {
      const targetService = String(args.service || 'all').trim();
      this.reloadEnvFromDisk();
      const indexedCount = this.memory.indexCodebase();
      await this.mediaService.ensureGo2RtcRunning();
      await this.mediaService.ensureBluramsBridgeRunning();
      await this.mediaService.syncRegisteredStreams();
      try {
        await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
      } catch {}

      if (targetService === 'backend' || targetService === 'all') {
        exec('npm --prefix "' + path.join(ROOT_DIR, 'backend') + '" run build', () => {});
      }

      this.pushTrace(
        executionLog,
        broadcastWs,
        'RESTART',
        `Reloaded .env, FTS5 index (${indexedCount} files), go2rtc & Blurams Bridge`
      );
      toolResults.push({
        tool: 'restartServer',
        success: true,
        summary: `Reloaded services (${targetService}) & indexed ${indexedCount} files`
      });
      return `Services (${targetService}) reloaded and ${indexedCount} files indexed in SQLite FTS5.`;
    }

    // --- 2. DEVICE & CONFIG TOOLS ---
    if (fnName === 'toggleDevice') {
      const rawId = String(args.deviceId || '').toLowerCase();
      const power = Boolean(args.power);
      const brightness = args.brightness !== undefined ? Number(args.brightness) : undefined;
      const cmdPayload: Record<string, any> = { power };
      if (brightness !== undefined) cmdPayload.brightness = Math.max(1, Math.min(100, brightness));

      const targets =
        rawId === 'all'
          ? devices.filter((d) => d.category !== 'camera')
          : devices.filter(
              (d) =>
                d.id.toLowerCase() === rawId ||
                d.name.toLowerCase().includes(rawId) ||
                d.room.toLowerCase().includes(rawId)
            );

      const effectiveTargets =
        targets.length > 0 ? targets : devices.filter((d) => d.category !== 'camera');
      for (const dev of effectiveTargets) {
        await this.deviceManager.sendCommand(dev.id, cmdPayload);
        broadcastWs('device_state', { deviceId: dev.id, state: cmdPayload });
        this.pushTrace(
          executionLog,
          broadcastWs,
          'EXEC',
          `Toggled ${dev.name} -> ${power ? 'ON' : 'OFF'}`
        );
        toolResults.push({
          tool: 'toggleDevice',
          success: true,
          summary: `${dev.name} -> ${power ? 'ON' : 'OFF'}${brightness ? ` (${brightness}%)` : ''}`
        });
      }
      return `Toggled ${effectiveTargets.length} devices to ${power ? 'ON' : 'OFF'}.`;
    }

    if (fnName === 'deleteDevice') {
      const rawId = String(args.deviceId || '').toLowerCase();
      const target = devices.find(
        (d) => d.id.toLowerCase() === rawId || d.name.toLowerCase().includes(rawId)
      );
      if (target) {
        const backup = this.createFileBackup(ALLOWED_CONFIG_FILES['devices.json']);
        await this.deviceManager.removeDevice(target.id);
        broadcastWs('device_removed', { id: target.id });
        this.pushTrace(
          executionLog,
          broadcastWs,
          'DELETE',
          `Removed device ${target.name} (${target.id})`,
          { backupFile: backup }
        );
        toolResults.push({
          tool: 'deleteDevice',
          success: true,
          summary: `Șters ${target.name} (${target.id})`,
          backupFile: backup
        });
        return `Deleted device ${target.name}.`;
      }
      return `Device not found: ${rawId}`;
    }

    if (fnName === 'wakePC') {
      const rawPc = String(args.pcId || '').toLowerCase();
      const targetPc =
        pcs.find(
          (p) =>
            p.id.toLowerCase() === rawPc ||
            p.name.toLowerCase().includes(rawPc) ||
            p.location.toLowerCase().includes(rawPc)
        ) || pcs[0];
      if (targetPc) {
        const bcast =
          targetPc.broadcastAddress ||
          (targetPc.location === 'Garage' ? '192.168.8.255' : '192.168.1.255');
        await this.wolService.sendWol(targetPc.mac, bcast);
        this.pushTrace(
          executionLog,
          broadcastWs,
          'EXEC',
          `Sent Wake-on-LAN packet to ${targetPc.name} (${targetPc.mac})`
        );
        toolResults.push({
          tool: 'wakePC',
          success: true,
          summary: `WoL -> ${targetPc.name} (${targetPc.mac})`
        });
        return `Sent WoL packet to ${targetPc.name} (${targetPc.mac}).`;
      }
      return 'No PC configured.';
    }

    if (fnName === 'editConfig') {
      const file = String(args.file || '.env').trim();
      const key = String(args.key || '').trim();
      const value = String(args.value || '').trim();
      if (!key) return 'Missing key.';

      if (file === '.env' || !ALLOWED_CONFIG_FILES[file]) {
        const envPath = ALLOWED_CONFIG_FILES['.env'];
        const backup = this.createFileBackup(envPath);
        if (backup) {
          this.pushTrace(executionLog, broadcastWs, 'BACKUP', `Created ${backup}`, {
            filePath: '.env',
            backupFile: backup
          });
        }
        let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
        const lineRegex = new RegExp(`^${key}=.*$`, 'm');
        if (lineRegex.test(content)) {
          content = content.replace(lineRegex, `${key}=${value}`);
        } else {
          content += `\n${key}=${value}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf-8');
        process.env[key] = value;

        if (key.startsWith('BLURAMS_')) {
          try {
            await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
          } catch {}
        }

        this.pushTrace(executionLog, broadcastWs, 'EDIT', `Updated ${key} in .env`, {
          filePath: '.env',
          backupFile: backup
        });
        toolResults.push({
          tool: 'editConfig',
          success: true,
          summary: `.env: ${key} actualizat`,
          backupFile: backup
        });
        return `Updated ${key} in .env.`;
      } else if (file === 'settings.json') {
        const settingsPath = ALLOWED_CONFIG_FILES['settings.json'];
        const backup = this.createFileBackup(settingsPath);
        this.db.updateSettings({ [key]: value });
        this.pushTrace(
          executionLog,
          broadcastWs,
          'EDIT',
          `Updated ${key}=${value} in settings.json`,
          { filePath: 'backend/data/settings.json', backupFile: backup }
        );
        toolResults.push({
          tool: 'editConfig',
          success: true,
          summary: `settings.json: ${key}=${value}`,
          backupFile: backup
        });
        return `Updated ${key} in settings.json.`;
      }
    }
  }

  /**
   * STRICT 0-Token Fast Path:
   * Only matches explicit, imperative device control commands anchored at the start of the message.
   * Never intercepts conversational, diagnostic, or file/code modification requests.
   */
  private async tryStrictZeroTokenFastPath(
    msg: string,
    toolResults: JarvisToolResult[],
    executionLog: JarvisTraceStep[],
    broadcastWs: (event: string, data: any) => void
  ): Promise<{
    matched: boolean;
    reply: string;
    uiAction?: JarvisChatResponse['uiAction'];
    learnedAction?: { type: string; payload: Record<string, any> };
  }> {
    const lower = msg.toLowerCase().trim();

    if (
      msg.includes('?') ||
      /\b(test|merge|inca|încă|de ce|cum|eroare|error|problema|problemă|ajutor|explica|explică|crezi|salut|buna|bună|fisier|fișier|cod|modifica|modifică|editeaza|editează|citeste|citește|scrie)\b/i.test(
        lower
      )
    ) {
      return { matched: false, reply: '' };
    }

    const devices = this.db.getAllDevices();
    const pcs = this.db.getAllPcs();

    if (/^(status|status sistem|raport|stare sistem)$/i.test(lower)) {
      const camCount = devices.filter((d) => d.category === 'camera').length;
      const iotCount = devices.filter((d) => d.category !== 'camera').length;
      const onlinePcs = pcs.filter((p) => p.online).length;
      this.pushTrace(
        executionLog,
        broadcastWs,
        'CACHE',
        'Executed local 0-token system telemetry check'
      );
      return {
        matched: true,
        reply: `Toate sistemele sunt operaționale, domnule: ${camCount} camere WebRTC active, ${iotCount} unități IoT și ${onlinePcs}/${pcs.length} calculatoare online.`
      };
    }

    const envAssignMatch = msg.match(
      /^(?:set|seteaza|setează)?\s*(GEMINI_API_KEY|GEMINI_MODEL|BLURAMS_EMAIL|BLURAMS_PASSWORD|BLURAMS_COOKIE|BLURAMS_TOKEN|BLURAMS_STREAM_URL|BLURAMS_DEVICE_ID|BLURAMS_CAMERA_IP|OLLAMA_URL|OLLAMA_MODEL)\s*[=:]\s*(.+)$/i
    );
    if (envAssignMatch) {
      const envKey = envAssignMatch[1].toUpperCase();
      const envVal = envAssignMatch[2].trim();
      const backupName = this.createFileBackup(ENV_PATH);
      if (backupName) {
        this.pushTrace(executionLog, broadcastWs, 'BACKUP', `Created ${backupName}`, {
          filePath: '.env',
          backupFile: backupName
        });
      }

      let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
      const lineRegex = new RegExp(`^${envKey}=.*$`, 'm');
      if (lineRegex.test(content)) {
        content = content.replace(lineRegex, `${envKey}=${envVal}`);
      } else {
        content += `\n${envKey}=${envVal}\n`;
      }
      fs.writeFileSync(ENV_PATH, content, 'utf-8');
      process.env[envKey] = envVal;

      if (envKey.startsWith('BLURAMS_')) {
        try {
          await fetch('http://127.0.0.1:8557/reload', { method: 'POST' });
        } catch {}
      }

      this.pushTrace(executionLog, broadcastWs, 'EDIT', `Updated ${envKey} in .env (0 tokens)`, {
        filePath: '.env',
        backupFile: backupName
      });
      toolResults.push({
        tool: 'editConfig',
        success: true,
        summary: `Actualizat ${envKey} în .env`,
        backupFile: backupName
      });

      return {
        matched: true,
        reply: `Am actualizat \`${envKey}\` în \`.env\` cu backup automat (\`${backupName || 'ok'}\`) și am reîncărcat puntea Blurams, domnule.`
      };
    }

    if (/^(wake|wol|porneste|pornește)\s+(pc|calculator|calculatorul|garage pc|home pc)/i.test(lower)) {
      const targetPc =
        pcs.find((p) =>
          lower.includes('garage') || lower.includes('garaj')
            ? p.location === 'Garage'
            : lower.includes('home') || lower.includes('acasa') || lower.includes('acasă')
              ? p.location === 'Home'
              : lower.includes(p.name.toLowerCase())
        ) || pcs[0];

      if (targetPc) {
        const bcast =
          targetPc.broadcastAddress ||
          (targetPc.location === 'Garage' ? '192.168.8.255' : '192.168.1.255');
        await this.wolService.sendWol(targetPc.mac, bcast);
        this.pushTrace(
          executionLog,
          broadcastWs,
          'EXEC',
          `Sent Wake-on-LAN packet to ${targetPc.name} (${targetPc.mac})`
        );
        toolResults.push({
          tool: 'wakePC',
          success: true,
          summary: `WoL -> ${targetPc.name} (${targetPc.mac})`
        });
        return {
          matched: true,
          reply: `Am transmis pachetul Magic Wake-on-LAN către **${targetPc.name}** (\`${targetPc.ip}\` / \`${targetPc.mac}\`), domnule.`
        };
      }
    }

    const toggleMatch = lower.match(/^(aprinde|stinge|turn on|turn off)\s+(.+)$/i);
    if (toggleMatch) {
      const verb = toggleMatch[1].toLowerCase();
      const targetStr = toggleMatch[2].toLowerCase();
      const desiredPower = verb === 'aprinde' || verb === 'turn on';
      const iotDevs = devices.filter((d) => d.category !== 'camera');
      const matchedDevs = iotDevs.filter(
        (d) =>
          targetStr.includes(d.name.toLowerCase()) ||
          targetStr.includes(d.room.toLowerCase()) ||
          /\b(all|toate|tot|lumina|lumină|light|tuya|priza|priză|bec)\b/i.test(targetStr)
      );

      const targets = matchedDevs.length > 0 ? matchedDevs : iotDevs;
      if (targets.length === 0) {
        return {
          matched: true,
          reply: 'Nu există dispozitive IoT (lumini/prize) înregistrate momentan, domnule.'
        };
      }
      for (const dev of targets) {
        await this.deviceManager.sendCommand(dev.id, { power: desiredPower });
        broadcastWs('device_state', { deviceId: dev.id, state: { power: desiredPower } });
        this.pushTrace(
          executionLog,
          broadcastWs,
          'EXEC',
          `Toggled ${dev.name} -> ${desiredPower ? 'ON' : 'OFF'}`
        );
        toolResults.push({
          tool: 'toggleDevice',
          success: true,
          summary: `${dev.name} -> ${desiredPower ? 'ON' : 'OFF'}`
        });
      }
      const names = targets.map((t) => `**${t.name}**`).join(', ');
      return {
        matched: true,
        reply: `Am ${desiredPower ? 'aprins' : 'stins'} ${names}, domnule.`
      };
    }

    const delMatch = lower.match(/^(sterge|șterge|delete|remove)\s+(.+)$/i);
    if (delMatch) {
      const targetName = delMatch[2].trim().toLowerCase();
      const targetDev = devices.find(
        (d) => d.name.toLowerCase() === targetName || d.id.toLowerCase() === targetName
      );
      if (targetDev) {
        const backup = this.createFileBackup(ALLOWED_CONFIG_FILES['devices.json']);
        await this.deviceManager.removeDevice(targetDev.id);
        broadcastWs('device_removed', { id: targetDev.id });
        this.pushTrace(
          executionLog,
          broadcastWs,
          'DELETE',
          `Deleted device '${targetDev.name}' (${targetDev.id})`,
          { backupFile: backup }
        );
        toolResults.push({
          tool: 'deleteDevice',
          success: true,
          summary: `Șters '${targetDev.name}' (${targetDev.id})`,
          backupFile: backup
        });
        return {
          matched: true,
          reply: `Am eliminat **${targetDev.name}** (\`${targetDev.ip}\`) din sistem, domnule.`
        };
      }
    }

    return { matched: false, reply: '' };
  }
}
