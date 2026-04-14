/**
 * window-tracker.js — Active window detection for Windows
 * Uses PowerShell to detect foreground window title and process name.
 */

const { spawn } = require('child_process');

// PowerShell script to poll active window continuously
const PS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinApi {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

while ($true) {
    try {
        $hwnd = [WinApi]::GetForegroundWindow()
        $title = New-Object System.Text.StringBuilder(512)
        [WinApi]::GetWindowText($hwnd, $title, 512)
        $wpid = 0
        [WinApi]::GetWindowThreadProcessId($hwnd, [ref]$wpid)
        $proc = Get-Process -Id $wpid -ErrorAction SilentlyContinue
        $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
        Write-Output "$($title.ToString())|$procName"
    } catch {
        Write-Output "error|error"
    }
    Start-Sleep -Milliseconds 2000
}
`;

const SELF_PROCESS_NAMES = ['electron', 'time-watcher'];

// Strip leading Unicode symbols (e.g. ❖ in "❖ Claude Code", emoji, etc.)
function normalizeTitle(title) {
  return title.replace(/^[\p{So}\p{Sm}\p{Sk}\p{Po}]+\s*/u, '').trim();
}

class WindowTracker {
  constructor() {
    this.process = null;
    this.currentWindow = null;
    this.recentWindows = []; // [{title, processName, timestamp}] 最新20件、自アプリ除外
    this.listeners = [];
    this.running = false;
  }

  _addToHistory(info) {
    // 自アプリ自身は除外
    if (SELF_PROCESS_NAMES.some(s => info.processName.toLowerCase().includes(s))) return;
    if (!info.title) return;

    // 同じプロセス名の既存エントリを削除して先頭に追加（重複排除）
    this.recentWindows = this.recentWindows.filter(
      w => w.processName !== info.processName
    );
    this.recentWindows.unshift({ ...info });
    if (this.recentWindows.length > 20) this.recentWindows.pop();
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'error|error') continue;
        const pipeIdx = trimmed.lastIndexOf('|');
        if (pipeIdx === -1) continue;
        const title = normalizeTitle(trimmed.slice(0, pipeIdx).trim());
        const processName = trimmed.slice(pipeIdx + 1).trim();
        const info = { title, processName, timestamp: Date.now() };
        if (!this.currentWindow ||
            this.currentWindow.title !== info.title ||
            this.currentWindow.processName !== info.processName) {
          this.currentWindow = info;
          this._addToHistory(info);
          for (const fn of this.listeners) {
            try { fn(info); } catch {}
          }
        }
      }
    });

    this.process.stderr.on('data', () => {}); // suppress errors
    this.process.on('exit', () => {
      this.running = false;
    });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.running = false;
  }

  onWindowChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  getCurrent() {
    return this.currentWindow;
  }

  getRecentWindows() {
    return this.recentWindows;
  }
}

module.exports = new WindowTracker();
