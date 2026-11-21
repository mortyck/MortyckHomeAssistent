import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import BetterSqlite3 from 'better-sqlite3';

const ROOT_DIR = fs.existsSync(path.join(process.cwd(), 'docker', 'go2rtc.yaml'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');

const DATA_DIR = path.join(ROOT_DIR, 'data');
const MARVIN_DB_PATH = path.join(DATA_DIR, 'marvin_memory.db');
const LEGACY_JARVIS_DB_PATH = path.join(DATA_DIR, 'jarvis_memory.db');

export interface CachedCommandMatch {
  id: number;
  normalizedIntent: string;
  actionType: string;
  actionPayload: Record<string, any>;
  replyTemplate: string;
  hitCount: number;
  matchScore: number;
}

export interface CodeIndexHit {
  filePath: string;
  functionNames: string;
  summary: string;
  snippet: string;
  startLine: number;
  endLine: number;
}

export interface ConversationRow {
  id: number;
  role: 'user' | 'jarvis';
  message: string;
  provider: string;
  tokensUsed: number;
  cacheHit: boolean;
  toolCallsJson?: string;
  createdAt: number;
}

export interface MemoryTelemetryStats {
  localCacheHits: number;
  geminiApiCalls: number;
  geminiTokensUsed: number;
  estimatedTokensSaved: number;
  savingsPercent: number;
  indexedFilesCount: number;
  cachedIntentsCount: number;
  dbPath: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'please', 'can', 'you',
  'te', 'rog', 'sa', 'să', 'in', 'în', 'la', 'pe', 'cu', 'din', 'de', 'un', 'o',
  'lui', 'care', 'este', 'sunt', 'mai', 'sau', 'dar', 'pentru', 'domnule', 'jarvis', 'marvin',
  'arata', 'arată', 'show', 'vezi', 'citeste', 'citește', 'codul', 'cod', 'code',
  'functia', 'funcția', 'functiei', 'funcției', 'fisierul', 'fișierul', 'file', 'function'
]);

export class JarvisMemoryEngine {
  private static instance: JarvisMemoryEngine;
  private db: BetterSqlite3.Database;
  private activeDbPath: string;

  private constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Seamless migration from jarvis_memory.db to marvin_memory.db without data loss
    if (!fs.existsSync(MARVIN_DB_PATH) && fs.existsSync(LEGACY_JARVIS_DB_PATH)) {
      try {
        fs.copyFileSync(LEGACY_JARVIS_DB_PATH, MARVIN_DB_PATH);
        console.log('[MarvinMemory] Seamlessly migrated jarvis_memory.db -> marvin_memory.db without data loss.');
      } catch (err: any) {
        console.warn(`[MarvinMemory] DB copy note: ${err.message}`);
      }
    }

    this.activeDbPath = fs.existsSync(MARVIN_DB_PATH) ? MARVIN_DB_PATH : LEGACY_JARVIS_DB_PATH;
    this.db = new BetterSqlite3(this.activeDbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initializeSchema();
    this.seedDefaultCommandCache();
    this.indexCodebase();
  }

  public static getInstance(): JarvisMemoryEngine {
    if (!JarvisMemoryEngine.instance) {
      JarvisMemoryEngine.instance = new JarvisMemoryEngine();
    }
    return JarvisMemoryEngine.instance;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        provider TEXT DEFAULT 'M.A.R.V.I.N.',
        tokens_used INTEGER DEFAULT 0,
        cache_hit INTEGER DEFAULT 0,
        tool_calls_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized_intent TEXT UNIQUE NOT NULL,
        keywords TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_payload_json TEXT NOT NULL,
        reply_template TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0,
        last_used_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS code_index USING fts5(
        file_path,
        function_names,
        summary,
        content_hash UNINDEXED
      );

      CREATE TABLE IF NOT EXISTS telemetry_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        local_cache_hits INTEGER DEFAULT 0,
        gemini_api_calls INTEGER DEFAULT 0,
        gemini_tokens_used INTEGER DEFAULT 0,
        estimated_tokens_saved INTEGER DEFAULT 0
      );

      INSERT OR IGNORE INTO telemetry_stats (id, local_cache_hits, gemini_api_calls, gemini_tokens_used, estimated_tokens_saved)
      VALUES (1, 0, 0, 0, 0);
    `);
  }

  public normalizePhrase(text: string): string {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s._/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public extractKeywords(text: string): string[] {
    const norm = this.normalizePhrase(text);
    return norm
      .split(' ')
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  }

  private seedDefaultCommandCache(): void {
    const now = Date.now();
    const seeds: Array<{
      intent: string;
      keywords: string;
      actionType: string;
      payload: Record<string, any>;
      reply: string;
    }> = [
      {
        intent: 'aprinde lumina',
        keywords: 'aprinde lumina porneste bec light on turn on',
        actionType: 'toggleDevice',
        payload: { deviceId: 'all', power: true },
        reply: 'Am aprins sistemul de iluminat, domnule.'
      },
      {
        intent: 'stinge lumina',
        keywords: 'stinge lumina opreste bec light off turn off',
        actionType: 'toggleDevice',
        payload: { deviceId: 'all', power: false },
        reply: 'Am stins sistemul de iluminat, domnule.'
      },
      {
        intent: 'porneste calculatorul din garaj',
        keywords: 'porneste calculatorul garaj wake garage pc wol',
        actionType: 'wakePC',
        payload: { pcId: 'pc-garage' },
        reply: 'Am transmis pachetul Magic Wake-on-LAN către Garage PC (192.168.8.116 / MAC D8:12:65:04:28:B5), domnule.'
      },
      {
        intent: 'porneste calculatorul de acasa',
        keywords: 'porneste calculatorul acasa wake home pc wol',
        actionType: 'wakePC',
        payload: { pcId: 'pc-home' },
        reply: 'Am transmis pachetul Magic Wake-on-LAN către Home PC (192.168.1.80), domnule.'
      },
      {
        intent: 'status sistem',
        keywords: 'status raport stare sistemul system report',
        actionType: 'statusReport',
        payload: {},
        reply: 'Toate sistemele MortyckHomeAssistent sunt operaționale, domnule.'
      },
      {
        intent: 'arata camerele din garaj',
        keywords: 'arata camerele garaj show garage cameras',
        actionType: 'switchUi',
        payload: { location: 'Garage', viewMode: 'cameras' },
        reply: 'Afișez matricea video WebRTC pentru sectorul Garaj, domnule.'
      },
      {
        intent: 'arata camerele de acasa',
        keywords: 'arata camerele acasa show home cameras',
        actionType: 'switchUi',
        payload: { location: 'Home', viewMode: 'cameras' },
        reply: 'Afișez camerele din sectorul Home, domnule.'
      },
      {
        intent: 'refresh all camera streams and go2rtc',
        keywords: 'refresh resync restart camera streams go2rtc blurams',
        actionType: 'refreshStreams',
        payload: {},
        reply: 'Am resincronizat toate fluxurile WebRTC în go2rtc și puntea RTSP Blurams, domnule.'
      },
      {
        intent: 'citeste fisierul go2rtc.yaml',
        keywords: 'citeste vezi arata fisierul go2rtc.yaml read',
        actionType: 'readConfig',
        payload: { file: 'go2rtc.yaml' },
        reply: 'Am extras configurația activă din go2rtc.yaml, domnule.'
      }
    ];

    // Purge any stale conversational/troubleshooting rows from command_cache
    this.db.prepare(`
      DELETE FROM command_cache
      WHERE normalized_intent LIKE '%test%'
         OR normalized_intent LIKE '%merge%'
         OR normalized_intent LIKE '%blurams%'
         OR normalized_intent LIKE '%de ce%'
         OR normalized_intent LIKE '%inca%'
    `).run();

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO command_cache
      (normalized_intent, keywords, action_type, action_payload_json, reply_template, hit_count, last_used_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const s of seeds) {
        insertStmt.run(
          this.normalizePhrase(s.intent),
          s.keywords,
          s.actionType,
          JSON.stringify(s.payload),
          s.reply,
          now
        );
      }
    });
    tx();
  }

  /**
   * Lookup a user command in the local SQLite `command_cache`.
   * STRICT MODE: Only matches exact normalized device control commands so conversational,
   * diagnostic, or troubleshooting messages are NEVER intercepted by the cache and always
   * route to the Gemini API.
   */
  public findCachedCommand(userMessage: string): CachedCommandMatch | null {
    const normInput = this.normalizePhrase(userMessage);
    if (!normInput) return null;

    // Never intercept questions, troubleshooting, tests, or Blurams/code discussions
    if (
      userMessage.includes('?') ||
      /\b(test|merge|inca|de ce|cum|eroare|error|blurams|problema|ajutor|explica|modifica|cod|config|crezi|spune|salut|buna)\b/i.test(normInput)
    ) {
      return null;
    }

    // Strict exact normalized match only
    const exactRow = this.db
      .prepare('SELECT * FROM command_cache WHERE normalized_intent = ?')
      .get(normInput) as any;

    if (exactRow) {
      this.recordCacheHit(exactRow.id);
      return {
        id: exactRow.id,
        normalizedIntent: exactRow.normalized_intent,
        actionType: exactRow.action_type,
        actionPayload: JSON.parse(exactRow.action_payload_json || '{}'),
        replyTemplate: exactRow.reply_template,
        hitCount: exactRow.hit_count + 1,
        matchScore: 1.0
      };
    }

    return null;
  }

  /**
   * Cache a newly learned natural language intent -> backend action so future calls use 0 tokens.
   */
  public learnCommandIntent(
    userMessage: string,
    actionType: string,
    actionPayload: Record<string, any>,
    replyTemplate: string
  ): void {
    try {
      const norm = this.normalizePhrase(userMessage);
      if (!norm || norm.length < 3 || norm.length > 120) return;
      const keywords = this.extractKeywords(userMessage).join(' ');
      this.db
        .prepare(`
          INSERT INTO command_cache
          (normalized_intent, keywords, action_type, action_payload_json, reply_template, hit_count, last_used_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(normalized_intent) DO UPDATE SET
            action_type = excluded.action_type,
            action_payload_json = excluded.action_payload_json,
            reply_template = excluded.reply_template,
            hit_count = command_cache.hit_count + 1,
            last_used_at = excluded.last_used_at
        `)
        .run(norm, keywords, actionType, JSON.stringify(actionPayload), replyTemplate, Date.now());
    } catch {}
  }

  public recordCacheHit(cacheId?: number): void {
    try {
      if (cacheId !== undefined) {
        this.db
          .prepare('UPDATE command_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?')
          .run(Date.now(), cacheId);
      }
      // Each local cache hit saves ~1,500 tokens vs sending full prompt + history + schema to Gemini
      this.db
        .prepare(`
          UPDATE telemetry_stats
          SET local_cache_hits = local_cache_hits + 1,
              estimated_tokens_saved = estimated_tokens_saved + 1500
          WHERE id = 1
        `)
        .run();
    } catch {}
  }

  public recordGeminiApiUsage(tokensUsed: number, ragSavedTokens: number = 1200): void {
    try {
      this.db
        .prepare(`
          UPDATE telemetry_stats
          SET gemini_api_calls = gemini_api_calls + 1,
              gemini_tokens_used = gemini_tokens_used + ?,
              estimated_tokens_saved = estimated_tokens_saved + ?
          WHERE id = 1
        `)
        .run(tokensUsed, ragSavedTokens);
    } catch {}
  }

  public saveConversationTurn(
    role: 'user' | 'jarvis',
    message: string,
    provider: string = 'M.A.R.V.I.N.',
    tokensUsed: number = 0,
    cacheHit: boolean = false,
    toolCalls?: any[]
  ): void {
    try {
      this.db
        .prepare(`
          INSERT INTO conversation_history
          (role, message, provider, tokens_used, cache_hit, tool_calls_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          role,
          message,
          provider,
          tokensUsed,
          cacheHit ? 1 : 0,
          toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
          Date.now()
        );
    } catch {}
  }

  public getRecentConversations(limit: number = 30): ConversationRow[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM conversation_history ORDER BY id DESC LIMIT ?')
        .all(limit) as any[];
      return rows.reverse().map((r) => ({
        id: r.id,
        role: r.role,
        message: r.message,
        provider: r.provider,
        tokensUsed: r.tokens_used,
        cacheHit: Boolean(r.cache_hit),
        toolCallsJson: r.tool_calls_json,
        createdAt: r.created_at
      }));
    } catch {
      return [];
    }
  }

  /**
   * Auto-generate and maintain the SQLite FTS5 `code_index` table for `D:\MortyckHome`
   */
  public indexCodebase(): number {
    const filesToIndex: string[] = [];

    const walkDir = (dirPath: string) => {
      if (!fs.existsSync(dirPath)) return;
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'backups') {
          continue;
        }
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(full);
        } else if (/\.(ts|tsx|py|yaml|yml|css|json)$/i.test(entry.name) && !entry.name.endsWith('package-lock.json')) {
          filesToIndex.push(full);
        }
      }
    };

    walkDir(path.join(ROOT_DIR, 'backend', 'src'));
    walkDir(path.join(ROOT_DIR, 'frontend', 'src'));
    walkDir(path.join(ROOT_DIR, 'scripts'));

    const extraFiles = [
      path.join(ROOT_DIR, 'docker', 'go2rtc.yaml'),
      path.join(ROOT_DIR, 'backend', 'data', 'devices.json'),
      path.join(ROOT_DIR, 'backend', 'data', 'pcs.json'),
      path.join(ROOT_DIR, 'backend', 'data', 'settings.json')
    ];
    for (const ef of extraFiles) {
      if (fs.existsSync(ef)) filesToIndex.push(ef);
    }

    const existingRows = this.db.prepare('SELECT file_path, content_hash FROM code_index').all() as any[];
    const hashByPath = new Map<string, string>();
    for (const r of existingRows) {
      hashByPath.set(r.file_path, r.content_hash);
    }

    let updatedCount = 0;
    const tx = this.db.transaction(() => {
      for (const fullPath of filesToIndex) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
          const hash = crypto.createHash('md5').update(content).digest('hex');

          if (hashByPath.get(relPath) === hash) {
            continue;
          }

          const fnNames = this.extractFunctionNames(content, relPath);
          const summary = this.generateFileSummary(content, relPath, fnNames);

          this.db.prepare('DELETE FROM code_index WHERE file_path = ?').run(relPath);
          this.db
            .prepare('INSERT INTO code_index (file_path, function_names, summary, content_hash) VALUES (?, ?, ?, ?)')
            .run(relPath, fnNames, summary, hash);
          updatedCount++;
        } catch {}
      }
    });
    tx();

    if (updatedCount > 0) {
      console.log(`[MarvinMemoryEngine] Indexed ${updatedCount} updated files into SQLite FTS5 code_index (${this.activeDbPath}).`);
    }

    // Keep data/project_index.json synchronized
    try {
      const codeIndexer = require(path.join(ROOT_DIR, 'scripts', 'code_indexer.js'));
      if (typeof codeIndexer.runCodeIndexer === 'function') {
        codeIndexer.runCodeIndexer();
      }
    } catch {}

    return filesToIndex.length;
  }

  private extractFunctionNames(content: string, relPath: string): string {
    const names = new Set<string>();
    const patterns = [
      /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/g,
      /(?:public|private|protected)\s+(?:async\s+)?([a-zA-Z0-9_]+)\s*\(/g,
      /const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
      /export\s+(?:class|interface|const)\s+([a-zA-Z0-9_]+)/g,
      /def\s+([a-zA-Z0-9_]+)\s*\(/g,
      /router\.(?:get|post|put|delete)\s*\(\s*['"]([^'"]+)['"]/g
    ];

    for (const regex of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        if (name && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) {
          names.add(name);
        }
      }
    }

    return Array.from(names).slice(0, 35).join(' ');
  }

  private generateFileSummary(content: string, relPath: string, fnNames: string): string {
    const firstLines = content
      .split(/\r?\n/)
      .slice(0, 25)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('import '))
      .join(' ')
      .slice(0, 260);
    return `${relPath} | Functions: ${fnNames} | Preview: ${firstLines}`;
  }

  /**
   * Surgical Context Retrieval (Local RAG via SQLite FTS5):
   * Searches `code_index` for the user's query and extracts ONLY the relevant <= 60-line snippet!
   */
  public retrieveSurgicalCodeSnippet(query: string, maxLines: number = 60): CodeIndexHit | null {
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return null;

    // Build valid SQLite FTS5 prefix OR query (unquoted alphanumeric tokens with trailing *)
    const ftsTokens = keywords
      .map((k) => k.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
      .filter((k) => k.length >= 2)
      .slice(0, 8);

    if (ftsTokens.length === 0) return null;

    const ftsQuery = ftsTokens.map((t) => `${t}*`).join(' OR ');

    try {
      const row = this.db
        .prepare(`
          SELECT file_path, function_names, summary
          FROM code_index
          WHERE code_index MATCH ?
          ORDER BY rank
          LIMIT 1
        `)
        .get(ftsQuery) as any;

      if (!row) return null;

      const absPath = path.join(ROOT_DIR, row.file_path);
      if (!fs.existsSync(absPath)) return null;

      const allLines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/);

      // Find the line with the highest keyword density
      let bestLineIdx = 0;
      let bestLineHits = -1;

      for (let i = 0; i < allLines.length; i++) {
        const lineLower = allLines[i].toLowerCase();
        let hits = 0;
        for (const tok of ftsTokens) {
          if (lineLower.includes(tok)) hits++;
        }
        if (hits > bestLineHits) {
          bestLineHits = hits;
          bestLineIdx = i;
        }
      }

      const halfWindow = Math.floor(maxLines / 2);
      const startLine = Math.max(0, bestLineIdx - halfWindow);
      const endLine = Math.min(allLines.length, startLine + maxLines);
      const snippet = allLines
        .slice(startLine, endLine)
        .map((line, idx) => `${startLine + idx + 1}: ${line}`)
        .join('\n');

      return {
        filePath: row.file_path,
        functionNames: row.function_names,
        summary: row.summary,
        snippet,
        startLine: startLine + 1,
        endLine
      };
    } catch {
      return null;
    }
  }

  public getTelemetryStats(): MemoryTelemetryStats {
    try {
      const statRow = this.db.prepare('SELECT * FROM telemetry_stats WHERE id = 1').get() as any;
      const idxCount = (this.db.prepare('SELECT count(*) as c FROM code_index').get() as any)?.c || 0;
      const cacheCount = (this.db.prepare('SELECT count(*) as c FROM command_cache').get() as any)?.c || 0;

      const localCacheHits = statRow?.local_cache_hits || 0;
      const geminiApiCalls = statRow?.gemini_api_calls || 0;
      const geminiTokensUsed = statRow?.gemini_tokens_used || 0;
      const estimatedTokensSaved = statRow?.estimated_tokens_saved || 0;

      const totalPotentialTokens = geminiTokensUsed + estimatedTokensSaved;
      const savingsPercent =
        totalPotentialTokens > 0
          ? Number(((estimatedTokensSaved / totalPotentialTokens) * 100).toFixed(1))
          : 100;

      return {
        localCacheHits,
        geminiApiCalls,
        geminiTokensUsed,
        estimatedTokensSaved,
        savingsPercent,
        indexedFilesCount: idxCount,
        cachedIntentsCount: cacheCount,
        dbPath: this.activeDbPath
      };
    } catch {
      return {
        localCacheHits: 0,
        geminiApiCalls: 0,
        geminiTokensUsed: 0,
        estimatedTokensSaved: 0,
        savingsPercent: 100,
        indexedFilesCount: 0,
        cachedIntentsCount: 0,
        dbPath: this.activeDbPath
      };
    }
  }
}
