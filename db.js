/**
 * db.js — JSON file-based data access layer
 * No native dependencies. Data stored in /data directory.
 */

const fs = require('fs');
const path = require('path');

let DATA_DIR = path.join(__dirname, 'data');
let ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');

function setDataDir(dir) {
  DATA_DIR = dir;
  ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getRecordsFile(dateStr) {
  const recordsDir = path.join(DATA_DIR, 'records');
  ensureDir(recordsDir);
  return path.join(recordsDir, `${dateStr}.json`);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Activities ──────────────────────────────────────────────────────────────

function getActivities() {
  ensureDir(DATA_DIR);
  return readJSON(ACTIVITIES_FILE, []);
}

function saveActivities(activities) {
  writeJSON(ACTIVITIES_FILE, activities);
}

function createActivity({ name, color = '#4CAF50', goalMinutes = 0, goalType = 'none', windowPatterns = [] }) {
  const activities = getActivities();
  const id = Date.now().toString();
  const activity = { id, name, color, goalMinutes, goalType, windowPatterns, createdAt: new Date().toISOString() };
  activities.push(activity);
  saveActivities(activities);
  return activity;
}

function updateActivity(id, updates) {
  const activities = getActivities();
  const idx = activities.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Activity not found');
  activities[idx] = { ...activities[idx], ...updates };
  saveActivities(activities);
  return activities[idx];
}

function deleteActivity(id) {
  const activities = getActivities().filter(a => a.id !== id);
  saveActivities(activities);
}

// ── Time Records ────────────────────────────────────────────────────────────

function getRecordsForDate(dateStr) {
  return readJSON(getRecordsFile(dateStr), []);
}

function saveRecordsForDate(dateStr, records) {
  writeJSON(getRecordsFile(dateStr), records);
}

function startRecord({ activityId, mode = 'manual', windowTitle = null }) {
  const dateStr = todayStr();
  const records = getRecordsForDate(dateStr);
  const id = Date.now().toString();
  const record = {
    id,
    activityId,
    date: dateStr,
    startTime: new Date().toISOString(),
    endTime: null,
    durationSeconds: 0,
    mode,
    windowTitle,
  };
  records.push(record);
  saveRecordsForDate(dateStr, records);
  return record;
}

function stopRecord(recordId) {
  const dateStr = todayStr();
  const records = getRecordsForDate(dateStr);
  const idx = records.findIndex(r => r.id === recordId);
  if (idx === -1) throw new Error('Record not found');
  const record = records[idx];
  const endTime = new Date();
  const durationSeconds = Math.floor((endTime - new Date(record.startTime)) / 1000);
  records[idx] = { ...record, endTime: endTime.toISOString(), durationSeconds };
  saveRecordsForDate(dateStr, records);
  return records[idx];
}

function updateRecord(dateStr, recordId, updates) {
  const records = getRecordsForDate(dateStr);
  const idx = records.findIndex(r => r.id === recordId);
  if (idx === -1) throw new Error('Record not found');
  records[idx] = { ...records[idx], ...updates };
  saveRecordsForDate(dateStr, records);
  return records[idx];
}

/** Get total seconds per activity for a specific date */
function getDailySummary(dateStr) {
  const records = getRecordsForDate(dateStr);
  const summary = {}; // activityId -> totalSeconds
  for (const r of records) {
    if (!summary[r.activityId]) summary[r.activityId] = 0;
    if (r.endTime) {
      summary[r.activityId] += r.durationSeconds;
    } else {
      // Still running
      const elapsed = Math.floor((Date.now() - new Date(r.startTime)) / 1000);
      summary[r.activityId] += elapsed;
    }
  }
  return summary;
}

/** Get summaries for a date range */
function getRangeSummary(startDateStr, endDateStr) {
  const results = []; // [{date, activityId, totalSeconds}]
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const cur = new Date(start);
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    const summary = getDailySummary(dateStr);
    for (const [activityId, totalSeconds] of Object.entries(summary)) {
      results.push({ date: dateStr, activityId, totalSeconds });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

/** Get window title breakdown for a date: { windowTitle: totalSeconds } */
function getWindowBreakdown(dateStr) {
  const records = getRecordsForDate(dateStr);
  const breakdown = {};
  for (const r of records) {
    const title = r.windowTitle || '(不明)';
    if (!breakdown[title]) breakdown[title] = 0;
    if (r.endTime) {
      breakdown[title] += r.durationSeconds;
    } else {
      breakdown[title] += Math.floor((Date.now() - new Date(r.startTime)) / 1000);
    }
  }
  return breakdown;
}

/** Get all raw records for a date range (flat array) */
function getRecordsForRange(startDateStr, endDateStr) {
  const results = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const cur = new Date(start);
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    results.push(...getRecordsForDate(dateStr));
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

/** Get Claude segment breakdown for a date: { activityId: { claudeSeconds, userSeconds } } */
function getClaudeSegmentBreakdown(dateStr) {
  const records = getRecordsForDate(dateStr);
  const result = {};
  for (const r of records) {
    if (!r.claudeSeconds && !r.userSeconds) continue;
    if (!result[r.activityId]) result[r.activityId] = { claudeSeconds: 0, userSeconds: 0 };
    result[r.activityId].claudeSeconds += r.claudeSeconds || 0;
    result[r.activityId].userSeconds += r.userSeconds || 0;
  }
  return result;
}

/** Get open (not stopped) records for today */
function getOpenRecords() {
  const dateStr = todayStr();
  const records = getRecordsForDate(dateStr);
  return records.filter(r => !r.endTime);
}

module.exports = {
  setDataDir,
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  startRecord,
  stopRecord,
  updateRecord,
  getRecordsForDate,
  getRecordsForRange,
  getDailySummary,
  getRangeSummary,
  getOpenRecords,
  getWindowBreakdown,
  getClaudeSegmentBreakdown,
  todayStr,
};
