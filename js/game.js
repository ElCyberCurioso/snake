(() => {
"use strict";

/* ════════════════════════════════════════════════════════════════
   Polyfills y utilidades
   ════════════════════════════════════════════════════════════════ */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (from, to) => { let d = (to - from) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const fmt = n => Math.round(n).toLocaleString('es-ES');
const nb = t => t.replace(/(\d) (s\b|%)/g, '$1\u00A0$2'); // número y unidad nunca se separan de línea
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const $ = id => document.getElementById(id);

function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}

const store = {
  key: 'snakeJoystick.v2.',
  get(k, def) { try { const v = localStorage.getItem(this.key + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(this.key + k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } }
};

const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
function vibrate(p) { try { if (isTouch && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* sin vibración */ } }

/* ════════════════════════════════════════════════════════════════
   Configuración del juego
   ════════════════════════════════════════════════════════════════ */
const WORLD = 3000;          // tamaño del mapa (px)
const TILE = 80;             // rejilla del suelo
const SIZE = 36;             // tamaño del personaje
const HR = SIZE / 2;         // medio tamaño
const ER = 17;               // radio del enemigo
const GAP = 44;              // separación entre segmentos de la cola
const HIT_SCALE = 0.86;      // hitbox algo más pequeña que el dibujo (más justo)
const BASE_SPEED = 190;      // px/s
const BOOST = 1.6;           // multiplicador del power-up de velocidad
const TURN_RATE = 7;         // rad/s: giro máximo en movimiento (evita giros de 180° instantáneos)
const STOP_SPEED = 50;       // por debajo se considera parado y puede girar libremente
const FOOD_COUNT = 14;
const POWERUP_COUNT = 4;
const VISION = 300;          // radio de visión base de los enemigos
const CHASE_SPEED = 112;
const WANDER_SPEED = 55;
const CENTER_CLEAR = 260;    // zona libre de obstáculos en el centro
const OB_GAP = 90;           // separación mínima entre obstáculos
const FOOD_COLOR = '#ffa63d';
const GOLD_COLOR = '#ffd166';
const ICE_COLOR = '#67e8f9';
const ENEMY_COLOR = '#ff4a3d';

const DIFFS = {
  easy:   { label: 'Fácil',   enemies: 2, maxEnemies: 6,  enemySpeed: 0.82, vision: 0.85, xpMult: 0.9,  desc: 'Pocos cazadores y lentos. Ideal para aprender.' },
  normal: { label: 'Normal',  enemies: 3, maxEnemies: 9,  enemySpeed: 1,    vision: 1,    xpMult: 1,    desc: 'La experiencia equilibrada.' },
  hard:   { label: 'Difícil', enemies: 5, maxEnemies: 13, enemySpeed: 1.22, vision: 1.15, xpMult: 1.15, desc: 'Más cazadores, más rápidos y con mejor vista.' }
};

const basePerks = () => ({
  speedMult: 1, magnetMult: 1, scoreMult: 1, comboBonus: 0,
  shields: 0, maxShields: 0, shieldRegen: 0, emergency: 0,
  growth: 0, xpBonus: 0, powerDur: 0, ghostBonus: 0, stealth: 0, burstEvery: 0
});

const CHARACTERS = [
  { id: 'red', shape: 'square', name: 'Rojo', color: '#ff4d6d', tag: 'Equilibrado',
    desc: 'Combo 1,5 s más largo y +10 % de puntos.', stats: [3, 2, 3],
    passive: { scoreMult: 1.1, comboBonus: 1.5 } },
  { id: 'swift', shape: 'triangle', name: 'Veloz', color: '#facc15', tag: 'Rápido y frágil',
    desc: '+20 % de velocidad y radio de recogida ×1,4.', stats: [5, 1, 3],
    passive: { speedMult: 1.2, magnetMult: 1.4 } },
  { id: 'tank', shape: 'hexagon', name: 'Tanque', color: '#60a5fa', tag: 'Resistente',
    desc: '2 escudos que se recargan cada 40 s. Algo más lento.', stats: [2, 5, 2],
    passive: { speedMult: 0.88, shields: 2, maxShields: 2, shieldRegen: 40 } },
  { id: 'greedy', shape: 'diamond', name: 'Glotón', color: '#84e04a', tag: 'Crece rápido',
    desc: 'Cada comida da +1 segmento y +1 XP extra. Power-ups +2 s.', stats: [3, 2, 5],
    passive: { growth: 1, xpBonus: 1, powerDur: 2 } },
  { id: 'ghost', shape: 'circle', name: 'Espectro', color: '#a78bfa', tag: 'Táctico',
    desc: 'Empieza en modo fantasma. Fantasma +3 s y los cazadores te ven peor.', stats: [4, 3, 2],
    passive: { speedMult: 1.08, ghostBonus: 3, stealth: 0.15 }, startGhost: 6 }
];
const STAT_LABELS = ['Velocidad', 'Defensa', 'Crecimiento'];

// Habilidades: el efecto escala con el rango (nivel 5 → I, 10 → II, 15 → III, 20+ → IV)
const SKILLS = [
  { id: 'speed', icon: '💨', name: 'Turbina', desc: t => `+${8 * t} % de velocidad`, apply: (p, t) => { p.speedMult *= 1 + 0.08 * t; } },
  { id: 'magnet', icon: '🧲', name: 'Atracción', desc: t => `Radio de recogida +${25 * t} %`, apply: (p, t) => { p.magnetMult *= 1 + 0.25 * t; } },
  { id: 'shield', icon: '🛡️', name: 'Blindaje', desc: t => `+${t} escudo${t > 1 ? 's' : ''}. Absorben cualquier choque`, apply: (p, t) => { p.shields += t; p.maxShields += t; } },
  { id: 'regen', icon: '🔋', name: 'Recarga', desc: t => `Recupera 1 escudo cada ${Math.max(15, 45 - 8 * t)} s`, apply: (p, t) => { const v = Math.max(15, 45 - 8 * t); p.shieldRegen = p.shieldRegen ? Math.min(p.shieldRegen, v) : v; p.maxShields = Math.max(p.maxShields, 1); } },
  { id: 'power', icon: '⏳', name: 'Persistencia', desc: t => `Los power-ups duran ${(1.5 * t).toLocaleString('es-ES')} s más`, apply: (p, t) => { p.powerDur += 1.5 * t; } },
  { id: 'emergency', icon: '✂️', name: 'Poda de emergencia', desc: t => `${t} carga${t > 1 ? 's' : ''}: un choque mortal te quita 5 segmentos en su lugar`, apply: (p, t) => { p.emergency += t; } },
  { id: 'xp', icon: '📚', name: 'Aprendizaje', desc: t => `+${t} XP por cada comida`, apply: (p, t) => { p.xpBonus += t; } },
  { id: 'stealth', icon: '🌫️', name: 'Sigilo', desc: t => `Los cazadores te ven un ${12 * t} % menos`, apply: (p, t) => { p.stealth = Math.min(0.6, p.stealth + 0.12 * t); } },
  { id: 'burst', icon: '🚀', name: 'Ráfaga', desc: t => `Turbo automático cada ${Math.max(4, 12 - 2 * t)} comidas`, apply: (p, t) => { const v = Math.max(4, 12 - 2 * t); p.burstEvery = p.burstEvery ? Math.min(p.burstEvery, v) : v; } },
  { id: 'fortune', icon: '💰', name: 'Fortuna', desc: t => `+${20 * t} % de puntos`, apply: (p, t) => { p.scoreMult *= 1 + 0.2 * t; } },
  { id: 'rhythm', icon: '🔥', name: 'Ritmo', desc: t => `El combo dura ${t} s más`, apply: (p, t) => { p.comboBonus += t; } }
];

const POWERS = {
  speed:  { icon: '⚡', name: 'Turbo',       color: '#facc15', dur: 5, w: 3, desc: 'Velocidad ×1,6' },
  ghost:  { icon: '👻', name: 'Fantasma',    color: '#a78bfa', dur: 5, w: 2, desc: 'Atraviesas muros, cazadores y tu cola' },
  freeze: { icon: '❄️', name: 'Congelación', color: '#67e8f9', dur: 4, w: 2, desc: 'Cazadores congelados: tócalos para romperlos' },
  magnet: { icon: '🧲', name: 'Imán',        color: '#f472b6', dur: 6, w: 2, desc: 'Atrae la comida cercana' },
  double: { icon: '💎', name: 'Puntos ×2',   color: '#38bdf8', dur: 8, w: 2, desc: 'Cada comida vale el doble' },
  shrink: { icon: '✂️', name: 'Recorte',     color: '#34d399', dur: 0, w: 1, desc: 'Pierdes 3 segmentos' }
};
const POWER_IDS = Object.keys(POWERS);

// Iconos en una cuadrícula de 24×24 (rutas SVG reutilizadas en canvas con Path2D)
const ICONS = {
  speed:  { fill: ['M13.5 2 4.5 13.5h6L9.5 22l10-12.5h-6.2z'] },
  ghost:  { fill: ['M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11.5l2.5-1.8 2.5 1.8 2.5-1.8 2.5 1.8 2.5-1.8 2.5 1.8V10A7.5 7.5 0 0 0 12 2.5z'],
            dark: ['M7.6 9.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z', 'M13.2 9.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z'] },
  freeze: { stroke: ['M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7', 'M9 3.6l3 2.4 3-2.4M9 20.4l3-2.4 3 2.4', 'M3.7 10.7 7 9.3l-.5-3.5M20.3 10.7 17 9.3l.5-3.5', 'M3.7 13.3 7 14.7l-.5 3.5M20.3 13.3 17 14.7l.5 3.5'] },
  magnet: { fill: ['M4.5 3h5.2v8.6a2.3 2.3 0 0 0 4.6 0V3h5.2v8.6a7.5 7.5 0 0 1-15 0z'],
            light: ['M4.5 3h5.2v3.6H4.5zM14.3 3h5.2v3.6h-5.2z'] },
  double: { fill: ['M6.5 3.5h11l4.2 5.6L12 21 2.3 9.1z'],
            facets: ['M2.3 9.1h19.4M9.2 3.5 7.6 9.1 12 21l4.4-11.9-1.6-5.6'] },
  shrink: { stroke: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12'] }
};
const pathCache = new Map();
const P2 = d => { let p = pathCache.get(d); if (!p) { p = new Path2D(d); pathCache.set(d, p); } return p; };
function iconSVG(id, color, cls) {
  const ic = ICONS[id];
  let out = `<svg class="${cls || 'pw-ico'}" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">`;
  for (const d of ic.fill || []) out += `<path d="${d}" fill="${color}"/>`;
  for (const d of ic.stroke || []) out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.3"/>`;
  for (const d of ic.light || []) out += `<path d="${d}" fill="#fff" opacity=".85"/>`;
  for (const d of ic.facets || []) out += `<path d="${d}" fill="none" stroke="#14163a" stroke-opacity=".45" stroke-width="1.2"/>`;
  for (const d of ic.dark || []) out += `<path d="${d}" fill="#14163a"/>`;
  return out + '</svg>';
}

const DEATH_REASONS = {
  wall: 'Te estrellaste contra un muro.',
  enemy: 'Un cazador te atrapó.',
  self: 'Te mordiste la cola.',
  tail: 'Un cazador alcanzó tu cola.'
};

/* ════════════════════════════════════════════════════════════════
   Geometría y colisiones (SAT entre polígonos convexos)
   ════════════════════════════════════════════════════════════════ */
const ngon = n => Array.from({ length: n }, (_, i) => [Math.cos(i * TAU / n), Math.sin(i * TAU / n)]);
const SHAPES = {
  square: [[1, -1], [1, 1], [-1, 1], [-1, -1]],
  triangle: [[1, 0], [-1, 1], [-1, -1]],
  diamond: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  hexagon: ngon(6),
  circle: ngon(14),
  octagon: ngon(8)
};
const EYES = { // posición local de los ojos (x, separación y) relativa al radio
  square: [0.32, 0.38], hexagon: [0.28, 0.36], circle: [0.3, 0.36], diamond: [0.18, 0.3], triangle: [-0.18, 0.3]
};

function polyAt(shape, x, y, r, a) {
  const s = SHAPES[shape], c = Math.cos(a), sn = Math.sin(a), out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const px = s[i][0] * r, py = s[i][1] * r;
    out[i] = { x: x + px * c - py * sn, y: y + px * sn + py * c };
  }
  return out;
}
function rectPoly(o) { return [{ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y }, { x: o.x + o.w, y: o.y + o.h }, { x: o.x, y: o.y + o.h }]; }
function centroid(P) { let x = 0, y = 0; for (const v of P) { x += v.x; y += v.y; } return { x: x / P.length, y: y / P.length }; }

// Devuelve el vector mínimo de separación que empuja A fuera de B, o null si no se tocan.
function sat(A, B) {
  let best = Infinity, bx = 0, by = 0;
  for (let pass = 0; pass < 2; pass++) {
    const P = pass ? B : A;
    for (let i = 0, n = P.length; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      let nx = q.y - p.y, ny = p.x - q.x;
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const d = v.x * nx + v.y * ny; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const v of B) { const d = v.x * nx + v.y * ny; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return null;
      if (o < best) { best = o; bx = nx; by = ny; }
    }
  }
  const ca = centroid(A), cb = centroid(B);
  if ((ca.x - cb.x) * bx + (ca.y - cb.y) * by < 0) { bx = -bx; by = -by; }
  return { d: best, nx: bx, ny: by };
}
const rectsOverlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

// Segmento contra rectángulo (Liang-Barsky) para la línea de visión
function segHitsRect(x1, y1, x2, y2, o) {
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - o.x, o.x + o.w - x1, y1 - o.y, o.y + o.h - y1];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/* ════════════════════════════════════════════════════════════════
   Sonido (sintetizado con WebAudio, sin archivos externos)
   ════════════════════════════════════════════════════════════════ */
const Sound = (() => {
  let ac = null, master = null, noiseBuf = null, lastAlert = 0;
  let muted = store.get('muted', false);
  function unlock() {
    if (!ac) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ac.destination);
        const len = Math.floor(ac.sampleRate * 0.6);
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; return; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }
  function tone(f, dur, o = {}) {
    if (!ac || muted) return;
    const { type = 'sine', vol = 0.15, slide = 1, delay = 0 } = o;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(dur, o = {}) {
    if (!ac || muted || !noiseBuf) return;
    const { vol = 0.2, freq = 1200, type = 'lowpass', delay = 0 } = o;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  const semi = (base, s) => base * Math.pow(2, s / 12);
  return {
    unlock,
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('muted', muted); if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    eat(c) { const f = semi(440, Math.min(c, 18)); tone(f, 0.08, { type: 'square', vol: 0.06, slide: 1.4 }); tone(f * 1.5, 0.07, { vol: 0.05, delay: 0.03 }); },
    gold() { [0, 4, 7, 12, 16].forEach((s, i) => tone(semi(660, s), 0.16, { type: 'triangle', vol: 0.08, delay: i * 0.05 })); },
    power() { [0, 5, 9].forEach((s, i) => tone(semi(392, s), 0.12, { type: 'sawtooth', vol: 0.04, delay: i * 0.045 })); tone(1200, 0.25, { vol: 0.03, slide: 0.5, delay: 0.12 }); },
    powerEnd() { tone(520, 0.16, { type: 'triangle', vol: 0.06, slide: 0.6 }); },
    shield() { noise(0.25, { vol: 0.28, freq: 700 }); tone(180, 0.25, { type: 'square', vol: 0.07, slide: 0.5 }); tone(900, 0.2, { vol: 0.05, slide: 1.4, delay: 0.05 }); },
    shieldUp() { tone(600, 0.12, { type: 'triangle', vol: 0.06 }); tone(900, 0.16, { type: 'triangle', vol: 0.06, delay: 0.08 }); },
    death() { noise(0.8, { vol: 0.35, freq: 900 }); tone(320, 0.8, { type: 'sawtooth', vol: 0.08, slide: 0.22 }); },
    level() { [0, 4, 7].forEach((s, i) => tone(semi(523, s), 0.16, { type: 'triangle', vol: 0.07, delay: i * 0.07 })); },
    skill() { [0, 4, 7, 11, 14].forEach((s, i) => tone(semi(523, s), 0.2, { type: 'triangle', vol: 0.07, delay: i * 0.06 })); },
    pick() { tone(880, 0.06, { type: 'square', vol: 0.04 }); tone(1320, 0.1, { type: 'triangle', vol: 0.05, delay: 0.05 }); },
    shatter() { noise(0.35, { vol: 0.22, freq: 3000, type: 'highpass' }); tone(1500, 0.22, { vol: 0.05, slide: 0.5 }); },
    alert() { const now = performance.now(); if (now - lastAlert < 700) return; lastAlert = now; tone(880, 0.07, { type: 'square', vol: 0.035 }); tone(1175, 0.09, { type: 'square', vol: 0.035, delay: 0.07 }); },
    pop() { tone(rand(500, 900), 0.05, { type: 'square', vol: 0.025 }); },
    click() { tone(720, 0.04, { type: 'square', vol: 0.03 }); }
  };
})();

/* ════════════════════════════════════════════════════════════════
   Estado global
   ════════════════════════════════════════════════════════════════ */
const canvas = $('game'), ctx = canvas.getContext('2d');
const mini = $('minimap'), mctx = mini.getContext('2d');
let W = 0, H = 0, DPR = 1, vignette = null;
const cam = { x: 0, y: 0 };
let mode = 'menu';          // menu · play · paused · levelup · dying · over
let G = null;               // mundo actual (demo del menú o partida)
let selectedChar = CHARACTERS.find(c => c.id === store.get('lastChar', 'red')) || CHARACTERS[0];
let difficulty = DIFFS[store.get('lastDiff', 'normal')] ? store.get('lastDiff', 'normal') : 'normal';
const admin = { god: false, hitboxes: false, enemies: true, speed: 1, enemySpeed: 1, vision: 1, timeScale: 1 };

// Récords por dificultad; los valores guardados se validan como números al cargar
const toCount = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0; };
let records = (() => {
  const raw = store.get('records', null), out = {};
  for (const k of Object.keys(DIFFS)) {
    const r = raw && typeof raw === 'object' && raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
    out[k] = { score: toCount(r.score), length: toCount(r.length) };
  }
  if (!raw) {
    try { out.normal.length = toCount(localStorage.getItem('snakeBest')); } catch (e) { /* almacenamiento no disponible */ }
  }
  return out;
})();
store.set('records', records);

/* ════════════════════════════════════════════════════════════════
   Creación del mundo
   ════════════════════════════════════════════════════════════════ */
function genObstacles() {
  const obs = [], cx = WORLD / 2, cy = WORLD / 2;
  let tries = 0;
  while (obs.length < 56 && tries < 5000) {
    tries++;
    let w, h;
    if (Math.random() < 0.28) {
      const long = rand(170, 320), thin = rand(24, 32);
      if (Math.random() < 0.5) { w = long; h = thin; } else { w = thin; h = long; }
    } else { w = rand(50, 150); h = rand(50, 150); }
    const x = rand(120, WORLD - 120 - w), y = rand(120, WORLD - 120 - h);
    if (rectsOverlap(x, y, w, h, cx - CENTER_CLEAR, cy - CENTER_CLEAR, CENTER_CLEAR * 2, CENTER_CLEAR * 2)) continue;
    let ok = true;
    for (const o of obs) if (rectsOverlap(x - OB_GAP, y - OB_GAP, w + OB_GAP * 2, h + OB_GAP * 2, o.x, o.y, o.w, o.h)) { ok = false; break; }
    if (!ok) continue;
    const o = { x, y, w, h };
    o.poly = rectPoly(o);
    obs.push(o);
  }
  return obs;
}

function createWorld(char, diffKey, demo) {
  const p = Object.assign(basePerks(), char ? char.passive : {});
  const g = {
    demo, char, diffKey, diff: DIFFS[diffKey], perks: p, owned: {},
    obstacles: genObstacles(), foods: [], powerups: [], enemies: [], particles: [], texts: [], events: [],
    head: { x: WORLD / 2, y: WORLD / 2 }, heading: 0, speed: 0, turnSign: 1,
    trail: [], tailCount: 2, segs: [], popIdx: 0,
    powers: {}, score: 0, shownScore: 0, level: 1, xp: 0, xpNext: 4, time: 0,
    combo: 0, comboT: 0, maxCombo: 0, foodsEaten: 0, kills: 0, maxLength: 3,
    invuln: 0, invulnExt: 0, bounceT: 0, shieldRegenT: 0, burstCount: 0, goldT: rand(14, 22),
    shake: 0, flash: 0, flashColor: '#ff3b5c', blinkT: rand(2, 5), blink: 0,
    pendingEnemies: 0, pendingLevelUp: false, moved: false, adminUsed: false,
    deathT: 0, deathReason: '', overShown: false, demoT: rand(0, 100)
  };
  for (let i = 30; i >= 0; i--) g.trail.push({ x: WORLD / 2 - i * 10, y: WORLD / 2 });
  const base = char ? char.color : '#ff4d6d';
  g.shades = Array.from({ length: 32 }, (_, i) => mixHex(base, '#1a1d48', Math.min(0.62, 0.1 + i * 0.03)));
  g.miniLayer = buildMiniLayer(g.obstacles);
  return g;
}

function populate() {
  for (let i = 0; i < FOOD_COUNT; i++) spawnFood(false);
  for (let i = 0; i < POWERUP_COUNT; i++) spawnPowerup();
  const n = G.demo ? 5 : G.diff.enemies;
  for (let i = 0; i < n; i++) spawnEnemy(true);
}

function freePoint(margin, near, minD, maxD) {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 300; i++) {
      let x, y;
      if (near && pass === 0) { const a = rand(0, TAU), d = rand(minD, maxD); x = near.x + Math.cos(a) * d; y = near.y + Math.sin(a) * d; }
      else { x = rand(90, WORLD - 90); y = rand(90, WORLD - 90); }
      if (x < 90 || x > WORLD - 90 || y < 90 || y > WORLD - 90) continue;
      if (near && minD && dist(x, y, near.x, near.y) < minD) continue;
      let ok = true;
      for (const o of G.obstacles) if (x > o.x - margin && x < o.x + o.w + margin && y > o.y - margin && y < o.y + o.h + margin) { ok = false; break; }
      if (ok) return { x, y };
    }
  }
  return { x: WORLD / 2 + rand(-150, 150), y: WORLD / 2 + rand(-150, 150) };
}

function spawnFood(nearPlayer) {
  const p = nearPlayer && !G.demo && Math.random() < 0.5 ? freePoint(40, G.head, 260, 900) : freePoint(40);
  G.foods.push({ x: p.x, y: p.y, kind: 'food', age: 0, life: rand(28, 38), rot: rand(0, TAU), pulse: rand(0, TAU) });
}
function spawnGold() {
  const p = freePoint(50, G.head, 450, 1100);
  G.foods.push({ x: p.x, y: p.y, kind: 'gold', age: 0, life: 10, rot: 0, pulse: 0 });
  ring(p.x, p.y, GOLD_COLOR, 70);
}
function spawnPowerup() {
  if (!G || G.powerups.length >= POWERUP_COUNT + 1) return;
  const total = POWER_IDS.reduce((s, id) => s + POWERS[id].w, 0);
  let r = Math.random() * total, type = POWER_IDS[0];
  for (const id of POWER_IDS) { r -= POWERS[id].w; if (r <= 0) { type = id; break; } }
  const p = freePoint(50);
  G.powerups.push({ x: p.x, y: p.y, type, bob: rand(0, TAU) });
}
let enemyId = 0;
function spawnEnemy(initial, near) {
  if (!admin.enemies && !G.demo) return;
  const ref = G.demo ? null : G.head;
  const p = near ? freePoint(60, G.head, 300, 450)
    : ref ? freePoint(60, ref, initial ? 750 : 650, initial ? 2400 : 1500) : freePoint(60);
  G.enemies.push({
    id: ++enemyId, x: p.x, y: p.y, vx: 0, vy: 0, state: 'wander', wanderA: rand(0, TAU), wanderT: 0,
    lastSeen: null, searchT: 0, alertT: 0, stun: 0, spawnT: initial ? 0 : 0.9, spin: rand(0, TAU),
    losT: Math.random() * 0.2, look: rand(0, TAU)
  });
  if (!initial) ring(p.x, p.y, ENEMY_COLOR, 60);
}
function schedule(delay, fn) { G.events.push({ t: G.time + delay, fn }); }
function runEvents() {
  if (!G.events.length) return;
  const due = G.events.filter(e => e.t <= G.time);
  if (!due.length) return;
  G.events = G.events.filter(e => e.t > G.time);
  for (const e of due) e.fn();
}

/* ════════════════════════════════════════════════════════════════
   Entrada: teclado y joystick flotante
   ════════════════════════════════════════════════════════════════ */
const keys = new Set();
const joy = { active: false, id: null, bx: 0, by: 0, tx: 0, ty: 0, dx: 0, dy: 0, mag: 0, R: 62 };
function resetJoy() { joy.active = false; joy.id = null; joy.mag = 0; }

canvas.addEventListener('pointerdown', e => {
  Sound.unlock();
  if (mode !== 'play' || joy.active) return;
  e.preventDefault();
  Object.assign(joy, { active: true, id: e.pointerId, bx: e.clientX, by: e.clientY, tx: e.clientX, ty: e.clientY, dx: 0, dy: 0, mag: 0 });
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
});
canvas.addEventListener('pointermove', e => {
  if (!joy.active || e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.bx, dy = e.clientY - joy.by;
  let d = Math.hypot(dx, dy);
  const follow = joy.R * 1.3;
  if (d > follow) { // la base sigue al dedo para no quedarse atrás
    const k = (d - follow) / d;
    joy.bx += dx * k; joy.by += dy * k;
    dx = e.clientX - joy.bx; dy = e.clientY - joy.by; d = Math.hypot(dx, dy);
  }
  const cl = Math.min(d, joy.R);
  joy.dx = d ? dx / d : 0; joy.dy = d ? dy / d : 0; joy.mag = cl / joy.R;
  joy.tx = joy.bx + joy.dx * cl; joy.ty = joy.by + joy.dy * cl;
});
const endJoy = e => { if (joy.active && e.pointerId === joy.id) resetJoy(); };
canvas.addEventListener('pointerup', endJoy);
canvas.addEventListener('pointercancel', endJoy);
canvas.addEventListener('lostpointercapture', endJoy);
window.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('pointerdown', () => Sound.unlock(), true);

function readInput() {
  if (joy.active && joy.mag > 0.22) return { x: joy.dx, y: joy.dy, on: true };
  let x = 0, y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
  if (x || y) { const L = Math.hypot(x, y); return { x: x / L, y: y / L, on: true }; }
  return { on: false };
}

window.addEventListener('keydown', e => {
  Sound.unlock();
  if (e.target && e.target.tagName === 'INPUT') return;
  if (mode === 'play' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.shiftKey && e.code === 'KeyA') { toggleAdmin(); return; }
  keys.add(e.code);
  const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
  switch (e.code) {
    case 'Escape': case 'KeyP':
      if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame();
      break;
    case 'KeyM': toggleMute(); break;
    case 'Enter': case 'Space':
      if (onButton || e.repeat) break;
      if (mode === 'menu') startGame();
      else if (mode === 'over' && screens.over.dataset.armed === '1') startGame();
      else if (mode === 'paused') resumeGame();
      break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Numpad1': case 'Numpad2': case 'Numpad3':
      if (mode === 'levelup' && screens.level.dataset.armed === '1') {
        const btn = $('skillGrid').children[parseInt(e.code.slice(-1), 10) - 1];
        if (btn) btn.click();
      }
      break;
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); resetJoy(); if (mode === 'play') pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') pauseGame(); });

/* ════════════════════════════════════════════════════════════════
   Lógica principal
   ════════════════════════════════════════════════════════════════ */
const comboWindow = () => 3.5 + G.perks.comboBonus;
const comboMult = () => 1 + Math.min(Math.max(G.combo - 1, 0), 30) * 0.1;
const segR = i => (SIZE - Math.min(i + 1, 10) * 0.7) / 2;
const headPoly = () => polyAt(G.char.shape, G.head.x, G.head.y, HR * HIT_SCALE, G.heading);
const segPoly = i => polyAt(G.char.shape, G.segs[i].x, G.segs[i].y, segR(i) * HIT_SCALE, G.segs[i].a);
const enemyPoly = e => polyAt('octagon', e.x, e.y, ER * HIT_SCALE, 0);
const pickupRadius = () => (HR + 14) * G.perks.magnetMult * (G.powers.magnet ? 1.5 : 1);
const visionRadius = () => VISION * G.diff.vision * (1 - G.perks.stealth) * admin.vision;
const enemyTarget = () => admin.enemies ? Math.min(G.diff.maxEnemies, G.diff.enemies + Math.floor((G.level - 1) / 2)) : 0;

function update(dt) {
  G.time += dt;
  runEvents();
  tickTimers(dt);
  movePlayer(dt);
  if (mode !== 'play') return;
  computeSegs();
  updateEnemies(dt);
  manageEnemies();
  checkBodyCollisions();
  if (mode !== 'play') return;
  updatePickups(dt);
  updateFx(dt);
  updateCamera(dt);
  if (G.pendingLevelUp) { G.pendingLevelUp = false; openLevelUp(); }
}

function tickTimers(dt) {
  for (const id of Object.keys(G.powers)) {
    const p = G.powers[id];
    p.t -= dt;
    if (p.t <= 0) { delete G.powers[id]; onPowerEnd(id); }
  }
  if (G.invuln > 0) {
    G.invuln -= dt;
    if (G.invuln <= 0) {
      // no termina la invulnerabilidad mientras sigas encima de un peligro
      if (G.invulnExt < 2.5 && overlapsHazard()) { G.invuln = 0.12; G.invulnExt += 0.12; }
      else G.invuln = 0;
    }
  }
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) { G.comboT = 0; G.combo = 0; } }
  const p = G.perks;
  if (p.shieldRegen > 0 && p.shields < p.maxShields) {
    G.shieldRegenT += dt;
    if (G.shieldRegenT >= p.shieldRegen) {
      G.shieldRegenT = 0; p.shields++;
      toast('🛡️ Escudo recargado', `${p.shields} de ${p.maxShields}`, '#60a5fa');
      Sound.shieldUp();
    }
  } else G.shieldRegenT = 0;
  G.goldT -= dt;
  if (G.goldT <= 0) { G.goldT = rand(20, 30); if (!G.foods.some(f => f.kind === 'gold')) spawnGold(); }
  G.blinkT -= dt;
  if (G.blinkT <= 0) { G.blink = 0.13; G.blinkT = rand(2.5, 5.5); }
  if (G.blink > 0) G.blink -= dt;
}

function movePlayer(dt) {
  let inp = readInput();
  if (G.bounceT > 0) { G.bounceT -= dt; inp = { on: true, x: Math.cos(G.heading), y: Math.sin(G.heading) }; }
  const maxSpeed = BASE_SPEED * G.perks.speedMult * (G.powers.speed ? BOOST : 1) * admin.speed;
  if (inp.on) {
    if (!G.moved) { G.moved = true; $('hint').classList.add('hidden'); }
    const target = Math.atan2(inp.y, inp.x);
    if (G.speed < STOP_SPEED) {
      G.heading = target; // parado: puede encarar cualquier dirección
    } else {
      // en movimiento: giro limitado; un giro de 180° se convierte en una curva en U segura
      let d = angDiff(G.heading, target);
      if (Math.abs(d) > Math.PI - 0.15) d = Math.abs(d) * G.turnSign;
      else if (Math.abs(d) > 0.05) G.turnSign = Math.sign(d);
      const maxTurn = TURN_RATE * dt;
      G.heading += clamp(d, -maxTurn, maxTurn);
    }
    G.speed += (maxSpeed - G.speed) * (1 - Math.exp(-10 * dt));
  } else {
    G.speed *= Math.exp(-5 * dt);
    if (G.speed < 4) G.speed = 0;
  }
  G.heading = Math.atan2(Math.sin(G.heading), Math.cos(G.heading));

  const travel = G.speed * dt;
  if (travel <= 0) return;
  const steps = Math.max(1, Math.ceil(travel / 8));
  const sx = Math.cos(G.heading) * travel / steps, sy = Math.sin(G.heading) * travel / steps;
  for (let s = 0; s < steps; s++) {
    G.head.x = clamp(G.head.x + sx, HR, WORLD - HR);
    G.head.y = clamp(G.head.y + sy, HR, WORLD - HR);
    const hit = collideObstacles();
    if (hit === 2) return;
    if (hit === 1) break;
  }
  const last = G.trail[G.trail.length - 1];
  if (dist(last.x, last.y, G.head.x, G.head.y) >= 3) G.trail.push({ x: G.head.x, y: G.head.y });
  if (G.powers.speed && Math.random() < 0.6) {
    const a = G.heading + Math.PI + rand(-0.4, 0.4);
    G.particles.push({ x: G.head.x, y: G.head.y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, life: 0.35, max: 0.35, size: rand(2, 3.5), color: '#facc15', drag: 2 });
  }
}

// 0 = sin choque · 1 = choque absorbido · 2 = muerte
function collideObstacles() {
  if (G.powers.ghost) return 0;
  const m = SIZE * 0.7;
  for (const o of G.obstacles) {
    const hx = G.head.x, hy = G.head.y;
    if (hx < o.x - m || hx > o.x + o.w + m || hy < o.y - m || hy > o.y + o.h + m) continue;
    const r = sat(headPoly(), o.poly);
    if (!r) continue;
    G.head.x = clamp(G.head.x + r.nx * (r.d + 0.5), HR, WORLD - HR);
    G.head.y = clamp(G.head.y + r.ny * (r.d + 0.5), HR, WORLD - HR);
    if (G.invuln > 0 || admin.god) continue; // sólido pero sin daño: se desliza
    return handleHit('wall', r.nx, r.ny, null) ? 1 : 2;
  }
  return 0;
}

// Saca la cabeza de cualquier muro sin hacer daño (p. ej. al terminar el modo fantasma)
function pushOutOfObstacles() {
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const o of G.obstacles) {
      const m = SIZE * 0.7;
      if (G.head.x < o.x - m || G.head.x > o.x + o.w + m || G.head.y < o.y - m || G.head.y > o.y + o.h + m) continue;
      const r = sat(headPoly(), o.poly);
      if (!r) continue;
      G.head.x = clamp(G.head.x + r.nx * (r.d + 1), HR, WORLD - HR);
      G.head.y = clamp(G.head.y + r.ny * (r.d + 1), HR, WORLD - HR);
      moved = true;
    }
    if (!moved) break;
  }
  const last = G.trail[G.trail.length - 1];
  if (dist(last.x, last.y, G.head.x, G.head.y) >= 3) G.trail.push({ x: G.head.x, y: G.head.y });
}

function computeSegs() {
  const n = G.tailCount, tr = G.trail, segs = G.segs;
  segs.length = n;
  let px = G.head.x, py = G.head.y, acc = 0, k = 0, i = tr.length - 1;
  for (; i >= 0 && k < n; i--) {
    const qx = tr[i].x, qy = tr[i].y, d = Math.hypot(qx - px, qy - py);
    if (d > 0) {
      while (k < n && acc + d >= (k + 1) * GAP) {
        const t = ((k + 1) * GAP - acc) / d;
        setSeg(k, px + (qx - px) * t, py + (qy - py) * t);
        k++;
      }
      acc += d;
    }
    px = qx; py = qy;
  }
  for (; k < n; k++) setSeg(k, px, py);
  let ax = G.head.x, ay = G.head.y;
  for (let j = 0; j < n; j++) {
    const s = segs[j], dx = ax - s.x, dy = ay - s.y;
    s.a = dx * dx + dy * dy > 0.01 ? Math.atan2(dy, dx) : (j ? segs[j - 1].a : G.heading);
    ax = s.x; ay = s.y;
  }
  if (i > 80) tr.splice(0, i - 40); // recorta el rastro que ya no se necesita
}
function setSeg(k, x, y) { let s = G.segs[k]; if (!s) s = G.segs[k] = { x: 0, y: 0, a: 0 }; s.x = x; s.y = y; }

function updateEnemies(dt) {
  const frozen = !!G.powers.freeze;
  const lvlMul = 1 + Math.min(0.45, (G.level - 1) * 0.035);
  const spdMul = G.diff.enemySpeed * lvlMul * admin.enemySpeed;
  const hasPlayer = !G.demo;
  const vis = hasPlayer ? visionRadius() : 0;
  for (const e of G.enemies) {
    e.spin += dt * (e.state === 'chase' ? 3.5 : 1);
    if (e.spawnT > 0) { e.spawnT -= dt; continue; }
    if (frozen) continue;
    if (e.alertT > 0) e.alertT -= dt;
    if (e.stun > 0) {
      e.stun -= dt;
      e.vx *= Math.exp(-4 * dt); e.vy *= Math.exp(-4 * dt);
      moveEnemy(e, dt);
      continue;
    }
    // percepción (limitada a ~8 comprobaciones por segundo)
    e.losT -= dt;
    if (hasPlayer && e.losT <= 0) {
      e.losT = 0.12;
      const d = dist(e.x, e.y, G.head.x, G.head.y);
      const range = e.state === 'chase' ? vis * 1.35 : vis;
      const sees = !G.powers.ghost && d < range && lineOfSight(e.x, e.y, G.head.x, G.head.y);
      if (sees) {
        if (e.state !== 'chase') { e.alertT = 0.9; Sound.alert(); }
        e.state = 'chase';
        e.lastSeen = { x: G.head.x, y: G.head.y };
      } else if (e.state === 'chase') { e.state = 'search'; e.searchT = 2.2; }
    }
    let tx, ty, sp;
    if (e.state === 'chase') { tx = G.head.x; ty = G.head.y; sp = CHASE_SPEED * spdMul; }
    else if (e.state === 'search' && e.lastSeen) {
      e.searchT -= dt; tx = e.lastSeen.x; ty = e.lastSeen.y; sp = CHASE_SPEED * 0.8 * spdMul;
      if (e.searchT <= 0 || dist(e.x, e.y, tx, ty) < 20) { e.state = 'wander'; e.wanderT = 0; }
    } else {
      e.state = 'wander';
      e.wanderT -= dt;
      if (e.wanderT <= 0) { e.wanderA = rand(0, TAU); e.wanderT = rand(1.5, 3.5); }
      tx = e.x + Math.cos(e.wanderA) * 100; ty = e.y + Math.sin(e.wanderA) * 100; sp = WANDER_SPEED * spdMul;
    }
    const a = Math.atan2(ty - e.y, tx - e.x);
    const k = 1 - Math.exp(-(e.state === 'chase' ? 5 : 2.5) * dt);
    e.vx += (Math.cos(a) * sp - e.vx) * k;
    e.vy += (Math.sin(a) * sp - e.vy) * k;
    for (const o of G.enemies) { // separación entre enemigos
      if (o === e) continue;
      const dx = e.x - o.x, dy = e.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 < 2500 && d2 > 0.01) { const d = Math.sqrt(d2); e.vx += dx / d * (50 - d) * 6 * dt; e.vy += dy / d * (50 - d) * 6 * dt; }
    }
    moveEnemy(e, dt);
    e.look = e.state === 'chase' ? Math.atan2(G.head.y - e.y, G.head.x - e.x) : Math.atan2(e.vy, e.vx);
  }
}
function enemyBlocked(x, y) {
  if (x < ER || x > WORLD - ER || y < ER || y > WORLD - ER) return true;
  for (const o of G.obstacles) if (x + ER > o.x && x - ER < o.x + o.w && y + ER > o.y && y - ER < o.y + o.h) return true;
  return false;
}
function moveEnemy(e, dt) {
  const nx = e.x + e.vx * dt;
  if (enemyBlocked(nx, e.y)) { e.vx *= -0.3; if (e.state === 'wander') e.wanderA = Math.PI - e.wanderA; } else e.x = nx;
  const ny = e.y + e.vy * dt;
  if (enemyBlocked(e.x, ny)) { e.vy *= -0.3; if (e.state === 'wander') e.wanderA = -e.wanderA; } else e.y = ny;
}
function lineOfSight(x1, y1, x2, y2) {
  const minx = Math.min(x1, x2), maxx = Math.max(x1, x2), miny = Math.min(y1, y2), maxy = Math.max(y1, y2);
  for (const o of G.obstacles) {
    if (o.x > maxx || o.x + o.w < minx || o.y > maxy || o.y + o.h < miny) continue;
    if (segHitsRect(x1, y1, x2, y2, o)) return false;
  }
  return true;
}
function manageEnemies() {
  if (G.enemies.length + G.pendingEnemies < enemyTarget()) {
    G.pendingEnemies++;
    schedule(1.2, () => { G.pendingEnemies--; spawnEnemy(false); });
  }
}

function overlapsHazard() {
  if (!G.char) return false;
  const hp = headPoly();
  for (let k = 3; k < G.segs.length; k++) {
    const s = G.segs[k];
    if (Math.abs(s.x - G.head.x) < SIZE * 1.25 && Math.abs(s.y - G.head.y) < SIZE * 1.25 && sat(hp, segPoly(k))) return true;
  }
  if (!G.powers.freeze) {
    for (const e of G.enemies) if (Math.abs(e.x - G.head.x) < SIZE * 1.25 && Math.abs(e.y - G.head.y) < SIZE * 1.25 && sat(hp, enemyPoly(e))) return true;
  }
  return false;
}

function checkBodyCollisions() {
  const ghost = !!G.powers.ghost, frozen = !!G.powers.freeze;
  const safe = ghost || G.invuln > 0 || admin.god;
  const hx = G.head.x, hy = G.head.y;
  let hp = null;
  // cabeza contra cazadores
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    if (e.spawnT > 0 || Math.abs(e.x - hx) > SIZE * 1.2 || Math.abs(e.y - hy) > SIZE * 1.2) continue;
    hp = hp || headPoly();
    const r = sat(hp, enemyPoly(e));
    if (!r) continue;
    if (frozen) { shatter(i); continue; }
    if (safe) continue;
    handleHit('enemy', r.nx, r.ny, e);
    return;
  }
  // cazadores contra la cola
  if (!safe && !frozen) {
    for (const e of G.enemies) {
      if (e.spawnT > 0) continue;
      let ep = null;
      for (let k = 0; k < G.segs.length; k++) {
        const s = G.segs[k];
        if (Math.abs(s.x - e.x) > SIZE * 1.2 || Math.abs(s.y - e.y) > SIZE * 1.2) continue;
        ep = ep || enemyPoly(e);
        if (sat(ep, segPoly(k))) { handleHit('tail', null, null, e, s); return; }
      }
    }
  }
  // cabeza contra la propia cola (se ignoran los segmentos pegados al cuello)
  if (!safe) {
    hp = hp || headPoly();
    for (let k = 3; k < G.segs.length; k++) {
      const s = G.segs[k];
      if (Math.abs(s.x - hx) > SIZE * 1.25 || Math.abs(s.y - hy) > SIZE * 1.25) continue;
      const r = sat(hp, segPoly(k));
      if (r) { handleHit('self', r.nx, r.ny, null); return; }
    }
  }
}

