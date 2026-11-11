// 손짓 다트: 손바닥을 보여 주고 → 주먹을 쥐어 다트를 잡고 → 손을 펴면 발사.
// 상태: wait(손 기다림) → ready(손 보임) → aim(다트 잡음) → fly(날아감) → settle(판 멈춤) → result(결과) → wait
import { HandTracker, ZONE } from './hand.js';
import { loadSettings, saveSettings, derive, segName, bindSettings, fillCameras } from './settings.js';
import { mountMascots, setMascot, Buddy } from './mascot.js';
import { sfx, unlock, setSound } from './sfx.js';

const $ = s => document.querySelector(s);
const TAU = Math.PI * 2, BULL = 0.15;
const INK = '#1c2030', PAPER = '#f8f5ec', ACCENT = '#f2cc3a', CORAL = '#e9604c';
const clamp01 = v => Math.min(1, Math.max(0, v));
const pick = a => a[Math.floor(Math.random() * a.length)];

const stage = $('#stage'), cv = $('#board');
let ctx = cv.getContext('2d');
const coach = $('#coach'), coachIcon = $('#coachIcon'), coachText = $('#coachText');
const resultBox = $('#result'), gate = $('#gate'), cam = $('#cam');

// 손 그림 세 가지(손바닥·주먹·펴서 던지기). 고정 마크업이다.
const PALM = `<g class="hand__fill"><rect x="8.5" y="33" width="9" height="19" rx="4.5" transform="rotate(-32 13 42)"/><rect x="17" y="11" width="7.4" height="28" rx="3.7"/><rect x="25.2" y="6" width="7.4" height="32" rx="3.7"/><rect x="33.4" y="9" width="7.4" height="30" rx="3.7"/><rect x="41.6" y="16" width="7.4" height="24" rx="3.7"/><rect x="16" y="30" width="34" height="28" rx="11"/></g>`;
const HAND = {
  palm: `<svg viewBox="0 0 64 64" aria-hidden="true">${PALM}</svg>`,
  fist: `<svg viewBox="0 0 64 64" aria-hidden="true"><g class="hand__fill"><rect x="13" y="19" width="39" height="33" rx="12"/><rect x="9" y="34" width="27" height="11" rx="5.5"/></g><path class="hand__line" d="M23.5 20v9M32.5 20v9M41.5 20v9"/></svg>`,
  throw: `<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="translate(9 15) scale(0.74)">${PALM}</g><path class="hand__spark" d="M31 3v8M13 8l5 7M50 8l-5 7M4 27h8M59 27h-8"/></svg>`,
};
document.querySelectorAll('[data-hand]').forEach(n => { n.innerHTML = HAND[n.dataset.hand]; });
mountMascots();

let S = loadSettings(), D = derive(S);
const tracker = new HandTracker($('#video'), $('#overlay'));
const buddy = new Buddy($('#buddy'), stage);

const G = {
  state: 'wait', since: 0, last: 0, started: false,
  w: 0, h: 0, dpr: 1, cx: 0, cy: 0, r: 100,
  angle: 0, spin: 1, spinTarget: 1,
  aim: { x: 0, y: 0 }, aimOn: false, pointer: { x: 0, y: 0 }, pointerAt: -1e9,
  pose: 'none', poseSince: 0, seenAt: -1e9, greeted: false, nextHint: 0,
  fly: null, stuck: null, win: null, bits: [],
};

function applySettings(next) {
  S = next; D = derive(S); saveSettings(S);
  tracker.limits = { fistBelow: D.fistBelow, openAbove: D.openAbove };
  setSound(S.sound); renderLegend();
}

