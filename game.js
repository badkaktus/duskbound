'use strict';

/* =========================================================================
   DUSKBOUND — небольшой 2D-платформер в мрачной сказочной стилистике
   ========================================================================= */

const W = 960, H = 540, GROUND = 470;
const GRAV = 2100, JUMP = 820, SPEED = 270, MAXFALL = 1000;
const STEP = 1 / 120;

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let viewScale = 1, dpr = 1;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const rand = (a, b) => a + Math.random() * (b - a);
const sign = (v) => (v < 0 ? -1 : 1);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ------------------------------- Resize -------------------------------- */

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewScale = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = Math.round(W * viewScale) + 'px';
  cv.style.height = Math.round(H * viewScale) + 'px';
  cv.width = Math.round(W * viewScale * dpr);
  cv.height = Math.round(H * viewScale * dpr);
  bgCache.length = 0;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
document.addEventListener('fullscreenchange', resize);
document.addEventListener('webkitfullscreenchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

/* ------------------------------ Fullscreen ----------------------------- */

const isLandscape = () => (window.matchMedia ? matchMedia('(orientation: landscape)').matches : innerWidth > innerHeight);
const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function goFullscreen() {
  if (!document.body.classList.contains('touch') || !isLandscape() || isStandalone()) return;
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) return;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const r = req.call(el, { navigationUI: 'hide' });
    const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} };
    if (r && r.then) r.then(lock).catch(() => {}); else lock();
  } catch (_) {}
}

/* ------------------------------- Images -------------------------------- */

const IMG = {};
function loadImg(name, src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => { IMG[name] = i; res(); };
    i.onerror = () => res();
    i.src = src;
  });
}
function whiteVersion(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
const assetsReady = Promise.all([
  loadImg('mob1', 'sprites/mob1.png'),
  loadImg('mob2', 'sprites/mob2.png'),
  loadImg('boss', 'sprites/boss.png'),
  loadImg('title', 'sprites/title.jpg'),
]).then(() => {
  for (const k of ['mob1', 'mob2', 'boss']) if (IMG[k]) IMG[k + 'W'] = whiteVersion(IMG[k]);
});

/* -------------------------------- Audio -------------------------------- */

const AU = {
  ctx: null, mode: 'none', bus: null,
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.85; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.55; this.mus.connect(this.master);
    this.rev = c.createConvolver(); this.rev.buffer = this.impulse(3);
    const ro = c.createGain(); ro.gain.value = 0.55; this.rev.connect(ro); ro.connect(this.master);
    const len = c.sampleRate * 2;
    this.nbuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    setInterval(() => this.schedule(), 80);
  },
  impulse(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  },
  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  },
  out(g, dest, rev) {
    g.connect(dest || this.sfx);
    if (rev) { const s = this.ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.rev); }
  },
  tone({ type = 'sine', f = 440, f2 = 0, dur = 0.2, vol = 0.3, a = 0.005, t = 0, dest = null, rev = 0, lp = 0, bp = 0, q = 1, at = 0 }) {
    const c = this.ctx; if (!c) return;
    const now = (at || c.currentTime) + t;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = c.createGain(); this.env(g, now, a, vol, dur);
    let n = o;
    if (lp || bp) {
      const fl = c.createBiquadFilter(); fl.type = lp ? 'lowpass' : 'bandpass';
      fl.frequency.value = lp || bp; fl.Q.value = q; o.connect(fl); n = fl;
    }
    n.connect(g); this.out(g, dest, rev);
    o.start(now); o.stop(now + dur + 0.05);
  },
  noise({ dur = 0.2, vol = 0.3, a = 0.003, type = 'bandpass', f = 1000, f2 = 0, q = 1, t = 0, dest = null, rev = 0, at = 0 }) {
    const c = this.ctx; if (!c) return;
    const now = (at || c.currentTime) + t;
    const s = c.createBufferSource(); s.buffer = this.nbuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, now);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = c.createGain(); this.env(g, now, a, vol, dur);
    s.connect(fl); fl.connect(g); this.out(g, dest, rev);
    s.start(now, Math.random() * 1.5); s.stop(now + dur + 0.05);
  },

  /* ---- sound effects ---- */
  slash() {
    this.noise({ dur: 0.17, vol: 0.4, type: 'bandpass', f: 5000, f2: 900, q: 1.4 });
    this.tone({ type: 'triangle', f: 2600, f2: 1800, dur: 0.07, vol: 0.04 });
  },
  hit() {
    this.tone({ f: 190, f2: 50, dur: 0.16, vol: 0.55 });
    this.noise({ dur: 0.06, vol: 0.35, type: 'highpass', f: 2500 });
    this.tone({ type: 'square', f: 900, f2: 300, dur: 0.05, vol: 0.05 });
  },
  bossHit() {
    this.hit();
    this.tone({ type: 'triangle', f: 620, f2: 580, dur: 0.25, vol: 0.06, rev: 0.3 });
  },
  hurt() {
    this.tone({ type: 'square', f: 330, f2: 80, dur: 0.32, vol: 0.16, lp: 1600 });
    this.noise({ dur: 0.35, vol: 0.45, type: 'lowpass', f: 900, f2: 200 });
    this.tone({ f: 70, f2: 40, dur: 0.45, vol: 0.6 });
  },
  jump() {
    this.noise({ dur: 0.14, vol: 0.12, type: 'bandpass', f: 900, f2: 2600, q: 0.8 });
  },
  land() {
    this.noise({ dur: 0.09, vol: 0.22, type: 'lowpass', f: 500 });
  },
  die() {
    this.noise({ dur: 0.45, vol: 0.4, type: 'bandpass', f: 1800, f2: 180, q: 1 });
    this.tone({ type: 'triangle', f: 520, f2: 70, dur: 0.45, vol: 0.18 });
  },
  kick() {
    this.tone({ f: 260, f2: 90, dur: 0.09, vol: 0.45 });
    this.noise({ dur: 0.03, vol: 0.2, type: 'highpass', f: 3000 });
  },
  bounce() { this.tone({ f: 170, f2: 110, dur: 0.07, vol: 0.18 }); },
  cluck(t = 0) {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const b = 560 + Math.random() * 140;
      this.tone({ type: 'square', f: b, f2: b * 0.75, dur: 0.07, vol: 0.07, bp: 1300, q: 2.5, t: t + i * 0.12 });
    }
    const b = 650 + Math.random() * 120;
    this.tone({ type: 'sawtooth', f: b, f2: b * 1.4, dur: 0.22, vol: 0.06, bp: 1500, q: 3, t: t + n * 0.12 + 0.04 });
  },
  crack() {
    this.noise({ dur: 0.04, vol: 0.25, type: 'highpass', f: 3500 });
    this.noise({ dur: 0.05, vol: 0.2, type: 'highpass', f: 2500, t: 0.06 });
  },
  roar() {
    this.tone({ type: 'sawtooth', f: 92, f2: 55, dur: 1.5, vol: 0.28, a: 0.12, lp: 650, rev: 0.4 });
    this.tone({ type: 'sawtooth', f: 97, f2: 58, dur: 1.4, vol: 0.22, a: 0.1, lp: 900 });
    this.tone({ type: 'square', f: 46, f2: 38, dur: 1.3, vol: 0.12, a: 0.1, lp: 300 });
    this.noise({ dur: 1.3, vol: 0.35, type: 'lowpass', f: 1200, f2: 300, a: 0.1, rev: 0.4 });
  },
  slam() {
    this.tone({ f: 95, f2: 28, dur: 0.7, vol: 0.85 });
    this.noise({ dur: 0.7, vol: 0.55, type: 'lowpass', f: 900, f2: 90, rev: 0.3 });
  },
  dash() { this.noise({ dur: 0.4, vol: 0.35, type: 'bandpass', f: 500, f2: 2400, q: 0.9 }); },
  shard() { this.tone({ type: 'triangle', f: 1900, f2: 800, dur: 0.14, vol: 0.09, rev: 0.2 }); },
  gate() {
    this.noise({ dur: 1.1, vol: 0.45, type: 'lowpass', f: 400, f2: 120, a: 0.05 });
    this.tone({ type: 'sawtooth', f: 55, f2: 45, dur: 1.0, vol: 0.12, lp: 220 });
    this.tone({ f: 60, f2: 30, dur: 0.6, vol: 0.6, t: 0.9 });
  },
  spawn() {
    [440, 554, 659, 880, 1108].forEach((f, i) =>
      this.tone({ f, dur: 1.6, vol: 0.07, a: 0.02, t: i * 0.09, rev: 0.6 }));
    this.noise({ dur: 1.0, vol: 0.12, type: 'bandpass', f: 400, f2: 3000, q: 0.6, a: 0.4, rev: 0.4 });
  },
  victory() {
    [220, 277, 330, 440, 554, 659, 880].forEach((f, i) =>
      this.tone({ type: i % 2 ? 'sine' : 'triangle', f, dur: 3.2, vol: 0.08, a: 0.02, t: i * 0.14, rev: 0.7 }));
  },
  deathSting() {
    [330, 262, 196, 147].forEach((f, i) =>
      this.tone({ type: 'triangle', f, dur: 1.4, vol: 0.09, t: i * 0.22, rev: 0.6 }));
  },

  /* ---- music ---- */
  setMusic(mode) {
    if (!this.ctx || mode === this.mode) return;
    this.mode = mode;
    const c = this.ctx;
    if (this.bus) {
      const b = this.bus;
      b.gain.setTargetAtTime(0, c.currentTime, 0.5);
      setTimeout(() => b.disconnect(), 4000);
      this.bus = null;
    }
    if (mode === 'none') return;
    const bus = c.createGain(); bus.gain.value = 0.0001;
    bus.gain.setTargetAtTime(1, c.currentTime, 0.8);
    bus.connect(this.mus);
    const s = c.createGain(); s.gain.value = 0.6; bus.connect(s); s.connect(this.rev);
    this.bus = bus; this.next = c.currentTime + 0.15; this.step = 0;
  },
  pad(f, t, dur, peak, att, cutoff) {
    const c = this.ctx;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; fl.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, t + dur - att * 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    fl.connect(g); g.connect(this.bus);
    for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = det;
      o.connect(fl); o.start(t); o.stop(t + dur + 0.1);
    }
  },
  schedule() {
    if (!this.bus) return;
    const c = this.ctx;
    while (this.next < c.currentTime + 0.4) {
      if (this.mode === 'ambient') this.ambStep(this.next);
      else this.bossStep(this.next);
    }
  },
  ambStep(t) {
    const chords = [[110, 130.8, 164.8], [87.3, 110, 130.8], [73.4, 87.3, 110], [82.4, 103.8, 123.5]];
    const s = this.step;
    if (s % 16 === 0) {
      const ch = chords[(s / 16) % 4];
      for (const f of ch) this.pad(f, t, 8.6, 0.035, 2.6, 520);
      this.pad(ch[0] / 2, t, 8.6, 0.04, 2.6, 260);
    }
    const scale = [440, 523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7];
    if (Math.random() < 0.28) {
      const f = scale[Math.floor(Math.random() * scale.length)];
      this.tone({ f, dur: 2.6, vol: 0.05, a: 0.008, at: t, dest: this.bus });
      this.tone({ type: 'triangle', f: f * 2, dur: 1.2, vol: 0.012, a: 0.008, at: t, dest: this.bus });
    }
    this.next += 0.5; this.step++;
  },
  bossStep(t) {
    const s = this.step, d = 0.2;
    const bassA = [73.4, 73.4, 87.3, 73.4, 110, 73.4, 130.8, 116.5];
    const bassB = [73.4, 73.4, 87.3, 73.4, 98, 87.3, 82.4, 69.3];
    const bass = (Math.floor(s / 8) % 2 ? bassB : bassA)[s % 8];
    this.tone({ type: 'sawtooth', f: bass, dur: 0.18, vol: 0.11, lp: 750, q: 3, at: t, dest: this.bus });
    this.tone({ f: bass / 2, dur: 0.2, vol: 0.12, at: t, dest: this.bus });
    if (s % 4 === 0) this.tone({ f: 130, f2: 38, dur: 0.22, vol: 0.4, at: t, dest: this.bus });
    if (s % 8 === 4) this.noise({ dur: 0.16, vol: 0.14, type: 'bandpass', f: 1900, q: 0.8, at: t, dest: this.bus });
    this.noise({ dur: 0.03, vol: s % 2 ? 0.02 : 0.035, type: 'highpass', f: 7500, at: t, dest: this.bus });
    if (s % 32 === 0) {
      const chords = [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [98, 116.5, 146.8], [110, 138.6, 164.8]];
      const ch = chords[(s / 32) % 4];
      for (const f of ch) this.pad(f, t, 6.4, 0.03, 0.6, 900);
    }
    if (s % 16 === 14 && Math.random() < 0.6) {
      const f = [587.3, 698.5, 880, 1046.5][Math.floor(Math.random() * 4)];
      this.tone({ type: 'triangle', f, dur: 1.2, vol: 0.04, at: t, dest: this.bus });
    }
    this.next += d; this.step++;
  },
};

