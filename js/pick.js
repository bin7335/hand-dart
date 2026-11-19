// 체험 선택 화면(Picker)과 고른 체험을 여는 틀(Runner).
// 선택 화면: 칸마다 카드 한 장. 손 커서를 카드 위에 두고 주먹을 쥐면 고른다. 판단은 main.js가 하고 여기는 화면만 그린다.
import { segName, segUrl, segDesc } from './settings.js';

export class Picker {
  // els: { root, grid, cursor, cursorIcon, title, hint(글자), hintBox(안내 띠), video }, inkOn(색) → 그 색 위에 올릴 글자색, onPick(칸 번호)
  constructor(els, { inkOn, onPick, hands }) {
    Object.assign(this, els); this.inkOn = inkOn; this.onPick = onPick; this.hands = hands;
    this.cards = []; this.rects = []; this.hover = -1; this.rec = -1; this.pose = ''; this.mr = false;
  }
  get open() { return !this.root.hidden; }

  // stream: 카메라 영상. 주면 그 영상을 배경으로 깔고 카드가 그 위에 떠 있는 것처럼 보여 준다(MR 모드).
  show(S, rec, stream = null) {
    this.mr = !!stream; this.root.dataset.mr = this.mr ? '1' : '0';
    if (this.video) { this.video.srcObject = stream; if (stream) this.video.play().catch(() => { /* 영상이 안 나와도 고르기는 된다 */ }); }
    this.rec = rec; this.hover = -1; this.cards = [];
    this.grid.textContent = ''; this.root.classList.remove('is-done');
    const n = S.segs.length;
    this.grid.style.setProperty('--cols', n <= 2 ? n : n <= 4 ? (n === 3 ? 3 : 2) : n <= 6 ? 3 : 4);
    this.grid.dataset.many = n > 4 ? '1' : '0';
    S.segs.forEach((g, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'card' + (i === rec ? ' is-rec' : '');
      b.style.setProperty('--seg', g.color); b.style.setProperty('--seg-ink', this.inkOn(g.color));
      const tag = document.createElement('span'); tag.className = 'card__tag'; tag.textContent = '다트가 고른 체험';
      const num = document.createElement('span'); num.className = 'card__num'; num.textContent = i + 1;
      const name = document.createElement('span'); name.className = 'card__name'; name.textContent = segName(S, i);
      const desc = document.createElement('span'); desc.className = 'card__desc'; desc.textContent = segDesc(S, i); // 손을 올렸을 때만 보인다
      const note = document.createElement('span'); note.className = 'card__note'; note.textContent = segUrl(S, i) ? '' : '부스 안에서 체험해요';
      const fill = document.createElement('i'); fill.className = 'card__fill';
      b.append(tag, num, name, desc, note, fill);
      b.addEventListener('click', () => this.onPick(i));
      this.grid.append(b); this.cards.push({ el: b, note, fill, base: note.textContent, p: -1 });
    });
    this.title.textContent = rec >= 0 ? `다트가 고른 체험은 "${segName(S, rec)}"!` : '어떤 체험을 해 볼까요?';
    // 자동으로 넘어가지 않는다. 카드 위에서 주먹을 쥐어야 체험이 열린다.
    this.hint.textContent = '원하는 카드 위에서 주먹을 꽉 쥐세요!'; this.hintBox.dataset.mode = 'fist';
    this.root.hidden = false; this.setCursor(null); this.layout();
  }
  hide() { if (this.root.hidden) return; this.root.hidden = true; this.mr = false; this.root.dataset.mr = '0'; if (this.video) this.video.srcObject = null; this.cursor.hidden = true; this.grid.textContent = ''; this.cards = []; this.rects = []; this.hover = -1; }

  // 카드 자리를 재 둔다(창 크기가 바뀔 때 다시). 카드가 커지는 효과와 상관없이 원래 자리로 판정한다.
  layout() {
    this.rects = this.cards.map(c => { const e = c.el; return { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }; });
  }
  // (x, y): 무대 기준 좌표. 지금 올라가 있는 카드는 조금 넉넉하게 봐서 경계에서 깜빡이지 않게 한다.
  hit(x, y) {
    const inside = (r, pad) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
    if (this.hover >= 0 && this.rects[this.hover] && inside(this.rects[this.hover], 10)) return this.hover;
    return this.rects.findIndex(r => inside(r, 0));
  }
  setHover(i) {
    if (i === this.hover) return; this.hover = i;
    this.cards.forEach((c, k) => c.el.classList.toggle('is-hover', k === i));
  }
  // 카드 아래 막대(0-1)와 작은 글자
  setFill(i, p) { const c = this.cards[i]; if (!c) return; p = Math.round(p * 200) / 200; if (c.p === p) return; c.p = p; c.fill.style.transform = `scaleX(${p})`; }
  setNote(i, text) { const c = this.cards[i]; if (!c) return; const t = text || c.base; if (c.note.textContent !== t) c.note.textContent = t; }
  // 손 커서. p가 null이면 숨긴다. progress: 주먹을 쥐고 버티는 중 게이지 0-1
  setCursor(p, pose = 'open', progress = 0) {
    if (!p) { if (!this.cursor.hidden) this.cursor.hidden = true; return; }
    if (this.cursor.hidden) this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    this.cursor.style.setProperty('--p', progress.toFixed(3));
    const icon = pose === 'fist' ? 'fist' : 'palm';
    if (icon !== this.pose) { this.pose = icon; this.cursorIcon.innerHTML = this.hands[icon]; this.cursor.dataset.pose = icon; }
  }
  picked(i, title, hint) {
    this.root.classList.add('is-done'); this.setCursor(null);
    this.cards.forEach((c, k) => { c.el.classList.toggle('is-picked', k === i); c.el.classList.remove('is-hover'); });
    if (title) this.title.textContent = title;
    this.hint.textContent = hint || ''; this.hintBox.dataset.mode = hint ? 'plain' : 'none';
  }
}

export class Runner {
  // els: { layer, frame, name }, onKey: 체험 화면 안에서 눌린 키도 받아서 "처음으로" 같은 운영 단축키가 듣게 한다
  constructor(els, { onKey }) { Object.assign(this, els); this.onKey = onKey; this.el = null; this.url = ''; this.index = -1; this.keys = false; }
  get active() { return !!this.el; }

  open(url, title, index) {
    this.close();
    const f = document.createElement('iframe');
    f.className = 'run__iframe'; f.title = title;
    // 체험이 카메라·전체 화면을 쓸 수 있게 허락한다. 다른 주소(다른 사람이 만든 체험)도 마찬가지.
    f.allow = 'camera; microphone; fullscreen; autoplay; clipboard-write';
    f.addEventListener('load', () => {
      if (this.el !== f) return;
      // 같은 주소(origin)에 있는 체험이면 그 안에서 눌린 키도 받는다. 다른 주소면 브라우저가 막으므로 위쪽 띠의 버튼을 쓴다.
      try { f.contentWindow.addEventListener('keydown', this.onKey, true); this.keys = true; } catch { this.keys = false; }
      this.layer.dataset.keys = this.keys ? '1' : '0';
      try { f.contentWindow.focus(); } catch { /* 초점을 못 줘도 진행한다 */ }
    });
    f.src = url;
    this.name.textContent = title; this.layer.dataset.keys = '0';
    this.frame.append(f); this.layer.hidden = false;
    this.el = f; this.url = url; this.index = index;
  }
  close() {
    if (!this.el) return;
    this.el.remove(); this.el = null; this.url = ''; this.index = -1; this.keys = false;
    this.layer.hidden = true;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
}
