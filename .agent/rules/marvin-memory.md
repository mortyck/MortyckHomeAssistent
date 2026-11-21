# M.A.R.V.I.N. Permanent Memory & Portability Rules

## 1. System Identity & Workspace Context
- **Workspace:** `MortyckHomeAssistent` (Root: `.`, strictly relative paths for 100% portability).
- **AI Assistant:** **M.A.R.V.I.N.** (*Mortyck Automated Reconnaissance & Virtual Infrastructure Node*).
- **Primary Engine:** Google Gemini Flash-Lite (`models/gemini-3.5-flash-lite`) paired with local SQLite FTS5 and pre-indexed memory.

## 2. Surgical Context Retrieval (95% Token Savings)
- **NEVER** scan all project directories or read complete files when inspecting code or diagnosing issues.
- **ALWAYS** query `data/project_index.json` or the SQLite FTS5 `code_index` table first to identify the exact target file and symbols.
- Read **ONLY** the specific 30–60 line block required for the change.
- Fast commands (`status`, `aprinde/stinge`, `pornește PC`) must execute via local SQLite cache with **0 tokens**.

## 3. Permanent Git Tracking & Changelog
- Any file addition, modification, or configuration edit made by M.A.R.V.I.N. or Antigravity MUST:
  1. Append a timestamped entry to `CHANGELOG_AI.md` specifying the file, line range, author, and purpose.
  2. Create a local Git commit: `git add -A && git commit -m "MARVIN: <concise summary>"`.
  3. If a remote GitHub repository is linked (`git remote get-url origin`), push changes in the background without blocking execution.
- If a change causes an error or is rejected, perform a single-click rollback with `git revert HEAD --no-edit`.

## 4. Portability & Relative Paths
- Do NOT hardcode absolute paths like `D:\MortyckHome` in scripts or code. Always resolve paths relative to `__dirname`, `process.cwd()`, or `ROOT_DIR`.
- All operational configurations, WebRTC streams, and PC remote connections must operate portably across desktop, laptop, and tablet kiosk environments.
