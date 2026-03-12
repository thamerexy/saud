// ════════════════════════════════════════════
// SUPABASE CONFIG
// ════════════════════════════════════════════
const SUPABASE_URL = 'https://afezmnrtjgndluzmtcpv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZXptbnJ0amduZGx1em10Y3B2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE0MDAsImV4cCI6MjA4ODYxNzQwMH0.gkzCRasUCa-2WAwif_K0eaG5yEasbfdn6aQnBnPD8fg';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ════════════════════════════════════════════
// GAME STATE
// ════════════════════════════════════════════
const G = {
  allPlayers: [],
  allQuestions: [],
  selectedPlayers: [],   // chosen before game starts
  usedQIds: new Set(),   // used question IDs this game
  currentRound: 1,
  activePlayers: [],     // not yet asked this round (on wheel)
  qualifiedPlayers: [],  // answered correctly this round
  currentPlayer: null,
  currentQuestion: null,
  suddenDeathPlayers: [],
  winner: null,
  wheel: null,
  confetti: null,
  audioCtx: null,
};

// ════════════════════════════════════════════
// AUDIO (Web Audio API — no files needed)
// ════════════════════════════════════════════
function initAudio() {
  if (G.audioCtx) return;
  G.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(freq, type, duration, delay = 0, volume = 0.25) {
  if (!G.audioCtx) return;
  const osc = G.audioCtx.createOscillator();
  const gain = G.audioCtx.createGain();
  osc.connect(gain); gain.connect(G.audioCtx.destination);
  osc.type = type; osc.frequency.value = freq;
  const t = G.audioCtx.currentTime + delay;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t); osc.stop(t + duration);
}

function soundSpin() {
  if (!G.audioCtx) return;
  const buf = G.audioCtx.createBuffer(1, G.audioCtx.sampleRate * 4, G.audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  const src = G.audioCtx.createBufferSource();
  src.buffer = buf;
  const f = G.audioCtx.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(900, G.audioCtx.currentTime);
  f.frequency.exponentialRampToValueAtTime(150, G.audioCtx.currentTime + 4);
  const g = G.audioCtx.createGain();
  g.gain.setValueAtTime(0.5, G.audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, G.audioCtx.currentTime + 4);
  src.connect(f); f.connect(g); g.connect(G.audioCtx.destination);
  src.start(); src.stop(G.audioCtx.currentTime + 4);
}

function soundCorrect() {
  [523, 659, 784].forEach((f, i) => playTone(f, 'sine', 0.35, i * 0.1, 0.3));
}
function soundWrong() {
  [300, 200, 150].forEach((f, i) => playTone(f, 'sawtooth', 0.3, i * 0.12, 0.25));
}
function soundWinner() {
  [523, 659, 784, 1047].forEach((f, i) => playTone(f, 'sine', 0.4, i * 0.15, 0.3));
}
function soundClick() { playTone(800, 'sine', 0.1, 0, 0.15); }

// ════════════════════════════════════════════
// CONFETTI
// ════════════════════════════════════════════
class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.colors = ['#FFD700','#FF6B6B','#4ECDC4','#9B59B6','#00C851','#FF8A65','#45B7D1'];
    this.running = false; this.raf = null;
  }
  start() {
    this.running = true;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._spawn(200); this._loop();
  }
  stop() { this.running = false; if (this.raf) cancelAnimationFrame(this.raf); }
  _spawn(n) {
    for (let i = 0; i < n; i++) this.particles.push({
      x: Math.random() * this.canvas.width, y: -20,
      vx: (Math.random() - 0.5) * 5,
      vy: Math.random() * 4 + 2,
      r: this.colors[Math.floor(Math.random() * this.colors.length)],
      w: Math.random() * 10 + 6, h: Math.random() * 6 + 3,
      rot: Math.random() * 360, rv: (Math.random() - 0.5) * 8,
    });
  }
  _loop() {
    if (!this.running) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.rv; p.vy += 0.06;
      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot * Math.PI / 180);
      this.ctx.fillStyle = p.r;
      this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      this.ctx.restore();
    });
    this.particles = this.particles.filter(p => p.y < this.canvas.height + 30);
    if (this.particles.length < 120 && this.running) this._spawn(60);
    this.raf = requestAnimationFrame(() => this._loop());
  }
}

