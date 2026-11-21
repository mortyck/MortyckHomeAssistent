/**
 * M.A.R.V.I.N. Git & GitHub Change Tracking Engine
 * Automatically logs AI modifications to CHANGELOG_AI.md and creates Git commits.
 * Supports single-click rollback and non-blocking background push to GitHub.
 */

const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { IS_WINDOWS, GO2RTC_BINARY_NAME, getPythonExecutable, getGo2RtcBinary } = require('./platform_detect');

const ROOT_DIR = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG_AI.md');

function getFormattedTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function ensureChangelogHeader() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    const header = [
      '# M.A.R.V.I.N. & Antigravity - Permanent AI Changelog',
      '',
      'Acest fișier înregistrează automat fiecare modificare de cod sau configurație efectuată de M.A.R.V.I.N. și Antigravity.',
      '',
      '---',
      ''
    ].join('\n');
    fs.writeFileSync(CHANGELOG_PATH, header, 'utf8');
  }
}

function recordChangeAndCommit({ filePath, startLine, endLine, summary, reason, actor = 'M.A.R.V.I.N. // CORE' }) {
  ensureChangelogHeader();

  const timestamp = getFormattedTimestamp();
  const lineInfo = startLine ? ` (Liniile ${startLine}${endLine ? `-${endLine}` : ''})` : '';
  const cleanSummary = (summary || 'Actualizare cod/configurație').replace(/\r?\n/g, ' ').trim();
  const cleanReason = (reason || 'Optimizare solicitată de utilizator').replace(/\r?\n/g, ' ').trim();

  const entry = [
    '',
    `### [${timestamp}] - MARVIN: ${cleanSummary}`,
    `- **Actor:** ${actor}`,
    `- **Fișier:** \`${filePath}\`${lineInfo}`,
    `- **Motiv:** ${cleanReason}`,
    ''
  ].join('\n');

  try {
    fs.appendFileSync(CHANGELOG_PATH, entry, 'utf8');
  } catch (err) {
    console.error('[MARVIN-GIT] Failed to append to CHANGELOG_AI.md:', err.message);
  }

  // Execute git commit
  try {
    execSync('git add -A', { cwd: ROOT_DIR, stdio: 'pipe' });
    const commitMsg = `MARVIN: ${cleanSummary}`.replace(/"/g, '\\"');
    execSync(`git commit -m "${commitMsg}" --allow-empty`, { cwd: ROOT_DIR, stdio: 'pipe' });
    console.log(`[MARVIN-GIT] Created commit: ${commitMsg}`);
  } catch (commitErr) {
    console.warn(`[MARVIN-GIT] Git commit note: ${commitErr.message}`);
  }

  // Non-blocking background push if origin remote is configured
  try {
    const remotes = execSync('git remote', { cwd: ROOT_DIR, stdio: 'pipe' }).toString();
    if (remotes.includes('origin')) {
      exec('git push -u origin HEAD', { cwd: ROOT_DIR }, (pushErr, stdout, stderr) => {
        if (pushErr) {
          console.warn('[MARVIN-GIT] Background push note:', stderr || pushErr.message);
        } else {
          console.log('[MARVIN-GIT] Successfully pushed to origin in background.');
        }
      });
    }
  } catch {}

  // Trigger code indexer to keep project_index.json updated
  try {
    const { runCodeIndexer } = require('./code_indexer');
    runCodeIndexer();
  } catch {}

  return { success: true, timestamp, summary: cleanSummary };
}

function rollbackLastChange(actor = 'M.A.R.V.I.N. // USER_ROLLBACK') {
  const timestamp = getFormattedTimestamp();

  try {
    // Check if there are commits to revert
    const logOut = execSync('git log -n 1 --oneline', { cwd: ROOT_DIR, stdio: 'pipe' }).toString().trim();
    if (!logOut) {
      return { success: false, error: 'Nu există commituri anterioare pentru rollback.' };
    }

    execSync('git revert HEAD --no-edit', { cwd: ROOT_DIR, stdio: 'pipe' });

    const entry = [
      '',
      `### [${timestamp}] - MARVIN: ROLLBACK LAST AI CHANGE`,
      `- **Actor:** ${actor}`,
      `- **Reverted Commit:** \`${logOut}\``,
      `- **Motiv:** Revert solicitat de utilizator din interfață.`,
      ''
    ].join('\n');
    fs.appendFileSync(CHANGELOG_PATH, entry, 'utf8');

    // Trigger code indexer
    try {
      const { runCodeIndexer } = require('./code_indexer');
      runCodeIndexer();
    } catch {}

    return {
      success: true,
      timestamp,
      revertedCommit: logOut,
      message: `Rollback efectuat cu succes pentru commitul: ${logOut}`
    };
  } catch (err) {
    return {
      success: false,
      error: `Eroare rollback git revert: ${err.message}`
    };
  }
}

function getGitStatus() {
  try {
    let branch = 'unknown';
    let commit = 'none';
    let hasOrigin = false;
    let remoteUrl = null;

    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, stdio: 'pipe' }).toString().trim();
      commit = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, stdio: 'pipe' }).toString().trim();
    } catch {}

    try {
      const remoteOut = execSync('git remote get-url origin', { cwd: ROOT_DIR, stdio: 'pipe' }).toString().trim();
      if (remoteOut) {
        hasOrigin = true;
        remoteUrl = remoteOut;
      }
    } catch {}

    const statusOut = execSync('git status --porcelain', { cwd: ROOT_DIR, stdio: 'pipe' }).toString().trim();

    return {
      initialized: true,
      branch,
      commit,
      hasOrigin,
      remoteUrl,
      isClean: statusOut.length === 0,
      uncommittedFiles: statusOut ? statusOut.split(/\r?\n/).length : 0
    };
  } catch (err) {
    return {
      initialized: false,
      error: err.message
    };
  }
}

module.exports = {
  recordChangeAndCommit,
  rollbackLastChange,
  getGitStatus,
  CHANGELOG_PATH
};