// ---------- 화면 글자·안내 ----------
function inkOn(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.36 ? INK : '#ffffff';
}
function renderLegend() {
  const ul = $('#legend'); ul.textContent = ''; ul.dataset.many = S.segs.length > 4 ? '1' : '0';
  S.segs.forEach((g, i) => {
    const li = document.createElement('li'), n = document.createElement('i'), t = document.createElement('span');
    n.textContent = i + 1; n.style.background = g.color; n.style.color = inkOn(g.color); t.textContent = segName(S, i);
    if (G.state === 'result' && G.win === i) li.className = 'win';
    li.append(n, t); ul.append(li);
  });
}
const COACH = {
  wait: ['palm', '손바닥을 카메라에 보여 주세요'],
  ready: ['fist', '주먹을 꽉 쥐어 다트를 잡아요'],
  aim: ['throw', '과녁을 겨누고, 손을 활짝 펴면 발사!'],
  fly: ['throw', '슈웅!'],
  settle: ['throw', '어디에 꽂혔을까요?'],
  result: ['throw', ''],
};
function setCoach(step, text) {
  const [icon, base] = COACH[step];
  coach.dataset.step = step; coachIcon.innerHTML = HAND[icon]; coachText.textContent = text || base;
  coach.classList.remove('is-pop'); void coach.offsetWidth; coach.classList.add('is-pop');
  const order = ['wait', 'ready', 'aim'], at = order.indexOf(step);
  document.querySelectorAll('#steps li').forEach((li, i) => { li.classList.toggle('on', i === at); li.classList.toggle('done', at === -1 || i < at); });
}
function go(state, now, text) {
  G.state = state; G.since = now;
  setCoach(state, text || (state === 'wait' && !tracker.live && !tracker.fake ? '마우스로 겨누고, 눌러서 던져요' : ''));
}

// ---------- 크기 ----------
function resize() {
  const b = stage.getBoundingClientRect();
  G.w = b.width; G.h = b.height; G.dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, Math.round(G.w * G.dpr)); cv.height = Math.max(1, Math.round(G.h * G.dpr));
  G.r = Math.max(40, Math.min(G.w * 0.44, G.h * 0.385)); G.cx = G.w / 2; G.cy = G.h * 0.545;
  buddy.resize();
}
new ResizeObserver(resize).observe(stage);

