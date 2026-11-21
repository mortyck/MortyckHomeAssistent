/**
 * M.A.R.V.I.N. Codebase Indexer
 * MortyckHomeAssistent - Pre-Indexed Local Codebase Memory
 * Generates data/project_index.json and populates SQLite FTS5 code_index
 * Uses strictly relative paths so the workspace is 100% portable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IS_WINDOWS, GO2RTC_BINARY_NAME, getPythonExecutable, getGo2RtcBinary } = require('./platform_detect');

// Resolve project root strictly relative to this script
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const INDEX_JSON_PATH = path.join(DATA_DIR, 'project_index.json');
const MARVIN_DB_PATH = path.join(DATA_DIR, 'marvin_memory.db');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'jarvis_memory.db');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'backups',
  'logs',
  '.system_generated'
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  '.DS_Store',
  'Thumbs.db'
]);

const INDEXED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.yaml', '.yml', '.css', '.md', '.bat'
]);

const FILE_SUMMARIES = {
  'frontend/src/App.tsx': 'Panou principal MortyckHomeAssistent: layout cu bară HUD tactică, taburi de control, cameră WebRTC și consolă M.A.R.V.I.N.',
  'frontend/src/components/JarvisMainTerminal.tsx': 'Consolă verticală M.A.R.V.I.N. HUD: istoric conversație, jurnal de execuție în timp real, telemetrie tokeni și rollback',
  'frontend/src/components/JarvisAssistantDrawer.tsx': 'Sertar lateral secundar M.A.R.V.I.N. cu suport pentru istoric SQLite și comenzi vocale/text',
  'frontend/src/components/RemotePcCard.tsx': 'Card tactică pentru stații de lucru remote: status ping, Wake-on-LAN și integrare noVNC modal',
  'frontend/src/components/Navbar.tsx': 'Bara de navigație superioară: logo Arc Reactor, comutator locație (Home/Garaj), taburi și starea nodului',
  'frontend/src/components/WebRtcPlayer.tsx': 'Player video WebRTC de latență ultra-redusă conectat la go2rtc pentru camerele Wansview, CamHi și Blurams',
  'frontend/src/components/MultiCameraWall.tsx': 'Matrice video multiview pentru monitorizarea simultană a tuturor camerelor din atelier și curte',
  'frontend/src/components/SystemSettingsModal.tsx': 'Modal configurare parametrii sistem: credențiale camere, chei API M.A.R.V.I.N. și setări rețea',
  'frontend/src/components/DeviceOnboardingModal.tsx': 'Modal adăugare și descoperire dispozitive IoT (Tuya, Camere IP, Workstation-uri PC)',
  'frontend/src/components/AutomationsModal.tsx': 'Panou vizualizare și activare scenarii automatizate (Smart Rules)',
  'frontend/src/components/TuyaDeviceCard.tsx': 'Control comutatoare și prize inteligente Tuya (relee, iluminat atelier)',
  'backend/src/index.ts': 'Punctul de pornire al serverului backend: Express API, WebSocket broadcast, noVNC proxy și inițializare noduri',
  'backend/src/routes/api.ts': 'Definițiile rutelor REST API: /devices, /pcs, /cameras, /ai/command, /marvin/task, /marvin/rollback',
  'backend/src/services/JarvisAiService.ts': 'Motorul central M.A.R.V.I.N. AI: rutare rapidă 0-token, interacțiune Gemini Flash-Lite și execuție unelte',
  'backend/src/services/JarvisMemoryEngine.ts': 'Baza de date SQLite FTS5 și memoria locală a intențiilor, istoricului și telemetriei de tokeni',
  'backend/src/services/DeviceManager.ts': 'Manager gestiune stare dispozitive inteligente Tuya și camere IP',
  'backend/src/services/VncProxyService.ts': 'Punte websockify nativă Node.js pentru control la distanță noVNC pe portul RFB 5900',
  'backend/src/services/WolService.ts': 'Serviciu transmisie pachete Magic Wake-on-LAN pe subneturile 192.168.1.255 și 192.168.8.255',
  'backend/src/services/MediaService.ts': 'Integrare cu motorul media go2rtc: înregistrare fluxuri RTSP și mapare WebRTC',
  'scripts/blurams_bridge.py': 'Punte RTSP H.264 și captură instantanee Blurams Cloud pentru camera Garage Workshop 2 (port 8556)',
  'scripts/code_indexer.js': 'Indexator structural local pentru M.A.R.V.I.N.: generează data/project_index.json și sincronizează FTS5',
  'scripts/platform_detect.js': 'Motor centralizat de detecție multi-platformă (Windows & Linux) pentru căi relative, go2rtc și interpretor Python',
  'scripts/mcp_mortyck_server.js': 'Server MCP (Model Context Protocol) pentru integrarea nativă Antigravity cu MortyckHomeAssistent',
  'docker/go2rtc.yaml': 'Configurația motorului de streaming go2rtc: mapări fluxuri RTSP/WebRTC pentru Wansview, CamHi și Blurams'
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function computeMd5(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

function extractSymbols(content, ext) {
  const symbols = [];
  const lines = content.split(/\r?\n/);

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    const symbolRegex = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|interface|type|const|function|enum)\s+([A-Za-z0-9_]+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(symbolRegex);
      if (match) {
        symbols.push({
          kind: match[1],
          name: match[2],
          line: i + 1
        });
      }
    }
  } else if (ext === '.py') {
    const pyRegex = /^\s*(def|class)\s+([A-Za-z0-9_]+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pyRegex);
      if (match) {
        symbols.push({
          kind: match[1],
          name: match[2],
          line: i + 1
        });
      }
    }
  }

  return symbols;
}

function deriveSummary(relPath, symbols, content) {
  if (FILE_SUMMARIES[relPath]) {
    return FILE_SUMMARIES[relPath];
  }

  const base = path.basename(relPath);
  const ext = path.extname(relPath);

  if (base === 'package.json') return 'Manifest dependențe și scripturi npm ale proiectului';
  if (base === 'tsconfig.json') return 'Configurație TypeScript compiler pentru backend / frontend';
  if (base === 'START_ALL.bat') return 'Script Windows de pornire simultană a tuturor serviciilor (go2rtc, bridge, backend, frontend)';
  if (base === 'STOP_ALL.bat') return 'Script Windows de oprire completă a serviciilor și eliberare porturi 3000, 4000, 8556';
  if (base === 'CHANGELOG_AI.md') return 'Jurnal permanent al tuturor modificărilor de cod operate de M.A.R.V.I.N. și Antigravity';
  if (base === 'devices.json') return 'Registrul stării dispozitivelor IoT și camerelor IP salvate în baza de date locală';
  if (base === 'pcs.json') return 'Registrul stațiilor de lucru remote (IP, MAC Wake-on-LAN, port VNC)';

  if (symbols.length > 0) {
    const topSymbols = symbols.slice(0, 3).map((s) => s.name).join(', ');
    return `Modul ${relPath}: definește ${topSymbols}`;
  }

  const lines = content.split(/\r?\n/).slice(0, 5).join(' ');
  return `Fișier ${relPath} (${ext || 'date'})`;
}

function scanProjectFiles(rootDir) {
  const result = [];

  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_DIRS.has(name) || name.startsWith('.git') || name.endsWith('.bak')) {
        continue;
      }

      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (IGNORED_FILES.has(name)) continue;
        const ext = path.extname(name).toLowerCase();
        if (INDEXED_EXTENSIONS.has(ext)) {
          const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          result.push({ fullPath, relPath, ext });
        }
      }
    }
  }

  walk(path.join(rootDir, 'backend', 'src'));
  walk(path.join(rootDir, 'frontend', 'src'));
  walk(path.join(rootDir, 'scripts'));
  walk(path.join(rootDir, 'docker'));
  walk(path.join(rootDir, 'backend', 'data'));

  // Also include key root files
  const rootFiles = ['package.json', 'tsconfig.json', 'START_ALL.bat', 'STOP_ALL.bat', 'CHANGELOG_AI.md', 'README.md'];
  for (const rf of rootFiles) {
    const fp = path.join(rootDir, rf);
    if (fs.existsSync(fp)) {
      result.push({ fullPath: fp, relPath: rf, ext: path.extname(rf).toLowerCase() });
    }
  }

  return result;
}

function updateSqliteFts(filesIndex) {
  let BetterSqlite3;
  try {
    BetterSqlite3 = require('better-sqlite3');
  } catch {
    // If not in root node_modules, try backend node_modules
    try {
      BetterSqlite3 = require(path.join(ROOT_DIR, 'backend', 'node_modules', 'better-sqlite3'));
    } catch {
      return false;
    }
  }

  const dbTargets = [MARVIN_DB_PATH, LEGACY_DB_PATH];
  for (const dbPath of dbTargets) {
    try {
      if (!fs.existsSync(path.dirname(dbPath))) continue;
      const db = new BetterSqlite3(dbPath);
      db.pragma('journal_mode = WAL');

      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS code_index USING fts5(
          file_path,
          function_names,
          summary,
          content_hash UNINDEXED
        );
      `);

      const selectStmt = db.prepare('SELECT file_path, content_hash FROM code_index');
      const existing = new Map();
      for (const row of selectStmt.all()) {
        existing.set(row.file_path, row.content_hash);
      }

      const insertStmt = db.prepare(`
        INSERT INTO code_index (file_path, function_names, summary, content_hash)
        VALUES (?, ?, ?, ?)
      `);
      const deleteStmt = db.prepare('DELETE FROM code_index WHERE file_path = ?');

      const tx = db.transaction(() => {
        for (const [relPath, item] of Object.entries(filesIndex)) {
          if (existing.get(relPath) === item.hash) continue;
          deleteStmt.run(relPath);
          const symbolNames = item.symbols.map((s) => s.name).join(' ');
          insertStmt.run(relPath, symbolNames, item.summary, item.hash);
        }
      });
      tx();
      db.close();
    } catch (e) {
      // Non-fatal
    }
  }
  return true;
}

function runCodeIndexer() {
  ensureDir(DATA_DIR);

  const scanned = scanProjectFiles(ROOT_DIR);
  const filesIndex = {};

  for (const { fullPath, relPath, ext } of scanned) {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      const hash = computeMd5(content);
      const symbols = extractSymbols(content, ext);
      const summary = deriveSummary(relPath, symbols, content);

      filesIndex[relPath] = {
        relPath,
        summary,
        lineCount: lines.length,
        symbols,
        hash,
        sizeBytes: Buffer.byteLength(content, 'utf8')
      };
    } catch (e) {
      // Ignore unreadable files
    }
  }

  const projectIndex = {
    version: '1.0.0',
    assistant: 'M.A.R.V.I.N.',
    projectRootRel: '.',
    generatedAt: new Date().toISOString(),
    totalFiles: Object.keys(filesIndex).length,
    files: filesIndex
  };

  fs.writeFileSync(INDEX_JSON_PATH, JSON.stringify(projectIndex, null, 2), 'utf8');
  updateSqliteFts(filesIndex);

  return projectIndex;
}

if (require.main === module) {
  const isWatch = process.argv.includes('--watch');
  const index = runCodeIndexer();
  console.log(`[MARVIN-INDEXER] Successfully indexed ${index.totalFiles} files into data/project_index.json`);

  if (isWatch) {
    console.log('[MARVIN-INDEXER] Watching project files for changes...');
    const watchDirs = [
      path.join(ROOT_DIR, 'backend', 'src'),
      path.join(ROOT_DIR, 'frontend', 'src'),
      path.join(ROOT_DIR, 'scripts')
    ];

    let debounceTimer = null;
    for (const wd of watchDirs) {
      if (fs.existsSync(wd)) {
        fs.watch(wd, { recursive: true }, (event, filename) => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const reindexed = runCodeIndexer();
            console.log(`[MARVIN-INDEXER] Re-indexed ${reindexed.totalFiles} files due to change in ${filename}`);
          }, 800);
        });
      }
    }
  }
}

module.exports = {
  runCodeIndexer,
  INDEX_JSON_PATH,
  DATA_DIR
};