/* -------------------------------- Input -------------------------------- */

const IN = { kb: {}, touch: {}, now: {} };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'attack', KeyX: 'attack', KeyJ: 'attack',
};
const held = (k) => !!(IN.kb[k] || IN.touch[k] > 0);
const pressed = (k) => !!IN.now[k];
function setKb(k, v) {
  const before = held(k); IN.kb[k] = v;
  if (!before && held(k)) IN.now[k] = true;
}
function touchAdd(k, d) {
  const before = held(k);
  IN.touch[k] = Math.max(0, (IN.touch[k] || 0) + d);
  if (!before && held(k)) IN.now[k] = true;
  document.querySelectorAll(`[data-k="${k}"]`).forEach((b) => b.classList.toggle('on', IN.touch[k] > 0));
}

window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { e.preventDefault(); setKb(k, true); }
  if (!e.repeat) anyInput();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { e.preventDefault(); setKb(k, false); }
});
window.addEventListener('blur', () => { IN.kb = {}; });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

const pointerKey = new Map();
function keyAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const b = el && el.closest && el.closest('[data-k]');
  return b ? b.dataset.k : null;
}
function onPointer(e) {
  const prev = pointerKey.get(e.pointerId) || null;
  const next = e.type === 'pointerup' || e.type === 'pointercancel' ? null : keyAt(e.clientX, e.clientY);
  if (prev !== next) {
    if (prev) touchAdd(prev, -1);
    if (next) touchAdd(next, +1);
    if (next) pointerKey.set(e.pointerId, next); else pointerKey.delete(e.pointerId);
  }
}
const touchEl = document.getElementById('touch');
touchEl.addEventListener('pointerdown', (e) => { e.preventDefault(); onPointer(e); goFullscreen(); anyInput(); });
window.addEventListener('pointermove', (e) => { if (pointerKey.has(e.pointerId)) onPointer(e); });
window.addEventListener('pointerup', onPointer);
window.addEventListener('pointercancel', onPointer);
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !document.body.classList.contains('touch')) document.body.classList.add('touch');
  if (e.pointerType === 'touch') goFullscreen();
  if (!e.target.closest('#touch')) anyInput();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* -------------------------------- Rooms -------------------------------- */

const ROOMS = [
  {
    title: 'Порог Сумерек', sub: 'Начало пути',
    theme: { top: '#060a20', mid: '#1c3878', bot: '#0a1130', glow: 'rgba(120,160,255,0.28)',
      far: 'rgba(50,80,160,0.45)', mid2: 'rgba(22,36,86,0.85)', near: '#070a1a', lamp: '#ffd08a', mote: '170,200,255' },
    plats: [{ x: 600, y: 385, w: 140 }, { x: 780, y: 315, w: 120 }],
    enemies: [],
  },
  {
    title: 'Перекрёсток Болельщиков', sub: 'Забытые трибуны',
    theme: { top: '#04121c', mid: '#16506a', bot: '#061820', glow: 'rgba(110,220,230,0.22)',
      far: 'rgba(40,110,140,0.42)', mid2: 'rgba(14,52,70,0.88)', near: '#04100f', lamp: '#b8fff0', mote: '160,255,230' },
    plats: [{ x: 280, y: 380, w: 150 }, { x: 600, y: 345, w: 140 }],
    enemies: [{ type: 'kicker', x: 520 }, { type: 'kicker', x: 800 }],
  },
  {
    title: 'Квартал Капюшонов', sub: 'Где тени носят кепки',
    theme: { top: '#0b0720', mid: '#352a70', bot: '#0b0920', glow: 'rgba(170,140,255,0.24)',
      far: 'rgba(90,70,170,0.42)', mid2: 'rgba(36,26,82,0.88)', near: '#08061a', lamp: '#d9c2ff', mote: '210,190,255' },
    plats: [{ x: 180, y: 380, w: 130 }, { x: 420, y: 315, w: 130 }, { x: 680, y: 380, w: 130 }],
    enemies: [{ type: 'hood', x: 560 }, { type: 'hood', x: 820 }, { type: 'hood', x: 470, y: 315 }],
  },
  {
    title: 'Шпиль Ткача', sub: 'Последний чертог',
    theme: { top: '#08040f', mid: '#3a1846', bot: '#09040d', glow: 'rgba(230,110,160,0.2)',
      far: 'rgba(110,50,120,0.4)', mid2: 'rgba(44,18,56,0.9)', near: '#07030b', lamp: '#ff9a7a', mote: '255,170,200' },
    plats: [{ x: 110, y: 370, w: 120 }, { x: W - 230, y: 370, w: 120 }],
    enemies: [],
    boss: true,
  },
];

/* ------------------------------ Background ----------------------------- */

const bgCache = [];
function getBg(i) {
  if (bgCache[i]) return bgCache[i];
  const k = Math.min(2, Math.max(1, viewScale * dpr));
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d');
  g.scale(k, k);
  paintBg(g, ROOMS[i], i);
  bgCache[i] = c;
  return c;
}

function paintBg(g, room, idx) {
  const th = room.theme, R = rng(idx * 977 + 31);

  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, th.top); gr.addColorStop(0.6, th.mid); gr.addColorStop(1, th.bot);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);

  let rg = g.createRadialGradient(W * 0.5, H * 0.4, 10, W * 0.5, H * 0.4, W * 0.62);
  rg.addColorStop(0, th.glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);

  // дальние своды и колонны
  g.fillStyle = th.far; g.strokeStyle = th.far;
  const n = 7;
  const xs = [];
  for (let i = 0; i < n; i++) {
    const w = 34 + R() * 34, x = i * (W / (n - 1)) - w / 2 + (R() - 0.5) * 40;
    const top = 30 + R() * 90;
    xs.push([x, w, top]);
    g.fillRect(x, top, w, GROUND - top);
    g.fillRect(x - 6, top + 26, w + 12, 7);
    g.fillRect(x - 4, GROUND - 60, w + 8, 10);
    g.beginPath(); g.moveTo(x - 2, top); g.lineTo(x + w / 2, top - 40 - R() * 50); g.lineTo(x + w + 2, top); g.fill();
    // окна-стрельчатые
    g.save(); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.35;
    const wy = top + 70 + R() * 60;
    g.beginPath(); g.moveTo(x + w * 0.3, wy + 70); g.lineTo(x + w * 0.3, wy + 16);
    g.quadraticCurveTo(x + w * 0.5, wy - 10, x + w * 0.7, wy + 16); g.lineTo(x + w * 0.7, wy + 70); g.fill();
    g.restore();
  }
  g.lineWidth = 9;
  for (let i = 0; i < xs.length - 1; i++) {
    const [x1, w1, t1] = xs[i], [x2] = xs[i + 1];
    const a = x1 + w1, b = x2, mid = (a + b) / 2, y = Math.max(t1, xs[i + 1][2]) + 60 + R() * 40;
    g.beginPath(); g.moveTo(a, y + 60);
    g.quadraticCurveTo(a, y - 10, mid, y - 40); g.quadraticCurveTo(b, y - 10, b, y + 60); g.stroke();
  }

  // лучи света
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const x = 80 + R() * (W - 160), w = 40 + R() * 70, sk = 120 + R() * 100;
    const lg = g.createLinearGradient(0, 0, 0, GROUND);
    lg.addColorStop(0, 'rgba(160,190,255,0.10)'); lg.addColorStop(1, 'rgba(160,190,255,0)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w + sk, GROUND); g.lineTo(x + sk - 20, GROUND); g.fill();
  }
  g.restore();

  // средний план: шпили, мост, «пузыри»-кусты
  g.fillStyle = th.mid2;
  for (let i = 0; i < 5; i++) {
    const x = R() * W, w = 14 + R() * 18, top = 140 + R() * 120;
    g.fillRect(x, top, w, GROUND - top);
    g.beginPath(); g.arc(x + w / 2, top - 8, w * 0.55, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x + w / 2 - 3, top - 14); g.lineTo(x + w / 2, top - 50 - R() * 30); g.lineTo(x + w / 2 + 3, top - 14); g.fill();
  }
  if (idx !== 3) {
    const by = 250 + R() * 40, bx = R() * 300 + 380;
    g.fillRect(bx, by, 420, 16);
    for (let i = 0; i < 8; i++) g.fillRect(bx + i * 56, by - 22, 6, 22);
    g.fillRect(bx, by - 26, 420, 6);
    g.lineWidth = 12; g.strokeStyle = th.mid2;
    for (let i = 0; i < 3; i++) {
      const ax = bx + 30 + i * 140;
      g.beginPath(); g.arc(ax + 60, by + 90, 64, Math.PI, 0); g.stroke();
      g.fillRect(ax - 8, by + 90, 14, GROUND - by);
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = R() * W, r = 10 + R() * 26;
    g.beginPath(); g.arc(x, GROUND - r * 0.5 - R() * 30, r, 0, Math.PI * 2); g.fill();
  }

  // висячие фонари
  for (let i = 0; i < 3; i++) {
    const x = 120 + R() * (W - 240), len = 70 + R() * 120;
    g.strokeStyle = 'rgba(10,12,24,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, len); g.stroke();
    g.fillStyle = '#0b0d1a';
    g.beginPath(); g.ellipse(x, len + 14, 9, 14, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.globalCompositeOperation = 'lighter';
    const lg = g.createRadialGradient(x, len + 14, 1, x, len + 14, 70);
    lg.addColorStop(0, 'rgba(255,240,210,0.9)'); lg.addColorStop(0.15, 'rgba(255,220,170,0.25)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.beginPath(); g.arc(x, len + 14, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = th.lamp; g.beginPath(); g.ellipse(x, len + 14, 4, 7, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // особые декорации
  if (idx === 0) drawBanner(g, 46, th);
  if (idx === 3) drawRoseWindow(g, th);
  if (idx === 1) drawGoalPosts(g, th);

  // туман у пола
  const fg = g.createLinearGradient(0, GROUND - 110, 0, GROUND);
  fg.addColorStop(0, 'rgba(120,150,230,0)'); fg.addColorStop(1, 'rgba(120,150,230,0.16)');
  g.fillStyle = fg; g.fillRect(0, GROUND - 110, W, 110);

  // пол
  g.fillStyle = '#05070f'; g.fillRect(0, GROUND, W, H - GROUND);
  g.fillStyle = '#0b0f20';
  let x = -10;
  while (x < W + 20) {
    const w = 26 + R() * 30;
    rr(g, x, GROUND - 2, w, 14 + R() * 6, 7); g.fill();
    x += w + 3;
  }
  g.strokeStyle = 'rgba(140,170,240,0.35)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, GROUND); g.lineTo(W, GROUND); g.stroke();
  g.fillStyle = 'rgba(80,100,170,0.12)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(R() * W, GROUND + 24 + R() * 50, 3 + R() * 8, 0, Math.PI * 2); g.fill(); }

  // платформы
  for (const p of room.plats) drawLedge(g, p, R);

  // передний план: грибы и трава
  g.fillStyle = '#020309';
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? W - R() * 160 : R() * 160;
    const hgt = 20 + R() * 46, cw = 12 + R() * 16;
    g.fillRect(side - 2, GROUND - hgt + 6, 4, hgt);
    g.beginPath(); g.ellipse(side, GROUND - hgt + 6, cw, cw * 0.55, 0, Math.PI, 0); g.fill();
  }
  for (let i = 0; i < 70; i++) {
    const gx = R() * W, gh = 6 + R() * 16;
    g.beginPath(); g.moveTo(gx - 3, GROUND + 2); g.quadraticCurveTo(gx, GROUND - gh * 0.5, gx + (R() - 0.5) * 8, GROUND - gh); g.lineTo(gx + 3, GROUND + 2); g.fill();
  }
}

function drawLedge(g, p, R) {
  g.fillStyle = '#080b18';
  rr(g, p.x, p.y, p.w, 18, 8); g.fill();
  g.beginPath(); g.moveTo(p.x + 10, p.y + 14);
  for (let i = 0; i <= 6; i++) {
    const xx = p.x + 10 + (p.w - 20) * (i / 6);
    g.lineTo(xx, p.y + 14 + (i % 2 ? 14 + R() * 18 : 4));
  }
  g.lineTo(p.x + p.w - 10, p.y + 14); g.fill();
  g.strokeStyle = 'rgba(150,180,250,0.45)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(p.x + 6, p.y + 1); g.lineTo(p.x + p.w - 6, p.y + 1); g.stroke();
  g.strokeStyle = 'rgba(10,14,30,1)'; g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const vx = p.x + 16 + R() * (p.w - 32);
    g.beginPath(); g.moveTo(vx, p.y + 16); g.quadraticCurveTo(vx + 6, p.y + 40, vx - 2, p.y + 50 + R() * 30); g.stroke();
  }
}

function drawBanner(g, x, th) {
  g.fillStyle = '#04060f';
  g.fillRect(x - 3, 70, 6, GROUND - 70);
  g.beginPath(); g.moveTo(x - 7, 74); g.lineTo(x, 30); g.lineTo(x + 7, 74); g.fill();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x, 110 + i * 70, 7, 0, Math.PI * 2); g.fill(); }
  g.fillRect(x, 120, 50, 4);
  g.fillStyle = '#0d1430';
  g.beginPath(); g.moveTo(x + 6, 124); g.lineTo(x + 50, 124); g.lineTo(x + 50, 230); g.lineTo(x + 38, 215);
  g.lineTo(x + 28, 236); g.lineTo(x + 18, 214); g.lineTo(x + 6, 232); g.fill();
  g.strokeStyle = 'rgba(160,190,255,0.5)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x + 28, 168, 13, 0.6, Math.PI * 2 - 0.6); g.stroke();
  g.beginPath(); g.moveTo(x + 28, 148); g.lineTo(x + 28, 190); g.stroke();
}

