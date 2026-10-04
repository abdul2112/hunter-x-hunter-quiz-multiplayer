'use strict';
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const questions = require('./questions.cjs');

const PORT = Number(process.env.PORT || 3000);
const ROUND_MS = 10_000;
const REVEAL_MS = 3_200;
const NEXT_MS = 1_800;
const ROOM_IDLE_MS = 30 * 60_000;
const MAX_ROOMS = 500;
const rooms = new Map();
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 2048, perMessageDeflate: false });
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const emit = (room, data) => room.players.forEach(p => send(p.ws, data));
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function makeCode() { let code; do { code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code)); return code; }
function stop(room) { clearTimeout(room.timer); room.timer = null; }
function publicPlayers(room) { return room.players.map(p => ({ id: p.id, name: p.name, score: p.score, correct: p.correct, connected: !!p.ws && p.ws.readyState === WebSocket.OPEN, ready: p.ready })); }
function snapshot(room, player) {
  send(player.ws, { type: 'snapshot', code: room.code, you: player.id, phase: room.phase, players: publicPlayers(room), question: room.phase === 'question' ? currentQuestion(room) : null, revealed: room.phase === 'reveal' ? room.revealed : null });
}
function currentQuestion(room) {
  const q = room.pool[room.index];
  return { index: room.index, total: room.pool.length, id: room.questionId, text: q.q, options: q.a, startedAt: room.startedAt, endsAt: room.endsAt, serverNow: Date.now(), double: room.index === 9 };
}
function broadcastLobby(room) { emit(room, { type: 'lobby', code: room.code, players: publicPlayers(room) }); }
function startRound(room) {
  stop(room);
  if (room.index >= 10) { finish(room); return; }
  room.phase = 'question'; room.questionId++;
  room.answers.clear(); room.startedAt = Date.now(); room.endsAt = room.startedAt + ROUND_MS;
  emit(room, { type: 'question', question: currentQuestion(room), players: publicPlayers(room) });
  room.timer = setTimeout(() => reveal(room), ROUND_MS + 40);
}
function startGame(room) {
  if (room.players.length !== 2 || room.players.some(p => !p.ready || !p.ws)) return;
  stop(room); room.phase = 'starting'; room.pool = shuffle(questions).slice(0, 10);
  room.index = 0; room.players.forEach(p => { p.score = 0; p.correct = 0; p.ready = false; });
  emit(room, { type: 'starting', players: publicPlayers(room) });
  room.timer = setTimeout(() => startRound(room), NEXT_MS);
}
function reveal(room) {
  if (room.phase !== 'question') return;
  stop(room); room.phase = 'reveal';
  const q = room.pool[room.index];
  const selections = room.players.map(p => {
    const answer = room.answers.get(p.id);
    const correct = answer?.choice === q.correct;
    const remaining = answer ? Math.max(0, ROUND_MS - Math.max(0, answer.at - room.startedAt)) : 0;
    const points = correct ? Math.max(2, Math.min(20, Math.ceil(20 * remaining / ROUND_MS))) * (room.index === 9 ? 2 : 1) : 0;
    p.score += points; if (correct) p.correct++;
    return { id: p.id, choice: answer?.choice ?? null, points };
  });
  room.revealed = { questionId: room.questionId, index: room.index, correct: q.correct, why: q.why, selections, players: publicPlayers(room) };
  emit(room, { type: 'reveal', ...room.revealed });
  room.timer = setTimeout(() => { room.index++; startRound(room); }, REVEAL_MS);
}
function finish(room) { stop(room); room.phase = 'finished'; emit(room, { type: 'finished', players: publicPlayers(room) }); }
function leave(ws) {
  const player = ws.player; if (!player) return;
  const room = rooms.get(ws.roomCode);
  ws.player = null; ws.roomCode = null;
  if (!room || player.ws !== ws) return;
  player.ws = null; player.ready = false; room.touchedAt = Date.now();
  if (room.phase === 'question' || room.phase === 'reveal' || room.phase === 'starting') {
    stop(room); room.phase = 'lobby'; room.revealed = null;
    emit(room, { type: 'paused', reason: 'Opponent disconnected. Waiting for reconnection.', players: publicPlayers(room) });
  }
  broadcastLobby(room);
}
function validName(name) { return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 20 && !/[<>\r\n]/.test(name); }
function join(ws, room, name, token) {
  if (ws.player) return send(ws, { type: 'error', message: 'Leave your current room first.' });
  let player = room.players.find(p => token && p.token === token);
  if (player) {
    if (player.ws && player.ws !== ws) { send(player.ws, { type: 'error', message: 'You joined from another tab.' }); player.ws.player = null; player.ws.close(); }
    player.ws = ws;
  } else {
    if (room.players.length >= 2) return send(ws, { type: 'error', message: 'This room is full.' });
    if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'This match has already started.' });
    if (!validName(name)) return send(ws, { type: 'error', message: 'Enter a nickname (1–20 characters).' });
    player = { id: crypto.randomUUID(), token: crypto.randomBytes(24).toString('hex'), name: name.trim(), ws, score: 0, correct: 0, ready: false };
    room.players.push(player);
  }
  ws.player = player; ws.roomCode = room.code; room.touchedAt = Date.now();
  send(ws, { type: 'joined', code: room.code, token: player.token, you: player.id });
  snapshot(room, player); broadcastLobby(room);
}
wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'create') {
      if (ws.player) return send(ws, { type: 'error', message: 'Already in a room.' });
      if (!validName(msg.name)) return send(ws, { type: 'error', message: 'Enter a nickname (1–20 characters).' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', message: 'Server is busy. Try again later.' });
      const room = { code: makeCode(), players: [], phase: 'lobby', answers: new Map(), index: 0, questionId: 0, pool: [], timer: null, revealed: null, touchedAt: Date.now() };
      rooms.set(room.code, room); join(ws, room, msg.name); return;
    }
    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().trim(); const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Room not found or expired.' });
      join(ws, room, msg.name, msg.token); return;
    }
    const player = ws.player; const room = rooms.get(ws.roomCode);
    if (!player || !room || player.ws !== ws) return;
    room.touchedAt = Date.now();
    if (msg.type === 'leave') { leave(ws); return; }
    if (msg.type === 'ready' && (room.phase === 'lobby' || room.phase === 'finished')) {
      if (room.players.length !== 2 || room.players.some(p => !p.ws)) return;
      if (room.phase === 'finished') { room.phase = 'lobby'; room.players.forEach(p => p.ready = false); }
      player.ready = true; broadcastLobby(room);
      if (room.players.every(p => p.ready)) startGame(room);
      return;
    }
    if (msg.type === 'answer' && room.phase === 'question' && msg.questionId === room.questionId && !room.answers.has(player.id) && Number.isInteger(msg.choice) && msg.choice >= 0 && msg.choice < 4 && Date.now() < room.endsAt) {
      room.answers.set(player.id, { choice: msg.choice, at: Date.now() });
      send(ws, { type: 'ack', questionId: room.questionId, choice: msg.choice });
      emit(room, { type: 'answered', id: player.id, questionId: room.questionId });
      if (room.answers.size === 2) reveal(room);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touchedAt > ROOM_IDLE_MS && room.players.every(p => !p.ws)) { stop(room); rooms.delete(code); }
  }
}, 60_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Hunter Quiz listening on http://localhost:${PORT}`));
