'use strict';
const $ = id => document.getElementById(id);
let socket, roomCode = '', token = '', me = '', players = [], phase = 'home', question = null, choice = null, locked = false, clockFrame = 0, clockOffset = 0, soundsOn = false, audioContext = null, reconnectTimer = null, deliberateLeave = false;
const params = new URLSearchParams(location.search);
const storedName = localStorage.getItem('hunter_name') || '';
$('nickname').value = storedName;
$('roomCode').value = (params.get('room') || '').toUpperCase().slice(0, 6);
const show = screen => { ['home', 'game', 'result'].forEach(id => $(id).classList.toggle('hide', id !== screen)); phase = screen; };
const say = message => { $('homeError').textContent = message || ''; };
function beep(freq = 550) { if (!soundsOn) return; try { audioContext ??= new (window.AudioContext || window.webkitAudioContext)(); const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.frequency.value = freq; gain.gain.setValueAtTime(.025, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .09); osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + .09); } catch {} }
function connect(onOpen) {
  if (socket && socket.readyState === WebSocket.OPEN) return onOpen();
  if (socket && socket.readyState === WebSocket.CONNECTING) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onopen = () => { clearTimeout(reconnectTimer); onOpen(); };
  socket.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  socket.onclose = () => {
    cancelAnimationFrame(clockFrame);
    if (deliberateLeave) return;
    if (roomCode && token) {
      $('status').textContent = 'Connection lost. Reconnecting…'; say('Connection lost. Reconnecting…');
      reconnectTimer = setTimeout(() => connect(() => send({ type: 'join', code: roomCode, token, name: name() })), 1400);
    } else say('Connection lost. Please try again.');
  };
}
const send = data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
const name = () => $('nickname').value.trim();
function begin(mode) {
  if (!name()) return say('Enter your nickname first.');
  localStorage.setItem('hunter_name', name()); say(''); deliberateLeave = false;
  connect(() => send(mode === 'create' ? { type: 'create', name: name() } : { type: 'join', code: $('roomCode').value.trim().toUpperCase(), name: name() }));
}
function self() { return players.find(p => p.id === me); }
function rival() { return players.find(p => p.id !== me); }
function updateNames() {
  const you = self(), them = rival();
  document.querySelector('.competitor .name').textContent = you?.name || 'You';
  document.querySelector('.competitor.right .name').textContent = them?.name || 'Waiting…';
  document.querySelector('.competitor .face').textContent = (you?.name || 'Y')[0].toUpperCase();
  document.querySelector('.competitor.right .face').textContent = (them?.name || 'R')[0].toUpperCase();
  document.querySelector('.competitor.right .subtitle').textContent = them?.connected ? 'Online opponent' : 'Disconnected';
  $('myScore').textContent = you?.score ?? 0; $('rivalScore').textContent = them?.score ?? 0;
  $('myRail').style.height = `${Math.min(100, (you?.score || 0) / 220 * 100)}%`;
  $('rivalRail').style.height = `${Math.min(100, (them?.score || 0) / 220 * 100)}%`;
}
function lobby() {
  show('home'); $('lobby').classList.remove('hide'); $('lobbyCode').textContent = roomCode;
  const other = rival(), you = self();
  $('lobbyState').textContent = other ? `${you?.name || 'You'} ${you?.ready ? '✓ ready' : '— not ready'} · ${other.name} ${other.ready ? '✓ ready' : other.connected ? '— not ready' : '— offline'}` : 'Waiting for your friend to join…';
  $('ready').disabled = !other?.connected || !!you?.ready;
  $('ready').textContent = you?.ready ? 'Waiting for opponent…' : 'Ready to play';
  $('start').disabled = true; $('join').disabled = true;
}
function progress(index) {
  $('progress').replaceChildren(); for (let i = 0; i < 10; i++) { const el = document.createElement('span'); el.className = i < index ? 'done' : i === index ? 'current' : ''; $('progress').appendChild(el); }
}
function renderQuestion(q) {
  cancelAnimationFrame(clockFrame); question = q; choice = null; locked = false; show('game');
  $('review').classList.add('hide'); $('autoNext').textContent = '';
  $('status').textContent = 'Choose your answer!'; $('myPlus').textContent = ''; $('rivalPlus').textContent = '';
  $('round').textContent = `QUESTION ${q.index + 1} OF 10`;
  $('bonus').textContent = q.double ? '⚡ FINAL ROUND · DOUBLE POINTS' : '';
  $('question').textContent = q.text; progress(q.index); updateNames();
  const options = $('options'); options.replaceChildren();
  q.options.forEach((label, i) => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'answer'; btn.dataset.index = i;
    const title = document.createElement('span'); title.className = 'answer-label'; title.textContent = label;
    const badges = document.createElement('span'); badges.className = 'choice-indicators';
    btn.append(title, badges); btn.addEventListener('click', () => answer(i)); options.appendChild(btn);
  });
  // Correct for differences between the server clock and this device's clock.
  clockOffset = q.serverNow - Date.now(); tick();
}
function tick() {
  if (phase !== 'game' || !question || locked) return;
  const left = Math.max(0, question.endsAt - (Date.now() + clockOffset));
  $('time').textContent = String(Math.ceil(left / 1000));
  $('clock').style.setProperty('--angle', `${left / 10000 * 360}deg`);
  $('clock').classList.toggle('urgent', left <= 3000);
  if (left <= 0) { $('options').querySelectorAll('button').forEach(btn => btn.disabled = true); $('status').textContent = 'Time is up! Waiting for results…'; return; }
  clockFrame = requestAnimationFrame(tick);
}
function badge(parent, kind, correct) {
  const el = document.createElement('span'); el.className = `pick-badge ${kind}`;
  const label = document.createElement('span'); label.textContent = kind === 'you' ? 'YOU' : 'RIVAL';
  const symbol = document.createElement('span'); symbol.className = 'pick-symbol'; symbol.textContent = correct === null ? '·' : correct ? '✓' : '×';
  el.append(label, symbol); parent.appendChild(el);
}
function answer(index) {
  if (locked || choice !== null || !question || Date.now() + clockOffset >= question.endsAt) return;
  choice = index; send({ type: 'answer', questionId: question.id, choice: index });
  $('options').querySelectorAll('button').forEach(btn => { btn.disabled = true; if (Number(btn.dataset.index) === index) { btn.classList.add('mine-pending'); badge(btn.querySelector('.choice-indicators'), 'you', null); } });
  $('status').textContent = 'Answer sent! Waiting for your rival…'; beep(600);
}
function reveal(msg) {
  if (!question || msg.questionId !== question.id) return;
  cancelAnimationFrame(clockFrame); locked = true; players = msg.players;
  const mine = msg.selections.find(p => p.id === me), theirs = msg.selections.find(p => p.id !== me);
  $('myPlus').textContent = `+${mine?.points || 0}`; $('rivalPlus').textContent = `+${theirs?.points || 0}`;
  updateNames();
  $('options').querySelectorAll('button').forEach(btn => {
    btn.disabled = true; btn.classList.remove('mine-pending');
    const index = Number(btn.dataset.index);
    if (index === msg.correct) btn.classList.add('correct');
    else if (index === mine?.choice || index === theirs?.choice) btn.classList.add('wrong');
    const markers = btn.querySelector('.choice-indicators'); markers.replaceChildren();
    if (index === mine?.choice) badge(markers, 'you', index === msg.correct);
    if (index === theirs?.choice) badge(markers, 'them', index === msg.correct);
  });
  $('status').textContent = mine?.choice === null ? '⏰ Time is up.' : mine?.points ? '✓ Correct!' : 'Not quite.';
  $('reviewNote').replaceChildren(); const title = document.createElement('strong'); title.textContent = `Answer: ${question.options[msg.correct]}. `;
  $('reviewNote').append(title, msg.why);
  $('next').classList.add('hide'); $('review').classList.remove('hide');
  $('autoNext').textContent = msg.index === 9 ? 'Results next…' : 'Next question soon…'; beep(mine?.points ? 800 : 320);
}
function results() {
  cancelAnimationFrame(clockFrame); show('result'); const you = self(), them = rival();
  $('finalMine').textContent = you?.score ?? 0; $('finalRival').textContent = them?.score ?? 0;
  $('myAccuracy').textContent = `${you?.correct ?? 0}/10`; $('rivalAccuracy').textContent = `${them?.correct ?? 0}/10`;
  document.querySelector('.versus-result .rname').textContent = you?.name || 'You';
  document.querySelector('.opponent-result .rname').textContent = them?.name || 'Rival';
  const outcome = (you?.score || 0) - (them?.score || 0);
  $('endIcon').textContent = outcome > 0 ? '🏆' : outcome < 0 ? '🎯' : '🤝';
  $('headline').textContent = outcome > 0 ? 'You win!' : outcome < 0 ? `${them?.name || 'Rival'} wins!` : 'It’s a draw!';
  $('resultSub').textContent = 'Great match! Both players can select rematch to play again.';
  const prev = Number(localStorage.getItem('hunter_best') || -1);
  if ((you?.score || 0) > prev) localStorage.setItem('hunter_best', String(you.score));
  $('homeBest').textContent = localStorage.getItem('hunter_best') || '—';
}
function handle(msg) {
  if (msg.type === 'error') { say(msg.message); $('status').textContent = msg.message; return; }
  if (msg.type === 'joined') { roomCode = msg.code; token = msg.token; me = msg.you; sessionStorage.setItem('hunter_session', JSON.stringify({ roomCode, token })); history.replaceState(null, '', `?room=${roomCode}`); say(''); }
  if (msg.type === 'snapshot') {
    roomCode = msg.code; me = msg.you; players = msg.players;
    if (msg.phase === 'question' && msg.question) renderQuestion(msg.question);
    else if (msg.phase === 'reveal' && msg.revealed) {
      $('status').textContent = 'Reconnected. Waiting for next round…'; show('game');
    } else if (msg.phase === 'finished') results(); else lobby();
  }
  if (msg.type === 'lobby') { players = msg.players; if (phase === 'home' || phase === 'result') lobby(); else updateNames(); }
  if (msg.type === 'starting') { players = msg.players; show('game'); $('status').textContent = 'Both players ready! Starting match…'; }
  if (msg.type === 'question') { players = msg.players; renderQuestion(msg.question); }
  if (msg.type === 'answered' && msg.id !== me && msg.questionId === question?.id && !locked) $('status').textContent = choice === null ? 'Your rival has answered!' : 'Both players have answered!';
  if (msg.type === 'reveal') reveal(msg);
  if (msg.type === 'finished') { players = msg.players; results(); }
  if (msg.type === 'paused') { players = msg.players; $('status').textContent = msg.reason; lobby(); say(msg.reason); }
}
function exitRoom() {
  deliberateLeave = true; send({ type: 'leave' }); socket?.close(); socket = null; roomCode = ''; token = ''; me = ''; players = []; question = null; cancelAnimationFrame(clockFrame);
  sessionStorage.removeItem('hunter_session'); history.replaceState(null, '', location.pathname); $('lobby').classList.add('hide'); $('start').disabled = false; $('join').disabled = false; say(''); show('home');
}
$('start').addEventListener('click', () => begin('create'));
$('join').addEventListener('click', () => begin('join'));
$('ready').addEventListener('click', () => send({ type: 'ready' }));
$('rematch').addEventListener('click', () => { lobby(); send({ type: 'ready' }); });
$('back').addEventListener('click', exitRoom); $('exit').addEventListener('click', exitRoom);
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${roomCode}`); $('copy').textContent = '✓ Link copied'; } catch { $('copy').textContent = `${location.origin}/?room=${roomCode}`; } });
$('sound').addEventListener('click', () => { soundsOn = !soundsOn; $('sound').textContent = soundsOn ? '♫ ON' : '♪ OFF'; $('sound').setAttribute('aria-pressed', String(soundsOn)); if (soundsOn) beep(660); });
$('homeBest').textContent = localStorage.getItem('hunter_best') || '—';
try { const session = JSON.parse(sessionStorage.getItem('hunter_session') || 'null'); if (session?.roomCode && session?.token) { roomCode = session.roomCode; token = session.token; connect(() => send({ type: 'join', code: roomCode, token, name: name() })); } } catch {}