// ---------- 그리기 ----------
function fitLabel(text, maxW, big, small) {
  const font = px => `800 ${px}px ${fontFamily}`;
  for (let px = big; px >= small; px -= 1) { ctx.font = font(px); if (ctx.measureText(text).width <= maxW) return { lines: [text], px }; }
  // 두 줄로 나눈다: 가운데에 가장 가까운 띄어쓰기, 없으면 가운데 글자
  const chars = [...text], mid = chars.length / 2; let cut = -1;
  chars.forEach((c, i) => { if (c === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i; });
  const a = (cut > 0 ? chars.slice(0, cut) : chars.slice(0, Math.ceil(mid))).join(''), b = (cut > 0 ? chars.slice(cut + 1) : chars.slice(Math.ceil(mid))).join('');
  for (let px = big; px >= small; px -= 1) { ctx.font = font(px); if (Math.max(ctx.measureText(a).width, ctx.measureText(b).width) <= maxW) return { lines: [a, b], px }; }
  ctx.font = font(small);
  const trim = s => { let t = [...s]; while (t.length > 1 && ctx.measureText(t.join('') + '…').width > maxW) t.pop(); return t.length < [...s].length ? t.join('') + '…' : s; };
  return { lines: [trim(a), trim(b)], px: small };
}
let fontFamily = '';
// 다트판 그림(칸·번호·이름)은 설정이나 크기가 바뀔 때만 한 번 그려 두고, 매 프레임에는 그 그림을 돌려서 붙이기만 한다.
const sprite = { cv: document.createElement('canvas'), key: '', half: 0 };
function boardSprite() {
  const { r, dpr } = G, n = S.segs.length, step = TAU / n, showWin = G.state === 'result';
  const key = [Math.round(r * dpr), dpr, JSON.stringify(S.segs), showWin ? G.win : 'x', fontFamily].join('|');
  if (sprite.key === key) return sprite;
  sprite.key = key; sprite.half = r * 1.1;
  sprite.cv.width = sprite.cv.height = Math.max(2, Math.ceil(sprite.half * 2 * dpr));
  const main = ctx; ctx = sprite.cv.getContext('2d'); // 아래 그리기 함수들이 쓰는 ctx를 잠깐 바꿔 둔다
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, sprite.half * 2, sprite.half * 2); ctx.translate(sprite.half, sprite.half);
  ctx.beginPath(); ctx.arc(0, 0, r * 1.075, 0, TAU); ctx.fillStyle = INK; ctx.fill();
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step, a1 = a0 + step;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a1); ctx.closePath();
    ctx.fillStyle = S.segs[i].color; ctx.fill();
    if (showWin && G.win !== i) { ctx.fillStyle = 'rgba(248,245,236,0.72)'; ctx.fill(); }
    ctx.lineWidth = Math.max(2, r * 0.014); ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
  }
  // 테두리의 점: 판이 도는 것이 잘 보이게
  for (let i = 0; i < n * 3; i++) {
    const a = -Math.PI / 2 + i * step / 3;
    ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.038, Math.sin(a) * r * 1.038, r * (i % 3 ? 0.009 : 0.017), 0, TAU); ctx.fillStyle = i % 3 ? 'rgba(248,245,236,0.6)' : ACCENT; ctx.fill();
  }
  // 칸 번호와 이름
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + (i + 0.5) * step, col = inkOn(S.segs[i].color), dim = showWin && G.win !== i;
    ctx.save(); ctx.rotate(mid + Math.PI / 2); ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.fillStyle = col; ctx.font = `900 ${r * (n > 6 ? 0.17 : 0.21)}px ${fontFamily}`;
    ctx.fillText(String(i + 1), 0, -r * 0.76);
    const rho = r * 0.5, maxW = Math.min(r * 1.15, 2 * rho * Math.sin(step / 2) * 0.86);
    const lab = fitLabel(segName(S, i), maxW, Math.round(r * 0.105), Math.max(9, Math.round(r * 0.058)));
    ctx.fillStyle = col;
    lab.lines.forEach((ln, k) => ctx.fillText(ln, 0, -rho + (k - (lab.lines.length - 1) / 2) * lab.px * 1.16));
    ctx.restore();
  }
  ctx = main;
  return sprite;
}
function drawBoard(now) {
  const sp = boardSprite();
  const { cx, cy, r } = G, n = S.segs.length, step = TAU / n, showWin = G.state === 'result';
  ctx.save(); ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, r * 0.05, r * 1.075, 0, TAU); ctx.fillStyle = 'rgba(28,32,48,0.16)'; ctx.fill();
  ctx.rotate(G.angle);
  ctx.drawImage(sp.cv, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // 정중앙
  if (S.bull) {
    const pulse = showWin && G.win === -1 ? 1 + 0.12 * Math.sin(now / 110) : 1;
    ctx.beginPath(); ctx.arc(0, 0, r * BULL * pulse, 0, TAU); ctx.fillStyle = ACCENT; ctx.fill(); ctx.lineWidth = Math.max(2, r * 0.018); ctx.strokeStyle = INK; ctx.stroke();
    ctx.save(); ctx.rotate(-G.angle); ctx.fillStyle = INK; ctx.font = `900 ${r * 0.15}px ${fontFamily}`; ctx.fillText('★', 0, r * 0.012); ctx.restore();
  } else { ctx.beginPath(); ctx.arc(0, 0, r * 0.045, 0, TAU); ctx.fillStyle = INK; ctx.fill(); }
  // 당첨 칸 테두리
  if (showWin && G.win >= 0) {
    const a0 = -Math.PI / 2 + G.win * step;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a0 + step); ctx.closePath();
    ctx.lineWidth = r * (0.03 + 0.012 * Math.sin(now / 130)); ctx.strokeStyle = '#ffffff'; ctx.stroke();
  }
  // 꽂힌 다트(판과 같이 돈다)
  if (G.stuck) {
    const x = Math.cos(G.stuck.a) * G.stuck.d * r, y = Math.sin(G.stuck.a) * G.stuck.d * r;
    ctx.beginPath(); ctx.ellipse(x + r * 0.03, y + r * 0.035, r * 0.05, r * 0.022, G.stuck.rot, 0, TAU); ctx.fillStyle = 'rgba(28,32,48,0.28)'; ctx.fill();
    drawDart(x, y, 0.82, G.stuck.rot, 0.72);
  }
  ctx.restore();
}
// 다트. (x, y)가 촉 끝이고 ang 방향으로 꼬리가 뻗는다. squash는 몸통 길이 비율(꽂힌 다트는 짧게 보인다).
function drawDart(x, y, s, ang, squash = 1) {
  const k = (G.r / 250) * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(k * squash, k); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#9aa1b2'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(24, 0); ctx.stroke();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(21, -6.5, 42, 13, 6.5); ctx.fill();
  ctx.fillStyle = ACCENT; ctx.fillRect(31, -6.5, 5, 13); ctx.fillRect(44, -6.5, 5, 13);
  ctx.strokeStyle = INK; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(62, 0); ctx.lineTo(86, 0); ctx.stroke();
  ctx.fillStyle = CORAL; ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(85, -18); ctx.lineTo(106, -18); ctx.lineTo(95, 0); ctx.lineTo(106, 18); ctx.lineTo(85, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawAim(now) {
  if (!G.aimOn || !['wait', 'ready', 'aim'].includes(G.state)) return;
  const { r } = G, p = aimPoint(now);
  ctx.save(); ctx.translate(p.x, p.y);
  if (G.state === 'aim') {
    ctx.beginPath(); ctx.arc(0, 0, Math.max(r * 0.05, D.scatter * r), 0, TAU); ctx.fillStyle = 'rgba(233,96,76,0.16)'; ctx.fill();
    const rr = r * (0.075 + 0.012 * Math.sin(now / 120));
    ctx.lineWidth = Math.max(3, r * 0.016); ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(2, r * 0.009); ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.moveTo(Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.55); ctx.lineTo(Math.cos(a) * rr * 1.45, Math.sin(a) * rr * 1.45); }
    ctx.stroke(); ctx.restore();
    // 손에 쥔 다트: 조준점 오른쪽 아래에서 판을 겨눈다
    drawDart(p.x + r * 0.03, p.y + r * 0.03, 1.5, Math.PI * 0.27 + Math.sin(now / 90) * 0.03);
    return;
  }
  const rr = r * 0.085;
  ctx.lineWidth = Math.max(3, r * 0.018); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
  ctx.setLineDash([rr * 0.5, rr * 0.34]); ctx.lineDashOffset = -now / 40; ctx.lineWidth = Math.max(2, r * 0.01); ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.014, 0, TAU); ctx.fillStyle = INK; ctx.fill();
  // 주먹을 쥐고 있으면 잡는 중 게이지가 찬다
  if (G.state === 'ready' && G.pose === 'fist') {
    const t = clamp01((now - G.poseSince) / Math.max(1, D.grabHoldMs));
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, r * 0.026); ctx.strokeStyle = CORAL; ctx.beginPath(); ctx.arc(0, 0, rr * 1.32, -Math.PI / 2, -Math.PI / 2 + TAU * t); ctx.stroke();
  }
  ctx.restore();
}
// 날아가는 다트의 위치. 처음엔 겨눈 곳(ax, ay)으로 가다가 바람을 탄 듯 휘어서 실제로 꽂힐 곳(x1, y1)에 닿는다.
function flyProgress(now) { const f = G.fly, t = f.dur > 0 ? clamp01((now - f.t0) / f.dur) : 1; return 1 - (1 - t) ** 1.7; } // 멀어질수록 느려 보인다
function flyPos(e) {
  const f = G.fly, q = clamp01(e), bend = clamp01((q - 0.25) / 0.75), drift = bend * bend * (3 - 2 * bend);
  const sway = Math.sin(q * Math.PI * 2.4 + f.phase) * (1 - q) ** 1.2 * f.sway;
  return {
    x: f.x0 + (f.ax - f.x0) * q + (f.x1 - f.ax) * drift + f.nx * sway,
    y: f.y0 + (f.ay - f.y0) * q + (f.y1 - f.ay) * drift + f.ny * sway - Math.sin(Math.PI * q) * G.h * 0.07,
  };
}
function drawFly(now) {
  const f = G.fly; if (!f || G.state !== 'fly') return;
  const e = flyProgress(now), p = flyPos(e), back = flyPos(e - 0.03), far = (1 - e) ** 1.4;
  const ang = e < 0.03 ? Math.atan2(f.y0 - f.ay, f.x0 - f.ax) : Math.atan2(back.y - p.y, back.x - p.x);
  // 판 위에 드리운 그림자: 다트가 판에 가까워질수록 다트 쪽으로 모인다
  ctx.save();
  ctx.beginPath(); ctx.ellipse(p.x + G.r * 0.1 * far, p.y + G.r * (0.06 + 0.5 * far), G.r * (0.05 + 0.1 * far), G.r * (0.02 + 0.035 * far), 0, 0, TAU);
  ctx.fillStyle = `rgba(28,32,48,${0.26 - 0.16 * far})`; ctx.fill();
  ctx.lineCap = 'round';
  for (let i = 1; i <= 6; i++) { const q = flyPos(e - i * 0.022); ctx.globalAlpha = 0.14 * (1 - i / 7); ctx.strokeStyle = INK; ctx.lineWidth = G.r * 0.022 * (1 + 2 * far); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + Math.cos(ang) * G.r * 0.16, q.y + Math.sin(ang) * G.r * 0.16); ctx.stroke(); }
  ctx.restore();
  drawDart(p.x, p.y, 1 + 2.7 * far, ang);
}
function burst(x, y) {
  const cols = S.segs.map(g => g.color).concat(ACCENT, '#ffffff');
  for (let i = 0; i < 110; i++) {
    const a = Math.random() * TAU, v = G.r * (0.6 + Math.random() * 2.4);
    G.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - G.r * 1.2, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14, w: G.r * (0.02 + Math.random() * 0.025), col: pick(cols), life: 1.6 + Math.random() * 1.2 });
  }
}
function drawBits(dt) {
  if (!G.bits.length) return;
  G.bits = G.bits.filter(b => (b.life -= dt) > 0 && b.y < G.h + 40);
  for (const b of G.bits) {
    b.vy += G.r * 3.4 * dt; b.vx *= 1 - 0.9 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.globalAlpha = Math.min(1, b.life * 1.6); ctx.fillStyle = b.col; ctx.fillRect(-b.w, -b.w * 0.5, b.w * 2, b.w); ctx.restore();
  }
}

