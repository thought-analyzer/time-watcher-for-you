/**
 * idle-detector.js — Windows idle time detection via PowerShell
 * Uses GetLastInputInfo to detect keyboard/mouse inactivity.
 */

const { spawn } = require('child_process');

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IdleTime {
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static uint GetIdleSeconds() {
        var info = new LASTINPUTINFO();
        info.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(info);
        GetLastInputInfo(ref info);
        return (uint)(Environment.TickCount - (int)info.dwTime) / 1000;
    }
}
"@ -ErrorAction SilentlyContinue

while ($true) {
    Write-Output ([IdleTime]::GetIdleSeconds())
    Start-Sleep -Seconds 5
}
`;

class IdleDetector {
  constructor({ idleThresholdSeconds = 180, onIdle, onActive } = {}) {
    this.idleThreshold = idleThresholdSeconds;
    this.onIdle = onIdle || (() => {});
    this.onActive = onActive || (() => {});
    this.process = null;
    this.isIdle = false;
    this.idleSeconds = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.process = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        const secs = parseInt(line.trim());
        if (isNaN(secs)) continue;
        this.idleSeconds = secs;
        const wasIdle = this.isIdle;
        this.isIdle = secs >= this.idleThreshold;

        if (this.isIdle && !wasIdle) {
          try { this.onIdle(secs); } catch (e) { console.error('[idle-detector] onIdle error:', e); }
        } else if (!this.isIdle && wasIdle) {
          try { this.onActive(secs); } catch (e) { console.error('[idle-detector] onActive error:', e); }
        }
      }
    });

    this.process.stderr.on('data', () => {});
    this.process.on('exit', () => { this.running = false; });
  }

  stop() {
    if (this.process) { this.process.kill(); this.process = null; }
    this.running = false;
  }

  getIdleSeconds() { return this.idleSeconds; }
  getIsIdle() { return this.isIdle; }
  setThreshold(seconds) { this.idleThreshold = seconds; }
}

module.exports = IdleDetector;