function drawGoalPosts(g) {
  g.strokeStyle = 'rgba(20,60,70,0.9)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(820, GROUND); g.lineTo(820, 330); g.lineTo(950, 330); g.lineTo(950, GROUND); g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(40,100,110,0.35)';
  for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(822 + i * 11, 332); g.lineTo(830 + i * 10, GROUND); g.stroke(); }
  for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(822, 340 + i * 11); g.lineTo(948, 340 + i * 11); g.stroke(); }
}

function drawRoseWindow(g) {
  const cx = W / 2, cy = 190;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const lg = g.createRadialGradient(cx, cy, 10, cx, cy, 170);
  lg.addColorStop(0, 'rgba(255,120,170,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg; g.beginPath(); g.arc(cx, cy, 170, 0, Math.PI * 2); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(20,6,26,0.95)'; g.lineWidth = 10;
  g.beginPath(); g.arc(cx, cy, 110, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
    g.lineTo(cx + Math.cos(a) * 110, cy + Math.sin(a) * 110); g.stroke();
    g.beginPath(); g.arc(cx + Math.cos(a) * 78, cy + Math.sin(a) * 78, 14, 0, Math.PI * 2); g.stroke();
  }
}

let vignette = null;
function getVignette() {
  if (vignette) return vignette;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.68);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,6,0.72)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  return (vignette = c);
}

/* -------------------------------- State -------------------------------- */

const S = {
  mode: 'loading', time: 0, roomIdx: 0, room: ROOMS[0],
  hero: null, enemies: [], projs: [], parts: [], fx: [], boss: null, motes: [],
  shake: 0, hitstop: 0, timeScale: 1,
  fade: 1, fadeTarget: 1, pending: null, holdT: 0,
  area: null, card: null, cleared: [], visited: [], deaths: 0, playTime: 0,
  spawnT: 0, introT: 0, gate: 0, gateTarget: 0, victoryT: -1, deadT: -1, endT: 0,
};

function makeHero() {
  return {
    x: 150, y: GROUND, vx: 0, vy: 0, w: 24, h: 54, facing: 1,
    onGround: true, onPlat: false, coyote: 0, jumpBuf: 0, atkBuf: 0, atkCd: 0, atkT: 0, atkDown: false,
    hitSet: null, hp: 5, maxHp: 5, inv: 0, kbT: 0, kbVx: 0, recoilT: 0, recoilVx: 0,
    dropT: 0, sx: 1, sy: 1, anim: 0, dead: false, fallV: 0, hidden: false,
  };
}

function makeEnemy(def) {
  const base = { type: def.type, x: def.x, y: def.y || GROUND, vx: 0, vy: 0, facing: -1, flash: 0,
    kbT: 0, kbVx: 0, anim: Math.random() * 10, state: 'idle', t: rand(0.3, 1), onGround: true, sx: 1, sy: 1, tilt: 0, dead: false };
  if (def.type === 'kicker') Object.assign(base, { w: 44, h: 84, hp: 3, dir: -1, kickCd: rand(0.5, 1.5), state: 'patrol' });
  if (def.type === 'hood') Object.assign(base, { w: 50, h: 84, hp: 4, state: 'wait', lungeCd: 0 });
  if (def.type === 'chicken') Object.assign(base, { w: 28, h: 26, hp: 1, speed: rand(150, 230), hopT: rand(0.5, 1.5), cluckT: rand(1, 3) });
  if (def.type === 'egg') Object.assign(base, { w: 16, h: 20, hp: 1, harmless: true, hatchT: -1, vx: def.vx, vy: def.vy, onGround: false, rot: 0 });
  return base;
}

function makeBoss() {
  return { type: 'boss', x: W - 240, y: -260, w: 110, h: 160, hp: 40, maxHp: 40, state: 'wait', sub: '', t: 0,
    facing: -1, flash: 0, phase: 1, vx: 0, vy: 0, last: '', lastSummon: -99, glow: 0, shakeAmt: 0, burstT: 0 };
}

/* ----------------------------- Room control ---------------------------- */

function loadRoom(idx, side) {
  S.roomIdx = idx; S.room = ROOMS[idx];
  S.enemies = []; S.projs = []; S.fx = []; S.parts = []; S.boss = null;
  if (!S.cleared[idx]) for (const d of S.room.enemies) S.enemies.push(makeEnemy(d));
  const h = S.hero;
  h.x = side === 'right' ? W - 40 : 40; h.y = GROUND; h.vx = 0; h.vy = 0; h.kbT = 0; h.atkT = 0;
  h.onGround = true; h.dead = false; h.hidden = false;
  if (S.room.boss) {
    h.hp = h.maxHp;
    if (!S.cleared[idx]) S.boss = makeBoss();
    S.gate = 0; S.gateTarget = 0;
    AU.setMusic('none');
  } else {
    AU.setMusic('ambient');
  }
  S.motes = [];
  for (let i = 0; i < 46; i++) S.motes.push(newMote(true));
  if (!S.visited[idx]) {
    S.visited[idx] = true;
    if (idx > 0) S.area = { title: S.room.title, sub: S.room.sub, t: 0 };
  }
}

function goRoom(idx, side) {
  if (S.pending) return;
  S.fadeTarget = 1;
  S.pending = { fn: () => loadRoom(idx, side), hold: 0.05 };
}

function newMote(anyY) {
  return { x: Math.random() * W, y: anyY ? Math.random() * H : H + 10, vy: rand(8, 26), ph: Math.random() * 6, r: rand(1, 2.6), a: rand(0.3, 0.9) };
}

function startGame() {
  S.mode = 'play'; S.time = 0; S.playTime = 0; S.deaths = 0;
  S.cleared = []; S.visited = []; S.victoryT = -1; S.deadT = -1;
  S.hero = makeHero();
  loadRoom(0, 'left');
  S.hero.x = 170; S.hero.y = 330; S.hero.hidden = true;
  S.spawnT = 1.5; S.introT = 0;
  S.fade = 1; S.fadeTarget = 0;
  AU.spawn();
}

function anyInput() {
  AU.init();
  if (S.mode === 'title') {
    startGame();
  } else if (S.mode === 'victory' && S.endT > 1.5) {
    S.mode = 'title'; AU.setMusic('none');
  }
}

/* ------------------------------- Particles ----------------------------- */

function burst(x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = o.angle != null ? o.angle + rand(-o.spread || -0.5, o.spread || 0.5) : rand(0, Math.PI * 2);
    const sp = rand(o.min || 60, o.max || 260);
    const life = rand(o.lmin || 0.3, o.lmax || 0.7);
    S.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: rand(o.smin || 1.5, o.smax || 4),
      color: o.color || '#fff', g: o.grav || 0, glow: !!o.glow, drag: o.drag || 2, kind: o.kind || 'dot', rot: rand(0, 6) });
  }
}
const dust = (x, y, n = 8) => burst(x, y - 3, n, { angle: -Math.PI / 2, spread: 1.4, min: 30, max: 140, color: 'rgba(170,185,230,0.55)', smin: 2, smax: 5, grav: -40, lmin: 0.3, lmax: 0.6 });

/* -------------------------------- Update ------------------------------- */

function update(dt) {
  S.time += dt;
  if (S.mode !== 'play') return;
  S.playTime += dt;

  // переходы/затемнение
  if (S.fade !== S.fadeTarget) {
    S.fade += sign(S.fadeTarget - S.fade) * dt * 3.2;
    S.fade = clamp(S.fade, 0, 1);
    if (Math.abs(S.fade - S.fadeTarget) < 0.01) S.fade = S.fadeTarget;
  }
  if (S.pending && S.fade >= 1) {
    S.holdT += dt;
    if (S.holdT >= S.pending.hold) { const p = S.pending; S.pending = null; S.holdT = 0; p.fn(); S.fadeTarget = 0; }
    return;
  }

  updateMotes(dt);
  updateParticles(dt);
  if (S.area) { S.area.t += dt; if (S.area.t > 4) S.area = null; }
  if (S.card) { S.card.t += dt; if (S.card.t > 3.6) S.card = null; }
  S.shake = Math.max(0, S.shake - dt * 30);
  S.gate = lerp(S.gate, S.gateTarget, Math.min(1, dt * 4));

  if (S.hitstop > 0) { S.hitstop -= dt; return; }
  const sdt = dt * S.timeScale;

  if (S.spawnT > 0) {
    S.spawnT -= dt;
    const h = S.hero;
    for (let i = 0; i < 3; i++) {
      const a = rand(0, Math.PI * 2), r = rand(60, 140);
      S.parts.push({ x: h.x + Math.cos(a) * r, y: h.y - 28 + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.6, vy: -Math.sin(a) * r * 1.6,
        life: 0.6, max: 0.6, size: rand(1.5, 3.5), color: '#cfe0ff', g: 0, glow: true, drag: 0, kind: 'dot' });
    }
    if (S.spawnT <= 0) {
      h.hidden = false; h.vy = 0;
      burst(h.x, h.y - 28, 40, { color: '#e6efff', glow: true, min: 80, max: 340, lmin: 0.4, lmax: 0.9 });
      S.shake = 6;
    }
    return;
  }
  if (S.roomIdx === 0) S.introT += dt;

  updateHero(sdt);
  for (const e of S.enemies) updateEnemy(e, sdt);
  S.enemies = S.enemies.filter((e) => !e.dead);
  if (S.boss) updateBoss(S.boss, sdt);
  updateProjs(sdt);
  for (const f of S.fx) f.t += sdt;
  S.fx = S.fx.filter((f) => f.t < f.max);

  if (!S.room.boss && !S.cleared[S.roomIdx] && S.room.enemies.length && S.enemies.length === 0) S.cleared[S.roomIdx] = true;

  // смерть героя
  if (S.deadT >= 0) {
    S.deadT += dt;
    if (S.deadT > 1.4 && !S.pending) {
      S.fadeTarget = 1;
      S.pending = { hold: 1.4, fn: () => { S.deadT = -1; S.timeScale = 1; S.hero.hp = S.hero.maxHp; S.hero.inv = 1; loadRoom(S.roomIdx, 'left'); } };
    }
  }

  // победа
  if (S.victoryT >= 0) {
    S.victoryT += dt;
    if (S.victoryT > 3.2) { S.mode = 'victory'; S.endT = 0; }
  }
}

