// ============================================================
//  DEFC Voice — Signalling Server
//  The ONE piece that can't run on Vercel (needs a live connection).
//  Deploy on Render / Railway / Fly.io / any cheap always-on host.
//
//  What it does: introduces two browsers to each other so they can
//  open a direct peer-to-peer WebRTC voice call. It NEVER sees or
//  carries the audio — audio goes browser-to-browser. This only
//  passes the tiny "handshake" messages (offer/answer/ICE) and
//  routes them by the user's 4-digit DEFC ID.
//
//  DEPLOY:
//    1. New project on Render/Railway, Node service.
//    2. Upload this file as server.js + the package.json below.
//    3. Run:  npm install && node server.js
//    4. It listens on process.env.PORT (host sets this automatically).
//    5. Note the public URL (e.g. wss://defc-voice.onrender.com) —
//       you put that URL into the call page (SIGNAL_URL).
//
//  package.json:
//    { "name": "defc-voice-signal", "version": "1.0.0",
//      "type": "commonjs", "main": "server.js",
//      "dependencies": { "ws": "^8.18.0" } }
// ============================================================

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

// Map of 4-digit DEFC ID -> live socket. One active socket per ID.
const online = new Map();

const server = http.createServer((req, res) => {
    // Simple health check so the host knows the service is alive.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('DEFC Voice signalling server is running.');
});

const wss = new WebSocketServer({ server });

function send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
    ws.defcId = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // 1. Register: browser says "I am ID 1234, I'm online".
        if (msg.type === 'register' && msg.id) {
            ws.defcId = String(msg.id);
            online.set(ws.defcId, ws);
            send(ws, { type: 'registered', id: ws.defcId });
            return;
        }

        // 2. Check if someone is online/callable.
        if (msg.type === 'check' && msg.targetId) {
            send(ws, { type: 'presence', id: String(msg.targetId), online: online.has(String(msg.targetId)) });
            return;
        }

        // 3. Relay signalling to a specific target by ID.
        //    Covers: call-request, call-accept, call-reject, offer, answer, ice, hangup.
        if (msg.targetId) {
            const target = online.get(String(msg.targetId));
            if (target) {
                send(target, { ...msg, fromId: ws.defcId });
            } else {
                send(ws, { type: 'unavailable', targetId: String(msg.targetId) });
            }
            return;
        }
    });

    ws.on('close', () => {
        if (ws.defcId && online.get(ws.defcId) === ws) {
            online.delete(ws.defcId);
            // Tell anyone we don't bother — peers detect drop via WebRTC + hangup.
        }
    });
});

server.listen(PORT, () => {
    console.log('DEFC Voice signalling server listening on port ' + PORT);
});