// Gestiona un choque mortal: escudo → poda de emergencia → muerte. Devuelve true si sobrevives.
function handleHit(kind, nx, ny, enemy, seg) {
  const p = G.perks;
  let label, color;
  if (p.shields > 0) { p.shields--; label = 'Escudo'; color = '#60a5fa'; }
  else if (p.emergency > 0) { p.emergency--; G.tailCount = Math.max(0, G.tailCount - 5); label = 'Poda de emergencia'; color = '#34d399'; }
  else { die(kind); return false; }
  Sound.shield();
  vibrate(45);
  G.invuln = 1.4; G.invulnExt = 0;
  G.shake = Math.max(G.shake, 10); G.flash = 0.22; G.flashColor = color;
  burst(G.head.x, G.head.y, color, 18, 220);
  ring(G.head.x, G.head.y, color, 60);
  addText(G.head.x, G.head.y - 34, label, color, 17);
  resetCombo();
  if (nx !== null) {
    // rebote: refleja la dirección respecto a la normal del choque
    const hx = Math.cos(G.heading), hy = Math.sin(G.heading), dot = hx * nx + hy * ny;
    let na = Math.atan2(hy - 2 * dot * ny, hx - 2 * dot * nx);
    const rev = angDiff(G.heading + Math.PI, na);
    if (Math.abs(rev) < 0.35) na += (rev >= 0 ? 1 : -1) * 0.6; // evita volver recto sobre la cola
    G.heading = na;
    G.speed = Math.max(G.speed * 0.75, 100);
    G.bounceT = 0.32;
    G.head.x = clamp(G.head.x + nx * 6, HR, WORLD - HR);
    G.head.y = clamp(G.head.y + ny * 6, HR, WORLD - HR);
  }
  if (enemy) {
    const from = seg || G.head;
    const a = Math.atan2(enemy.y - from.y, enemy.x - from.x);
    for (let s = 0; s < 10; s++) { const tx = enemy.x + Math.cos(a) * 7, ty = enemy.y + Math.sin(a) * 7; if (enemyBlocked(tx, ty)) break; enemy.x = tx; enemy.y = ty; }
    enemy.vx = Math.cos(a) * 160; enemy.vy = Math.sin(a) * 160;
    enemy.stun = 1.4; enemy.state = 'wander';
  }
  return true;
}

