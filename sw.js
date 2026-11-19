// 오프라인 캐시: 박람회장 와이파이가 끊겨도 한 번 연 기기에서는 계속 동작한다.
// 파일을 바꿔서 배포할 때 VERSION을 올리면 예전 캐시를 지운다.
const VERSION = 'hand-dart-v2';
const APP = ['./', './index.html', './css/app.css', './js/main.js', './js/hand.js', './js/hand-worker.js', './js/settings.js', './js/mascot.js', './js/sfx.js'];
// 손 인식 라이브러리·모델(약 22MB): 버전이 고정돼 있어 한 번 받으면 다시 받지 않는다.
const VENDOR = ['./vendor/mediapipe/vision_bundle.mjs', './vendor/mediapipe/wasm/vision_wasm_internal.js', './vendor/mediapipe/wasm/vision_wasm_internal.wasm', './vendor/mediapipe/hand_landmarker.task'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll([...APP, ...VENDOR])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const big = url.pathname.includes('/vendor/');
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    if (hit && big) return hit;
    // 화면 파일은 캐시를 먼저 보여 주고 뒤에서 새 파일을 받아 둔다(다음에 열 때 반영).
    const net = fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
