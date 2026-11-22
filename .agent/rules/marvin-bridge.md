# M.A.R.V.I.N. ↔ Antigravity MCP Bridge & Zero-Cost Routing Rules

## 1. Zero-Cost Architectural Overview
- **Workspace:** `MortyckHomeAssistent` (Root: `.`, strictly relative paths for 100% portability).
- **Primary AI Execution Engine:** Antigravity (Subscription-powered, 0 Google AI Studio API calls).
- **Local Fast Path:** Local SQLite cache & regex fast-path handles immediate device commands (`status`, `aprinde/stinge`, `wake pc`) with 0 tokens.
- **Code & Configuration Modifications:** All code, script, and configuration edits routed from M.A.R.V.I.N. are written directly into `data/marvin_tasks.json`.
- **Live HUD Trace Streaming:** Real-time feedback is streamed into `data/marvin_trace.log` and broadcasted over WebSocket directly to the M.A.R.V.I.N. tactical HUD console.

## 2. Antigravity MCP Server (`mortyck-marvin`)
The local MCP server is located at `scripts/mcp_mortyck_server.js`.
To register it in Antigravity (`~/.gemini/config/mcp_config.json`):
```json
{
  "mcpServers": {
    "mortyck-marvin": {
      "command": "node",
      "args": ["d:/MortyckHome/scripts/mcp_mortyck_server.js"]
    }
  }
}
```

## 3. Core MCP Tools & Workflow
When processing user instructions or tasks queued from the M.A.R.V.I.N. console:

1. **`list_marvin_tasks`**:
   - Query pending tasks from `data/marvin_tasks.json` (`status: "pending"`).
   - Read the user prompt, target files, and context metadata.

2. **`update_marvin_trace`**:
   - Stream live execution steps to the M.A.R.V.I.N. console in real time.
   - Use standard tags:
     - `SCAN`: Initializing task analysis or checking project index.
     - `RAG`: Extracting targeted 30–60 line code blocks.
     - `READ`: Inspecting source files.
     - `EDIT`: Modifying code or configuration files.
     - `WRITE`: Creating new components or scripts.
     - `BACKUP`: Preserving pre-edit `.bak` snapshots.
     - `EXEC`: Running build checks, tests, or indexer updates.
     - `SUCCESS`: Task completed cleanly.
     - `ERROR`: Any execution warning or failure.

3. **Surgical Context Retrieval (95% Token Conservation)**:
   - Use `get_project_index` to fetch the pre-indexed structural map of `data/project_index.json`.
   - Use `read_code_snippet` to read only the specific 30–60 lines required.
   - Never scan or read entire repository trees.

4. **`complete_marvin_task`**:
   - Mark task `status: "completed"` in `data/marvin_tasks.json`.
   - Automatically:
     1. Appends a structured entry to `CHANGELOG_AI.md`.
     2. Runs `git add -A` and `git commit -m "MARVIN: <summary>"`.
     3. Runs `node scripts/code_indexer.js` to refresh `data/project_index.json`.
     4. Broadcasts a `SUCCESS` trace step to the live HUD console.

## 4. Portability & Relative Paths
- NEVER hardcode absolute paths like `D:\MortyckHome`. Always resolve paths relative to repository root (`process.cwd()`, `__dirname`, or `./`).
- All scripts must remain 100% cross-platform (Windows & Linux).