function shatter(i) {
  const e = G.enemies[i];
  G.enemies.splice(i, 1);
  G.kills++;
  const pts = Math.round((40 + G.level * 10) * G.perks.scoreMult * (G.powers.double ? 2 : 1));
  G.score += pts;
  burst(e.x, e.y, ICE_COLOR, 26, 280);
  ring(e.x, e.y, ICE_COLOR, 70);
  addText(e.x, e.y - 22, '+' + fmt(pts), ICE_COLOR, 19);
  Sound.shatter();
  G.shake = Math.max(G.shake, 5);
  G.pendingEnemies++;
  schedule(7, () => { G.pendingEnemies--; spawnEnemy(false); });
}

function updatePickups(dt) {
  const hx = G.head.x, hy = G.head.y, pr = pickupRadius();
  for (let i = G.foods.length - 1; i >= 0; i--) {
    const f = G.foods[i];
    f.age += dt; f.rot += dt * (f.kind === 'gold' ? 2 : 1.2); f.pulse += dt * 4;
    if (f.age > f.life) {
      G.foods.splice(i, 1);
      if (f.kind === 'gold') ring(f.x, f.y, GOLD_COLOR, 40); else spawnFood(true);
      continue;
    }
    if (G.powers.magnet) {
      const d = dist(hx, hy, f.x, f.y);
      if (d < 280 && d > 1) { const s = Math.min(d, 340 * dt); f.x += (hx - f.x) / d * s; f.y += (hy - f.y) / d * s; }
    }
    if (f.kind === 'gold' && Math.random() < dt * 8) G.particles.push({ x: f.x + rand(-14, 14), y: f.y + rand(-14, 14), vx: 0, vy: -30, life: 0.6, max: 0.6, size: 2, color: GOLD_COLOR, drag: 1 });
    if (dist(hx, hy, f.x, f.y) < pr + (f.kind === 'gold' ? 6 : 0)) eatFood(i);
  }
  for (let i = G.powerups.length - 1; i >= 0; i--) {
    const p = G.powerups[i];
    if (dist(hx, hy, p.x, p.y) < HR + 22) {
      G.powerups.splice(i, 1);
      const c = POWERS[p.type].color;
      burst(p.x, p.y, c, 16, 200); ring(p.x, p.y, c, 54);
      activatePower(p.type);
      schedule(5, spawnPowerup);
    }
  }
}