// ════════════════════════════════════════════
// SPINNING WHEEL
// ════════════════════════════════════════════
const WHEEL_COLORS = [
  '#E74C3C','#3498DB','#F39C12','#2ECC71',
  '#9B59B6','#E67E22','#1ABC9C','#E91E63',
  '#00BCD4','#8BC34A','#FF5722',
];

class SpinningWheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.players = [];
    this.angle = 0;
    this.spinning = false;
    this.selectedIdx = -1;
  }

  setPlayers(players) { this.players = [...players]; this.draw(); }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;
    const radius = Math.min(cx, cy) - 4;
    ctx.clearRect(0, 0, W, H);
    if (!this.players.length) return;

    const seg = (2 * Math.PI) / this.players.length;
    this.players.forEach((p, i) => {
      const sa = this.angle + i * seg;
      const ea = sa + seg;
      // Segment
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sa, ea);
      ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Text
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sa + seg / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 4;
      const fontSize = Math.max(10, Math.min(18, Math.floor(radius / (this.players.length * 0.7))));
      ctx.font = `bold ${fontSize}px Tajawal, Arial`;
      ctx.direction = 'rtl';
      ctx.fillText(p.name, radius - 12, 5);
      ctx.restore();
    });

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, 2 * Math.PI);
    ctx.fillStyle = '#070714';
    ctx.fill();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', cx, cy);
    ctx.textBaseline = 'alphabetic';

    // Glow ring
    const grad = ctx.createRadialGradient(cx, cy, radius - 10, cx, cy, radius + 10);
    grad.addColorStop(0, 'rgba(255,215,0,0.0)');
    grad.addColorStop(0.5, 'rgba(255,215,0,0.15)');
    grad.addColorStop(1, 'rgba(255,215,0,0.0)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 20;
    ctx.stroke();
  }

  spin(onComplete) {
    if (this.spinning || this.players.length === 0) return;
    this.spinning = true;
    soundSpin();

    // Pre-select randomly
    this.selectedIdx = Math.floor(Math.random() * this.players.length);
    const seg = (2 * Math.PI) / this.players.length;

    // Target: selected segment center must be at TOP (angle = -π/2)
    // finalAngle + selectedIdx*seg + seg/2 ≡ -π/2  (mod 2π)
    // → finalAngle ≡ -π/2 - selectedIdx*seg - seg/2  (mod 2π)
    const targetMod = ((-Math.PI / 2 - this.selectedIdx * seg - seg / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const currentMod = ((this.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    // Clockwise rotation needed to reach target from current position
    let deltaRot = (targetMod - currentMod + 2 * Math.PI) % (2 * Math.PI);
    if (deltaRot < 0.01) deltaRot += 2 * Math.PI; // force at least one rotation

    // Add EXACT integer extra full rotations (5-9) to make it spin nicely
    // MUST be integer to preserve landing accuracy
    const extraFullRotations = 5 + Math.floor(Math.random() * 5);
    const totalRot = deltaRot + extraFullRotations * 2 * Math.PI;

    const duration = 4000;
    const startAngle = this.angle;
    const start = performance.now();

    const animate = (ts) => {
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.angle = startAngle + totalRot * eased;
      this.draw();
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.spinning = false;
        onComplete(this.players[this.selectedIdx]);
      }
    };
    requestAnimationFrame(animate);
  }
}

// ════════════════════════════════════════════
// SCREEN NAVIGATION
// ════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
}

// ════════════════════════════════════════════
// PLAYER SELECTION
// ════════════════════════════════════════════
function renderPlayerSelection() {
  const grid = document.getElementById('players-grid');
  grid.innerHTML = '';
  G.allPlayers.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="player-card-check">✓</div>
      <div class="player-card-emoji">${p.emoji}</div>
      <div class="player-card-name">${p.name}</div>`;
    card.addEventListener('click', () => {
      initAudio(); soundClick();
      card.classList.toggle('selected');
      updateSelectionUI();
    });
    grid.appendChild(card);
  });
}

function updateSelectionUI() {
  const selected = document.querySelectorAll('.player-card.selected').length;
  document.getElementById('selected-count').textContent = selected;
  const btn = document.getElementById('start-game-btn');
  btn.disabled = selected < 3;
  if (selected >= 3) btn.classList.add('btn-glow'); else btn.classList.remove('btn-glow');
}

function getSelectedPlayerObjects() {
  const ids = [...document.querySelectorAll('.player-card.selected')].map(c => parseInt(c.dataset.id));
  return G.allPlayers.filter(p => ids.includes(p.id));
}

// ════════════════════════════════════════════
// DATA LOADING
// ════════════════════════════════════════════
async function loadData() {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('visible');
  try {
    const [{ data: players, error: pe }, { data: questions, error: qe }] = await Promise.all([
      db.from('players').select('*').order('id'),
      db.from('questions').select('*'),
    ]);
    if (pe) throw pe; if (qe) throw qe;
    G.allPlayers = players || [];
    G.allQuestions = questions || [];
    renderPlayerSelection();
    overlay.classList.remove('visible');
    document.getElementById('start-btn').disabled = false;
  } catch (err) {
    overlay.innerHTML = `<p style="color:#FF4444;padding:20px;text-align:center">خطأ في تحميل البيانات:<br>${err.message}</p>`;
  }
}

// ════════════════════════════════════════════
// GAME FLOW
// ════════════════════════════════════════════
function showPlayersScreen() {
  initAudio(); soundClick();
  if (G.allPlayers.length === 0) { loadData(); return; }
  showScreen('players');
}

function startGame() {
  initAudio(); soundClick();
  G.selectedPlayers = getSelectedPlayerObjects();
  if (G.selectedPlayers.length < 3) return;
  G.usedQIds = new Set();
  G.currentRound = 1;
  G.activePlayers = [...G.selectedPlayers];
  G.qualifiedPlayers = [];
  startRound();
}

function startRound() {
  G.qualifiedPlayers = [];
  // Reset wheel angle to 0 so new segment count aligns correctly
  if (G.wheel) G.wheel.angle = 0;
  renderWheel();
  updateRoundUI();
  // Always re-enable spin button (may have been disabled from previous round)
  const spinBtn = document.getElementById('spin-btn');
  spinBtn.disabled = false;
  spinBtn.textContent = '🎰 أَدِر العجلة';
  showScreen('wheel');
}

function renderWheel() {
  const canvas = document.getElementById('wheel-canvas');
  const wrapper = canvas.parentElement;
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight) || 360;
  canvas.width = size; canvas.height = size;
  if (!G.wheel) G.wheel = new SpinningWheel(canvas);
  else { G.wheel.canvas = canvas; G.wheel.ctx = canvas.getContext('2d'); }
  G.wheel.setPlayers(G.activePlayers);
}

function updateRoundUI() {
  document.getElementById('round-badge').textContent = `الجولة ${G.currentRound}`;
  document.getElementById('players-left').textContent = `${G.activePlayers.length} لاعب`;
}

function spinWheel() {
  initAudio();
  const btn = document.getElementById('spin-btn');
  btn.disabled = true;
  btn.textContent = '🎰 جارٍ الدوران...';

  if (G.activePlayers.length === 1) {
    // Only one left — select them directly
    const player = G.activePlayers[0];
    G.activePlayers = [];
    setTimeout(() => showQuestionFor(player), 300);
    return;
  }

  G.wheel.spin((player) => {
    G.activePlayers = G.activePlayers.filter(p => p.id !== player.id);
    setTimeout(() => showQuestionFor(player), 600);
  });
}

function showQuestionFor(player) {
  G.currentPlayer = player;
  const q = pickQuestion(player.id);
  if (!q) {
    // No questions left — treat as no-answer, just continue
    alert('لا توجد أسئلة متاحة! سيتم المرور على هذا اللاعب.');
    G.qualifiedPlayers.push(player);
    checkState();
    return;
  }
  G.currentQuestion = q;
  G.usedQIds.add(q.id);

  // Find who the question is about
  const aboutPlayer = G.allPlayers.find(p => p.id === q.about_player_id);

  document.getElementById('q-player-emoji').textContent = player.emoji;
  document.getElementById('q-player-name').textContent = player.name;
  document.getElementById('question-text').textContent =
    aboutPlayer && aboutPlayer.id !== player.id
      ? q.question_text
      : q.question_text;

  document.getElementById('feedback-overlay').classList.remove('show');
  document.getElementById('btn-wrong').disabled = false;
  document.getElementById('btn-correct').disabled = false;
  showScreen('question');
}

function handleAnswer(correct) {
  initAudio();
  document.getElementById('btn-wrong').disabled = true;
  document.getElementById('btn-correct').disabled = true;

  const overlay = document.getElementById('feedback-overlay');
  const content = document.getElementById('feedback-content');

  if (correct) {
    soundCorrect();
    G.qualifiedPlayers.push(G.currentPlayer);
    content.innerHTML = `<span style="color:#00C851">✅</span><br><span style="font-size:clamp(16px,4vmin,24px);color:#00C851">إجابة صحيحة!<br>${G.currentPlayer.name} تأهّل! 🎉</span>`;
  } else {
    soundWrong();
    content.innerHTML = `<span style="color:#FF4444">❌</span><br><span style="font-size:clamp(16px,4vmin,24px);color:#FF4444">إجابة خاطئة!<br>${G.currentPlayer.name} خرج! 😔</span>`;
  }

  overlay.classList.add('show');
  setTimeout(() => {
    overlay.classList.remove('show');
    checkState();
  }, 1800);
}

function checkState() {
  const remaining = G.qualifiedPlayers.length + G.activePlayers.length;

  if (remaining <= 1) {
    const winner = G.qualifiedPlayers[0] || G.activePlayers[0];
    if (winner) { declareWinner(winner); return; }
    showScreen('home'); return;
  }

  if (remaining === 2) {
    const sdPlayers = [...G.qualifiedPlayers, ...G.activePlayers];
    triggerSuddenDeath(sdPlayers); return;
  }

  if (G.activePlayers.length > 0) {
    // More players to ask this round — re-render wheel
    renderWheel(); updateRoundUI();
    const btn = document.getElementById('spin-btn');
    btn.disabled = false;
    btn.textContent = '🎰 أَدِر العجلة';
    showScreen('wheel');
  } else {
    // Round complete
    showRoundResults();
  }
}

function showRoundResults() {
  document.getElementById('results-title').textContent = `نتائج الجولة ${G.currentRound}`;
  const qList = document.getElementById('qualified-list');
  const eList = document.getElementById('eliminated-list');
  qList.innerHTML = G.qualifiedPlayers.map(p => `<li>${p.emoji} ${p.name}</li>`).join('') || '<li style="color:var(--text-muted)">لا أحد</li>';

  // Eliminated this round = selected players NOT in qualified and NOT still active
  const allThisRound = G.currentRound === 1 ? G.selectedPlayers : G.lastRoundPlayers || G.selectedPlayers;
  const eliminatedThisRound = allThisRound.filter(p =>
    !G.qualifiedPlayers.find(q => q.id === p.id) && !G.activePlayers.find(a => a.id === p.id)
  );
  eList.innerHTML = eliminatedThisRound.map(p => `<li>${p.emoji} ${p.name}</li>`).join('') || '<li style="color:var(--text-muted)">لا أحد</li>';

  showScreen('results');
}

function nextRound() {
  soundClick(); initAudio();
  G.lastRoundPlayers = [...G.qualifiedPlayers];
  G.activePlayers = [...G.qualifiedPlayers];
  G.qualifiedPlayers = [];
  G.currentRound++;
  // Re-enable spin button here too (belt-and-suspenders for caching)
  const btn = document.getElementById('spin-btn');
  btn.disabled = false;
  btn.textContent = '🎰 أَدِر العجلة';
  startRound();
}

function triggerSuddenDeath(players) {
  G.suddenDeathPlayers = players;
  const container = document.getElementById('sd-players-intro');
  container.innerHTML = `
    <div class="sd-player-badge"><span>${players[0].emoji}</span><span>${players[0].name}</span></div>
    <div class="sd-vs">⚡</div>
    <div class="sd-player-badge"><span>${players[1].emoji}</span><span>${players[1].name}</span></div>
  `;
  showScreen('sd-intro');
}

function showSuddenDeathQuestion() {
  soundClick(); initAudio();
  const available = G.allQuestions.filter(q => !G.usedQIds.has(q.id));
  if (available.length === 0) {
    alert('نفدت الأسئلة! ستبدأ الأسئلة من جديد.');
    G.usedQIds = new Set();
  }
  const pool = G.allQuestions.filter(q => !G.usedQIds.has(q.id));
  if (pool.length === 0) { alert('لا توجد أسئلة!'); return; }
  const q = pool[Math.floor(Math.random() * pool.length)];
  G.usedQIds.add(q.id);
  document.getElementById('sd-question-text').textContent = q.question_text;

  const btns = document.getElementById('sd-answer-buttons');
  btns.innerHTML = G.suddenDeathPlayers.map(p => `
    <button class="btn-sd-player" onclick="handleSdWinner(${p.id})">
      ${p.emoji} ${p.name}
    </button>
  `).join('');
  showScreen('sd-question');
}

function handleSdWinner(playerId) {
  initAudio();
  const winner = G.suddenDeathPlayers.find(p => p.id === playerId);
  if (winner) declareWinner(winner);
}

function declareWinner(player) {
  soundWinner();
  document.getElementById('winner-name').textContent = player.name;
  document.getElementById('winner-emoji').textContent = player.emoji;
  showScreen('winner');
  startConfetti();
}

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!G.confetti) G.confetti = new Confetti(canvas);
  else G.confetti.stop();
  G.confetti.start();
}

function resetGame() {
  soundClick(); initAudio();
  if (G.confetti) G.confetti.stop();
  G.usedQIds = new Set();
  G.currentRound = 1;
  G.activePlayers = []; G.qualifiedPlayers = [];
  G.currentPlayer = null; G.currentQuestion = null;
  G.winner = null; G.suddenDeathPlayers = [];
  G.lastRoundPlayers = [];
  // Clear selections
  document.querySelectorAll('.player-card.selected').forEach(c => c.classList.remove('selected'));
  updateSelectionUI();
  showScreen('home');
}

// ════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════
function pickQuestion(excludePlayerId) {
  const pool = G.allQuestions.filter(q =>
    q.about_player_id !== excludePlayerId && !G.usedQIds.has(q.id)
  );
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Resize wheel canvas on orientation change
function handleResize() {
  if (document.getElementById('screen-wheel').classList.contains('active')) {
    renderWheel();
  }
  if (G.confetti && document.getElementById('screen-winner').classList.contains('active')) {
    const canvas = document.getElementById('confetti-canvas');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  }
}

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  // Prevent double-tap zoom on iOS
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - (document.lastTouch || 0) < 300) e.preventDefault();
    document.lastTouch = now;
  }, { passive: false });

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 300));

  // Disable start btn until data loads
  document.getElementById('start-btn').disabled = true;
  await loadData();
});