function landBody(e, prevY, ignorePlats) {
  e.onGround = false; e.onPlat = false;
  if (e.y >= GROUND) { e.y = GROUND; e.vy = 0; e.onGround = true; return; }
  if (e.vy < 0 || ignorePlats) return;
  for (const p of S.room.plats) {
    if (e.x + e.w * 0.35 > p.x && e.x - e.w * 0.35 < p.x + p.w && prevY <= p.y + 0.5 && e.y >= p.y) {
      e.y = p.y; e.vy = 0; e.onGround = true; e.onPlat = true; return;
    }
  }
}

function heroBox(h) { return { x: h.x - 13, y: h.y - 62, w: 26, h: 60 }; }
function eBox(e) { return { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h }; }
function bossBox(b) { return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }; }

function updateHero(dt) {
  const h = S.hero;
  h.anim += dt;
  h.inv -= dt;
  if (h.dead) {
    h.vy = Math.min(h.vy + GRAV * 0.5 * dt, MAXFALL); h.y = Math.min(GROUND, h.y + h.vy * dt);
    return;
  }

  let move = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  if (h.atkT <= 0 && move) h.facing = move;
  let vx = move * SPEED;
  if (h.kbT > 0) { h.kbT -= dt; vx = h.kbVx; }
  else if (h.recoilT > 0) { h.recoilT -= dt; vx += h.recoilVx; }
  h.vx = vx;

  h.coyote = h.onGround ? 0.09 : h.coyote - dt;
  h.jumpBuf = pressed('jump') ? 0.12 : h.jumpBuf - dt;
  h.dropT -= dt;
  if (h.jumpBuf > 0 && h.coyote > 0 && h.kbT <= 0) {
    h.jumpBuf = 0; h.coyote = 0;
    if (held('down') && h.onPlat) { h.dropT = 0.22; h.y += 2; }
    else {
      h.vy = -JUMP; h.onGround = false; h.sx = 0.78; h.sy = 1.24;
      AU.jump(); dust(h.x, h.y, 6);
    }
  }
  if (!held('jump') && h.vy < 0) h.vy += GRAV * 1.7 * dt;
  h.vy = Math.min(h.vy + GRAV * dt, MAXFALL);

  h.x += h.vx * dt;
  const r = S.room, idx = S.roomIdx;
  const lockedLeft = r.boss && S.gateTarget > 0;
  if (h.x < 12) {
    if (idx > 0 && !lockedLeft && !r.boss) goRoom(idx - 1, 'right');
    h.x = lockedLeft ? Math.max(h.x, 40) : 12;
  }
  if (lockedLeft && h.x < 40) h.x = 40;
  if (h.x > W - 12) {
    if (idx < ROOMS.length - 1) goRoom(idx + 1, 'left');
    h.x = W - 12;
  }

  const prevY = h.y, fallV = h.vy, wasGround = h.onGround;
  h.y += h.vy * dt;
  landBody(h, prevY, h.dropT > 0);
  if (!wasGround && h.onGround && fallV > 350) {
    AU.land(); dust(h.x, h.y, 7); h.sx = 1.22; h.sy = 0.8;
  }

  // атака
  h.atkBuf = pressed('attack') ? 0.12 : h.atkBuf - dt;
  h.atkCd -= dt;
  if (h.atkBuf > 0 && h.atkCd <= 0 && h.kbT <= 0) {
    h.atkBuf = 0; h.atkCd = 0.3; h.atkT = 0.13;
    h.atkDown = !h.onGround && held('down');
    h.hitSet = new Set();
    S.fx.push({ type: 'slash', t: 0, max: 0.16, down: h.atkDown, dir: h.facing, flip: Math.random() < 0.5 });
    AU.slash();
  }
  if (h.atkT > 0) {
    h.atkT -= dt;
    const hb = h.atkDown ? { x: h.x - 30, y: h.y - 14, w: 60, h: 62 }
                         : { x: h.facing > 0 ? h.x + 4 : h.x - 80, y: h.y - 74, w: 76, h: 66 };
    let landed = false;
    for (const e of S.enemies) {
      if (e.dead || h.hitSet.has(e)) continue;
      if (overlap(hb, eBox(e))) { h.hitSet.add(e); damageEnemy(e, 1, h.atkDown ? 0 : h.facing); landed = true; }
    }
    const b = S.boss;
    if (b && !h.hitSet.has(b) && ['wait', 'intro', 'phase', 'dying'].indexOf(b.state) < 0 && overlap(hb, bossBox(b))) {
      h.hitSet.add(b); damageBoss(b); landed = true;
    }
    for (const p of S.projs) {
      if ((p.type === 'shard' || p.type === 'ball') && !h.hitSet.has(p) && overlap(hb, { x: p.x - 10, y: p.y - 10, w: 20, h: 20 })) {
        h.hitSet.add(p); p.dead = true; landed = true;
        burst(p.x, p.y, 10, { color: '#dfe8ff', glow: true, min: 80, max: 260 }); AU.hit();
      }
    }
    if (landed) {
      if (h.atkDown) { h.vy = -640; h.atkT = 0; }
      else { h.recoilT = 0.09; h.recoilVx = -h.facing * 260; }
    }
  }

  h.sx += (1 - h.sx) * Math.min(1, dt * 12);
  h.sy += (1 - h.sy) * Math.min(1, dt * 12);

  // урон от касания
  if (h.inv <= 0) {
    const hb = heroBox(h);
    for (const e of S.enemies) {
      if (!e.harmless && !e.dead && overlap(hb, eBox(e))) { hurtHero(e.x); break; }
    }
    const b = S.boss;
    if (b && h.inv <= 0 && ['wait', 'intro', 'dying'].indexOf(b.state) < 0 && overlap(hb, bossBox(b))) hurtHero(b.x);
  }
}

function hurtHero(srcX) {
  const h = S.hero;
  if (h.inv > 0 || h.dead || S.victoryT >= 0) return;
  h.hp--; h.inv = 1.3;
  h.kbT = 0.2; h.kbVx = (h.x < srcX ? -1 : 1) * 330; h.vy = -420; h.onGround = false; h.atkT = 0;
  S.shake = 12; S.hitstop = 0.14;
  AU.hurt();
  burst(h.x, h.y - 30, 22, { color: '#0a0812', min: 80, max: 300, smin: 2, smax: 5 });
  burst(h.x, h.y - 30, 10, { color: '#ffffff', glow: true, min: 100, max: 360 });
  if (h.hp <= 0) {
    h.dead = true; S.deadT = 0; S.deaths++; S.timeScale = 0.35;
    AU.deathSting();
    burst(h.x, h.y - 30, 50, { color: '#0a0812', min: 60, max: 400, smin: 2, smax: 6, lmax: 1.2 });
  }
}

function damageEnemy(e, dmg, dir) {
  e.hp -= dmg; e.flash = 0.14;
  if (dir) { e.kbT = 0.16; e.kbVx = dir * 300; }
  S.hitstop = 0.05; S.shake = Math.max(S.shake, 4);
  AU.hit();
  burst(e.x, e.y - e.h * 0.55, 12, { angle: dir ? (dir > 0 ? 0 : Math.PI) : -Math.PI / 2, spread: 0.8, color: '#ffffff', glow: true, min: 120, max: 380, lmin: 0.15, lmax: 0.35, kind: 'spark' });
  if (e.hp <= 0) killEnemy(e, dir);
}

function killEnemy(e, dir) {
  e.dead = true;
  const cy = e.y - e.h * 0.5;
  if (e.type === 'chicken') {
    AU.cluck(); AU.die();
    burst(e.x, cy, 18, { color: '#f4f1ea', kind: 'feather', min: 40, max: 200, grav: 140, drag: 3, lmin: 0.8, lmax: 1.6, smin: 3, smax: 5 });
  } else if (e.type === 'egg') {
    AU.crack();
    burst(e.x, cy, 10, { color: '#f3ead8', min: 40, max: 180, grav: 600, smin: 2, smax: 4 });
  } else {
    AU.die();
    S.shake = 8;
    burst(e.x, cy, 26, { color: '#ffa94a', glow: true, min: 60, max: 320, lmin: 0.4, lmax: 1.0 });
    burst(e.x, cy, 20, { color: '#0a0812', min: 50, max: 260, smin: 3, smax: 7, grav: 300 });
    S.fx.push({ type: 'ring', x: e.x, y: cy, t: 0, max: 0.4 });
  }
}

/* ---------------------------- Enemy behaviour --------------------------- */

