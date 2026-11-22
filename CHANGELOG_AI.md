# M.A.R.V.I.N. & Antigravity - Permanent AI Changelog

Acest fișier înregistrează automat fiecare modificare de cod, reconfigurare sau adăugare de fișiere efectuată de asistentul **M.A.R.V.I.N.** (*Mortyck Automated Reconnaissance & Virtual Infrastructure Node*) sau de agentul **Antigravity**.

Fiecare intrare este asociată cu un commit Git local (`git commit -m "MARVIN: <rezumat>"`). Dacă este configurat un remote GitHub `origin`, modificările pot fi sincronizate în fundal.

---

### [2026-11-22 00:18:00] - MARVIN: Initialized permanent local memory, Git tracking, and Antigravity bridge
- **Actor:** M.A.R.V.I.N. // CORE & Antigravity
- **Fișiere afectate:**
  - `data/project_index.json` (Nou: index structural pre-procesat al întregului codebase)
  - `scripts/code_indexer.js` (Nou: indexator structural automat cu actualizare FTS5)
  - `scripts/marvin_git_tracker.js` (Nou: modul git tracking, changelog automat și rollback)
  - `scripts/mcp_mortyck_server.js` (Nou: server MCP pentru Antigravity)
  - `.agent/rules/marvin-memory.md` (Nou: reguli de interacțiune chirurgicală 30-60 linii)
  - `data/marvin_tasks.json` (Nou: coadă de sarcini asincronă cu urmărire live)
  - `.gitignore` (Nou: reguli de excludere chei sensibile, baze de date binare și fișiere temporare)
- **Motiv:** Implementarea sistemului de memorie permanentă, urmărire Git/GitHub, conversia numelui asistentului în M.A.R.V.I.N. și operare 100% portabilă cu căi relative.

### [2026-11-22 00:50:00] - MARVIN: Cross-platform Linux support
- **Actor:** M.A.R.V.I.N. // CORE & Antigravity
- **Fișiere afectate:**
  - `backend/src/index.ts` (Adăugare detecție OS Windows/Linux, rezoluție binar go2rtc/python și servire directă frontend single-page dashboard pe port 4000)
  - `backend/src/services/MediaService.ts` (Eliminare căi hardcodate, suport cross-platform Windows go2rtc.exe vs Linux ./go2rtc, venv/bin/python vs python3)
  - `backend/src/services/NetworkScannerService.ts` (Suport parsare tabelă ARP atât pe Windows cât și pe Linux)
  - `scripts/platform_detect.js` (Nou: modul centralizat de detecție runtime și rezoluție căi binare)
  - `ecosystem.config.js` (Configurație PM2 multi-platformă adaptivă)
  - `package.json` (Nou: scripturi root build & start pentru întregul proiect)
  - `start_all.sh` & `stop_all.sh` (Nou: scripturi bash native pentru pornire și oprire curată pe Linux)
- **Motiv:** Asigurarea funcționării native 100% cross-platform atât pe Windows cât și pe Linux.

### [2026-11-22 03:45:00] - MARVIN: Fix MARVIN tool loop and Blurams HD clean stream
- **Actor:** M.A.R.V.I.N. // CORE & Antigravity
- **Fișiere afectate:**
  - `backend/src/services/JarvisAiService.ts` (Extins bucla de execuție unelte Gemini la 12 iterații; suport `editFile`/`patchFile`; rutare dual-model: `gemini-3.5-flash` pentru sarcini de modificare cod/fișiere și `gemini-3.5-flash-lite` + cache local SQLite pentru comenzi rapide smart-home; generare turn final de sinteză/rezumat în limba română dacă răspunsul text era gol)
  - `scripts/blurams_bridge.py` (Stream nativ HD `quality=1`/`definition=hd` fără downscaling; eliminat complet overlay-ul sintetic HUD/cyan grid/telemetry clock din FFmpeg; stream curat passthrough `-c:v copy` sau `-crf 20`)
  - `frontend/src/components/JarvisMainTerminal.tsx` (Actualizat badge status: `3.5 FLASH // DUAL ROUTE`)
  - `frontend/src/components/WebRtcPlayer.tsx` (Verificat stream curat fără diagnostic overlay pe feed live)
- **Motiv:** Rezolvarea întreruperii premature a buclei de modificare de fișiere pentru M.A.R.V.I.N. și afișarea unui stream live de calitate HD curată pentru camera Blurams din Garaj.

### [2026-11-22 03:56:44] - MARVIN: Edited scripts/blurams_bridge.py (L459-L465)
- **Actor:** M.A.R.V.I.N. // CORE
- **Fișier:** `scripts/blurams_bridge.py` (Liniile 459-465)
- **Motiv:** Requested by user via M.A.R.V.I.N.

### [2026-11-22 04:16:23] - MARVIN: Configure M.A.R.V.I.N. Antigravity MCP Queue & Zero-Cost Routing
- **Actor:** Antigravity // MCP & M.A.R.V.I.N. CORE
- **Fișiere afectate:**
  - `frontend/src/components/JarvisMainTerminal.tsx` (Adăugat selector de rutare ANTIGRAVITY vs API FALLBACK în header, badge reactiv ANTIGRAVITY // 0 TOK, sincronizare istoric trace-uri din data/marvin_trace.log)
  - `frontend/src/services/api.ts` (Actualizat sendJarvisCommand cu parametrul mode: antigravity | api_fallback, adăugată funcția fetchAiTraces)
  - `backend/src/services/JarvisAiService.ts` (Implementat mod de rutare Antigravity implicit, funcție enqueueAntigravityTask care plasează sarcinile de cod în data/marvin_tasks.json cu 0 apeluri Google AI Studio, recordExternalTrace și getRecentTraces)
  - `backend/src/routes/api.ts` (Rute noi /api/marvin/trace GET/POST pentru broadcast în timp real și /api/marvin/routing-mode)
  - `scripts/mcp_mortyck_server.js` (Expuse uneltele MCP list_marvin_tasks, update_marvin_trace și complete_marvin_task cu auto-actualizare CHANGELOG_AI.md, Git commit și reindexare)
  - `.agent/rules/marvin-bridge.md` (Reguli complete de operare între M.A.R.V.I.N. și Antigravity pentru economisirea totală a apelurilor Google AI Studio)
  - `~/.gemini/config/mcp_config.json` (Înregistrat serverul MCP mortyck-marvin în Antigravity)
- **Motiv:** Rutarea tuturor sarcinilor de modificare cod/fișiere prin abonamentul plătit Antigravity cu 0 apeluri Google AI Studio API și urmărire live în consola M.A.R.V.I.N. HUD.