// ---------- 게임 ----------
function handToStage(h) {
  const nx = clamp01((h.x - ZONE.x0) / (ZONE.x1 - ZONE.x0)), ny = clamp01((h.y - ZONE.y0) / (ZONE.y1 - ZONE.y0));
  return { x: G.cx + (nx * 2 - 1) * G.r * 1.12, y: G.cy + (ny * 2 - 1) * G.r * 1.12 };
}
// 겨누는 동안 조준점이 살짝 떠다닌다(반쯤 운).
function aimPoint(now) {
  if (G.state !== 'aim') return G.aim;
  const wob = D.scatter * G.r * 0.5;
  return { x: G.aim.x + Math.sin(now / 310) * wob, y: G.aim.y + Math.cos(now / 265) * wob * 0.8 };
}
function grab(now) {
  G.stuck = null; go('aim', now); sfx.grab();
  buddy.setMood('tense'); buddy.talk(pick(['두근두근…', '잘 겨눠 봐요!', '꽉 잡았어요!']), 1800);
}
function fire(px, py, now) {
  // 겨눈 곳에서 얼마나 벗어날지: 늘 조금은 벗어나게 한다(흩어짐 반지름의 45-100%)
  const sc = D.scatter * G.r, a = Math.random() * TAU, rad = sc * (0.45 + 0.55 * Math.random());
  let tx = px + Math.cos(a) * rad, ty = py + Math.sin(a) * rad;
  const dx = tx - G.cx, dy = ty - G.cy, d = Math.hypot(dx, dy), max = G.r * 0.94;
  if (d > max) { tx = G.cx + dx / d * max; ty = G.cy + dy / d * max; } // 빗나감 없음: 판 밖이면 가장자리에 꽂힌다
  G.stuck = null;
  const x0 = G.w * 0.5 + (px - G.cx) * 0.3, y0 = G.h + G.r * 0.35, len = Math.hypot(px - x0, py - y0) || 1;
  G.fly = { x0, y0, ax: px, ay: py, x1: tx, y1: ty, t0: now, dur: D.flightMs, nx: -(py - y0) / len, ny: (px - x0) / len, sway: (0.04 + D.scatter * 0.9) * G.r * (Math.random() < 0.5 ? -1 : 1), phase: Math.random() * 1.2 };
  go('fly', now, D.flightMs > 1200 ? '슈웅… 어디로 갈까요?' : ''); sfx.throw(D.flightMs / 1000); buddy.setMood('tense'); buddy.antic('leap'); buddy.talk('슈웅!', Math.max(900, D.flightMs));
}
function land(now) {
  const f = G.fly, dx = f.x1 - G.cx, dy = f.y1 - G.cy, d = Math.hypot(dx, dy), local = Math.atan2(dy, dx) - G.angle;
  const back = flyPos(0.96); // 날아온 방향 그대로 꽂힌다
  G.stuck = { a: local, d: d / G.r, rot: Math.atan2(back.y - f.y1, back.x - f.x1) - G.angle };
  const n = S.segs.length, phi = (((local + Math.PI / 2) % TAU) + TAU) % TAU;
  G.win = S.bull && d < G.r * BULL ? -1 : Math.min(n - 1, Math.floor(phi / (TAU / n)));
  G.spinTarget = 0; go('settle', now); sfx.thunk(); buddy.setMood('idle');
  stage.classList.remove('is-thunk'); void stage.offsetWidth; stage.classList.add('is-thunk');
}
function showResult(now) {
  G.spin = 0; go('result', now);
  const bull = G.win === -1, col = bull ? ACCENT : S.segs[G.win].color;
  resultBox.style.setProperty('--seg', col); resultBox.style.setProperty('--seg-ink', inkOn(col));
  $('#resultEyebrow').textContent = bull ? '정중앙에 꽂혔어요!' : '다트가 꽂힌 곳은';
  $('#resultNum').textContent = bull ? '자유 선택' : `${G.win + 1}번`;
  $('#resultName').textContent = bull ? '원하는 체험을 골라요' : segName(S, G.win);
  $('#resultGo').textContent = bull ? '마음에 드는 체험으로 가면 돼요' : '이 체험으로 가 볼까요?';
  resultBox.hidden = false; renderLegend();
  const a = G.stuck.a + G.angle; burst(G.cx + Math.cos(a) * G.stuck.d * G.r, G.cy + Math.sin(a) * G.stuck.d * G.r);
  sfx.win(); buddy.setMood('cheer'); buddy.antic('spin'); buddy.talk(bull ? '정중앙이에요!' : pick(['나이스 샷!', '멋져요!', '와, 꽂혔어요!']), 3200);
}
function reset(now) {
  resultBox.hidden = true; G.win = null; G.spinTarget = 1; G.fly = null;
  buddy.setMood('idle'); go('wait', now); renderLegend();
}
// 대체 입력(스페이스바·마우스): 손 인식 없이 바로 던진다.
function quickThrow(now, at) {
  if (!G.started) return;
  if (G.state === 'result') { reset(now); return; }
  if (!['wait', 'ready', 'aim'].includes(G.state)) return;
  const p = at || (G.aimOn ? aimPoint(now) : { x: G.cx + Math.cos(now / 700) * G.r * 0.55, y: G.cy + Math.sin(now / 900) * G.r * 0.55 });
  fire(p.x, p.y, now);
}

