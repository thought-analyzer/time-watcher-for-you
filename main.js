/**
 * main.js — Electron main process for time-watcher-for-you
 * saifo - Activity time tracker
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const windowTracker = require('./tracker/window-tracker');
const IdleDetector = require('./tracker/idle-detector');
const claudeHookServer = require('./tracker/claude-hook-server');

// ── Settings (must be defined before first use) ───────────────────────────────

let SETTINGS_FILE = null;
function getSettingsFile() {
  if (!SETTINGS_FILE) SETTINGS_FILE = path.join(app.getPath('userData'), 'data', 'settings.json');
  return SETTINGS_FILE;
}

function loadSettings() {
  try {
    const f = getSettingsFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return {
    autoTrack: false,
    overlayVisible: true,
    overlayPosition: { x: 20, y: 40 },
    theme: 'dark',
    startWithLogin: false,
  };
}

function saveSettings(s) {
  const f = getSettingsFile();
  const dir = path.dirname(f);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
  settings = s;
}

// ── State ────────────────────────────────────────────────────────────────────

/** Map<activityId, { recordId, startTime }> */
const activeTimers = new Map();

/** In-memory accumulator for Claude segment times: activityId -> { claudeSeconds, userSeconds } */
const segmentAccum = new Map();

/** Set of activityIds paused due to idle */
const idlePausedTimers = new Set();

/** Current Claude Code segment: 'user' | 'claude' | null */
let claudeSegment = null;

/** Goal notifications already fired today: Set<"activityId-goalType-date"> — persisted to disk */
const notifiedGoals = new Set();

function getNotifiedGoalsFile() {
  return path.join(app.getPath('userData'), 'data', 'notified-goals.json');
}
function loadNotifiedGoals() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = JSON.parse(fs.readFileSync(getNotifiedGoalsFile(), 'utf8'));
    // 今日分だけ復元、古い日付は捨てる
    for (const key of (data.keys || [])) {
      if (key.endsWith(today)) notifiedGoals.add(key);
    }
  } catch {}
}
function saveNotifiedGoals() {
  try {
    const dir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getNotifiedGoalsFile(), JSON.stringify({ keys: [...notifiedGoals] }), 'utf8');
  } catch {}
}

let settings = {};
let autoTrackEnabled = false;
let autoTrackUnsubscribe = null;

// Idle detector instance (created after settings loaded)
let idleDetector = null;

// ── Windows ──────────────────────────────────────────────────────────────────

let mainWindow = null;
let overlayWindow = null;
let tray = null;

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 550,
    title: 'time-watcher-for-you',
    backgroundColor: '#0f0f13',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    icon: getIconPath(),
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => {
    app.quit();
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 290,
    height: 200,
    x: settings.overlayPosition ? settings.overlayPosition.x : 20,
    y: settings.overlayPosition ? settings.overlayPosition.y : 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: true,
  });

  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function getIconPath() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(p)) return p;
  return undefined;
}

