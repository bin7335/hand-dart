// 카메라 + 손 인식. 영상은 이 페이지 안에서만 분석하고 저장·전송하지 않는다.
// 모델과 WASM은 vendor/mediapipe/ 에 같이 들어 있어서 인터넷 없이 동작한다.
import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const BASE = new URL('../vendor/mediapipe/', import.meta.url);
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const FINGERS = [[5, 8], [9, 12], [13, 16], [17, 20]]; // [손가락 뿌리, 끝] 검지-새끼
// 카메라 화면 중 이 영역이 다트판 전체에 대응한다(가장자리까지 팔을 뻗지 않아도 되게).
export const ZONE = { x0: 0.2, x1: 0.8, y0: 0.14, y1: 0.74 };

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

// 손이 펴진 정도 0(주먹)-1(손바닥). 손목에서 손가락 끝까지 거리 ÷ 손목에서 손가락 뿌리까지 거리로 본다.
export function openness(pts) {
  let sum = 0;
  for (const [mcp, tip] of FINGERS) {
    const r = dist3(pts[tip], pts[0]) / Math.max(1e-6, dist3(pts[mcp], pts[0]));
    sum += Math.min(1, Math.max(0, (r - 1.0) / 0.75));
  }
  return sum / FINGERS.length;
}

export class HandTracker {
  constructor(video, overlay) {
    this.video = video; this.overlay = overlay; this.octx = overlay.getContext('2d');
    this.lm = null; this.delegate = ''; this.stream = null; this.lastT = -1; this.fake = null;
    this.limits = { fistBelow: 0.36, openAbove: 0.6 };
    this.state = { present: false, x: 0.5, y: 0.5, open: 0, pose: 'none', size: 0, t: 0 };
    this.fps = 0; this._n = 0; this._t0 = 0;
  }

  async load() {
    const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', BASE).href);
    const make = delegate => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('hand_landmarker.task', BASE).href, delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.lm = await make('GPU'); this.delegate = 'GPU'; }
    catch { this.lm = await make('CPU'); this.delegate = 'CPU'; }
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
    this.stream = null; this.video.srcObject = null; this.lastT = -1;
    this.state = { ...this.state, present: false, pose: 'none' };
  }
  get live() { return !!this.stream; }

  // 테스트·시연용: 가짜 손 상태를 넣는다. null이면 해제.
  inject(s) { this.fake = s; }

  // 한 장(영상 프레임이나 그림)을 분석해 손 상태를 돌려준다.
  analyze(source, now) {
    const res = this.lm.detectForVideo(source, now);
    const hands = res.landmarks || [];
    if (!hands.length) return { present: false, hands };
    const w = source.videoWidth || source.naturalWidth || source.width || 1, h = source.videoHeight || source.naturalHeight || source.height || 1;
    let best = 0, bestSize = -1;
    hands.forEach((p, i) => { const s = Math.hypot((p[9].x - p[0].x) * w, (p[9].y - p[0].y) * h) / h; if (s > bestSize) { bestSize = s; best = i; } });
    const p = hands[best], world = res.worldLandmarks && res.worldLandmarks[best];
    const flat = p.map(q => ({ x: q.x * w, y: q.y * h, z: 0 }));
    const palm = [0, 5, 9, 13, 17].reduce((a, i) => ({ x: a.x + p[i].x / 5, y: a.y + p[i].y / 5 }), { x: 0, y: 0 });
    return { present: true, hands, best, x: 1 - palm.x, y: palm.y, open: openness(world && world.length === 21 ? world : flat), size: bestSize };
  }

  pose(open, prev) {
    if (open < this.limits.fistBelow) return 'fist';
    if (open > this.limits.openAbove) return 'open';
    return prev === 'fist' || prev === 'open' ? prev : 'mid';
  }

  // 매 프레임 부른다. 새 영상 프레임이 있을 때만 분석한다.
  read(now) {
    if (this.fake) {
      const f = this.fake, prev = this.state.pose;
      this.state = f.present ? { present: true, x: f.x, y: f.y, open: f.open, pose: this.pose(f.open, prev), size: 0.2, t: now } : { ...this.state, present: false, pose: 'none' };
      return this.state;
    }
    const v = this.video;
    if (!this.lm || !this.stream || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastT) return this.state;
    this.lastT = v.currentTime;
    let r;
    try { r = this.analyze(v, now); } catch (e) { if (!this._warned) { this._warned = true; console.warn('손 인식 실패', e); } return this.state; }
    if (!this._t0) this._t0 = now;
    if (++this._n >= 15) { this.fps = Math.round(15000 / (now - this._t0)); this._n = 0; this._t0 = now; }
    if (r.present) {
      const prev = this.state, open = prev.present ? prev.open * 0.4 + r.open * 0.6 : r.open;
      this.state = { present: true, x: r.x, y: r.y, open, pose: this.pose(open, prev.pose), size: r.size, t: now };
    } else if (now - this.state.t > 250) {
      this.state = { ...this.state, present: false, pose: 'none' };
    }
    this.draw(r);
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
      ctx.beginPath(); for (const [a, b] of BONES) { ctx.moveTo(X(p[a].x), Y(p[a].y)); ctx.lineTo(X(p[b].x), Y(p[b].y)); } ctx.stroke();
      ctx.fillStyle = '#fff'; for (const q of p) { ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), main ? 3 : 2, 0, 6.2832); ctx.fill(); }
    });
  }
}
