// 손 인식 전용 스레드. 화면을 그리는 스레드와 따로 돌아서, 인식하는 동안에도 화면이 멈칫하지 않는다.
// hand.js가 이 파일을 blob 워커 안에서 importScripts로 불러온다(그래야 index.html의 CSP가 그대로 적용된다).
'use strict';
(() => {
  const BASE = self.__BASE, ORIGIN = new URL(BASE).origin;
  // 이 스레드에서는 같은 출처(와 blob·data) 말고는 어떤 요청도 내보내지 않는다.
  // MediaPipe가 사용 통계를 구글로 보내려 하는데, CSP와 별개로 여기서도 한 번 더 막는다.
  const allowed = u => { try { const x = new URL(String(u), BASE); return x.origin === ORIGIN || x.protocol === 'blob:' || x.protocol === 'data:'; } catch { return false; } };
  const realFetch = self.fetch.bind(self);
  self.fetch = (input, init) => allowed(typeof input === 'string' || input instanceof URL ? input : input && input.url) ? realFetch(input, init) : Promise.reject(new TypeError('blocked: external request'));
  if (self.XMLHttpRequest) {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) { if (!allowed(url)) throw new DOMException('blocked: external request', 'SecurityError'); return open.call(this, method, url, ...rest); };
  }

  let lm = null, delegate = '', lastTs = 0;
  async function init() {
    const { FilesetResolver, HandLandmarker } = await import(BASE + 'vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'vendor/mediapipe/wasm');
    const make = d => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: BASE + 'vendor/mediapipe/hand_landmarker.task', delegate: d },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { lm = await make('GPU'); delegate = 'GPU'; }
    catch { lm = await make('CPU'); delegate = 'CPU'; }
    // 첫 분석은 준비 작업 때문에 오래 걸린다. 빈 그림으로 미리 한 번 돌려서 첫 손짓이 늦지 않게 한다.
    try { const c = new OffscreenCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64); lastTs = Math.round(performance.now()); lm.detectForVideo(c, lastTs); } catch { /* 예열은 실패해도 괜찮다 */ }
  }

  self.onmessage = async e => {
    const m = e.data;
    if (m.type === 'init') {
      try { await init(); self.postMessage({ type: 'ready', delegate }); }
      catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }
    } else if (m.type === 'frame') {
      const t0 = performance.now(), out = { type: 'result', id: m.id, ms: 0, landmarks: [], world: [] };
      try {
        lastTs = Math.max(lastTs + 1, Math.round(t0));
        const res = lm.detectForVideo(m.bitmap, lastTs);
        out.landmarks = (res.landmarks || []).map(h => h.map(p => [p.x, p.y]));
        out.world = (res.worldLandmarks || []).map(h => h.map(p => [p.x, p.y, p.z]));
      } catch (err) { out.error = String((err && err.message) || err); }
      if (m.bitmap.close) m.bitmap.close();
      out.ms = performance.now() - t0;
      self.postMessage(out);
    } else if (m.type === 'probe') {
      // 테스트용: 이 스레드에서 외부 요청이 두 겹(CSP, 위의 fetch 막기)으로 막히는지 확인한다. .invalid 주소라 막히지 않아도 어디로도 나가지 않는다.
      let csp = false; const on = () => { csp = true; }; self.addEventListener('securitypolicyviolation', on);
      try { await realFetch('https://hand-dart-probe.invalid/x'); } catch { /* 막히거나 주소가 없어서 실패 */ }
      const patched = await self.fetch('https://hand-dart-probe.invalid/x').then(() => false, err => /blocked/.test(err.message));
      await new Promise(r => setTimeout(r, 200));
      self.removeEventListener('securitypolicyviolation', on);
      // 문서의 CSP에는 unsafe-eval이 없다. 이 스레드가 CSP를 물려받았다면 eval도 막힌다.
      let evalBlocked = false; try { (0, eval)('1'); } catch { evalBlocked = true; }
      self.postMessage({ type: 'probe', id: m.id, csp, evalBlocked, patched });
    }
  };
})();