function eatFood(i) {
  const f = G.foods[i];
  G.foods.splice(i, 1);
  const gold = f.kind === 'gold';
  G.tailCount += 1 + G.perks.growth;
  G.maxLength = Math.max(G.maxLength, G.tailCount + 1);
  G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo); G.comboT = comboWindow();
  const base = gold ? 60 + G.tailCount * 2 : 10 + G.tailCount;
  const pts = Math.round(base * comboMult() * G.perks.scoreMult * (G.powers.double ? 2 : 1));
  G.score += pts;
  G.foodsEaten++;
  const col = gold ? GOLD_COLOR : FOOD_COLOR;
  burst(f.x, f.y, col, gold ? 28 : 10, gold ? 280 : 160);
  addText(f.x, f.y - 16, '+' + fmt(pts), gold ? GOLD_COLOR : G.powers.double ? '#38bdf8' : G.combo >= 3 ? GOLD_COLOR : '#ffffff', gold ? 23 : 15);
  if (gold) { Sound.gold(); ring(f.x, f.y, GOLD_COLOR, 80); toast('★ Energía dorada', `+${fmt(pts)} puntos`, GOLD_COLOR); }
  else { Sound.eat(G.combo); spawnFood(true); }
  if (G.perks.burstEvery) {
    G.burstCount++;
    if (G.burstCount >= G.perks.burstEvery) { G.burstCount = 0; activatePower('speed', 2.5, true); addText(G.head.x, G.head.y - 46, 'Ráfaga', '#facc15', 16); }
  }
  addXP((gold ? 3 : 1) + G.perks.xpBonus);
}

