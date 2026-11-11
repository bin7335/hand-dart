// 카메라 + 손 인식. 영상은 이 페이지 안에서만 분석하고 저장·전송하지 않는다.
// 모델과 WASM은 vendor/mediapipe/ 에 같이 들어 있어서 인터넷 없이 동작한다.
// 인식은 별도 스레드(hand-worker.js)에서 돌린다. 화면 스레드에서 돌리면 인식할 때마다 화면이 멈칫한다.
// 별도 스레드를 못 쓰는 브라우저에서는 예전처럼 화면 스레드에서 돌린다(mode === 'main').
const ROOT = new URL('../', import.meta.url).href;
const VENDOR = ROOT + 'vendor/mediapipe/';
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const FINGERS = [[5, 8], [9, 12], [13, 16], [17, 20]]; // [손가락 뿌리, 끝] 검지-새끼
// 카메라 화면 중 이 영역이 다트판 전체에 대응한다(가장자리까지 팔을 뻗지 않아도 되게).
export const ZONE = { x0: 0.2, x1: 0.8, y0: 0.14, y1: 0.74 };
const SEND_WIDTH = 640; // 인식용으로 보내는 영상의 가로 크기. 모델 입력이 훨씬 작아서 이 정도면 충분하다.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0));

// 손이 펴진 정도 0(주먹)-1(손바닥). 손목에서 손가락 끝까지 거리 ÷ 손목에서 손가락 뿌리까지 거리로 본다.
export function openness(pts) {
  let sum = 0;
  for (const [mcp, tip] of FINGERS) {
    const r = dist(pts[tip], pts[0]) / Math.max(1e-6, dist(pts[mcp], pts[0]));
    sum += Math.min(1, Math.max(0, (r - 1.0) / 0.75));
  }
  return sum / FINGERS.length;
}

// 인식 결과(손마다 21개 점)를 게임이 쓰는 값으로 줄인다. landmarks: [[x, y]…], world: [[x, y, z]…]
export function summarize(landmarks, world, w, h) {
  const hands = landmarks || [];
  if (!hands.length) return { present: false, hands };
  let best = 0, bestSize = -1;
  hands.forEach((p, i) => { const s = Math.hypot((p[9][0] - p[0][0]) * w, (p[9][1] - p[0][1]) * h) / h; if (s > bestSize) { bestSize = s; best = i; } });
  const p = hands[best], wl = world && world[best];
  const flat = p.map(q => [q[0] * w, q[1] * h, 0]);
  let px = 0, py = 0; for (const i of [0, 5, 9, 13, 17]) { px += p[i][0] / 5; py += p[i][1] / 5; }
  return { present: true, hands, best, x: 1 - px, y: py, open: openness(wl && wl.length === 21 ? wl : flat), size: bestSize };
}

export class HandTracker {
  constructor(video, overlay) {
    this.video = video; this.overlay = overlay; this.octx = overlay.getContext('2d');
    this.ready = false; this.mode = ''; this.delegate = ''; this.worker = null; this.main = null;
    this.stream = null; this.lastT = -1; this.fake = null; this.busy = false;
    this.pending = new Map(); this.seq = 0;
    this.limits = { fistBelow: 0.36, openAbove: 0.6 };
    this.state = { present: false, x: 0.5, y: 0.5, open: 0, pose: 'none', size: 0, t: 0 };
    this.fps = 0; this.inferMs = 0; this._n = 0; this._t0 = 0;
  }
  get lm() { return this.ready; } // 예전 이름. 테스트가 쓴다.

