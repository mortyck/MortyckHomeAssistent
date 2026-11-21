/**
 * M.A.R.V.I.N. ↔ Antigravity MCP Server (Model Context Protocol)
 * Provides Antigravity with instant structural access to MortyckHomeAssistent
 * without expensive codebase scanning.
 * Uses strictly relative paths.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const INDEX_JSON_PATH = path.join(DATA_DIR, 'project_index.json');
const TASKS_PATH = path.join(DATA_DIR, 'marvin_tasks.json');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG_AI.md');
const DEVICES_PATH = path.join(ROOT_DIR, 'backend', 'data', 'devices.json');

const { rollbackLastChange, recordChangeAndCommit, getGitStatus } = require('./marvin_git_tracker');
const { IS_WINDOWS, GO2RTC_BINARY_NAME, getPythonExecutable, getGo2RtcBinary } = require('./platform_detect');

const TOOLS = [
  {
    name: 'get_project_index',
    description: 'Returnează harta structurală pre-indexată a proiectului MortyckHomeAssistent din data/project_index.json (fără scanare de disk).',
    inputSchema: {
      type: 'object',
      properties: {
        filterExtension: {
          type: 'string',
          description: 'Opțional: filtrează după extensie (ex: ".tsx", ".ts", ".py")'
        }
      }
    }
  },
  {
    name: 'read_code_snippet',
    description: 'Citește strict un bloc chirurgical de cod (max 60 linii) dintr-un fișier folosind calea relativă, pentru a economisi 95% din tokeni.',
    inputSchema: {
      type: 'object',
      properties: {
        relPath: {
          type: 'string',
          description: 'Calea relativă în proiect (ex: "frontend/src/App.tsx", "backend/src/routes/api.ts")'
        },
        startLine: {
          type: 'number',
          description: 'Linia de start (1-indexed)'
        },
        endLine: {
          type: 'number',
          description: 'Linia de final (max 60 linii distanță de startLine)'
        }
      },
      required: ['relPath', 'startLine']
    }
  },
  {
    name: 'get_devices_summary',
    description: 'Returnează indexul minificat al dispozitivelor IoT și camerelor (id, nume, tip, locație, stare).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_recent_changelog',
    description: 'Returnează cele mai recente intrări din CHANGELOG_AI.md și starea Git locală.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Numărul de intrări (implicit 5)'
        }
      }
    }
  },
  {
    name: 'rollback_last_change',
    description: 'Anulează ultimul commit AI (git revert HEAD --no-edit) și actualizează jurnalul CHANGELOG_AI.md.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_marvin_tasks',
    description: 'Citește coada de sarcini asincrone a asistentului M.A.R.V.I.N. din data/marvin_tasks.json.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

function handleGetProjectIndex(args) {
  if (!fs.existsSync(INDEX_JSON_PATH)) {
    try {
      const { runCodeIndexer } = require('./code_indexer');
      runCodeIndexer();
    } catch {}
  }

  if (!fs.existsSync(INDEX_JSON_PATH)) {
    return { error: 'Index file data/project_index.json not found.' };
  }

  const raw = JSON.parse(fs.readFileSync(INDEX_JSON_PATH, 'utf8'));
  const ext = args?.filterExtension;

  if (ext) {
    const filteredFiles = {};
    for (const [p, item] of Object.entries(raw.files || {})) {
      if (p.endsWith(ext)) {
        filteredFiles[p] = item;
      }
    }
    return {
      version: raw.version,
      totalFiles: Object.keys(filteredFiles).length,
      files: filteredFiles
    };
  }

  // Compact format returning path -> summary and lineCount
  const compactFiles = {};
  for (const [p, item] of Object.entries(raw.files || {})) {
    compactFiles[p] = {
      summary: item.summary,
      lineCount: item.lineCount,
      symbolsCount: item.symbols?.length || 0
    };
  }

  return {
    version: raw.version,
    generatedAt: raw.generatedAt,
    totalFiles: raw.totalFiles,
    files: compactFiles
  };
}

function handleReadCodeSnippet(args) {
  const { relPath, startLine, endLine } = args;
  const fullPath = path.resolve(ROOT_DIR, relPath);

  if (!fullPath.startsWith(ROOT_DIR)) {
    return { error: 'Path outside project workspace.' };
  }
  if (!fs.existsSync(fullPath)) {
    return { error: `File not found: ${relPath}` };
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const allLines = content.split(/\r?\n/);
  const start = Math.max(1, startLine || 1);
  const end = Math.min(allLines.length, endLine ? Math.min(endLine, start + 65) : start + 50);

  const snippetLines = allLines.slice(start - 1, end).map((l, idx) => `${start + idx} | ${l}`);

  return {
    relPath,
    startLine: start,
    endLine: end,
    totalFileLines: allLines.length,
    snippet: snippetLines.join('\n')
  };
}

function handleGetDevicesSummary() {
  if (!fs.existsSync(DEVICES_PATH)) {
    return { devices: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
    const summary = raw.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      location: d.location,
      ip: d.ip,
      online: d.online !== false,
      webrtcUrl: d.state?.webrtc_url || null
    }));
    return { total: summary.length, devices: summary };
  } catch (err) {
    return { error: err.message };
  }
}

function handleGetRecentChangelog(args) {
  const limit = args?.limit || 5;
  const gitStatus = getGitStatus();
  let changelogContent = '';

  if (fs.existsSync(CHANGELOG_PATH)) {
    changelogContent = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  }

  const entries = changelogContent.split(/###\s+/).slice(1);
  const recentEntries = entries.slice(-limit).map((e) => `### ${e.trim()}`);

  return {
    gitStatus,
    recentEntries: recentEntries.reverse()
  };
}

function handleGetMarvinTasks() {
  if (!fs.existsSync(TASKS_PATH)) {
    return { tasks: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  } catch (err) {
    return { error: err.message };
  }
}

function sendResponse(id, result, error = null) {
  const res = { jsonrpc: '2.0', id };
  if (error) {
    res.error = error;
  } else {
    res.result = result;
  }
  process.stdout.write(JSON.stringify(res) + '\n');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);

    if (msg.method === 'initialize') {
      sendResponse(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'mcp-mortyck-server',
          version: '1.0.0'
        }
      });
      return;
    }

    if (msg.method === 'notifications/initialized') {
      return;
    }

    if (msg.method === 'tools/list') {
      sendResponse(msg.id, { tools: TOOLS });
      return;
    }

    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params || {};

      let result = null;
      if (name === 'get_project_index') {
        result = handleGetProjectIndex(args);
      } else if (name === 'read_code_snippet') {
        result = handleReadCodeSnippet(args);
      } else if (name === 'get_devices_summary') {
        result = handleGetDevicesSummary();
      } else if (name === 'get_recent_changelog') {
        result = handleGetRecentChangelog(args);
      } else if (name === 'rollback_last_change') {
        result = rollbackLastChange('Antigravity // MCP');
      } else if (name === 'get_marvin_tasks') {
        result = handleGetMarvinTasks();
      } else {
        sendResponse(msg.id, null, { code: -32601, message: `Tool not found: ${name}` });
        return;
      }

      sendResponse(msg.id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      });
      return;
    }

    if (msg.id !== undefined) {
      sendResponse(msg.id, null, { code: -32601, message: `Method not supported: ${msg.method}` });
    }
  } catch (err) {
    process.stderr.write(`[MCP Error] ${err.message}\n`);
  }
});