function updateEnemy(e, dt) {
  const h = S.hero;
  e.anim += dt; e.flash -= dt;
  const dx = h.x - e.x, dy = h.y - e.y, adx = Math.abs(dx);
  let tsx = 1, tsy = 1, tilt = 0;

  if (e.type === 'kicker') {
    e.kickCd -= dt;
    if (e.state === 'patrol') {
      e.vx = e.dir * 70;
      if (e.x < 330) e.dir = 1; if (e.x > W - 60) e.dir = -1;
      tsy = 1 + Math.sin(e.anim * 14) * 0.04; tilt = Math.sin(e.anim * 7) * 0.07;
      if (!h.dead && adx < 360 && Math.abs(dy) < 140) {
        e.facing = sign(dx);
        if (e.kickCd <= 0 && adx > 170) { e.state = 'kickwind'; e.t = 0.45; }
        else if (adx < 280) { e.state = 'windup'; e.t = 0.42; }
      }
    } else if (e.state === 'windup') {
      e.vx = 0; tsx = 1.12; tsy = 0.86; tilt = -e.facing * 0.15;
      if ((e.t -= dt) <= 0) { e.state = 'charge'; e.t = 0.6; e.vx = e.facing * 380; AU.dash(); }
    } else if (e.state === 'charge') {
      tilt = e.facing * 0.22; tsy = 1 + Math.sin(e.anim * 30) * 0.06;
      if (Math.random() < 0.4) dust(e.x - e.facing * 14, e.y, 1);
      if ((e.t -= dt) <= 0 || e.x < 40 || e.x > W - 40) { e.state = 'rest'; e.t = 0.7; e.vx = 0; }
    } else if (e.state === 'kickwind') {
      e.vx = 0; tilt = -e.facing * 0.25; tsy = 0.9;
      if ((e.t -= dt) <= 0) {
        e.kickCd = rand(2.2, 3.2);
        const vx = clamp(dx * 1.25, -460, 460);
        S.projs.push({ type: 'ball', x: e.x + e.facing * 22, y: e.y - 20, vx, vy: -560, r: 10, life: 4, rot: 0, bounces: 0 });
        AU.kick(); e.state = 'rest'; e.t = 0.5;
      }
    } else if (e.state === 'rest') {
      e.vx = 0;
      if ((e.t -= dt) <= 0) { e.state = 'patrol'; e.dir = sign(dx); }
    }
  }

  if (e.type === 'hood') {
    e.lungeCd -= dt;
    if (e.state === 'wait') {
      if (e.onGround) e.vx *= Math.max(0, 1 - dt * 10);
      e.t -= dt;
      tsy = 1 + Math.sin(e.anim * 4) * 0.025;
      if (e.t < 0.25) { tsx = 1.12; tsy = 0.84; }
      if (e.t <= 0 && e.onGround && !h.dead) {
        e.facing = sign(dx);
        if (adx < 130 && e.lungeCd <= 0) {
          e.state = 'lunge'; e.vx = e.facing * 480; e.vy = -260; e.lungeCd = 2; e.t = 0.3; AU.dash();
        } else if (adx < 620) {
          e.state = 'hop'; e.vy = dy < -40 ? -860 : -720;
          e.vx = e.facing * Math.min(adx * 1.4, 300); AU.jump();
          dust(e.x, e.y, 6);
        } else e.t = 0.5;
      }
    } else {
      tsx = 0.9; tsy = 1.12; tilt = e.vx / 1600;
    }
  }

  if (e.type === 'chicken') {
    e.hopT -= dt; e.cluckT -= dt;
    if (!h.dead) e.facing = sign(dx);
    if (e.kbT <= 0) e.vx = lerp(e.vx, e.facing * e.speed, Math.min(1, dt * 5));
    if (e.hopT <= 0 && e.onGround) { e.vy = rand(-520, -340); e.hopT = rand(0.7, 1.8); }
    if (e.cluckT <= 0) { AU.cluck(); e.cluckT = rand(2.5, 5); }
    if (Math.random() < 0.05 && e.onGround) dust(e.x, e.y, 1);
  }

  if (e.type === 'egg') {
    e.rot += e.vx * dt * 0.05;
    if (e.onGround) {
      e.vx *= Math.max(0, 1 - dt * 8);
      if (e.hatchT < 0) { e.hatchT = 0.7; AU.bounce(); }
      e.hatchT -= dt;
      e.rot = Math.sin(S.time * 40) * 0.25 * (1 - e.hatchT);
      if (e.hatchT <= 0) {
        e.dead = true; AU.crack(); AU.cluck(0.05);
        burst(e.x, e.y - 10, 12, { color: '#f3ead8', min: 40, max: 200, grav: 600, smin: 2, smax: 4 });
        const c = makeEnemy({ type: 'chicken', x: e.x, y: e.y }); c.vy = -300; c.onGround = false;
        S.enemies.push(c);
        return;
      }
    }
  }

  if (e.kbT > 0) { e.kbT -= dt; e.vx = e.kbVx; if (e.kbT <= 0) e.vx = 0; }

  e.vy = Math.min(e.vy + GRAV * dt, MAXFALL);
  e.x += e.vx * dt;
  e.x = clamp(e.x, 20 + e.w / 2, W - 20 - e.w / 2);
  const prevY = e.y;
  e.y += e.vy * dt;
  const wasG = e.onGround;
  landBody(e, prevY, false);
  if (e.type === 'hood' && e.state !== 'wait' && e.onGround && !wasG) {
    dust(e.x, e.y, 7); e.state = 'wait'; e.t = rand(0.55, 1.1); e.sx = 1.25; e.sy = 0.78; e.vx *= 0.3;
  }

  e.sx = lerp(e.sx, tsx, Math.min(1, dt * 12));
  e.sy = lerp(e.sy, tsy, Math.min(1, dt * 12));
  e.tilt = lerp(e.tilt, tilt, Math.min(1, dt * 10));
}

/* --------------------------------- Boss -------------------------------- */

const HOVER_Y = 285, LOW_Y = GROUND - 82;

function damageBoss(b) {
  b.hp--; b.flash = 0.12;
  S.hitstop = 0.05; S.shake = Math.max(S.shake, 5);
  AU.bossHit();
  const h = S.hero;
  burst(b.x + (h.x < b.x ? -30 : 30), b.y - 10, 14, { color: '#bcd6ff', glow: true, min: 120, max: 400, lmin: 0.15, lmax: 0.4, kind: 'spark' });
  if (b.hp <= 0) {
    b.state = 'dying'; b.t = 2.6; b.burstT = 0;
    S.timeScale = 0.6; AU.setMusic('none'); AU.roar();
    for (const e of S.enemies) if (!e.dead) killEnemy(e, 0);
    S.projs = [];
  } else if (b.phase === 1 && b.hp <= b.maxHp / 2) {
    b.phase = 2; b.state = 'phase'; b.t = 1.4; AU.roar(); S.shake = 14;
  }
}

function bossPick(b) {
  const p2 = b.phase === 2;
  const chickens = S.enemies.filter((e) => e.type === 'chicken' || e.type === 'egg').length;
  const opts = [
    ['dash', 3], ['slam', 3], ['shards', p2 ? 3 : 2],
    ['summon', chickens < 4 && S.time - b.lastSummon > 5 ? 3.5 : 0],
  ].filter((o) => o[0] !== b.last && o[1] > 0);
  let tot = opts.reduce((s, o) => s + o[1], 0), r = Math.random() * tot;
  for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
  return 'dash';
}

function updateBoss(b, dt) {
  const h = S.hero;
  b.flash -= dt; b.glow = Math.max(0, b.glow - dt * 1.5);
  const p2 = b.phase === 2;
  const face = () => { b.facing = h.x > b.x ? 1 : -1; };

  switch (b.state) {
    case 'wait':
      if (h.x > 270 && !h.dead) {
        b.state = 'intro'; b.t = 0;
        S.gateTarget = 1; AU.gate();
      }
      break;
    case 'intro':
      b.t += dt;
      b.y = lerp(-260, HOVER_Y, 1 - Math.pow(1 - clamp(b.t / 1.6, 0, 1), 3));
      face();
      if (b.t > 0.9 && !b.roared) {
        b.roared = true; AU.roar(); S.shake = 16; b.glow = 1;
        S.card = { top: 'Синий Ткач', big: 'СТРАЖ ШПИЛЯ', t: 0 }; S.area = null;
        AU.setMusic('boss');
      }
      if (b.t > 2.8) { b.state = 'idle'; b.t = 0.6; }
      break;
    case 'idle': {
      face();
      const tx = clamp(h.x + (b.x > h.x ? 230 : -230), 130, W - 130);
      b.x += clamp(tx - b.x, -1, 1) * Math.min(Math.abs(tx - b.x), (p2 ? 200 : 140) * dt);
      b.y = lerp(b.y, HOVER_Y + Math.sin(S.time * 2.2) * 14, Math.min(1, dt * 3));
      if ((b.t -= dt) <= 0 && !h.dead) {
        const a = bossPick(b); b.last = a; b.state = a; b.sub = 'prep';
        if (a === 'dash') { b.t = p2 ? 0.5 : 0.65; b.glow = 1; }
        if (a === 'slam') { b.t = 0.6; b.sub = 'rise'; }
        if (a === 'summon') { b.t = 1.1; b.spawned = false; b.glow = 1; b.lastSummon = S.time; }
        if (a === 'shards') { b.t = 0.5; b.glow = 1; }
      }
      break;
    }
    case 'dash':
      if (b.sub === 'prep') {
        face();
        b.y = lerp(b.y, LOW_Y, Math.min(1, dt * 6));
        b.x -= b.facing * 60 * dt;
        b.shakeAmt = 2;
        if ((b.t -= dt) <= 0) { b.sub = 'go'; b.vx = b.facing * (p2 ? 900 : 760); AU.dash(); AU.roar(); b.shakeAmt = 0; }
      } else if (b.sub === 'go') {
        b.x += b.vx * dt;
        if (Math.random() < 0.6) dust(b.x - b.facing * 40, GROUND, 2);
        S.parts.push({ x: b.x + rand(-40, 40), y: b.y + rand(-60, 60), vx: -b.vx * 0.1, vy: 0, life: 0.35, max: 0.35, size: rand(2, 5), color: '#6d8fff', g: 0, glow: true, drag: 1, kind: 'dot' });
        if (b.x < 85 || b.x > W - 85) {
          b.x = clamp(b.x, 85, W - 85); b.sub = 'stun'; b.t = 0.6;
          S.shake = 10; AU.slam(); dust(b.x + b.facing * 50, GROUND, 14);
        }
      } else if (b.sub === 'stun') {
        b.shakeAmt = 1.5;
        if ((b.t -= dt) <= 0) { b.state = 'idle'; b.t = p2 ? rand(0.45, 0.7) : rand(0.8, 1.2); b.shakeAmt = 0; }
      }
      break;
    case 'slam':
      if (b.sub === 'rise') {
        b.x = lerp(b.x, clamp(h.x, 90, W - 90), Math.min(1, dt * 5));
        b.y = lerp(b.y, 130, Math.min(1, dt * 5));
        if ((b.t -= dt) <= 0) { b.sub = 'hang'; b.t = p2 ? 0.2 : 0.32; b.glow = 1; }
      } else if (b.sub === 'hang') {
        b.shakeAmt = 3;
        if ((b.t -= dt) <= 0) { b.sub = 'fall'; b.vy = 300; b.shakeAmt = 0; }
      } else if (b.sub === 'fall') {
        b.vy += 3600 * dt; b.y += b.vy * dt;
        if (b.y >= LOW_Y) {
          b.y = LOW_Y; b.sub = 'rec'; b.t = 0.65;
          S.shake = 18; AU.slam(); dust(b.x, GROUND, 24);
          const sp = p2 ? 470 : 380;
          S.projs.push({ type: 'wave', x: b.x - 40, y: GROUND, vx: -sp, life: 3 });
          S.projs.push({ type: 'wave', x: b.x + 40, y: GROUND, vx: sp, life: 3 });
        }
      } else if ((b.t -= dt) <= 0) { b.state = 'idle'; b.t = p2 ? rand(0.45, 0.7) : rand(0.8, 1.2); }
      break;
    case 'summon':
      b.shakeAmt = 2; face();
      b.y = lerp(b.y, HOVER_Y - 30, Math.min(1, dt * 3));
      b.t -= dt;
      if (b.t < 0.6 && !b.spawned) {
        b.spawned = true;
        const n = p2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const e = makeEnemy({ type: 'egg', x: b.x + rand(-20, 20), y: b.y + 50, vx: rand(90, 240) * (i % 2 ? 1 : -1), vy: rand(-380, -220) });
          e.onGround = false; S.enemies.push(e);
        }
        AU.cluck(); AU.cluck(0.25);
        burst(b.x, b.y + 40, 20, { color: '#ffe9b0', glow: true, min: 60, max: 240 });
      }
      if (b.t <= 0) { b.state = 'idle'; b.t = p2 ? rand(0.5, 0.8) : rand(0.9, 1.3); b.shakeAmt = 0; }
      break;
    case 'shards':
      face();
      if (b.sub === 'prep') {
        b.shakeAmt = 1.5;
        if ((b.t -= dt) <= 0) {
          const n = p2 ? 5 : 3, base = Math.atan2(h.y - 28 - b.y, h.x - b.x);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.2, sp = p2 ? 480 : 420;
            S.projs.push({ type: 'shard', x: b.x + Math.cos(a) * 50, y: b.y + Math.sin(a) * 50, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3.5 });
          }
          AU.shard(); b.sub = 'rec'; b.t = 0.6; b.shakeAmt = 0;
        }
      } else if ((b.t -= dt) <= 0) { b.state = 'idle'; b.t = p2 ? rand(0.45, 0.7) : rand(0.8, 1.2); }
      break;
    case 'phase':
      b.shakeAmt = 4; b.glow = 1;
      b.y = lerp(b.y, HOVER_Y - 40, Math.min(1, dt * 3));
      if (Math.random() < 0.5) burst(b.x, b.y, 2, { color: '#ff7ab0', glow: true, min: 100, max: 300 });
      if ((b.t -= dt) <= 0) { b.state = 'idle'; b.t = 0.4; b.shakeAmt = 0; }
      break;
    case 'dying':
      b.shakeAmt = 5; b.t -= dt; b.burstT -= dt;
      b.y = lerp(b.y, LOW_Y, Math.min(1, dt * 1.5));
      if (b.burstT <= 0) {
        b.burstT = 0.14;
        burst(b.x + rand(-60, 60), b.y + rand(-80, 80), 10, { color: Math.random() < 0.5 ? '#ffa94a' : '#9fc0ff', glow: true, min: 80, max: 320 });
        AU.hit(); S.shake = 6;
      }
      if (b.t <= 0) {
        S.shake = 24; AU.slam(); AU.die();
        burst(b.x, b.y, 90, { color: '#ffffff', glow: true, min: 100, max: 700, lmin: 0.6, lmax: 1.6 });
        burst(b.x, b.y, 60, { color: '#3a5bd0', min: 80, max: 500, smin: 3, smax: 8, grav: 400, lmax: 1.5 });
        S.fx.push({ type: 'ring', x: b.x, y: b.y, t: 0, max: 0.8, big: true });
        S.boss = null; S.cleared[S.roomIdx] = true; S.gateTarget = 0;
        S.timeScale = 1; S.victoryT = 0; AU.victory();
      }
      break;
  }
  if (S.boss && b.state !== 'slam') b.x = clamp(b.x, 85, W - 85);
}