function update(now, dt) {
  const hand = tracker.read(now), on = hand.present;
  if (on) G.seenAt = now;
  if (hand.pose !== G.pose) { G.pose = hand.pose; G.poseSince = now; }
  if (now - G.seenAt > 2500) G.greeted = false;

  const target = on ? handToStage(hand) : now - G.pointerAt < 3500 ? G.pointer : null;
  if (target) {
    if (!G.aimOn) { G.aim.x = target.x; G.aim.y = target.y; }
    const k = 1 - Math.exp(-dt / 0.06); G.aim.x += (target.x - G.aim.x) * k; G.aim.y += (target.y - G.aim.y) * k;
  }
  G.aimOn = !!target;

  switch (G.state) {
    case 'wait':
      if (on) {
        go('ready', now);
        if (!G.greeted) { G.greeted = true; sfx.seen(); buddy.setMood('wave'); buddy.talk(pick(['오, 손이 보여요!', '반가워요!', '좋아요, 찾았어요!']), 1800); }
      } else if (now > G.nextHint) {
        G.nextHint = now + 11000 + Math.random() * 6000;
        if (G.started) { buddy.setMood('wave'); buddy.talk(pick(tracker.live ? ['손바닥을 보여 주세요!', '한번 던져 볼래요?', '어떤 체험이 나올까요?'] : ['한번 던져 볼래요?', '어떤 체험이 나올까요?']), 2600); setTimeout(() => { if (G.state === 'wait') buddy.setMood('idle'); }, 2600); }
      }
      break;
    case 'ready':
      if (!on && now - G.seenAt > 700) { buddy.setMood('idle'); go('wait', now); }
      else if (on && G.pose === 'fist' && now - G.poseSince >= D.grabHoldMs) grab(now);
      else if (on && buddy.mood === 'wave' && now - G.since > 1800) buddy.setMood('idle');
      break;
    case 'aim':
      if (!on && now - G.seenAt > 900) { sfx.drop(); buddy.setMood('idle'); buddy.talk('앗, 손이 안 보여요', 1800); go('wait', now); }
      else if (on && G.pose === 'open' && now - G.poseSince >= D.releaseHoldMs && now - G.since >= D.minAimMs) { const p = aimPoint(now); fire(p.x, p.y, now); }
      break;
    case 'fly': if (now - G.fly.t0 >= G.fly.dur) land(now); break;
    case 'settle': if (now - G.since > 1150) showResult(now); break;
    case 'result':
      $('#resultBar').style.transform = `scaleX(${1 - clamp01((now - G.since) / (S.resultSec * 1000))})`;
      if (now - G.since > S.resultSec * 1000) reset(now);
      break;
  }
  G.spin += (G.spinTarget - G.spin) * (1 - Math.exp(-dt / 0.3));
  G.angle = (G.angle + D.spinRad * G.spin * dt) % TAU;
}

