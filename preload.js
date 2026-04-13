/**
 * preload.js — Expose safe IPC API to renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Activities
  getActivities: () => ipcRenderer.invoke('db:getActivities'),
  createActivity: (data) => ipcRenderer.invoke('db:createActivity', data),
  updateActivity: (id, updates) => ipcRenderer.invoke('db:updateActivity', id, updates),
  deleteActivity: (id) => ipcRenderer.invoke('db:deleteActivity', id),

  // Records
  startRecord: (data) => ipcRenderer.invoke('db:startRecord', data),
  stopRecord: (id) => ipcRenderer.invoke('db:stopRecord', id),
  getDailySummary: (dateStr) => ipcRenderer.invoke('db:getDailySummary', dateStr),
  getRangeSummary: (start, end) => ipcRenderer.invoke('db:getRangeSummary', start, end),
  getRecordsForDate: (dateStr) => ipcRenderer.invoke('db:getRecordsForDate', dateStr),
  getRecordsForRange: (start, end) => ipcRenderer.invoke('db:getRecordsForRange', start, end),
  getOpenRecords: () => ipcRenderer.invoke('db:getOpenRecords'),
  deleteRecord: (dateStr, recordId) => ipcRenderer.invoke('db:deleteRecord', dateStr, recordId),
  updateRecord: (dateStr, recordId, updates) => ipcRenderer.invoke('db:updateRecord', dateStr, recordId, updates),
  getWindowBreakdown: (dateStr) => ipcRenderer.invoke('db:getWindowBreakdown', dateStr),
  getClaudeSegmentBreakdown: (dateStr) => ipcRenderer.invoke('db:getClaudeSegmentBreakdown', dateStr),

  // Timer state (active sessions in main process)
  getActiveTimers: () => ipcRenderer.invoke('timer:getActive'),
  stopTimer: (activityId) => ipcRenderer.invoke('timer:stop', activityId),
  startTimer: (activityId) => ipcRenderer.invoke('timer:start', activityId),

  // Auto-track
  setAutoTrack: (enabled) => ipcRenderer.invoke('tracker:setEnabled', enabled),
  getAutoTrackState: () => ipcRenderer.invoke('tracker:getState'),
  linkActivityToWindow: (activityId, pattern) => ipcRenderer.invoke('tracker:linkWindow', activityId, pattern),
  unlinkActivityFromWindow: (activityId, pattern) => ipcRenderer.invoke('tracker:unlinkWindow', activityId, pattern),
  getCurrentWindow: () => ipcRenderer.invoke('tracker:getCurrentWindow'),
  getRecentWindows: () => ipcRenderer.invoke('tracker:getRecentWindows'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),

  // Window controls
  minimizeToTray: () => ipcRenderer.invoke('window:minimizeToTray'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  openMainWindow: () => ipcRenderer.invoke('window:openMain'),

  // Idle detection
  setIdleEnabled: (enabled) => ipcRenderer.invoke('idle:setEnabled', enabled),
  setIdleThreshold: (minutes) => ipcRenderer.invoke('idle:setThreshold', minutes),
  getIdleState: () => ipcRenderer.invoke('idle:getState'),

  // Data export
  exportJSON: () => ipcRenderer.invoke('data:exportJSON'),

  // Claude Code hooks
  getClaudeHookStatus: () => ipcRenderer.invoke('claude:getHookStatus'),
  generateClaudeHookConfig: () => ipcRenderer.invoke('claude:generateHookConfig'),
  applyClaudeHookConfig: () => ipcRenderer.invoke('claude:applyHookConfig'),
  getClaudeSegment: () => ipcRenderer.invoke('claude:getSegment'),

  // Events from main
  on: (channel, fn) => {
    const channels = [
      'timer:tick', 'tracker:windowChange', 'timer:autoStarted', 'timer:autoStopped',
      'idle:started', 'idle:ended', 'claude:hookEvent',
    ];
    if (channels.includes(channel)) {
      const handler = (_, ...args) => fn(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
});