/* ------------------------------ Projectiles ---------------------------- */

function updateProjs(dt) {
  const h = S.hero, hb = heroBox(h);
  for (const p of S.projs) {
    p.life -= dt;
    if (p.type === 'ball') {
      p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vx * dt * 0.06;
      if (p.y > GROUND - p.r) { p.y = GROUND - p.r; p.vy *= -0.62; p.vx *= 0.85; p.bounces++; AU.bounce(); if (p.bounces > 3) p.life = Math.min(p.life, 0.4); }
      if (p.x < 10 || p.x > W - 10) { p.vx *= -0.8; p.x = clamp(p.x, 10, W - 10); }
    } else if (p.type === 'wave') {
      p.x += p.vx * dt;
      if (Math.random() < 0.5) burst(p.x, GROUND - 4, 1, { angle: -Math.PI / 2, spread: 0.6, color: '#a6c4ff', glow: true, min: 60, max: 200, lmax: 0.4 });
      if (p.x < -40 || p.x > W + 40) p.dead = true;
    } else if (p.type === 'shard') {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > GROUND) { p.dead = true; burst(p.x, GROUND - 2, 8, { color: '#cfd8ea', min: 40, max: 180, grav: 500 }); }
      if (p.x < -40 || p.x > W + 40 || p.y < -40) p.dead = true;
    }
    if (p.life <= 0) p.dead = true;
    if (p.dead || h.dead || h.inv > 0) continue;
    const box = p.type === 'wave' ? { x: p.x - 12, y: GROUND - 34, w: 24, h: 34 } : { x: p.x - 9, y: p.y - 9, w: 18, h: 18 };
    if (overlap(hb, box)) { hurtHero(p.x); if (p.type !== 'wave') p.dead = true; }
  }
  S.projs = S.projs.filter((p) => !p.dead);
}

function updateParticles(dt) {
  for (const p of S.parts) {
    p.life -= dt;
    p.vx *= Math.max(0, 1 - p.drag * dt); p.vy *= Math.max(0, 1 - p.drag * dt);
    p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 4;
    if (p.kind === 'feather') p.x += Math.sin(p.life * 6) * 20 * dt;
  }
  S.parts = S.parts.filter((p) => p.life > 0);
  if (S.parts.length > 900) S.parts.splice(0, S.parts.length - 900);
}

function updateMotes(dt) {
  for (let i = 0; i < S.motes.length; i++) {
    const m = S.motes[i];
    m.y -= m.vy * dt; m.ph += dt; m.x += Math.sin(m.ph * 0.8) * 8 * dt;
    if (m.y < -10) S.motes[i] = newMote(false);
  }
}

/* ------------------------------- Drawing ------------------------------- */

const OUT = '#0b0810';

