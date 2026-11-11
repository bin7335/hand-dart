// 부스 도우미 캐릭터. vibe-taste에서 쓰던 그림을 그대로 가져왔다.
// Claude Code 시작 화면의 픽셀 마스코트 모양을 따라 그린 비공식 그림이며(공식 파일 아님), 그 사실은 화면 아래 안내 문구에 적어 둔다.
// 고정 마크업만 쓰고 사용자 입력은 넣지 않는다. 한 칸 = 가로 3.6 × 세로 7.2.
const SVG = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
<ellipse class="mas__shadow" cx="32" cy="53" rx="20" ry="2.5"/>
<g class="mas__all">
  <rect class="mas__leg" x="14" y="38.8" width="3.6" height="9.2"/>
  <rect class="mas__leg" x="21.2" y="38.8" width="3.6" height="9.2"/>
  <rect class="mas__leg" x="39.2" y="38.8" width="3.6" height="9.2"/>
  <rect class="mas__leg" x="46.4" y="38.8" width="3.6" height="9.2"/>
  <g class="mas__body">
    <rect class="mas__arm mas__arm--l" x="3.2" y="26.4" width="8.2" height="7.2"/>
    <rect class="mas__arm mas__arm--r" x="52.6" y="26.4" width="8.2" height="7.2"/>
    <rect class="mas__face" x="10.4" y="12" width="43.2" height="28.8"/>
    <g class="mas__gaze"><g class="mas__eyes"><rect x="17.6" y="19.2" width="3.6" height="7.2"/><rect x="42.8" y="19.2" width="3.6" height="7.2"/></g></g>
  </g>
</g></svg>`;

export function mountMascots(root = document) {
  root.querySelectorAll('[data-mascot]').forEach(n => { n.classList.add('mas'); n.innerHTML = SVG; });
}

const STATES = ['idle', 'wave', 'tense', 'cheer', 'run'];
export function setMascot(node, state) {
  if (!node) return;
  STATES.forEach(s => node.classList.toggle('mas--' + s, s === state));
}

// 한 번 하고 끝나는 동작
const ANTICS = { hop: 500, leap: 650, spin: 750, wiggle: 720, look: 1300, squash: 450 };
export function antic(node, name) {
  if (!node || !ANTICS[name]) return;
  Object.keys(ANTICS).forEach(k => node.classList.remove('mas--' + k)); void node.offsetWidth;
  node.classList.add('mas--' + name);
  clearTimeout(node._anticT); node._anticT = setTimeout(() => node.classList.remove('mas--' + name), ANTICS[name] + 60);
}

// 눈동자가 한 칸씩 움직여 조준점을 따라간다. dx, dy는 -1, 0, 1.
export function gaze(node, dx, dy) {
  const g = node && node.querySelector('.mas__gaze'); if (!g) return;
  const key = dx + ',' + dy; if (g._k === key) return; g._k = key;
  g.style.transform = `translate(${dx * 3.6}px, ${dy * 2.4}px)`;
}

// 판 아래를 뛰어다니는 도우미. 손이 보이면 조준점을 따라 달리고, 아무도 없으면 5-9초에 한 번 작은 동작을 하거나 반대편으로 달려간다.
export class Buddy {
  constructor(wrap, stage) {
    this.wrap = wrap; this.stage = stage;
    this.node = wrap.querySelector('.mas'); this.say = wrap.querySelector('.bubble');
    this.x = 0; this.mood = 'idle'; this.running = false; this.home = 0;
    this.nextAntic = 0; this.nextTrip = 0; this.nextFollow = 0; this.sayT = 0; this.runT = 0;
    this.measure(); this.moveTo(this.limit(0), true);
  }
  // 크기는 창 크기가 바뀔 때만 다시 잰다(매 프레임 재면 화면이 버벅인다).
  measure() { this.w = this.wrap.offsetWidth || 120; this.sw = this.stage.clientWidth; this.sh = this.stage.clientHeight; }
  width() { return this.w; }
  limit(x) { const w = this.sw, pad = w * 0.02; return Math.min(Math.max(pad, w - this.width() - pad), Math.max(pad, x)); }
  centerX() { return this.x + this.width() / 2; }
  moveTo(x, instant) {
    const dist = Math.abs(x - this.x); this.x = x;
    const ms = instant ? 0 : Math.max(260, dist * 1.5);
    this.wrap.style.setProperty('--bt', ms + 'ms'); this.wrap.style.setProperty('--bx', x + 'px');
    return ms;
  }
  // x(왼쪽 끝 좌표)까지 달려간다
  runTo(x) {
    x = this.limit(x); if (Math.abs(x - this.x) < 8) return;
    this.running = true; setMascot(this.node, 'run');
    const ms = this.moveTo(x, false);
    clearTimeout(this.runT);
    this.runT = setTimeout(() => { this.running = false; setMascot(this.node, this.mood); antic(this.node, 'squash'); }, ms + 30);
  }
  setMood(mood) { this.mood = mood; if (!this.running) setMascot(this.node, mood); }
  antic(name) { if (!this.running) antic(this.node, name); }
  talk(text, ms = 2200) {
    clearTimeout(this.sayT);
    this.say.hidden = true; void this.say.offsetWidth; this.say.textContent = text; this.say.hidden = false;
    this.sayT = setTimeout(() => { this.say.hidden = true; }, ms);
  }
  resize() { this.measure(); clearTimeout(this.runT); this.running = false; setMascot(this.node, this.mood); this.moveTo(this.limit(this.x), true); }
  // 매 프레임. aim: 조준점(없으면 null), calm: 혼자 놀아도 되는 때, follow: 조준점을 따라 달릴 때
  tick(now, aim, calm, follow) {
    if (aim) {
      const dx = aim.x - this.centerX();
      gaze(this.node, Math.abs(dx) < this.width() * 0.5 ? 0 : Math.sign(dx), aim.y < this.sh * 0.5 ? -1 : 0);
    } else gaze(this.node, 0, 0);
    if (!this.nextAntic) { this.nextAntic = now + 3000; this.nextTrip = now + 9000; }
    if (this.running) return;
    if (aim && follow) {
      // 조준점이 멀어지면 그 아래로 달려간다(너무 자주 뛰지 않게 0.9초 간격)
      if (now > this.nextFollow && Math.abs(aim.x - this.centerX()) > this.sw * 0.16) { this.nextFollow = now + 900; this.runTo(aim.x - this.width() / 2); }
      return;
    }
    if (!calm) return;
    if (now > this.nextAntic) { this.nextAntic = now + 5000 + Math.random() * 4000; this.antic(['hop', 'look', 'wiggle', 'squash'][Math.floor(Math.random() * 4)]); }
    if (now > this.nextTrip) { this.nextTrip = now + 13000 + Math.random() * 9000; this.home = this.home ? 0 : 1; this.runTo(this.home ? this.sw : 0); }
  }
}