function createTray() {
  // 16x16 white clock icon as base64 PNG
  const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAnUlEQVQ4jc2TwQ2DMAxFfxgBMQIjMEJGYARGYARGYARGYIQMwAiMwAiMwAjpqSqFgKVU6skX2/KzLf8YoI+kHbBJGiRdgaWk3k9ZJK0kNcBdUhuo+2qApO3oEWC8DkbeBUCrpHYAaKgWmBIbIDsgBuNGWAK/IkAT4N3ZkgAAAABJRU5ErkJggg==';
  let icon;
  try {
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_B64}`);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('time-watcher-for-you');
  updateTrayMenu();

  tray.on('double-click', () => {
    createMainWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const activeCount = activeTimers.size;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: activeCount > 0 ? `⏱ ${activeCount} activity running` : 'No active timers',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open',
      click: () => createMainWindow(),
    },
    {
      label: 'Reload UI',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.reload();
      },
    },
    {
      label: overlayWindow && !overlayWindow.isDestroyed() ? 'Hide Overlay' : 'Show Overlay',
      click: () => toggleOverlay(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        stopAllTimers();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  } else {
    createOverlayWindow();
  }
  updateTrayMenu();
}

// ── Timer Logic ──────────────────────────────────────────────────────────────

function startTimer(activityId) {
  if (activeTimers.has(activityId)) return activeTimers.get(activityId);
  const record = db.startRecord({ activityId, mode: 'manual' });
  const entry = { recordId: record.id, startTime: new Date(record.startTime) };
  activeTimers.set(activityId, entry);
  updateTrayMenu();
  return entry;
}

function stopTimer(activityId) {
  if (!activeTimers.has(activityId)) return null;
  const { recordId } = activeTimers.get(activityId);
  segmentAccum.delete(activityId);
  const record = db.stopRecord(recordId);
  activeTimers.delete(activityId);
  updateTrayMenu();
  return record;
}

function stopAllTimers() {
  for (const [activityId] of activeTimers) {
    try { stopTimer(activityId); } catch {}
  }
}

/** Broadcast tick every second to all windows */
function startTickBroadcast() {
  setInterval(() => {
    const state = buildTimerState();
    broadcast('timer:tick', state);
    checkGoalNotifications(state);
  }, 1000);
}

function checkGoalNotifications(state) {
  const today = db.todayStr();
  for (const t of state.timers) {
    if (!t.goalMinutes || t.goalType === 'none') continue;
    const goalSec = t.goalMinutes * 60;
    const key = `${t.activityId}-${t.goalType}-${today}`;
    if (!notifiedGoals.has(key) && t.todaySeconds >= goalSec && settings.goalNotifications !== false) {
      notifiedGoals.add(key);
      saveNotifiedGoals();
      const isMin = t.goalType === 'min';
      new Notification({
        title: isMin ? '🎯 目標達成!' : '⚠️ 上限超過',
        body: `${t.activityName}: ${Math.floor(t.todaySeconds / 60)}分`,
      }).show();
    }
  }
}

function buildTimerState() {
  const activities = db.getActivities();
  const dailySummary = db.getDailySummary(db.todayStr());
  const timers = [];
  const now = Date.now();

  for (const activity of activities) {
    const active = activeTimers.get(activity.id);
    const todaySeconds = dailySummary[activity.id] || 0;
    let sessionSeconds = 0;
    if (active) {
      sessionSeconds = Math.floor((now - active.startTime.getTime()) / 1000);
    }
    timers.push({
      activityId: activity.id,
      activityName: activity.name,
      color: activity.color,
      goalMinutes: activity.goalMinutes,
      goalType: activity.goalType,
      isRunning: !!active,
      matchedPattern: active ? (active.matchedPattern || null) : null,
      todaySeconds,
      sessionSeconds,
    });
  }
  return { timers, timestamp: now };
}

// ── Auto Tracking ────────────────────────────────────────────────────────────

function enableAutoTrack() {
  if (autoTrackEnabled) return;
  autoTrackEnabled = true;
  windowTracker.start();

  autoTrackUnsubscribe = windowTracker.onWindowChange((info) => {
    handleWindowChange(info);
    broadcast('tracker:windowChange', info);
  });
}

function disableAutoTrack() {
  if (!autoTrackEnabled) return;
  autoTrackEnabled = false;
  if (autoTrackUnsubscribe) {
    autoTrackUnsubscribe();
    autoTrackUnsubscribe = null;
  }
  windowTracker.stop();
}

const SELF_NAMES = ['electron', 'time watcher', 'time-watcher'];

function isSelfWindow(info) {
  const title = (info.title || '').toLowerCase();
  const proc  = (info.processName || '').toLowerCase();
  return SELF_NAMES.some(s => proc.includes(s) || title.includes(s));
}

function handleWindowChange(info) {
  // 自アプリへの切り替えではタイマーを止めない
  if (isSelfWindow(info)) return;

  const activities = db.getActivities();
  const matchedActivityIds = new Set();
  const matchedPatternMap = {}; // activityId -> matched pattern string

  for (const activity of activities) {
    if (!activity.windowPatterns || activity.windowPatterns.length === 0) continue;
    for (const pattern of activity.windowPatterns) {
      try {
        const re = new RegExp(pattern, 'i');
        if (re.test(info.title) || re.test(info.processName)) {
          matchedActivityIds.add(activity.id);
          matchedPatternMap[activity.id] = pattern;
          break;
        }
      } catch {}
    }
  }

  // Start matched activities that aren't running
  for (const activityId of matchedActivityIds) {
    if (!activeTimers.has(activityId)) {
      const entry = db.startRecord({ activityId, mode: 'auto', windowTitle: info.title });
      activeTimers.set(activityId, { recordId: entry.id, startTime: new Date(entry.startTime), matchedPattern: matchedPatternMap[activityId] || null });
      broadcast('timer:autoStarted', { activityId, windowTitle: info.title });
      updateTrayMenu();
    }
  }

  // Stop auto-tracked activities that no longer match
  for (const [activityId, entry] of activeTimers) {
    if (!matchedActivityIds.has(activityId)) {
      // Check if this was auto-started
      const records = db.getRecordsForDate(db.todayStr());
      const rec = records.find(r => r.id === entry.recordId);
      if (rec && rec.mode === 'auto') {
        stopTimer(activityId);
        broadcast('timer:autoStopped', { activityId });
      }
    }
  }
}

// ── Idle Detection ────────────────────────────────────────────────────────────

function startIdleDetection() {
  if (idleDetector) return;
  const thresholdSeconds = (settings.idleThresholdMinutes || 3) * 60;

  idleDetector = new IdleDetector({
    idleThresholdSeconds: thresholdSeconds,
    onIdle: (idleSecs) => {
      // Pause all running timers
      for (const [activityId] of activeTimers) {
        idlePausedTimers.add(activityId);
        stopTimer(activityId);
      }
      broadcast('idle:started', { idleSeconds: idleSecs });
      updateTrayMenu();
    },
    onActive: (idleSecs) => {
      // Auto-resume timers that were paused by idle
      for (const activityId of idlePausedTimers) {
        startTimer(activityId);
      }
      const resumedCount = idlePausedTimers.size;
      idlePausedTimers.clear();
      broadcast('idle:ended', { resumedCount });
      updateTrayMenu();
    },
  });
  idleDetector.start();
}

function stopIdleDetection() {
  if (idleDetector) {
    idleDetector.stop();
    idleDetector = null;
  }
}

// ── Claude Code Hook Integration ──────────────────────────────────────────────

function startClaudeHookServer() {
  claudeHookServer.start();

  claudeHookServer.onEvent((payload) => {
    claudeSegment = payload.segment;
    broadcast('claude:hookEvent', payload);

    // Annotate the current Claude Code timer record with segment info
    // Find any running timer for a "Claude Code" activity
    const claudeActivities = db.getActivities().filter(a =>
      (a.windowPatterns || []).some(p => /claude|claude code/i.test(p))
    );
    for (const a of claudeActivities) {
      if (activeTimers.has(a.id)) {
        const { recordId } = activeTimers.get(a.id);
        try {
          if (!segmentAccum.has(a.id)) segmentAccum.set(a.id, { claudeSeconds: 0, userSeconds: 0 });
          const accum = segmentAccum.get(a.id);
          if (payload.prevSegment === 'claude' && payload.segmentDuration > 0) accum.claudeSeconds += payload.segmentDuration;
          else if (payload.prevSegment === 'user' && payload.segmentDuration > 0) accum.userSeconds += payload.segmentDuration;
          db.updateRecord(db.todayStr(), recordId, {
            claudeSegment: payload.segment,
            lastHookEvent: payload.event,
            claudeSeconds: accum.claudeSeconds,
            userSeconds: accum.userSeconds,
          });
        } catch {}
      }
    }
  });
}

/** Generate Claude Code hook config and the hook PowerShell script */
function generateClaudeHookConfig() {
  const hookScriptPath = path.join(app.getPath('userData'), 'claude-hook.ps1');
  const psScript = `# Claude Code → time-watcher-for-you hook
param([string]$Event, [string]$Tool = "")
$body = ConvertTo-Json @{ event = $Event; tool = $Tool; ts = (Get-Date -Format o) }
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:${claudeHookServer.getPort()}/hook" \`
    -Method Post -Body $body -ContentType "application/json" -TimeoutSec 2 | Out-Null
} catch {}
`;
  fs.writeFileSync(hookScriptPath, psScript, 'utf8');

  const hookCmd = (event) =>
    `powershell -NoProfile -NonInteractive -File "${hookScriptPath}" -Event "${event}"`;

  const claudeSettingsPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.claude', 'settings.json'
  );

  return { hookScriptPath, claudeSettingsPath, hookCmd };
}

// ── Broadcast helper ──────────────────────────────────────────────────────────

function broadcast(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, data);
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // DB
  ipcMain.handle('db:getActivities', () => db.getActivities());
  ipcMain.handle('db:createActivity', (_, data) => db.createActivity(data));
  ipcMain.handle('db:updateActivity', (_, id, updates) => db.updateActivity(id, updates));
  ipcMain.handle('db:deleteActivity', (_, id) => db.deleteActivity(id));
  ipcMain.handle('db:startRecord', (_, data) => db.startRecord(data));
  ipcMain.handle('db:stopRecord', (_, id) => db.stopRecord(id));
  ipcMain.handle('db:deleteRecord', (_, dateStr, recordId) => db.deleteRecord(dateStr, recordId));
  ipcMain.handle('db:updateRecord', (_, dateStr, recordId, updates) => db.updateRecord(dateStr, recordId, updates));
  ipcMain.handle('db:getDailySummary', (_, dateStr) => db.getDailySummary(dateStr));
  ipcMain.handle('db:getRangeSummary', (_, start, end) => db.getRangeSummary(start, end));
  ipcMain.handle('db:getRecordsForDate', (_, dateStr) => db.getRecordsForDate(dateStr));
  ipcMain.handle('db:getOpenRecords', () => db.getOpenRecords());
  ipcMain.handle('db:getWindowBreakdown', (_, dateStr) => db.getWindowBreakdown(dateStr));
  ipcMain.handle('db:getRecordsForRange', (_, start, end) => db.getRecordsForRange(start, end));
  ipcMain.handle('db:getClaudeSegmentBreakdown', (_, dateStr) => db.getClaudeSegmentBreakdown(dateStr));

  // Timers
  ipcMain.handle('timer:start', (_, activityId) => {
    startTimer(activityId);
    return buildTimerState();
  });
  ipcMain.handle('timer:stop', (_, activityId) => {
    stopTimer(activityId);
    return buildTimerState();
  });
  ipcMain.handle('timer:getActive', () => buildTimerState());

  // Auto-track
  ipcMain.handle('tracker:setEnabled', (_, enabled) => {
    if (enabled) enableAutoTrack();
    else disableAutoTrack();
    settings.autoTrack = enabled;
    saveSettings(settings);
    return { autoTrackEnabled };
  });
  ipcMain.handle('tracker:getState', () => ({
    enabled: autoTrackEnabled,
    currentWindow: windowTracker.getCurrent(),
  }));
  ipcMain.handle('tracker:linkWindow', (_, activityId, pattern) => {
    const activity = db.getActivities().find(a => a.id === activityId);
    if (!activity) throw new Error('Activity not found');
    const patterns = [...(activity.windowPatterns || [])];
    if (!patterns.includes(pattern)) patterns.push(pattern);
    return db.updateActivity(activityId, { windowPatterns: patterns });
  });
  ipcMain.handle('tracker:unlinkWindow', (_, activityId, pattern) => {
    const activity = db.getActivities().find(a => a.id === activityId);
    if (!activity) throw new Error('Activity not found');
    const patterns = (activity.windowPatterns || []).filter(p => p !== pattern);
    return db.updateActivity(activityId, { windowPatterns: patterns });
  });
  ipcMain.handle('tracker:getCurrentWindow', () => windowTracker.getCurrent());
  ipcMain.handle('tracker:getRecentWindows', () => windowTracker.getRecentWindows());

  // Idle detection
  ipcMain.handle('idle:setEnabled', (_, enabled) => {
    if (enabled) startIdleDetection();
    else stopIdleDetection();
    settings.idleDetection = enabled;
    saveSettings(settings);
    return { enabled };
  });
  ipcMain.handle('idle:setThreshold', (_, minutes) => {
    settings.idleThresholdMinutes = minutes;
    saveSettings(settings);
    if (idleDetector) idleDetector.setThreshold(minutes * 60);
    return { idleThresholdMinutes: minutes };
  });
  ipcMain.handle('idle:getState', () => ({
    enabled: !!idleDetector,
    isIdle: idleDetector ? idleDetector.getIsIdle() : false,
    idleSeconds: idleDetector ? idleDetector.getIdleSeconds() : 0,
    thresholdMinutes: settings.idleThresholdMinutes || 3,
  }));

  // Claude Code hooks
  ipcMain.handle('claude:getHookStatus', () => claudeHookServer.getStatus());
  ipcMain.handle('claude:generateHookConfig', () => {
    const result = generateClaudeHookConfig();
    return result;
  });
  ipcMain.handle('claude:applyHookConfig', () => {
    const { hookScriptPath, claudeSettingsPath, hookCmd } = generateClaudeHookConfig();

    // Read existing settings
    let existing = {};
    try {
      if (fs.existsSync(claudeSettingsPath)) {
        existing = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
      }
    } catch {}

    // Merge hooks
    const makeHook = (event) => ({
      matcher: '',
      hooks: [{ type: 'command', command: hookCmd(event) }],
    });

    existing.hooks = existing.hooks || {};
    existing.hooks.UserPromptSubmit = [makeHook('UserPromptSubmit')];
    existing.hooks.PreToolUse = [makeHook('PreToolUse')];
    existing.hooks.PostToolUse = [makeHook('PostToolUse')];
    existing.hooks.Stop = [makeHook('Stop')];

    fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
    fs.writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), 'utf8');

    return { ok: true, claudeSettingsPath, hookScriptPath };
  });
  ipcMain.handle('claude:getSegment', () => ({ segment: claudeSegment }));

  // Settings
  ipcMain.handle('settings:get', () => settings);

  // Data export
  ipcMain.handle('data:exportJSON', async () => {
    const { dialog } = require('electron');
    const { filePath } = await dialog.showSaveDialog({
      title: 'データをエクスポート',
      defaultPath: `time-watcher-export-${db.todayStr()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!filePath) return { cancelled: true };
    const payload = {
      exportedAt: new Date().toISOString(),
      activities: db.getActivities(),
      records: db.getRecordsForRange('2020-01-01', db.todayStr()),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath };
  });
  ipcMain.handle('settings:set', (_, s) => {
    saveSettings({ ...settings, ...s });
    if ('startWithLogin' in s) {
      app.setLoginItemSettings({ openAtLogin: !!s.startWithLogin });
    }
    if ('theme' in s) {
      broadcast('theme:changed', s.theme);
    }
    return settings;
  });

  // Window controls
  ipcMain.handle('window:minimizeToTray', () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
  ipcMain.handle('window:openMain', () => createMainWindow());
  ipcMain.handle('app:quit', () => app.quit());

  // Overlay resize
  ipcMain.handle('overlay:resize', (_, height) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setSize(290, Math.max(60, Math.min(400, height)));
    }
  });

  // Save overlay position
  ipcMain.handle('overlay:savePosition', (_, x, y) => {
    settings.overlayPosition = { x, y };
    saveSettings(settings);
  });

  // Overlay
  ipcMain.handle('overlay:getState', () => buildTimerState());
  ipcMain.handle('overlay:setAlwaysOnTop', (_, v) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(v, 'screen-saver');
    }
  });
}

// ── Single Instance Lock ──────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 2つ目の起動試行 → 既存のメインウィンドウを前面に出す
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // データディレクトリをuserDataに設定（パッケージ版対応）
  const userDataPath = path.join(app.getPath('userData'), 'data');
  db.setDataDir(userDataPath);
  settings = loadSettings();
  loadNotifiedGoals();

  registerIPC();
  createMainWindow();
  createOverlayWindow();
  createTray();
  startTickBroadcast();

  if (settings.autoTrack) enableAutoTrack();
  if (settings.idleDetection) startIdleDetection();

  // Always start Claude hook server (it handles port conflict gracefully)
  startClaudeHookServer();

  // Recover open records from previous session (crash recovery)
  const openRecords = db.getOpenRecords();
  for (const record of openRecords) {
    try { db.stopRecord(record.id); } catch {}
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  stopAllTimers();
  disableAutoTrack();
  stopIdleDetection();
  claudeHookServer.stop();
});
