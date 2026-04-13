/**
 * overlay-preload.js — Preload for the always-on-top overlay window
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  on: (channel, fn) => {
    const allowed = ['timer:tick', 'tracker:windowChange', 'overlay:update', 'theme:changed'];
    if (allowed.includes(channel)) {
      const handler = (_, ...args) => fn(...args);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  openMain: () => ipcRenderer.invoke('window:openMain'),
  startTimer: (activityId) => ipcRenderer.invoke('timer:start', activityId),
  stopTimer: (activityId) => ipcRenderer.invoke('timer:stop', activityId),
  getState: () => ipcRenderer.invoke('overlay:getState'),
  getCurrentWindow: () => ipcRenderer.invoke('tracker:getCurrentWindow'),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('overlay:setAlwaysOnTop', v),
  resize: (height) => ipcRenderer.invoke('overlay:resize', height),
  savePosition: (x, y) => ipcRenderer.invoke('overlay:savePosition', x, y),
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