function drawSword(g, x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
  g.save(); g.translate(x1, y1); g.rotate(a);
  g.lineWidth = 1.6; g.strokeStyle = OUT;
  g.fillStyle = '#c9ced8';
  g.beginPath(); g.arc(0, 0, 4.2, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#4a4f5c'; g.beginPath(); g.arc(0, 0, 1.8, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2a33'; g.fillRect(4, -1.8, 7, 3.6); g.strokeRect(4, -1.8, 7, 3.6);
  g.fillStyle = '#b8bec9'; rr(g, 10, -4.5, 3, 9, 1); g.fill(); g.stroke();
  g.fillStyle = '#e4e8ef';
  g.beginPath(); g.moveTo(13, -3); g.lineTo(len - 6, -2.4); g.lineTo(len, 0); g.lineTo(len - 6, 2.4); g.lineTo(13, 3); g.closePath();
  g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(15, -1); g.lineTo(len - 6, -0.8); g.stroke();
  g.restore();
}

function drawTigerPatch(g, x, y) {
  g.fillStyle = '#e39a3b'; g.strokeStyle = OUT; g.lineWidth = 1;
  g.beginPath(); g.ellipse(x, y, 4.6, 5.4, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#f6e6c8';
  g.beginPath(); g.ellipse(x, y + 2.2, 2.6, 2.2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a0f0a'; g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(x - 3, y - 4); g.lineTo(x - 1.5, y - 2); g.moveTo(x + 3, y - 4); g.lineTo(x + 1.5, y - 2);
  g.moveTo(x, y - 5); g.lineTo(x, y - 3); g.moveTo(x - 4.2, y); g.lineTo(x - 2.5, y + 0.5); g.moveTo(x + 4.2, y); g.lineTo(x + 2.5, y + 0.5);
  g.stroke();
  g.fillStyle = '#1a0f0a';
  g.fillRect(x - 2, y - 1, 1.2, 1.2); g.fillRect(x + 0.9, y - 1, 1.2, 1.2);
}

function drawHero(g, h) {
  if (h.hidden) return;
  g.save();
  if (h.inv > 0 && !h.dead && Math.floor(h.inv * 18) % 2) g.globalAlpha = 0.35;
  if (h.dead) g.globalAlpha = Math.max(0, 1 - S.deadT * 0.8);
  g.translate(h.x, h.y);
  // тень
  g.fillStyle = 'rgba(0,0,0,0.35)';
  if (h.onGround) { g.beginPath(); g.ellipse(0, 0, 16, 4, 0, 0, Math.PI * 2); g.fill(); }
  g.scale(h.facing * h.sx * 1.2, h.sy * 1.2);
  if (h.dead) g.rotate(-0.4);
  g.lineJoin = 'round'; g.lineCap = 'round';

  const t = h.anim;
  const running = h.onGround && Math.abs(h.vx) > 20;
  const lp = running ? Math.sin(t * 18) * 4 : 0;
  const bob = running ? -Math.abs(Math.sin(t * 18)) * 2.5 : Math.sin(t * 2.5) * 0.8;
  const air = !h.onGround;

  // ноги
  g.fillStyle = '#0e0c14'; g.strokeStyle = OUT; g.lineWidth = 1.5;
  rr(g, -8 + lp, -9, 6, 9, 2); g.fill(); g.stroke();
  rr(g, 2 - lp, -9, 6, 9, 2); g.fill(); g.stroke();

  g.translate(0, bob);
  const attacking = h.atkT > 0 || S.fx.some((f) => f.type === 'slash');

  // меч за спиной
  if (!attacking) drawSword(g, 7, -27, -22, -1);

  // плащ
  const sway = -Math.min(Math.abs(h.vx) / SPEED, 1) * 5 + Math.sin(t * 3) * 0.8 + (air ? (h.vy < 0 ? -2 : 3) : 0);
  g.fillStyle = '#15111c'; g.strokeStyle = OUT; g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-9, -30);
  g.quadraticCurveTo(-14 + sway * 0.4, -18, -16 + sway, -5 + (air ? -2 : 0));
  g.lineTo(-10 + sway * 0.7, -8);
  g.lineTo(-4 + sway * 0.4, -4);
  g.lineTo(2, -7);
  g.lineTo(8, -4);
  g.lineTo(15, -6);
  g.quadraticCurveTo(14, -20, 9, -30);
  g.closePath(); g.fill(); g.stroke();
  // огненные узоры
  g.strokeStyle = '#b7342c'; g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(-10 + sway * 0.6, -9); g.quadraticCurveTo(-7, -14, -9, -19);
  g.moveTo(11, -8); g.quadraticCurveTo(9, -13, 12, -18);
  g.moveTo(1, -8); g.quadraticCurveTo(3, -12, 0, -15);
  g.stroke();
  drawTigerPatch(g, -5, -17);
  drawTigerPatch(g, 8, -17);

  // голова
  g.fillStyle = '#f1d4bd'; g.strokeStyle = OUT; g.lineWidth = 2.4;
  g.beginPath(); g.ellipse(2, -46, 16.5, 18, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  // борода по линии челюсти
  g.fillStyle = '#7a4d2c'; g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-10, -37); g.quadraticCurveTo(-6, -29, 0, -28.5); g.lineTo(3, -24); g.lineTo(6, -28.5);
  g.quadraticCurveTo(12, -29, 15, -37); g.quadraticCurveTo(11, -31, 3, -31.5); g.quadraticCurveTo(-6, -31, -10, -37);
  g.fill(); g.stroke();
  // усы
  g.fillStyle = '#8a5a34';
  g.beginPath();
  g.moveTo(3, -36.5);
  g.quadraticCurveTo(-2, -38.5, -6, -35); g.quadraticCurveTo(-8, -33.5, -9, -35);
  g.quadraticCurveTo(-5, -32, 3, -33.8);
  g.quadraticCurveTo(11, -32, 15, -35); g.quadraticCurveTo(14, -33.5, 12, -35);
  g.quadraticCurveTo(8, -38.5, 3, -36.5);
  g.fill(); g.stroke();
  // глаза
  const blink = (t % 3.7) < 0.12;
  g.fillStyle = '#050407';
  g.beginPath(); g.ellipse(-4, -47, 3.9, blink ? 0.7 : 6.2, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(8.5, -47, 3.9, blink ? 0.7 : 6.2, 0, 0, Math.PI * 2); g.fill();
  // волосы
  g.fillStyle = '#8a5a34'; g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-13, -55);
  g.quadraticCurveTo(-13, -65, -4, -67);
  g.quadraticCurveTo(8, -70, 15, -63);
  g.quadraticCurveTo(20, -58, 18, -52);
  g.quadraticCurveTo(15, -58, 9, -58.5);
  g.quadraticCurveTo(2, -61, -4, -58.5);
  g.quadraticCurveTo(-9, -58, -13, -55);
  g.fill(); g.stroke();
  g.strokeStyle = '#b3804f'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-4, -64); g.quadraticCurveTo(5, -67, 12, -62); g.stroke();
  // наушники
  g.strokeStyle = OUT; g.lineWidth = 6.5;
  g.beginPath(); g.ellipse(2, -48, 20, 21, 0, Math.PI * 1.04, Math.PI * 1.96); g.stroke();
  g.strokeStyle = '#2a2833'; g.lineWidth = 3.5;
  g.beginPath(); g.ellipse(2, -48, 20, 21, 0, Math.PI * 1.06, Math.PI * 1.94); g.stroke();
  g.fillStyle = '#1d1b25'; g.strokeStyle = OUT; g.lineWidth = 1.8;
  rr(g, -21, -54, 8, 15, 3.5); g.fill(); g.stroke();
  rr(g, 17, -54, 8, 15, 3.5); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(120,120,150,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.arc(-17, -46.5, 2.5, 0, Math.PI * 2); g.stroke();

  // меч в руке при атаке
  if (attacking) {
    if (h.atkDown) drawSword(g, 2, -18, 6, 16);
    else drawSword(g, 6, -22, 46, -27);
  }
  g.restore();
}

function drawSlashFx(g, f) {
  const h = S.hero, k = f.t / f.max;
  g.save();
  if (f.down) { g.translate(h.x, h.y + 10); g.rotate(Math.PI / 2); }
  else { g.translate(h.x + h.facing * 26, h.y - 40); g.scale(h.facing, f.flip ? -1 : 1); }
  g.globalAlpha = 1 - k * k;
  g.globalCompositeOperation = 'lighter';
  const R = 40 + k * 8;
  const grd = g.createRadialGradient(-6, 0, R * 0.6, 0, 0, R);
  grd.addColorStop(0, 'rgba(160,190,255,0)'); grd.addColorStop(0.7, 'rgba(200,220,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, R, -1.2, 1.2); g.arc(-14, 0, R - 6, 1.05, -1.05, true); g.closePath(); g.fill();
  g.restore();
}

function drawMobSprite(g, e, img, white, dispH) {
  if (!img) return;
  const k = dispH / img.height, dw = img.width * k;
  g.save();
  g.translate(e.x, e.y);
  if (e.onGround) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(0, 0, e.w * 0.55, 5, 0, 0, Math.PI * 2); g.fill(); }
  g.rotate(e.tilt);
  g.scale(e.sx, e.sy);
  g.drawImage(img, -dw / 2, -dispH + 4, dw, dispH);
  if (e.flash > 0 && white) {
    g.globalAlpha = clamp(e.flash / 0.14, 0, 1);
    g.drawImage(white, -dw / 2, -dispH + 4, dw, dispH);
  }
  g.restore();
}

function drawChicken(g, c) {
  g.save(); g.translate(c.x, c.y);
  if (c.onGround) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(0, 0, 12, 3, 0, 0, Math.PI * 2); g.fill(); }
  g.scale(c.facing, 1);
  const run = Math.sin(c.anim * 24);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#e8a23a'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(-3, -7); g.lineTo(-3 + run * 4, 0); g.moveTo(3, -7); g.lineTo(3 - run * 4, 0); g.stroke();
  g.fillStyle = '#f4f1ea'; g.strokeStyle = OUT; g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(-10, -16); g.lineTo(-17, -27); g.lineTo(-13, -21); g.lineTo(-18, -20); g.lineTo(-10, -12); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(0, -14, 12, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ddd5c6'; g.lineWidth = 1.2;
  g.beginPath(); g.ellipse(-2, -14, 6.5, 4, Math.sin(c.anim * 30) * (c.onGround ? 0.2 : 0.8), 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#d8322f';
  g.beginPath(); g.arc(7, -29, 2.6, 0, Math.PI * 2); g.arc(10.5, -29.5, 2.4, 0, Math.PI * 2); g.arc(13, -27.5, 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f4f1ea'; g.strokeStyle = OUT; g.lineWidth = 1.6;
  g.beginPath(); g.arc(10, -22, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#f0b030';
  g.beginPath(); g.moveTo(15.5, -24); g.lineTo(21, -21.5); g.lineTo(15.5, -19.5); g.closePath(); g.fill(); g.lineWidth = 1; g.stroke();
  g.fillStyle = '#d8322f'; g.beginPath(); g.ellipse(15, -16.5, 1.8, 2.8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(11.5, -23.5, 1.5, 0, Math.PI * 2); g.fill();
  if (c.flash > 0) { g.globalAlpha = clamp(c.flash / 0.14, 0, 1); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(2, -16, 16, 14, 0, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

function drawEgg(g, e) {
  g.save(); g.translate(e.x, e.y - 10); g.rotate(e.rot);
  g.fillStyle = '#f3ead8'; g.strokeStyle = OUT; g.lineWidth = 1.6;
  g.beginPath(); g.ellipse(0, 0, 7.5, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = 'rgba(160,130,90,0.5)';
  g.beginPath(); g.arc(-2, -3, 1.3, 0, Math.PI * 2); g.arc(3, 2, 1, 0, Math.PI * 2); g.fill();
  if (e.hatchT >= 0 && e.hatchT < 0.4) {
    g.strokeStyle = OUT; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-7, -1); g.lineTo(-3, -4); g.lineTo(0, 0); g.lineTo(3, -4); g.lineTo(7, -1); g.stroke();
  }
  g.restore();
}

function drawBoss(g, b) {
  const img = IMG.boss; if (!img) return;
  const dispH = 230, k = dispH / img.height, dw = img.width * k;
  let x = b.x, y = b.y;
  if (b.shakeAmt) { x += rand(-b.shakeAmt, b.shakeAmt); y += rand(-b.shakeAmt, b.shakeAmt); }
  const fl = 0.5 + 0.5 * Math.sin(S.time * 2.2);
  // тень
  const sh = clamp(1 - (GROUND - (b.y + 80)) / 300, 0.15, 1);
  g.fillStyle = `rgba(0,0,0,${0.45 * sh})`;
  g.beginPath(); g.ellipse(b.x, GROUND, 70 * sh, 8 * sh, 0, 0, Math.PI * 2); g.fill();
  g.save();
  g.translate(x, y - 25);
  g.rotate(Math.sin(S.time * 1.7) * 0.03 + (b.state === 'dash' && b.sub === 'go' ? b.facing * 0.25 : 0));
  g.scale(b.facing > 0 ? -1 : 1, 1);
  // аура
  g.save(); g.globalCompositeOperation = 'lighter';
  const ar = g.createRadialGradient(0, 0, 20, 0, 0, 170);
  const ac = b.phase === 2 ? '255,90,150' : '90,130,255';
  ar.addColorStop(0, `rgba(${ac},${0.12 + b.glow * 0.25})`); ar.addColorStop(1, `rgba(${ac},0)`);
  g.fillStyle = ar; g.beginPath(); g.arc(0, 0, 170, 0, Math.PI * 2); g.fill();
  g.restore();
  g.drawImage(img, -dw / 2, -dispH / 2, dw, dispH);
  if (b.flash > 0 && IMG.bossW) { g.globalAlpha = clamp(b.flash / 0.12, 0, 0.85); g.drawImage(IMG.bossW, -dw / 2, -dispH / 2, dw, dispH); g.globalAlpha = 1; }
  // светящиеся глаза
  g.globalCompositeOperation = 'lighter';
  const ex = -dw / 2 + dw * 0.385, ex2 = -dw / 2 + dw * 0.47, ey = -dispH / 2 + dispH * 0.272;
  for (const xx of [ex, ex2]) {
    const r = 9 + b.glow * 14 + fl * 3;
    const eg = g.createRadialGradient(xx, ey, 0, xx, ey, r);
    eg.addColorStop(0, 'rgba(255,200,100,0.9)'); eg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = eg; g.beginPath(); g.arc(xx, ey, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function drawProj(g, p) {
  g.save();
  if (p.type === 'ball') {
    g.translate(p.x, p.y); g.rotate(p.rot);
    g.fillStyle = '#f5f5f5'; g.strokeStyle = OUT; g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#111';
    g.beginPath();
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 0.4; g.lineTo(Math.cos(a) * 3.8, Math.sin(a) * 3.8); }
    g.closePath(); g.fill();
    g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 0.4; g.moveTo(Math.cos(a) * 3.8, Math.sin(a) * 3.8); g.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r); }
    g.stroke();
  } else if (p.type === 'wave') {
    g.translate(p.x, GROUND);
    g.globalCompositeOperation = 'lighter';
    const fl = 0.8 + Math.random() * 0.2;
    const lg = g.createLinearGradient(0, -40, 0, 0);
    lg.addColorStop(0, 'rgba(140,170,255,0)'); lg.addColorStop(1, `rgba(190,215,255,${fl})`);
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(-16, 0); g.quadraticCurveTo(-6, -20, sign(p.vx) * 4, -38); g.quadraticCurveTo(10, -14, 16, 0); g.closePath(); g.fill();
  } else if (p.type === 'shard') {
    g.translate(p.x, p.y); g.rotate(Math.atan2(p.vy, p.vx));
    g.save(); g.globalCompositeOperation = 'lighter';
    const tg = g.createLinearGradient(-40, 0, 0, 0);
    tg.addColorStop(0, 'rgba(120,150,255,0)'); tg.addColorStop(1, 'rgba(150,180,255,0.6)');
    g.fillStyle = tg; g.fillRect(-42, -3, 40, 6);
    g.restore();
    g.fillStyle = '#d6dbe4'; g.strokeStyle = OUT; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(16, 0); g.lineTo(0, -5); g.lineTo(-14, 0); g.lineTo(0, 5); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(-10, 0); g.lineTo(13, 0); g.stroke();
  }
  g.restore();
}

function drawParticles(g) {
  for (const glow of [false, true]) {
    g.save();
    if (glow) g.globalCompositeOperation = 'lighter';
    for (const p of S.parts) {
      if (p.glow !== glow) continue;
      const a = clamp(p.life / p.max, 0, 1);
      g.globalAlpha = a; g.fillStyle = p.color;
      if (p.kind === 'spark') {
        g.strokeStyle = p.color; g.lineWidth = p.size * 0.7;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke();
      } else if (p.kind === 'feather') {
        g.save(); g.translate(p.x, p.y); g.rotate(Math.sin(p.rot) * 1.2);
        g.beginPath(); g.ellipse(0, 0, p.size * 1.4, p.size * 0.5, 0, 0, Math.PI * 2); g.fill(); g.restore();
      } else {
        g.beginPath(); g.arc(p.x, p.y, p.size * (glow ? 0.6 + a * 0.4 : 1), 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }
}

function drawMotes(g) {
  const c = S.room.theme.mote;
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const m of S.motes) {
    const a = m.a * (0.5 + 0.5 * Math.sin(m.ph * 2));
    g.fillStyle = `rgba(${c},${a * 0.25})`;
    g.beginPath(); g.arc(m.x, m.y, m.r * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(${c},${a})`;
    g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function drawGate(g) {
  if (!S.room.boss) return;
  const p = S.gate;
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, 18, GROUND);
  if (p < 0.01) return;
  const bottom = -40 + (GROUND + 40) * p;
  g.fillStyle = '#0b0712'; g.strokeStyle = 'rgba(200,130,170,0.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const x = 6 + i * 10;
    g.fillRect(x, 0, 6, bottom);
    g.beginPath(); g.moveTo(x - 2, bottom); g.lineTo(x + 3, bottom + 12); g.lineTo(x + 8, bottom); g.fill(); g.stroke();
  }
  g.fillRect(0, bottom - 40, 36, 6); g.fillRect(0, bottom - 120, 36, 6);
}

function drawExitHint(g) {
  if (S.roomIdx >= ROOMS.length - 1) return;
  g.save(); g.globalCompositeOperation = 'lighter';
  const a = 0.25 + 0.15 * Math.sin(S.time * 2.5);
  const lg = g.createLinearGradient(W - 70, 0, W, 0);
  lg.addColorStop(0, 'rgba(160,190,255,0)'); lg.addColorStop(1, `rgba(160,190,255,${a})`);
  g.fillStyle = lg; g.fillRect(W - 70, GROUND - 160, 70, 160);
  g.restore();
}

function drawMask(g, x, y, full) {
  g.save(); g.translate(x, y);
  g.lineWidth = 2; g.strokeStyle = full ? '#0b0810' : 'rgba(180,200,255,0.4)';
  g.fillStyle = full ? '#f1e9e1' : 'rgba(10,12,24,0.6)';
  g.beginPath(); g.moveTo(-9, -6); g.quadraticCurveTo(-11, -16, 0, -17); g.quadraticCurveTo(11, -16, 9, -6);
  g.quadraticCurveTo(10, 8, 0, 12); g.quadraticCurveTo(-10, 8, -9, -6); g.fill(); g.stroke();
  if (full) {
    g.fillStyle = '#0b0810';
    g.beginPath(); g.ellipse(-3.5, -3, 2.3, 4, 0, 0, Math.PI * 2); g.ellipse(3.5, -3, 2.3, 4, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

function drawHUD(g) {
  const h = S.hero;
  g.save();
  g.fillStyle = 'rgba(5,6,14,0.45)';
  rr(g, 18, 16, 28 + h.maxHp * 30, 44, 22); g.fill();
  for (let i = 0; i < h.maxHp; i++) drawMask(g, 44 + i * 30, 40, i < h.hp);
  const b = S.boss;
  if (b && b.state !== 'wait') {
    const bw = 460, x = (W - bw) / 2, y = H - 34;
    g.font = '700 18px "Cormorant SC", serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(220,210,255,0.85)';
    g.fillText('Страж Шпиля', W / 2, y - 10);
    g.fillStyle = 'rgba(5,6,14,0.7)'; rr(g, x - 3, y - 3, bw + 6, 14, 7); g.fill();
    const k = clamp(b.hp / b.maxHp, 0, 1);
    const gr = g.createLinearGradient(x, 0, x + bw, 0);
    gr.addColorStop(0, '#6b2140'); gr.addColorStop(1, '#d2547d');
    g.fillStyle = gr; rr(g, x, y, Math.max(8, bw * k), 8, 4); g.fill();
  }
  g.restore();
}

function textGlow(g, text, x, y, font, color, alpha, blur = 12) {
  g.save(); g.globalAlpha = alpha; g.font = font; g.textAlign = 'center';
  g.shadowColor = 'rgba(120,160,255,0.7)'; g.shadowBlur = blur;
  g.fillStyle = color; g.fillText(text, x, y);
  g.restore();
}

function ornament(g, cx, y, w, alpha) {
  g.save(); g.globalAlpha = alpha; g.strokeStyle = 'rgba(220,230,255,0.85)'; g.fillStyle = 'rgba(220,230,255,0.85)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx - w, y); g.quadraticCurveTo(cx - w * 0.5, y - 6, cx - 14, y); g.moveTo(cx + 14, y); g.quadraticCurveTo(cx + w * 0.5, y - 6, cx + w, y); g.stroke();
  g.beginPath(); g.moveTo(cx, y - 6); g.lineTo(cx + 6, y); g.lineTo(cx, y + 6); g.lineTo(cx - 6, y); g.closePath(); g.fill();
  g.beginPath(); g.arc(cx - w, y, 2.5, 0, Math.PI * 2); g.arc(cx + w, y, 2.5, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawIntroText(g) {
  if (S.roomIdx !== 0 || S.spawnT > 0) return;
  const t = S.introT, h = S.hero;
  const away = clamp(1 - (h.x - 520) / 300, 0.25, 1);
  const lines = [
    ['Добро пожаловать, Странник.', '700 40px "Cormorant SC", serif', 0.3],
    ['Ты очнулся там, где гаснет последний свет.', 'italic 500 22px "Cormorant Garamond", serif', 1.2],
    ['Тени этих глубин давно забыли свои имена,', 'italic 500 22px "Cormorant Garamond", serif', 1.9],
    ['а на вершине Шпиля тебя ждёт Синий Ткач.', 'italic 500 22px "Cormorant Garamond", serif', 2.6],
  ];
  let y = 108;
  const fa = (st) => clamp((t - st) / 1.2, 0, 1) * away;
  ornament(g, W / 2, 66, 170, fa(0));
  for (const [s, f, st] of lines) {
    textGlow(g, s, W / 2, y, f, '#e2e9ff', fa(st));
    y += st === 0.3 ? 46 : 32;
  }
  ornament(g, W / 2, y - 8, 120, fa(3.2));
  textGlow(g, 'Иди направо. Не оглядывайся.', W / 2, y + 26, '500 20px "Cormorant SC", serif', '#bfcaf5', fa(3.4), 8);
  const hint = isTouch || document.body.classList.contains('touch')
    ? 'Крестовина — идти  ·  A или ▲ — прыжок  ·  B — удар  ·  ▼ + B в прыжке — удар вниз'
    : '← →  идти   ·   ↑  прыжок   ·   ПРОБЕЛ  удар   ·   ↓ + ПРОБЕЛ в прыжке — удар вниз';
  textGlow(g, hint, W / 2, y + 60, '500 17px "Cormorant Garamond", serif', '#9aa8d8', fa(4.0) * 0.95, 4);
}

function drawAreaTitle(g) {
  const a = S.area; if (!a) return;
  const al = a.t < 0.8 ? a.t / 0.8 : a.t > 3 ? Math.max(0, 1 - (a.t - 3)) : 1;
  textGlow(g, a.title, W / 2, 112, '700 36px "Cormorant SC", serif', '#e8edff', al);
  ornament(g, W / 2, 130, 150, al);
  textGlow(g, a.sub, W / 2, 158, 'italic 500 19px "Cormorant Garamond", serif', '#b9c3ea', al * 0.9, 6);
}

function drawCard(g) {
  const c = S.card; if (!c) return;
  const al = c.t < 0.6 ? c.t / 0.6 : c.t > 2.8 ? Math.max(0, 1 - (c.t - 2.8) / 0.8) : 1;
  g.save();
  g.globalAlpha = al * 0.55;
  const lg = g.createLinearGradient(0, H * 0.62, 0, H * 0.92);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.5, 'rgba(0,0,0,0.9)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg; g.fillRect(0, H * 0.62, W, H * 0.3);
  g.restore();
  textGlow(g, c.top, W / 2, H * 0.71, 'italic 500 22px "Cormorant Garamond", serif', '#d6c8ee', al, 6);
  textGlow(g, c.big, W / 2, H * 0.71 + 52, '700 56px "Cormorant SC", serif', '#f2eaff', al, 18);
  ornament(g, W / 2, H * 0.71 + 74, 200, al);
}

function render() {
  const g = ctx;
  g.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
  g.imageSmoothingEnabled = true;

  if (S.mode === 'loading') { g.fillStyle = '#03040a'; g.fillRect(0, 0, W, H); return; }
  if (S.mode === 'title') { drawTitle(g); return; }
  if (S.mode === 'victory') { drawVictory(g); return; }

  g.save();
  if (S.shake > 0) g.translate(rand(-S.shake, S.shake) * 0.6, rand(-S.shake, S.shake) * 0.6);

  g.drawImage(getBg(S.roomIdx), 0, 0, W, H);
  drawMotes(g);
  drawExitHint(g);
  drawGate(g);
  drawIntroText(g);

  for (const e of S.enemies) {
    if (e.type === 'kicker') drawMobSprite(g, e, IMG.mob1, IMG.mob1W, 92);
    else if (e.type === 'hood') drawMobSprite(g, e, IMG.mob2, IMG.mob2W, 94);
    else if (e.type === 'chicken') drawChicken(g, e);
    else if (e.type === 'egg') drawEgg(g, e);
  }
  if (S.boss && S.boss.state !== 'wait') drawBoss(g, S.boss);
  drawHero(g, S.hero);
  for (const f of S.fx) {
    if (f.type === 'slash') drawSlashFx(g, f);
    if (f.type === 'ring') {
      const k = f.t / f.max;
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - k;
      g.strokeStyle = '#ffd9a8'; g.lineWidth = (f.big ? 10 : 4) * (1 - k);
      g.beginPath(); g.arc(f.x, f.y, (f.big ? 260 : 70) * k + 10, 0, Math.PI * 2); g.stroke(); g.restore();
    }
  }
  for (const p of S.projs) drawProj(g, p);
  drawParticles(g);

  // туманная дымка снизу
  const fg = g.createLinearGradient(0, GROUND - 30, 0, H);
  fg.addColorStop(0, 'rgba(10,14,30,0)'); fg.addColorStop(1, 'rgba(10,14,30,0.6)');
  g.fillStyle = fg; g.fillRect(0, GROUND - 30, W, H - GROUND + 30);
  g.restore();

  g.drawImage(getVignette(), 0, 0);
  drawHUD(g);
  drawAreaTitle(g);
  drawCard(g);

  if (S.fade > 0) { g.fillStyle = `rgba(2,3,8,${S.fade})`; g.fillRect(0, 0, W, H); }
  if (S.deadT >= 0 && S.fade > 0.6) {
    textGlow(g, 'Тьма поглотила тебя…', W / 2, H / 2, 'italic 500 32px "Cormorant Garamond", serif', '#c9d2f5', (S.fade - 0.6) / 0.4);
  }
}

function drawCoverImage(g, img, alpha) {
  if (!img) return;
  const k = Math.max(W / img.width, H / img.height);
  const w = img.width * k, h = img.height * k;
  g.save(); g.globalAlpha = alpha;
  g.drawImage(img, (W - w) / 2, (H - h) / 2 - 20, w, h);
  g.restore();
}

function drawTitle(g) {
  g.fillStyle = '#03040a'; g.fillRect(0, 0, W, H);
  drawCoverImage(g, IMG.title, 0.85);
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, 'rgba(3,4,12,0.55)'); lg.addColorStop(0.45, 'rgba(3,4,12,0.05)'); lg.addColorStop(0.75, 'rgba(3,4,12,0.75)'); lg.addColorStop(1, 'rgba(3,4,12,0.95)');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.drawImage(getVignette(), 0, 0);
  textGlow(g, 'DUSKBOUND', W / 2, H - 120, '700 72px "Cormorant SC", serif', '#eef2ff', 1, 24);
  ornament(g, W / 2, H - 98, 220, 1);
  textGlow(g, 'Пленник сумерек', W / 2, H - 70, 'italic 500 24px "Cormorant Garamond", serif', '#c5cff3', 1, 8);
  const blink = 0.45 + 0.45 * Math.sin(S.time * 3);
  const prompt = document.body.classList.contains('touch') ? 'Коснитесь экрана, чтобы начать' : 'Нажмите любую клавишу';
  textGlow(g, prompt, W / 2, H - 30, '500 20px "Cormorant SC", serif', '#dfe6ff', blink, 6);
}

function drawVictory(g) {
  g.fillStyle = '#03040a'; g.fillRect(0, 0, W, H);
  drawCoverImage(g, IMG.title, 0.35 * clamp(S.endT, 0, 1));
  g.drawImage(getVignette(), 0, 0);
  const a = clamp(S.endT / 1.2, 0, 1);
  textGlow(g, 'Страж Шпиля повержен', W / 2, 170, '700 52px "Cormorant SC", serif', '#f2eaff', a, 20);
  ornament(g, W / 2, 196, 220, a);
  textGlow(g, 'Сумерки отступили. Ненадолго.', W / 2, 240, 'italic 500 26px "Cormorant Garamond", serif', '#cdd5f5', clamp((S.endT - 0.6) / 1.2, 0, 1));
  const m = Math.floor(S.playTime / 60), s = Math.floor(S.playTime % 60);
  const stats = `Время: ${m}:${String(s).padStart(2, '0')}   ·   Падений во тьму: ${S.deaths}`;
  textGlow(g, stats, W / 2, 300, '500 22px "Cormorant Garamond", serif', '#aab6e6', clamp((S.endT - 1.2) / 1, 0, 1), 4);
  if (S.endT > 1.5) {
    const blink = 0.45 + 0.45 * Math.sin(S.time * 3);
    const p = document.body.classList.contains('touch') ? 'Коснитесь, чтобы вернуться в начало' : 'Нажмите любую клавишу, чтобы вернуться в начало';
    textGlow(g, p, W / 2, H - 60, '500 20px "Cormorant SC", serif', '#dfe6ff', blink, 6);
  }
}

/* --------------------------------- Loop -------------------------------- */

let last = performance.now(), acc = 0;
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mode === 'victory') S.endT += dt;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 8) {
    update(STEP); acc -= STEP; steps++;
    IN.now = {};
  }
  render();
  requestAnimationFrame(frame);
}

resize();
const fontsReady = document.fonts
  ? Promise.race([
      Promise.all([
        '700 40px "Cormorant SC"', '500 20px "Cormorant SC"',
        'italic 500 22px "Cormorant Garamond"', '500 17px "Cormorant Garamond"',
      ].map((f) => document.fonts.load(f, 'Сумерки Duskbound'))),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => {})
  : null;
Promise.all([assetsReady, fontsReady]).then(() => {
  S.mode = 'title';
});
requestAnimationFrame(frame);