function addXP(n) {
  G.xp += n;
  while (G.xp >= G.xpNext) {
    G.xp -= G.xpNext;
    G.level++;
    G.xpNext = Math.round((3 + G.level) * G.diff.xpMult);
    if (G.level % 5 === 0) { G.pendingLevelUp = true; Sound.skill(); break; }
    Sound.level();
    addText(G.head.x, G.head.y - 50, 'Nivel ' + G.level, '#a78bfa', 20);
    ring(G.head.x, G.head.y, '#a78bfa', 70);
  }
}

function activatePower(id, forced, quiet) {
  const d = POWERS[id];
  if (id === 'shrink') {
    const lost = Math.min(3, G.tailCount);
    G.tailCount -= lost;
    Sound.pick();
    toast(d.name, lost ? `Pierdes ${lost} segmento${lost > 1 ? 's' : ''}` : 'No había nada que recortar', d.color, id);
    return;
  }
  const dur = forced || d.dur + G.perks.powerDur + (id === 'ghost' ? G.perks.ghostBonus : 0);
  const cur = G.powers[id];
  if (cur) { cur.t = Math.max(cur.t, dur); cur.dur = Math.max(cur.dur, cur.t); }
  else G.powers[id] = { t: dur, dur };
  if (!quiet) { Sound.power(); toast(d.name, d.desc, d.color, id); }
}
function onPowerEnd(id) {
  if (mode !== 'play') return;
  if (id === 'ghost') { G.invuln = Math.max(G.invuln, 0.6); G.invulnExt = 0; pushOutOfObstacles(); Sound.powerEnd(); }
  if (id === 'freeze') Sound.powerEnd();
}

function die(kind) {
  G.deathReason = DEATH_REASONS[kind] || '';
  G.maxLength = Math.max(G.maxLength, G.tailCount + 1);
  mode = 'dying';
  G.deathT = 0; G.popIdx = 0; G.speed = 0;
  resetJoy();
  Sound.death(); vibrate([60, 40, 140]);
  G.shake = 18; G.flash = 0.5; G.flashColor = '#ff3b5c';
  burst(G.head.x, G.head.y, G.char.color, 40, 340);
  ring(G.head.x, G.head.y, G.char.color, 90);
  hudSetCombo(false);
}

function updateDying(dt) {
  G.deathT += dt;
  updateFx(dt);
  const n = G.segs.length;
  const rate = Math.min(0.035, 1 / Math.max(1, n));
  while (G.popIdx < n && G.deathT > 0.3 + G.popIdx * rate) {
    const s = G.segs[G.popIdx];
    burst(s.x, s.y, G.shades[Math.min(G.popIdx, G.shades.length - 1)], 6, 150);
    if (G.popIdx % 3 === 0) Sound.pop();
    G.popIdx++;
  }
  if (!G.overShown && G.deathT > 0.3 + n * rate + 0.7) { G.overShown = true; showGameOver(); }
}

function updateDemo(dt) {
  G.time += dt;
  G.demoT += dt;
  updateEnemies(dt);
  for (const f of G.foods) { f.rot += dt * 1.2; f.pulse += dt * 4; }
  updateFx(dt);
  const t = G.demoT;
  const tx = WORLD / 2 + Math.sin(t * 0.05) * 900 - W / 2;
  const ty = WORLD / 2 + Math.cos(t * 0.037) * 800 - H / 2;
  cam.x += (tx - cam.x) * (1 - Math.exp(-1.5 * dt));
  cam.y += (ty - cam.y) * (1 - Math.exp(-1.5 * dt));
}

/* ════════════════════════════════════════════════════════════════
   Efectos: partículas, textos flotantes y cámara
   ════════════════════════════════════════════════════════════════ */
function burst(x, y, color, n, speed) {
  if (reducedMotion) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    if (G.particles.length > 600) break;
    const a = rand(0, TAU), s = rand(speed * 0.3, speed);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.35, 0.8), max: 0.8, size: rand(2, 4.5), color, drag: 3 });
  }
}
function ring(x, y, color, r) { G.particles.push({ x, y, ring: true, r, life: 0.45, max: 0.45, color }); }
function addText(x, y, text, color, size) { G.texts.push({ x, y, text, color, size: size || 15, life: 0.9, max: 0.9 }); }

function updateFx(dt) {
  const P = G.particles;
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    p.life -= dt;
    if (p.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; }
    if (!p.ring) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt; }
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.life -= dt; t.y -= 38 * dt;
    if (t.life <= 0) G.texts.splice(i, 1);
  }
  G.shake = reducedMotion ? 0 : G.shake * Math.exp(-8 * dt);
  G.flash = Math.max(0, G.flash - dt * 1.6);
}

function updateCamera(dt, instant) {
  const look = Math.min(90, G.speed * 0.35);
  const tx = G.head.x + Math.cos(G.heading) * look - W / 2;
  const ty = G.head.y + Math.sin(G.heading) * look - H / 2;
  const k = instant ? 1 : 1 - Math.exp(-6 * dt);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.x = W >= WORLD + 120 ? (WORLD - W) / 2 : clamp(cam.x, -60, WORLD - W + 60);
  cam.y = H >= WORLD + 120 ? (WORLD - H) / 2 : clamp(cam.y, -60, WORLD - H + 60);
}

/* ════════════════════════════════════════════════════════════════
   Render
   ════════════════════════════════════════════════════════════════ */
const glowCache = new Map();
function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, rgba(color, 0.55)); gr.addColorStop(0.35, rgba(color, 0.2)); gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowCache.set(color, c);
  return c;
}
function drawGlow(color, x, y, r, alpha) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (alpha === undefined ? 1 : alpha);
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}
let hatch = null;
function hatchPattern() {
  if (hatch) return hatch;
  const c = document.createElement('canvas'); c.width = c.height = 14;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(120,150,255,0.09)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-2, 16); g.lineTo(16, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(12, 16); g.lineTo(16, 12); g.stroke();
  hatch = ctx.createPattern(c, 'repeat');
  return hatch;
}

function shapePath(c, shape, r) {
  c.beginPath();
  if (shape === 'square') { c.roundRect(-r, -r, r * 2, r * 2, r * 0.32); return; }
  if (shape === 'circle') { c.arc(0, 0, r, 0, TAU); return; }
  const s = SHAPES[shape];
  c.moveTo(s[0][0] * r, s[0][1] * r);
  for (let i = 1; i < s.length; i++) c.lineTo(s[i][0] * r, s[i][1] * r);
  c.closePath();
}

const inView = (x, y, m) => x > cam.x - m && x < cam.x + W + m && y > cam.y - m && y < cam.y + H + m;

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0b0c1f';
  ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const sx = G.shake > 0.3 ? (Math.random() - 0.5) * G.shake : 0;
  const sy = G.shake > 0.3 ? (Math.random() - 0.5) * G.shake : 0;
  ctx.save();
  ctx.translate(-Math.round(cam.x) + sx, -Math.round(cam.y) + sy);
  drawFloor();
  drawObstacles();
  drawFoods();
  drawPowerups();
  if (!G.demo) drawSnake();
  drawEnemies();
  drawParticles();
  drawTexts();
  if (admin.hitboxes && !G.demo) drawDebug();
  ctx.restore();
  if (!G.demo) drawIndicators();
  drawJoystick();
  if (vignette) ctx.drawImage(vignette, 0, 0, W, H);
  if (G.flash > 0) { ctx.fillStyle = rgba(G.flashColor, G.flash * 0.45); ctx.fillRect(0, 0, W, H); }
}

function drawFloor() {
  ctx.fillStyle = '#15183a';
  ctx.fillRect(0, 0, WORLD, WORLD);
  const x0 = Math.max(0, Math.floor(cam.x / TILE) * TILE), x1 = Math.min(WORLD, cam.x + W + TILE);
  const y0 = Math.max(0, Math.floor(cam.y / TILE) * TILE), y1 = Math.min(WORLD, cam.y + H + TILE);
  const ya = Math.max(0, cam.y - 20), yb = Math.min(WORLD, cam.y + H + 20), xa = Math.max(0, cam.x - 20), xb = Math.min(WORLD, cam.x + W + 20);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(130,140,255,0.065)';
  ctx.beginPath();
  for (let x = x0; x <= x1; x += TILE) if (x % (TILE * 5)) { ctx.moveTo(x + 0.5, ya); ctx.lineTo(x + 0.5, yb); }
  for (let y = y0; y <= y1; y += TILE) if (y % (TILE * 5)) { ctx.moveTo(xa, y + 0.5); ctx.lineTo(xb, y + 0.5); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(130,140,255,0.13)';
  ctx.beginPath();
  for (let x = x0; x <= x1; x += TILE) if (!(x % (TILE * 5))) { ctx.moveTo(x + 0.5, ya); ctx.lineTo(x + 0.5, yb); }
  for (let y = y0; y <= y1; y += TILE) if (!(y % (TILE * 5))) { ctx.moveTo(xa, y + 0.5); ctx.lineTo(xb, y + 0.5); }
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,77,109,0.1)'; ctx.lineWidth = 22; ctx.strokeRect(-11, -11, WORLD + 22, WORLD + 22);
  ctx.strokeStyle = 'rgba(255,77,109,0.75)'; ctx.lineWidth = 3; ctx.strokeRect(-1.5, -1.5, WORLD + 3, WORLD + 3);
  ctx.restore();
}

function drawObstacles() {
  const vis = [];
  for (const o of G.obstacles) if (o.x + o.w > cam.x - 20 && o.x < cam.x + W + 20 && o.y + o.h > cam.y - 20 && o.y < cam.y + H + 20) vis.push(o);
  if (!vis.length) return;
  ctx.beginPath();
  for (const o of vis) ctx.roundRect(o.x, o.y, o.w, o.h, 6);
  ctx.fillStyle = '#1d2763'; ctx.fill();
  ctx.fillStyle = hatchPattern(); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(91,140,255,0.12)'; ctx.lineWidth = 7; ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(120,165,255,0.7)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  for (const o of vis) ctx.rect(o.x + 4, o.y + 3, o.w - 8, 2);
  ctx.fill();
}