const POSE_WORD = { none: '아직 없어요', open: '손바닥', fist: '주먹', mid: '반쯤 쥔 손' };
let uiKey = '', lastMeter = -1;
function updateSide(now) {
  const h = tracker.state, key = [h.present ? h.pose : 'none', tracker.live, !!tracker.fake, tracker.fps, tracker.lm ? 1 : 0, G.started ? 1 : 0].join('|');
  const meter = h.present ? Math.round(h.open * 100) : 0;
  if (meter !== lastMeter) { lastMeter = meter; $('#seenMeter').style.transform = `scaleX(${meter / 100})`; }
  if (key === uiKey) return; uiKey = key;
  $('#seenPose').textContent = POSE_WORD[h.present ? h.pose : 'none'];
  const chip = $('#aiChip'), txt = $('#aiChipText');
  if (tracker.live || tracker.fake) { chip.dataset.on = '1'; txt.textContent = tracker.fps ? `AI가 1초에 ${tracker.fps}번 손을 살펴요` : 'AI 손 인식 켜짐'; }
  else if (G.started) { chip.dataset.on = '2'; txt.textContent = '카메라 없이 하는 중'; }
  else { chip.dataset.on = '0'; txt.textContent = tracker.lm ? '손 인식 준비 끝' : '손 인식 준비 중'; }
}