  async load() {
    try { await this.loadWorker(); this.mode = 'worker'; }
    catch (e) {
      console.warn('별도 스레드에서 손 인식을 켜지 못해 화면 스레드로 돌려요', e);
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      await this.loadMain(); this.mode = 'main';
    }
    this.ready = true;
  }
  loadWorker() {
    return new Promise((resolve, reject) => {
      if (!window.Worker || !window.createImageBitmap) return reject(new Error('worker 미지원'));
      // blob 워커는 이 문서의 CSP를 물려받는다. 그 안에서 실제 코드를 불러온다.
      const src = `self.__BASE=${JSON.stringify(ROOT)};importScripts(${JSON.stringify(ROOT + 'js/hand-worker.js')});`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = this.worker = new Worker(url);
      const timer = setTimeout(() => reject(new Error('준비 시간 초과')), 40000);
      w.onerror = e => { clearTimeout(timer); reject(new Error(e.message || 'worker 오류')); };
      w.onmessage = e => {
        const m = e.data;
        if (m.type === 'ready') { clearTimeout(timer); URL.revokeObjectURL(url); this.delegate = m.delegate; resolve(); }
        else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
        else if (m.id && this.pending.has(m.id)) { const done = this.pending.get(m.id); this.pending.delete(m.id); done(m); }
      };
      w.postMessage({ type: 'init' });
    });
  }
  async loadMain() {
    const { FilesetResolver, HandLandmarker } = await import(VENDOR + 'vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(VENDOR + 'wasm');
    const make = delegate => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: VENDOR + 'hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.main = await make('GPU'); this.delegate = 'GPU'; }
    catch { this.main = await make('CPU'); this.delegate = 'CPU'; }
  }
  // 별도 스레드에 일을 맡기고 답을 기다린다.
  ask(msg, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('응답 없음')); }, 15000);
      this.pending.set(id, m => { clearTimeout(timer); resolve(m); });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }
  detectMain(source, now) {
    const t0 = performance.now(), res = this.main.detectForVideo(source, now);
    return { landmarks: (res.landmarks || []).map(h => h.map(p => [p.x, p.y])), world: (res.worldLandmarks || []).map(h => h.map(p => [p.x, p.y, p.z])), ms: performance.now() - t0 };
  }

  async cameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { return []; }
  }
  async start(deviceId) {
    this.stop();
    const want = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { ...want, deviceId: { exact: deviceId } } : want }); }
    catch (e) { if (!deviceId) throw e; this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: want }); }
    this.video.srcObject = this.stream;
    await this.video.play();
  }
  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.video.srcObject = null; this.lastT = -1; this.fps = 0;
    this.state = { ...this.state, present: false, pose: 'none' };
  }
  get live() { return !!this.stream; }

  // 테스트·시연용: 가짜 손 상태를 넣는다. null이면 해제.
  inject(s) { this.fake = s; }

  // 테스트용: 그림 한 장을 분석한다.
  async analyzeImage(source) {
    const w = source.naturalWidth || source.videoWidth || source.width || 1, h = source.naturalHeight || source.videoHeight || source.height || 1;
    const raw = this.mode === 'worker' ? await this.ask({ type: 'frame', bitmap: await createImageBitmap(source) }) : this.detectMain(source, performance.now());
    if (raw.error) throw new Error(raw.error);
    return summarize(raw.landmarks, raw.world, w, h);
  }
  // 테스트용: 별도 스레드에서 외부 요청이 막히는지 확인한다.
  probe() { return this.mode === 'worker' ? this.ask({ type: 'probe' }) : Promise.resolve(null); }

  pose(open, prev) {
    if (open < this.limits.fistBelow) return 'fist';
    if (open > this.limits.openAbove) return 'open';
    return prev === 'fist' || prev === 'open' ? prev : 'mid';
  }

  // 인식 결과 한 건을 상태에 반영한다.
  apply(r, now, ms) {
    if (!this.stream) return;
    if (!this._t0) this._t0 = now;
    this.inferMs = this.inferMs ? this.inferMs * 0.8 + ms * 0.2 : ms;
    if (++this._n >= 15) { this.fps = Math.round(15000 / Math.max(1, now - this._t0)); this._n = 0; this._t0 = now; }
    if (r.present) {
      const prev = this.state, open = prev.present ? prev.open * 0.4 + r.open * 0.6 : r.open;
      this.state = { present: true, x: r.x, y: r.y, open, pose: this.pose(open, prev.pose), size: r.size, t: now };
    } else if (now - this.state.t > 250) {
      this.state = { ...this.state, present: false, pose: 'none' };
    }
    this.draw(r);
  }

  // 매 프레임 부른다. 새 영상 프레임이 있고 앞의 분석이 끝났을 때만 다음 분석을 맡긴다.
  read(now) {
    if (this.fake) {
      const f = this.fake, prev = this.state.pose;
      this.state = f.present ? { present: true, x: f.x, y: f.y, open: f.open, pose: this.pose(f.open, prev), size: 0.2, t: now } : { ...this.state, present: false, pose: 'none' };
      return this.state;
    }
    const v = this.video;
    if (!this.ready || !this.stream || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastT) return this.state;
    const w = v.videoWidth, h = v.videoHeight;
    if (this.mode === 'worker') {
      if (this.busy) return this.state;
      this.busy = true; this.lastT = v.currentTime;
      const k = Math.min(1, SEND_WIDTH / w);
      createImageBitmap(v, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: 'low' })
        .then(bitmap => this.ask({ type: 'frame', bitmap }, [bitmap]))
        .then(raw => { if (raw.error) throw new Error(raw.error); this.apply(summarize(raw.landmarks, raw.world, w, h), performance.now(), raw.ms); })
        .catch(e => { if (!this._warned) { this._warned = true; console.warn('손 인식 실패', e); } })
        .finally(() => { this.busy = false; });
      return this.state;
    }
    this.lastT = v.currentTime;
    try { const raw = this.detectMain(v, now); this.apply(summarize(raw.landmarks, raw.world, w, h), now, raw.ms); }
    catch (e) { if (!this._warned) { this._warned = true; console.warn('손 인식 실패', e); } }
    return this.state;
  }

  // 카메라 화면 위에 AI가 찾은 손 뼈대를 그린다. (캔버스는 CSS로 영상과 같이 좌우 반전된다)
  draw(r) {
    const c = this.overlay, ctx = this.octx, dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = c.clientWidth, bh = c.clientHeight; if (!bw || !bh) return;
    if (c.width !== Math.round(bw * dpr) || c.height !== Math.round(bh * dpr)) { c.width = Math.round(bw * dpr); c.height = Math.round(bh * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, bw, bh);
    const vw = this.video.videoWidth, vh = this.video.videoHeight; if (!vw) return;
    const sc = Math.max(bw / vw, bh / vh), ox = (bw - vw * sc) / 2, oy = (bh - vh * sc) / 2;
    const X = x => ox + x * vw * sc, Y = y => oy + y * vh * sc;
    // 손을 두면 좋은 자리
    ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(X(ZONE.x0), Y(ZONE.y0), X(ZONE.x1) - X(ZONE.x0), Y(ZONE.y1) - Y(ZONE.y0)); ctx.setLineDash([]);
    if (!r.present) return;
    r.hands.forEach((p, i) => {
      const main = i === r.best, pose = this.state.pose;
      const col = !main ? 'rgba(255,255,255,0.5)' : pose === 'fist' ? '#ff7a5c' : pose === 'open' ? '#5fe0a2' : '#ffd84d';
      ctx.lineWidth = main ? 3 : 2; ctx.strokeStyle = col; ctx.lineCap = 'round';
      ctx.beginPath(); for (const [a, b] of BONES) { ctx.moveTo(X(p[a][0]), Y(p[a][1])); ctx.lineTo(X(p[b][0]), Y(p[b][1])); } ctx.stroke();
      ctx.fillStyle = '#fff'; for (const q of p) { ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), main ? 3 : 2, 0, 6.2832); ctx.fill(); }
    });
  }
}