function drawFoods() {
  for (const f of G.foods) {
    if (!inView(f.x, f.y, 50)) continue;
    const left = f.life - f.age;
    if (left < 4 && Math.floor(f.age * 8) % 2 === 0) continue; // parpadea antes de desaparecer
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (f.kind === 'gold') drawGlow(GOLD_COLOR, f.x, f.y, 52 + Math.sin(f.pulse) * 6, 1);
    else drawGlow(FOOD_COLOR, f.x, f.y, 30, 0.85);
    ctx.restore();
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    if (f.kind === 'gold') {
      const r = 15 + Math.sin(f.pulse) * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
      ctx.fillStyle = GOLD_COLOR; ctx.fill();
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      const s = 15 + Math.sin(f.pulse) * 1.5;
      ctx.beginPath(); ctx.roundRect(-s / 2, -s / 2, s, s, 4);
      ctx.fillStyle = FOOD_COLOR; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.roundRect(-s / 2 + 3, -s / 2 + 3, s * 0.35, s * 0.25, 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawIcon(id, x, y, size, color) {
  const ic = ICONS[id], s = size / 24;
  ctx.save();
  ctx.translate(x - 12 * s, y - 12 * s); ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(14,15,36,0.7)'; ctx.lineWidth = 3.4;
  for (const d of ic.fill || []) ctx.stroke(P2(d));
  for (const d of ic.stroke || []) ctx.stroke(P2(d));
  ctx.fillStyle = color;
  for (const d of ic.fill || []) ctx.fill(P2(d));
  ctx.strokeStyle = color; ctx.lineWidth = 2.3;
  for (const d of ic.stroke || []) ctx.stroke(P2(d));
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const d of ic.light || []) ctx.fill(P2(d));
  ctx.strokeStyle = 'rgba(20,22,58,0.45)'; ctx.lineWidth = 1.2;
  for (const d of ic.facets || []) ctx.stroke(P2(d));
  ctx.fillStyle = '#14163a';
  for (const d of ic.dark || []) ctx.fill(P2(d));
  ctx.restore();
}

function drawPowerups() {
  for (const p of G.powerups) {
    if (!inView(p.x, p.y, 50)) continue;
    const bob = Math.sin(G.time * 3 + p.bob) * 5;
    const c = POWERS[p.type].color;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(c, p.x, p.y + bob, 40 + Math.sin(G.time * 4 + p.bob) * 4, 0.9);
    ctx.restore();
    drawIcon(p.type, p.x, p.y + bob, 30, c);
  }
}

function drawEyes(shape, r, look, closed, dead) {
  const [ex, ey] = EYES[shape] || EYES.square;
  for (const side of [-1, 1]) {
    const x = r * ex, y = side * r * ey;
    if (dead) {
      ctx.strokeStyle = '#14163a'; ctx.lineWidth = 2.2; const s = r * 0.16;
      ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
    } else if (closed) {
      ctx.strokeStyle = '#14163a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - r * 0.18, y); ctx.lineTo(x + r * 0.18, y); ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = '#14163a';
      ctx.beginPath(); ctx.arc(x + Math.cos(look) * r * 0.08, y + Math.sin(look) * r * 0.08, r * 0.11, 0, TAU); ctx.fill();
    }
  }
}

function drawSnake() {
  const segs = G.segs, n = segs.length, shape = G.char.shape;
  const dying = mode === 'dying' || mode === 'over';
  const ghost = !!G.powers.ghost;
  const ghostEnding = ghost && G.powers.ghost.t < 1.5;
  const tt = performance.now() / 1000;
  let alpha = 1;
  if (ghost) alpha = ghostEnding ? (Math.floor(tt * 10) % 2 ? 0.3 : 0.75) : 0.55;
  else if (G.invuln > 0) alpha = Math.floor(tt * 14) % 2 ? 0.35 : 1;
  const base = ghost ? '#b9a6ff' : G.char.color;
  ctx.save();
  ctx.globalAlpha = alpha;
  // columna que une los segmentos
  const start = dying ? G.popIdx : 0;
  if (n - start > 0) {
    ctx.beginPath();
    if (!dying) ctx.moveTo(G.head.x, G.head.y); else ctx.moveTo(segs[start].x, segs[start].y);
    for (let i = start; i < n; i++) ctx.lineTo(segs[i].x, segs[i].y);
    ctx.strokeStyle = rgba(ghost ? '#a78bfa' : G.char.color, 0.28);
    ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }
  // segmentos de atrás hacia delante
  for (let i = n - 1; i >= start; i--) {
    const s = segs[i], r = segR(i);
    if (!inView(s.x, s.y, 40)) continue;
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(s.a);
    shapePath(ctx, shape, r);
    ctx.fillStyle = ghost ? '#8f7cf7' : G.shades[Math.min(i, G.shades.length - 1)];
    ctx.fill();
    shapePath(ctx, shape, r * 0.52);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.restore();
  }
  if (!dying) {
    const h = G.head;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(base, h.x, h.y, 58, 0.75);
    ctx.restore();
    ctx.save();
    ctx.translate(h.x, h.y); ctx.rotate(G.heading);
    shapePath(ctx, shape, HR);
    ctx.fillStyle = base; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    // los ojos miran al cazador más cercano que te persigue
    let look = 0, best = 260;
    for (const e of G.enemies) { if (e.state !== 'chase') continue; const d = dist(e.x, e.y, h.x, h.y); if (d < best) { best = d; look = Math.atan2(e.y - h.y, e.x - h.x) - G.heading; } }
    drawEyes(shape, HR, look, G.blink > 0, false);
    ctx.restore();
    // flecha de dirección
    const ar = HR + 13 + Math.sin(G.time * 6) * 1.5;
    ctx.save();
    ctx.translate(h.x + Math.cos(G.heading) * ar, h.y + Math.sin(G.heading) * ar);
    ctx.rotate(G.heading);
    ctx.beginPath(); ctx.moveTo(-4, -7); ctx.lineTo(4, 0); ctx.lineTo(-4, 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
    // escudos orbitando
    const sh = Math.min(G.perks.shields, 8);
    for (let i = 0; i < sh; i++) {
      const a = G.time * 2 + i * TAU / sh, rx = h.x + Math.cos(a) * (HR + 15), ry = h.y + Math.sin(a) * (HR + 15);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; drawGlow('#60a5fa', rx, ry, 12, 0.9);
      ctx.restore();
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(a);
      shapePath(ctx, 'hexagon', 4.5); ctx.fillStyle = '#93c5fd'; ctx.fill();
      ctx.restore();
    }
    // anillo del imán
    if (G.powers.magnet) {
      ctx.save();
      ctx.setLineDash([6, 10]); ctx.lineDashOffset = -G.time * 40;
      ctx.strokeStyle = 'rgba(244,114,182,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(h.x, h.y, 280, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawEnemies() {
  const frozen = !!G.powers.freeze;
  for (const e of G.enemies) {
    if (!inView(e.x, e.y, 70)) continue;
    const chasing = e.state === 'chase' && !frozen;
    const col = frozen ? ICE_COLOR : chasing ? ENEMY_COLOR : '#e5484d';
    const grow = e.spawnT > 0 ? 1 - e.spawnT / 0.9 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(col, e.x, e.y, (chasing ? 56 : 42) * grow, chasing ? 0.95 : 0.7);
    ctx.restore();
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(grow, grow);
    if (e.spawnT > 0) ctx.globalAlpha = grow;
    // pinchos giratorios
    ctx.save();
    ctx.rotate(frozen ? 0 : e.spin);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      ctx.moveTo(Math.cos(a - 0.22) * ER * 0.9, Math.sin(a - 0.22) * ER * 0.9);
      ctx.lineTo(Math.cos(a) * ER * 1.32, Math.sin(a) * ER * 1.32);
      ctx.lineTo(Math.cos(a + 0.22) * ER * 0.9, Math.sin(a + 0.22) * ER * 0.9);
    }
    ctx.fillStyle = frozen ? '#a5f3fc' : mixHex(col, '#2a0a12', 0.25);
    ctx.fill();
    ctx.restore();
    shapePath(ctx, 'octagon', ER);
    ctx.fillStyle = col; ctx.fill();
    shapePath(ctx, 'octagon', ER * 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fill();
    // ojos enfadados
    const la = e.look || 0;
    for (const side of [-1, 1]) {
      const x = side * 6, y = -1;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 4.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#14163a';
      ctx.beginPath(); ctx.arc(x + Math.cos(la) * 1.7, y + Math.sin(la) * 1.7, 2.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#14163a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - side * 4.5, y - (chasing ? 7.5 : 6)); ctx.lineTo(x + side * 3, y - (chasing ? 4 : 5.2)); ctx.stroke();
    }
    if (frozen) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.moveTo(-2, 0); ctx.lineTo(9, 4); ctx.stroke();
    }
    ctx.restore();
    if (e.stun > 0 && !frozen) {
      ctx.save(); ctx.fillStyle = '#ffe28a';
      for (let i = 0; i < 3; i++) { const a = G.time * 5 + i * TAU / 3; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 15, e.y - 26 + Math.sin(a) * 5, 2.4, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    if (e.alertT > 0 && !frozen) {
      const b = Math.sin((0.9 - e.alertT) * 12) * 3;
      ctx.save();
      ctx.font = '700 22px "Chakra Petch",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#14163a'; ctx.strokeText('!', e.x, e.y - 34 + b);
      ctx.fillStyle = GOLD_COLOR; ctx.fillText('!', e.x, e.y - 34 + b);
      ctx.restore();
    }
  }
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.particles) {
    const k = p.life / p.max;
    if (p.ring) {
      ctx.globalAlpha = k;
      ctx.strokeStyle = p.color; ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.85), 0, TAU); ctx.stroke();
    } else {
      if (!inView(p.x, p.y, 10)) continue;
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + k * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  ctx.restore();
}

function drawTexts() {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of G.texts) {
    const k = t.life / t.max;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.font = `700 ${Math.round(t.size * (1 + (1 - k) * 0.15))}px "Chakra Petch",system-ui,sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(14,15,36,0.85)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

function drawDebug() {
  ctx.save();
  ctx.lineWidth = 1.5;
  const poly = (P, c) => { ctx.strokeStyle = c; ctx.beginPath(); P.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); ctx.stroke(); };
  if (mode === 'play' || mode === 'paused' || mode === 'levelup') poly(headPoly(), '#00ff88');
  for (let k = 0; k < G.segs.length; k++) poly(segPoly(k), k < 3 ? 'rgba(255,255,255,0.3)' : '#ffee00');
  const vr = visionRadius();
  for (const e of G.enemies) {
    poly(enemyPoly(e), '#ff2266');
    ctx.strokeStyle = e.state === 'chase' ? 'rgba(255,60,60,0.45)' : 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(e.x, e.y, e.state === 'chase' ? vr * 1.35 : vr, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(e.state, e.x, e.y + 32);
  }
  ctx.strokeStyle = 'rgba(244,114,182,0.6)';
  ctx.beginPath(); ctx.arc(G.head.x, G.head.y, pickupRadius(), 0, TAU); ctx.stroke();
  ctx.restore();
}

function drawIndicators() {
  if (mode !== 'play') return;
  const px = G.head.x - cam.x, py = G.head.y - cam.y;
  const items = [];
  for (const f of G.foods) if (f.kind === 'gold') items.push({ x: f.x, y: f.y, color: GOLD_COLOR });
  if (!G.powers.freeze) for (const e of G.enemies) if (e.state === 'chase' && dist(e.x, e.y, G.head.x, G.head.y) < 1100) items.push({ x: e.x, y: e.y, color: ENEMY_COLOR });
  const m = 34;
  for (const it of items) {
    const sx = it.x - cam.x, sy = it.y - cam.y;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const dx = sx - px, dy = sy - py;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (W - m - px) / dx);
    if (dx < 0) t = Math.min(t, (m - px) / dx);
    if (dy > 0) t = Math.min(t, (H - m - py) / dy);
    if (dy < 0) t = Math.min(t, (m - py) / dy);
    if (!isFinite(t) || t <= 0) continue;
    const ix = px + dx * t, iy = py + dy * t, a = Math.atan2(dy, dx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(it.color, ix, iy, 26, 0.9 + Math.sin(G.time * 8) * 0.1);
    ctx.restore();
    ctx.save();
    ctx.translate(ix, iy); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -8); ctx.lineTo(-3, 0); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fillStyle = it.color; ctx.fill();
    ctx.restore();
  }
}

function drawJoystick() {
  if (!joy.active || mode !== 'play') return;
  const c = G.char ? G.char.color : '#ff4d6d';
  ctx.save();
  ctx.beginPath(); ctx.arc(joy.bx, joy.by, joy.R, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(joy.bx, joy.by); ctx.lineTo(joy.tx, joy.ty);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(c, joy.tx, joy.ty, 46, 0.8);
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); ctx.arc(joy.tx, joy.ty, 24, 0, TAU);
  ctx.fillStyle = rgba(c, 0.9); ctx.fill();
  ctx.restore();
}

/* Minimapa */
function buildMiniLayer(obstacles) {
  const c = document.createElement('canvas'); c.width = c.height = 240;
  const g = c.getContext('2d'), s = 240 / WORLD;
  g.fillStyle = 'rgba(60,85,190,0.75)';
  for (const o of obstacles) g.fillRect(o.x * s, o.y * s, Math.max(1.5, o.w * s), Math.max(1.5, o.h * s));
  return c;
}
let miniFrame = 0;
function drawMinimap() {
  if (!G || G.demo || mode === 'menu') return;
  if (++miniFrame % 2) return;
  const mw = mini.width, mh = mini.height, s = mw / WORLD;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, mw, mh);
  mctx.drawImage(G.miniLayer, 0, 0, mw, mh);
  mctx.fillStyle = FOOD_COLOR;
  const d = Math.max(2, mw / 55);
  for (const f of G.foods) if (f.kind !== 'gold') mctx.fillRect(f.x * s - d / 2, f.y * s - d / 2, d, d);
  for (const p of G.powerups) { mctx.fillStyle = POWERS[p.type].color; mctx.beginPath(); mctx.arc(p.x * s, p.y * s, d * 0.9, 0, TAU); mctx.fill(); }
  for (const f of G.foods) if (f.kind === 'gold') { mctx.fillStyle = GOLD_COLOR; mctx.beginPath(); mctx.arc(f.x * s, f.y * s, d * 1.6, 0, TAU); mctx.fill(); }
  for (const e of G.enemies) {
    mctx.fillStyle = G.powers.freeze ? ICE_COLOR : ENEMY_COLOR;
    const r = e.state === 'chase' ? d * (1.2 + Math.sin(G.time * 10) * 0.3) : d;
    mctx.beginPath(); mctx.arc(e.x * s, e.y * s, r, 0, TAU); mctx.fill();
  }
  if (G.segs.length) {
    mctx.strokeStyle = rgba(G.char.color, 0.7); mctx.lineWidth = Math.max(1.5, d * 0.8); mctx.lineCap = 'round';
    mctx.beginPath(); mctx.moveTo(G.head.x * s, G.head.y * s);
    for (let i = 0; i < G.segs.length; i += 2) mctx.lineTo(G.segs[i].x * s, G.segs[i].y * s);
    mctx.stroke();
  }
  mctx.fillStyle = '#ffffff';
  mctx.beginPath(); mctx.arc(G.head.x * s, G.head.y * s, d * 1.3, 0, TAU); mctx.fill();
  mctx.strokeStyle = 'rgba(255,255,255,0.3)'; mctx.lineWidth = 1;
  mctx.strokeRect(cam.x * s, cam.y * s, W * s, H * s);
}

/* ════════════════════════════════════════════════════════════════
   HUD
   ════════════════════════════════════════════════════════════════ */
const hud = {
  root: $('hud'), score: $('hudScore'), len: $('hudLen'), lvl: $('hudLvl'), xp: $('hudXp'), xpFill: $('hudXpFill'),
  shieldWrap: $('hudShieldWrap'), shield: $('hudShield'), timer: $('timer'),
  combo: $('combo'), comboText: $('comboText'), comboFill: $('comboFill'),
  powers: $('powers'), toast: $('toast'), t1: $('toastT1'), t2: $('toastT2'), hint: $('hint')
};
const hudCache = {};
const setText = (el, key, v) => { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } };
const chipEls = {};
let toastTimer = 0;

function toast(t1, t2, color, iconId) {
  hud.t1.textContent = t1;
  if (iconId) hud.t1.insertAdjacentHTML('afterbegin', iconSVG(iconId, color || '#fff'));
  hud.t2.textContent = t2 || '';
  hud.toast.style.setProperty('--c', color || '#fff');
  hud.toast.classList.add('on');
  toastTimer = 1.9;
}
function hudSetCombo(on) { hud.combo.classList.toggle('on', on); }
function resetCombo() { G.combo = 0; G.comboT = 0; }

function resetHUD() {
  for (const k in hudCache) delete hudCache[k];
  for (const id in chipEls) { chipEls[id].remove(); delete chipEls[id]; }
  hud.toast.classList.remove('on'); toastTimer = 0;
  hudSetCombo(false);
}

function updateHUD(dt) {
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) hud.toast.classList.remove('on'); }
  if (!G || G.demo) return;
  G.shownScore += (G.score - G.shownScore) * Math.min(1, dt * 12);
  if (Math.abs(G.score - G.shownScore) < 0.5) G.shownScore = G.score;
  setText(hud.score, 'score', fmt(G.shownScore));
  setText(hud.len, 'len', String(G.tailCount + 1));
  setText(hud.lvl, 'lvl', String(G.level));
  const sh = G.perks.shields;
  if (hudCache.shN !== sh) { hudCache.shN = sh; hud.shieldWrap.classList.toggle('hidden', sh <= 0); hud.shield.textContent = sh; }
  const xpPct = Math.round(Math.min(1, G.xp / G.xpNext) * 100);
  if (hudCache.xp !== xpPct) { hudCache.xp = xpPct; hud.xpFill.style.width = xpPct + '%'; }
  const nextSkill = (G.level + 1) % 5 === 0;
  if (hudCache.ns !== nextSkill) { hudCache.ns = nextSkill; hud.xp.classList.toggle('next-skill', nextSkill); }
  const m = Math.floor(G.time / 60), s = Math.floor(G.time % 60);
  setText(hud.timer, 'timer', `${m}:${s < 10 ? '0' : ''}${s}`);
  const comboOn = G.combo >= 2 && mode !== 'dying' && mode !== 'over';
  hudSetCombo(comboOn);
  if (comboOn) {
    const label = `Combo ${G.combo}|×${comboMult().toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    if (hudCache.combo !== label) { hudCache.combo = label; const [a, b] = label.split('|'); hud.comboText.innerHTML = `${a}<small>${b}</small>`; }
    hud.comboFill.style.transform = `scaleX(${clamp(G.comboT / comboWindow(), 0, 1)})`;
  }
  // chips de power-ups activos
  for (const id in G.powers) {
    const p = G.powers[id], d = POWERS[id];
    let el = chipEls[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'chip'; el.style.setProperty('--c', d.color);
      el.innerHTML = `${iconSVG(id, d.color, 'ico')}<div class="txt"><div class="nm">${d.name}</div><div class="bar"><i></i></div></div>`;
      hud.powers.appendChild(el); chipEls[id] = el;
    }
    el.querySelector('.bar i').style.transform = `scaleX(${clamp(p.t / p.dur, 0, 1)})`;
    el.classList.toggle('ending', p.t < 1.5);
  }
  for (const id in chipEls) if (!G.powers[id] || mode === 'dying' || mode === 'over') { chipEls[id].remove(); delete chipEls[id]; }
}

/* ════════════════════════════════════════════════════════════════
   Pantallas y flujo
   ════════════════════════════════════════════════════════════════ */
const screens = { menu: $('scrMenu'), level: $('scrLevel'), pause: $('scrPause'), over: $('scrOver') };
function showScreen(name, armDelay) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  if (!name) return;
  hud.toast.classList.remove('on'); toastTimer = 0;
  const s = screens[name];
  s.scrollTop = 0;
  if (armDelay) {
    s.dataset.armed = '0';
    setTimeout(() => { if (!s.classList.contains('hidden')) s.dataset.armed = '1'; }, armDelay);
  } else s.dataset.armed = '1';
}

function shapeSVG(shape, color) {
  const c = 32, r = 21;
  let body;
  if (shape === 'square') body = `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" rx="${r * 0.32}"/>`;
  else if (shape === 'circle') body = `<circle cx="${c}" cy="${c}" r="${r}"/>`;
  else body = `<polygon points="${SHAPES[shape].map(([x, y]) => `${(c + x * r).toFixed(1)},${(c + y * r).toFixed(1)}`).join(' ')}"/>`;
  const [ex, ey] = EYES[shape];
  const eyes = [-1, 1].map(sd => `<circle cx="${c + ex * r}" cy="${c + sd * ey * r}" r="${r * 0.22}" fill="#fff"/><circle cx="${c + ex * r + r * 0.07}" cy="${c + sd * ey * r}" r="${r * 0.11}" fill="#14163a"/>`).join('');
  return `<svg class="char-art" viewBox="0 0 64 64" aria-hidden="true"><g fill="${color}">${body}</g>${eyes}</svg>`;
}

function buildMenu() {
  const grid = $('charGrid');
  grid.innerHTML = '';
  for (const ch of CHARACTERS) {
    const b = document.createElement('button');
    b.className = 'char-card' + (ch === selectedChar ? ' sel' : '');
    b.style.setProperty('--c', ch.color);
    b.setAttribute('aria-pressed', ch === selectedChar);
    const stats = ch.stats.map((v, i) => `<span>${STAT_LABELS[i]}</span><span class="pips">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= v ? 'on' : ''}"></i>`).join('')}</span>`).join('');
    b.innerHTML = `${shapeSVG(ch.shape, ch.color)}<span class="char-name">${ch.name}</span><span class="char-tag">${ch.tag}</span><span class="char-desc">${nb(ch.desc)}</span><span class="char-stats">${stats}</span>`;
    b.addEventListener('click', () => {
      selectedChar = ch; store.set('lastChar', ch.id); Sound.click();
      for (const el of grid.children) { el.classList.toggle('sel', el === b); el.setAttribute('aria-pressed', el === b); }
    });
    b.addEventListener('dblclick', startGame);
    grid.appendChild(b);
  }
  refreshDifficulty();
  $('controlsLine').textContent = isTouch
    ? 'Arrastra en cualquier punto de la pantalla para moverte. El joystick aparece donde pongas el dedo.'
    : 'Muévete con WASD o las flechas, o arrastrando con el ratón. Esc pausa y M silencia el sonido.';
}
function refreshDifficulty() {
  for (const b of $('diffSeg').children) { const on = b.dataset.diff === difficulty; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); }
  $('diffDesc').textContent = DIFFS[difficulty].desc;
  const r = records[difficulty];
  $('recordLine').innerHTML = r.score > 0
    ? `Récord en ${DIFFS[difficulty].label}: <b>${fmt(r.score)}</b> puntos y longitud ${r.length}`
    : r.length > 0 ? `Mejor longitud en ${DIFFS[difficulty].label}: <b>${r.length}</b>` : `Aún no hay récord en ${DIFFS[difficulty].label}.`;
}
for (const b of $('diffSeg').children) {
  b.addEventListener('click', () => { difficulty = b.dataset.diff; store.set('lastDiff', difficulty); Sound.click(); refreshDifficulty(); });
}

function toMenu() {
  mode = 'menu';
  resetJoy();
  G = createWorld(null, 'normal', true);
  populate();
  cam.x = WORLD / 2 - W / 2; cam.y = WORLD / 2 - H / 2;
  hud.root.classList.add('hidden');
  resetHUD();
  refreshDifficulty();
  showScreen('menu');
}

function startGame() {
  Sound.unlock();
  Sound.click();
  resetJoy();
  G = createWorld(selectedChar, difficulty, false);
  G.adminUsed = admin.god || !admin.enemies || admin.speed !== 1 || admin.enemySpeed !== 1 || admin.vision !== 1 || admin.timeScale !== 1;
  populate();
  if (selectedChar.startGhost) activatePower('ghost', selectedChar.startGhost + G.perks.ghostBonus, true);
  computeSegs();
  updateCamera(0, true);
  resetHUD();
  hud.root.classList.remove('hidden');
  const played = store.get('games', 0);
  store.set('games', played + 1);
  hud.hint.textContent = isTouch ? 'Arrastra para moverte' : 'Usa WASD o las flechas para moverte';
  hud.hint.classList.toggle('hidden', played >= 3);
  showScreen(null);
  mode = 'play';
  blurActive();
}
function blurActive() { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }

function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused';
  resetJoy(); keys.clear();
  $('pauseChar').textContent = `${G.char.name}, dificultad ${DIFFS[G.diffKey].label.toLowerCase()}, nivel ${G.level}`;
  const list = $('pauseSkills');
  const owned = Object.values(G.owned);
  const extras = [];
  if (G.perks.shields > 0) extras.push(`🛡️ Escudos: ${G.perks.shields}`);
  if (G.perks.emergency > 0) extras.push(`✂️ Cargas de poda: ${G.perks.emergency}`);
  list.innerHTML = owned.length || extras.length
    ? owned.map(o => `<span>${o.icon} ${o.name} ${ROMAN[o.tier]}${o.count > 1 ? ' ×' + o.count : ''}</span>`).concat(extras.map(t => `<span>${t}</span>`)).join('')
    : `<p class="fine">Aún no tienes habilidades. La primera llega en el nivel 5.</p>`;
  showScreen('pause', 150);
  $('btnResume').focus({ preventScroll: true });
}
function resumeGame() {
  if (mode !== 'paused') return;
  showScreen(null);
  mode = 'play';
  blurActive();
}

function openLevelUp() {
  mode = 'levelup';
  resetJoy(); keys.clear();
  const tier = clamp(Math.floor(G.level / 5), 1, 4);
  $('lvlTitle').textContent = `Nivel ${G.level}`;
  const grid = $('skillGrid');
  grid.innerHTML = '';
  const pool = SKILLS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  pool.forEach((sk, i) => {
    const b = document.createElement('button');
    b.className = 'skill-card';
    const owned = G.owned[sk.id];
    b.innerHTML = `${isTouch ? '' : `<span class="skill-key">${i + 1}</span>`}<span class="skill-icon">${sk.icon}</span><span class="skill-name">${sk.name}</span><span class="skill-rank">Rango ${ROMAN[tier]}</span><span class="skill-desc">${nb(sk.desc(tier))}</span>${owned ? `<span class="skill-owned">Ya la tienes (rango ${ROMAN[owned.tier]})</span>` : ''}`;
    b.addEventListener('click', () => chooseSkill(sk, tier));
    grid.appendChild(b);
  });
  $('lvlKeys').classList.toggle('hidden', isTouch);
  showScreen('level', 450); // retardo: evita elegir sin querer al soltar el dedo
}
function chooseSkill(sk, tier) {
  if (mode !== 'levelup') return;
  sk.apply(G.perks, tier);
  const o = G.owned[sk.id] || (G.owned[sk.id] = { icon: sk.icon, name: sk.name, tier: 0, count: 0 });
  o.tier = Math.max(o.tier, tier); o.count++;
  Sound.pick();
  showScreen(null);
  mode = 'play';
  blurActive();
  G.invuln = Math.max(G.invuln, 0.8); G.invulnExt = 0;
  toast(`${sk.icon} ${sk.name} ${ROMAN[tier]}`, nb(sk.desc(tier)), GOLD_COLOR);
  ring(G.head.x, G.head.y, GOLD_COLOR, 90);
  addXP(0);
}

function showGameOver() {
  mode = 'over';
  hud.root.classList.add('hidden');
  const r = records[G.diffKey];
  let newRecord = false;
  if (!G.adminUsed) {
    if (G.score > r.score) { r.score = G.score; newRecord = true; }
    if (G.maxLength > r.length) r.length = G.maxLength;
    store.set('records', records);
  }
  $('overReason').textContent = G.deathReason;
  $('overBadge').innerHTML = newRecord && G.score > 0 ? '<span class="badge-record">¡Nuevo récord!</span>'
    : r.score > 0 ? `<span class="record">Récord en ${DIFFS[G.diffKey].label}: <b>${fmt(r.score)}</b></span>` : '';
  const mm = Math.floor(G.time / 60), ss = Math.floor(G.time % 60);
  const cells = [
    [G.maxLength, 'Longitud máxima'], [G.level, 'Nivel'], [`${mm}:${ss < 10 ? '0' : ''}${ss}`, 'Tiempo'],
    [G.maxCombo, 'Combo máximo'], [G.foodsEaten, 'Comidas'], [G.kills, 'Cazadores rotos']
  ];
  $('overStats').innerHTML = cells.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('overNote').textContent = G.adminUsed ? 'Partida de prueba: se usó el panel de pruebas, así que no cuenta para el récord.' : '';
  showScreen('over', 700);
  countUp($('overScore'), G.score, 900);
  setTimeout(() => { if (mode === 'over') $('btnRetry').focus({ preventScroll: true }); }, 720);
}
function countUp(el, to, ms) {
  const t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

function toggleMute() {
  const m = Sound.toggle();
  $('icoSound').classList.toggle('hidden', m);
  $('icoMuted').classList.toggle('hidden', !m);
  $('btnMute').setAttribute('aria-label', m ? 'Activar sonido' : 'Silenciar sonido');
}

$('btnPlay').addEventListener('click', startGame);
$('btnResume').addEventListener('click', resumeGame);
$('btnRestart').addEventListener('click', startGame);
$('btnPauseMenu').addEventListener('click', toMenu);
$('btnRetry').addEventListener('click', startGame);
$('btnOverMenu').addEventListener('click', toMenu);
$('btnPause').addEventListener('click', () => pauseGame());
$('btnMute').addEventListener('click', toggleMute);
if (Sound.muted) { $('icoSound').classList.add('hidden'); $('icoMuted').classList.remove('hidden'); }

/* ════════════════════════════════════════════════════════════════
   Panel de pruebas (oculto)
   ════════════════════════════════════════════════════════════════ */
const adminEl = $('admin');
function toggleAdmin() { adminEl.classList.toggle('hidden'); }
function secretTaps(el) {
  let taps = [];
  el.addEventListener('pointerdown', () => {
    const now = performance.now();
    taps = taps.filter(t => now - t < 2500); taps.push(now);
    if (taps.length >= 5) { taps = []; toggleAdmin(); }
  });
}
secretTaps($('brand'));
secretTaps($('pauseTitle'));
$('admClose').addEventListener('click', () => adminEl.classList.add('hidden'));

const inGame = () => G && !G.demo && (mode === 'play' || mode === 'paused' || mode === 'levelup');
const markAdmin = () => { if (G && !G.demo) G.adminUsed = true; };
$('admGod').addEventListener('change', e => { admin.god = e.target.checked; markAdmin(); });
$('admHit').addEventListener('change', e => { admin.hitboxes = e.target.checked; });
$('admEnemies').addEventListener('change', e => {
  admin.enemies = e.target.checked; markAdmin();
  if (!admin.enemies && G && !G.demo) G.enemies = [];
});
for (const id of POWER_IDS) {
  const b = document.createElement('button');
  b.innerHTML = `${iconSVG(id, POWERS[id].color)}${POWERS[id].name}`;
  b.addEventListener('click', () => { if (mode !== 'play') return; markAdmin(); activatePower(id); });
  $('admPowers').appendChild(b);
}
adminEl.addEventListener('click', e => {
  const act = e.target.closest('[data-adm]');
  if (!act || !inGame()) return;
  markAdmin();
  switch (act.dataset.adm) {
    case 'grow': G.tailCount += 10; G.maxLength = Math.max(G.maxLength, G.tailCount + 1); break;
    case 'level': if (mode === 'play') addXP(G.xpNext - G.xp); break;
    case 'skill': if (mode === 'play') { G.level = Math.ceil((G.level + 1) / 5) * 5 - 1; G.xp = 0; G.xpNext = Math.round((3 + G.level) * G.diff.xpMult); addXP(G.xpNext); } break;
    case 'shield': G.perks.shields++; G.perks.maxShields = Math.max(G.perks.maxShields, G.perks.shields); break;
    case 'gold': spawnGold(); G.foods[G.foods.length - 1].x = clamp(G.head.x + 200, 100, WORLD - 100); G.foods[G.foods.length - 1].y = G.head.y; break;
    case 'enemy': { const was = admin.enemies; admin.enemies = true; spawnEnemy(false, true); admin.enemies = was; break; }
  }
});
function bindRange(id, key) {
  const inp = $(id), out = $(id + 'V');
  inp.addEventListener('input', () => { admin[key] = parseFloat(inp.value); out.textContent = inp.value; markAdmin(); });
}
bindRange('admSpd', 'speed');
bindRange('admESpd', 'enemySpeed');
bindRange('admVis', 'vision');
bindRange('admTime', 'timeScale');

/* ════════════════════════════════════════════════════════════════
   Tamaño de pantalla y bucle
   ════════════════════════════════════════════════════════════════ */
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  const mr = mini.getBoundingClientRect();
  const ms = Math.round((mr.width || 116) * DPR);
  mini.width = mini.height = ms;
  vignette = document.createElement('canvas');
  vignette.width = Math.max(1, Math.round(W / 2)); vignette.height = Math.max(1, Math.round(H / 2));
  const vg = vignette.getContext('2d');
  const gr = vg.createRadialGradient(vignette.width / 2, vignette.height / 2, Math.min(vignette.width, vignette.height) * 0.35, vignette.width / 2, vignette.height / 2, Math.max(vignette.width, vignette.height) * 0.75);
  gr.addColorStop(0, 'rgba(8,8,24,0)'); gr.addColorStop(1, 'rgba(8,8,24,0.6)');
  vg.fillStyle = gr; vg.fillRect(0, 0, vignette.width, vignette.height);
}
window.addEventListener('resize', () => { resize(); if (mode !== 'menu' && G && !G.demo) updateCamera(0, true); });
const ro = window.ResizeObserver ? new ResizeObserver(() => { const ms = Math.round((mini.getBoundingClientRect().width || 116) * DPR); if (ms && mini.width !== ms) mini.width = mini.height = ms; }) : null;
if (ro) ro.observe(mini);

let lastTs = performance.now();
function frame(ts) {
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (!(dt > 0)) dt = 0;
  dt = Math.min(dt, 0.05);
  const sdt = dt * admin.timeScale;
  try {
    if (mode === 'play') update(sdt);
    else if (mode === 'dying') updateDying(sdt);
    else if (mode === 'menu') updateDemo(dt);
    else if (mode === 'over') updateFx(dt);
    if (mode === 'dying' || mode === 'over') updateCamera(dt);
    render();
    drawMinimap();
    updateHUD(dt);
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

resize();
buildMenu();
toMenu();
requestAnimationFrame(frame);

// Gancho para pruebas automatizadas: index.html?debug expone window.__snake
if (/[?&]debug\b/.test(location.search)) {
  window.__snake = { get G() { return G; }, get mode() { return mode; }, admin, activatePower, startGame, toMenu, pauseGame, resumeGame, addXP, spawnEnemy, keys, joy, CHARACTERS, selectChar: id => { selectedChar = CHARACTERS.find(c => c.id === id); buildMenu(); }, setDiff: d => { difficulty = d; refreshDifficulty(); } };
}
})();
