/**
 * claude-hook-server.js — Local HTTP server receiving Claude Code hook events
 * Listens on port 27182. Claude Code hooks POST events here.
 *
 * Hook events tracked:
 *   UserPromptSubmit  → user is typing/submitted
 *   PreToolUse        → Claude autonomous execution starts
 *   PostToolUse       → tool finished
 *   Stop              → Claude finished responding
 */

const http = require('http');

const PORT = 27182;

class ClaudeHookServer {
  constructor() {
    this.server = null;
    this.listeners = [];
    this.lastEvent = null;
    // Segment tracking: 'user' | 'claude' | null
    this.currentSegment = null;
    this.segmentStart = null;
  }

  start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404);
        res.end();
        return;
      }

      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          this._handleEvent(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400);
          res.end();
        }
      });
    });

    this.server.listen(PORT, '127.0.0.1', () => {
      console.log(`[claude-hook-server] Listening on port ${PORT}`);
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('[claude-hook-server] Port already in use, skipping');
      }
    });
  }

  stop() {
    if (this.server) { this.server.close(); this.server = null; }
  }

  _handleEvent(data) {
    const { event, tool, session_id, transcript_path } = data;
    const now = new Date();
    this.lastEvent = { event, tool, ts: now };

    let segment = null;
    if (event === 'UserPromptSubmit') {
      segment = 'user';
    } else if (event === 'PreToolUse') {
      segment = 'claude';
    } else if (event === 'PostToolUse') {
      segment = 'claude'; // still in claude turn
    } else if (event === 'Stop') {
      segment = 'user'; // user's turn to review
    }

    if (segment && segment !== this.currentSegment) {
      const prev = this.currentSegment;
      const prevStart = this.segmentStart;
      this.currentSegment = segment;
      this.segmentStart = now;

      const segmentDuration = prevStart ? Math.floor((now - prevStart) / 1000) : 0;
      const payload = { event, segment, prevSegment: prev, segmentDuration, tool, ts: now.toISOString() };

      for (const fn of this.listeners) {
        try { fn(payload); } catch {}
      }
    } else {
      // Same segment, still emit for tool tracking
      const payload = { event, segment: this.currentSegment, tool, ts: now.toISOString() };
      for (const fn of this.listeners) {
        try { fn(payload); } catch {}
      }
    }
  }

  onEvent(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  getStatus() {
    return {
      running: !!this.server,
      port: PORT,
      currentSegment: this.currentSegment,
      lastEvent: this.lastEvent,
    };
  }

  getPort() { return PORT; }
}

module.exports = new ClaudeHookServer();
