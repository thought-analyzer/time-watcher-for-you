# Time Watcher

**A PC activity time tracker — know exactly where your time goes.**

Track time across any activity: work, study, creative projects, coding sessions, or any app you use. Time Watcher runs quietly in the background with an always-on-top overlay, automatic window detection, and daily goal tracking.

Built as a companion tool to the [thought-analyzer](https://github.com/hapi_happy/thought-analyzer) project — with deep integration for measuring how you actually spend time with AI tools like Claude Code.

---

## What you can track

- **By activity** — Work, Study, Design, Reading, anything you define
- **By application** — link activities to specific apps or window titles for automatic tracking
- **With AI** — separate your thinking time from Claude's autonomous tool execution (Claude Code integration)

---

## Features

- Always-on-top overlay with live timers
- Auto Track — starts the right timer when you switch windows
- Daily goals (min / max) with progress bar and notifications
- Claude Code integration — measures user vs. AI autonomous time segments
- 5 themes: Void · Chalk · Forest · Ocean · Rose
- JSON data export
- Login auto-start
- Single-instance enforcement

---

## Installation

### Option A — Installer (recommended)

Download `Time Watcher Setup x.x.x.exe` from [Releases](../../releases) and run it.

### Option B — From source

```bash
git clone https://github.com/hapi_happy/time-watcher-for-you.git
cd time-watcher-for-you
npm install
npm start
```

Requires [Node.js](https://nodejs.org/) 18+.

---

## Claude Code Integration

Time Watcher tracks how time is split between your input and Claude's autonomous work.

### Setup

1. Create a **Claude Code** activity
2. Link the terminal window pattern (Settings → Setup Guide)
3. Enable Auto Track
4. Click **Apply Claude Hooks** — writes hook config to `~/.claude/settings.json`

### What gets measured

| Segment | Counted as |
|---|---|
| Your prompt → Claude's first action | User time |
| Claude running tools autonomously | AI time |

Hook events are received via a local HTTP server on port **27182** (loopback only).

---

## Data & Privacy

All data is stored locally. Nothing leaves your machine.

```
%APPDATA%\time-watcher-for-you\
  data\
    activities.json
    settings.json
    records\YYYY-MM-DD.json
```

---

## Building

```bash
npm run build
```

Outputs a Windows NSIS installer to `dist/`.

---

## License

MIT © saifo