// 성능 표시(P 키): 화면이 1초에 몇 번 그려지는지, AI가 한 번 분석하는 데 얼마나 걸리는지 보여 준다.
const perf = { t0: 0, n: 0, worst: 0, fps: 0, lastWorst: 0 };
const hud = $('#hud');
function tickPerf(now, gap) {
  if (!perf.t0) { perf.t0 = now; return; }
  perf.n++; if (gap > perf.worst) perf.worst = gap;
  if (now - perf.t0 < 1000) return;
  perf.fps = Math.round(perf.n * 1000 / (now - perf.t0)); perf.lastWorst = Math.round(perf.worst); perf.t0 = now; perf.n = 0; perf.worst = 0;
  if (hud.hidden) return;
  const v = tracker.video, where = tracker.mode === 'worker' ? '별도 스레드' : tracker.mode === 'main' ? '화면 스레드' : '준비 중';
  hud.textContent = `화면 ${perf.fps}fps · 가장 느린 프레임 ${perf.lastWorst}ms
AI ${tracker.fps}회/초 · 한 번에 ${Math.round(tracker.inferMs)}ms · ${where} ${tracker.delegate}
카메라 ${v.videoWidth || 0}×${v.videoHeight || 0} · 화면 ${Math.round(G.w * G.dpr)}×${Math.round(G.h * G.dpr)}`;
}
function frame(now) {
  const gap = now - G.last, dt = Math.min(0.05, Math.max(0, gap / 1000)); G.last = now;
  tickPerf(now, gap);
  update(now, dt);
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); ctx.clearRect(0, 0, G.w, G.h);
  drawBoard(now); drawAim(now); drawFly(now); drawBits(dt);
  updateSide(now);
  // 도우미는 날아가는 다트를 눈으로 좇는다
  const look = G.state === 'fly' && G.fly ? flyPos(flyProgress(now)) : G.aimOn ? G.aim : null;
  buddy.tick(now, look, G.state === 'wait', G.state === 'ready' || G.state === 'aim');
  requestAnimationFrame(frame);
}

// ---------- 입력 ----------
stage.addEventListener('pointermove', e => { const b = stage.getBoundingClientRect(); G.pointer = { x: e.clientX - b.left, y: e.clientY - b.top }; G.pointerAt = performance.now(); });
stage.addEventListener('pointerdown', e => { const b = stage.getBoundingClientRect(); quickThrow(performance.now(), { x: e.clientX - b.left, y: e.clientY - b.top }); });
const sheet = $('#sheet');
const settingsUI = bindSettings({ dialog: sheet, get: () => structuredClone(S), set: applySettings, cameras: () => camList, onCamera: id => { if (tracker.live) startCamera(id); } });
document.addEventListener('keydown', e => {
  if (sheet.open || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) quickThrow(performance.now()); }
  else if (e.key === 's' || e.key === 'S' || e.key === 'ㄴ') settingsUI.open();
  else if (e.key === 'f' || e.key === 'F' || e.key === 'ㄹ') toggleFull();
  else if (e.key === 'p' || e.key === 'P' || e.key === 'ㅔ') hud.hidden = !hud.hidden;
});
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
$('#btnFull').addEventListener('click', toggleFull);
$('#btnSet').addEventListener('click', () => settingsUI.open());

