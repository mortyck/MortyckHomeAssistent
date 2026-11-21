/**
 * MortyckHomeAssistent - Cross-Platform Detection Engine (Windows & Linux)
 * Provides centralized binary and runtime resolution for go2rtc, Python, and relative paths.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IS_WINDOWS = process.platform === 'win32';
const GO2RTC_BINARY_NAME = IS_WINDOWS ? 'go2rtc.exe' : 'go2rtc';
const GO2RTC_RELATIVE_PATH = IS_WINDOWS ? path.join('docker', 'go2rtc.exe') : path.join('docker', 'go2rtc');

/**
 * Resolve cross-platform Python executable:
 * - On Windows: uses ./venv/Scripts/python.exe if present, else fallback to 'python'
 * - On Linux: uses ./venv/bin/python, ./venv/bin/python3, or 'python3'
 */
function getPythonExecutable(baseDir = ROOT_DIR) {
  if (IS_WINDOWS) {
    const winVenv = path.join(baseDir, 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(winVenv)) return winVenv;
    return 'python';
  } else {
    const linuxVenv = path.join(baseDir, 'venv', 'bin', 'python');
    if (fs.existsSync(linuxVenv)) return linuxVenv;
    const linuxVenv3 = path.join(baseDir, 'venv', 'bin', 'python3');
    if (fs.existsSync(linuxVenv3)) return linuxVenv3;
    return 'python3';
  }
}

/**
 * Locate bundled or local go2rtc executable:
 * - Returns absolute path or relative binary string
 * - Automatically ensures chmod 0755 permissions on Linux
 */
function getGo2RtcBinary(baseDir = ROOT_DIR) {
  const binaryName = GO2RTC_BINARY_NAME;
  const candidateDirs = [
    path.join(baseDir, 'docker'),
    path.resolve(process.cwd(), 'docker'),
    path.resolve(process.cwd(), '..', 'docker'),
    path.resolve(__dirname, '..', 'docker')
  ];

  for (const dir of candidateDirs) {
    const p = path.join(dir, binaryName);
    if (fs.existsSync(p)) {
      if (!IS_WINDOWS) {
        try {
          fs.chmodSync(p, 0o755);
        } catch {}
      }
      return p;
    }
  }

  return IS_WINDOWS ? 'go2rtc.exe' : './go2rtc';
}

module.exports = {
  ROOT_DIR,
  IS_WINDOWS,
  GO2RTC_BINARY_NAME,
  GO2RTC_RELATIVE_PATH,
  getPythonExecutable,
  getGo2RtcBinary
};