// ---------- 시작 ----------
let camList = [];
const status = t => { $('#gateStatus').textContent = t; };
async function refreshCameras() { camList = await tracker.cameras(); fillCameras($('#camSelect'), camList, S.camId); }
async function startCamera(id) {
  await tracker.start(id);
  cam.dataset.live = '1'; await refreshCameras();
}
const modelReady = tracker.load().then(() => { status('손 인식 준비가 끝났어요.'); return true; }, e => { console.warn('모델 불러오기 실패', e); status('손 인식 모델을 불러오지 못했어요. 카메라 없이 해 볼 수 있어요.'); return false; });
function begin() { G.started = true; gate.hidden = true; G.nextHint = performance.now() + 2500; go('wait', performance.now()); }
// 카메라가 안 켜질 때 이유를 사람 말로 알려 준다.
function camProblem(e) {
  const n = e && e.name;
  if (e && e.message === 'model') return '손 인식 모델을 불러오지 못했어요. 페이지를 새로 고쳐 주세요.';
  if (!navigator.mediaDevices || !window.isSecureContext) return '이 주소에서는 카메라를 쓸 수 없어요. http://localhost:5173 으로 열어 주세요.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return '카메라 사용이 막혀 있어요. 크롬이나 엣지에서 열고, 주소창 왼쪽 아이콘에서 카메라를 "허용"으로 바꿔 주세요.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '카메라를 찾지 못했어요. USB 웹캠이 꽂혀 있는지 확인해 주세요.';
  if (n === 'NotReadableError' || n === 'AbortError') return '다른 프로그램이 카메라를 쓰고 있어요. 줌이나 카메라 앱을 닫고 다시 눌러 주세요.';
  return '카메라를 켜지 못했어요. (' + (n || '알 수 없는 오류') + ')';
}
// 카메라를 켠다. 성공하면 true, 실패하면 say(이유)를 부르고 false.
async function turnOnCamera(id, say) {
  try {
    say('손 인식을 준비하는 중이에요…');
    if (!(await modelReady)) throw new Error('model');
    say('카메라를 켜는 중이에요…');
    applySettings({ ...S, camId: id || '' });
    await startCamera(id); return true;
  } catch (e) { console.warn('카메라 켜기 실패', e && e.name, e && e.message); cam.dataset.live = '0'; say(camProblem(e)); return false; }
}
$('#btnStart').addEventListener('click', async () => {
  const btn = $('#btnStart'); unlock(); btn.disabled = true;
  if (await turnOnCamera($('#camSelect').value, status)) begin();
  btn.disabled = false;
});
$('#btnNoCam').addEventListener('click', () => { unlock(); begin(); });
// 카메라 없이 시작했거나 중간에 꺼졌을 때 게임 화면에서 다시 켠다.
$('#btnCamOn').addEventListener('click', async () => {
  const btn = $('#btnCamOn'), say = t => { $('#camEmptyText').textContent = t; }; unlock(); btn.disabled = true;
  if (await turnOnCamera(S.camId, say)) { say('카메라가 꺼져 있어요'); if (G.state === 'wait') go('wait', performance.now()); }
  btn.disabled = false;
});
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => { refreshCameras(); });

fontFamily = getComputedStyle(document.body).fontFamily;
applySettings(S); resize(); refreshCameras(); setMascot($('#gateMascot'), 'wave');
go('wait', performance.now());
requestAnimationFrame(t => { G.last = t; requestAnimationFrame(frame); });

// 오프라인 캐시. 개발용 localhost에서는 예전 파일이 보이지 않게 끈다(?sw=1 로 켤 수 있다).
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) navigator.serviceWorker.register('sw.js').catch(e => console.warn('오프라인 캐시 등록 실패', e));

// 자동 테스트와 시연용 손잡이
window.__dart = { G, tracker, buddy, perf, get S() { return S; }, get D() { return D; }, applySettings, quickThrow, begin };
