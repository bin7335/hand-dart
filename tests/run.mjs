// 자동 테스트: 로컬 정적 서버 + 헤드리스 크롬(CDP). 실행: node tests/run.mjs
// 선택: IMG_DIR=<손 사진 폴더> 를 주면 실제 사진으로 손 인식·주먹/손바닥 판정까지 검사한다.
//       SHOT_DIR=<폴더> 를 주면 화면 캡처를 남긴다.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const IMG_DIR = process.env.IMG_DIR || '', SHOT_DIR = process.env.SHOT_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const port = 9700 + Math.floor(Math.random() * 200);
const udd = path.join(process.env.TEMP || '/tmp', 'hand-dart-test-' + port);
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let wsUrl; for (let i = 0; i < 100 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = j.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(200); }
if (!wsUrl) { console.error('크롬 연결 실패'); process.exit(2); }
const sock = new WebSocket(wsUrl); await new Promise(r => sock.onopen = r);
let seq = 0; const pend = new Map(); let errors = [], requests = [];
sock.onmessage = ev => {
  const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  const p = m.params;
  if (m.method === 'Runtime.exceptionThrown') errors.push('예외: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Log.entryAdded' && p.entry.level === 'error' && !/favicon/.test(p.entry.url || '')) errors.push('log: ' + p.entry.text + ' ' + (p.entry.url || ''));
  if (m.method === 'Network.requestWillBeSent') requests.push(p.request.url);
};
const send = (method, params = {}) => new Promise((r, j) => { const i = ++seq; const t = setTimeout(() => j(new Error('timeout ' + method)), 60000); pend.set(i, m => { clearTimeout(t); r(m); }); sock.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr, timeout = 40000) => {
  const r = await send('Runtime.evaluate', { expression: `Promise.race([(async()=>{${H}${expr}})(), new Promise((_,j)=>setTimeout(()=>j(new Error('시간 초과')),${timeout}))])`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
  return r.result.result.value;
};
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
const metrics = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const load = async (url, wait = 800) => { errors = []; requests = []; await send('Page.navigate', { url }); await sleep(wait); };
const shot = async name => { if (!SHOT_DIR) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(r.result.data, 'base64')); };

const H = `const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];const wait=ms=>new Promise(r=>setTimeout(r,ms));const assert=(c,m)=>{if(!c)throw new Error('assert: '+m)};
const until=async(f,ms=8000,m='조건')=>{const t=performance.now();while(!f()){if(performance.now()-t>ms)throw new Error('기다림 초과: '+m);await wait(30);}};const A=()=>window.__dart;`;
const results = []; const t = async (name, fn) => { try { const r = await fn(); results.push({ name, ok: true }); console.log('✓', name, r ?? ''); } catch (e) { results.push({ name, ok: false, e: e.message }); console.log('✗', name, '\n   ', e.message); } };
const noErrors = label => { const e = [...new Set(errors)].filter(x => !/AudioContext/.test(x)); if (e.length) throw new Error(label + ' 오류: ' + e.join(' / ')); };
const noExternal = () => { const ext = requests.filter(u => !u.startsWith(ORIGIN) && !/^(data|blob|about):/.test(u)); if (ext.length) throw new Error('외부 요청: ' + ext.join(' ')); };

await metrics(1600, 900);
await t('첫 화면·모델 불러오기·오류 0·외부 요청 0', async () => {
  await load(ORIGIN + '/');
  const d = await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); return A().tracker.delegate + ' / ' + $('#gateStatus').textContent`);
  noErrors('로드'); noExternal(); await shot('1-gate'); return d;
});

if (IMG_DIR) {
  const imgs = { 'woman_hands.jpg': 'open', 'thumbs_up.jpg': 'fist', 'victory.jpg': 'any', 'pointing_up.jpg': 'any' };
  for (const [file, want] of Object.entries(imgs)) {
    await t(`실제 사진 손 인식: ${file}`, async () => {
      const src = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(IMG_DIR, file)).toString('base64');
      const r = await ev(`const img=new Image(); img.src=${JSON.stringify(src)}; await img.decode();
        const tr=A().tracker; let r; for(let i=0;i<4;i++){ window.__ts=(window.__ts||performance.now()+1000)+40; r=tr.analyze(img, window.__ts); await wait(20); }
        return {present:r.present, n:r.hands.length, open:r.present?+r.open.toFixed(2):null, pose:r.present?tr.pose(r.open,'none'):null, x:r.present?+r.x.toFixed(2):null}`);
      if (!r.present) throw new Error('손을 찾지 못함');
      if (want !== 'any' && r.pose !== want) throw new Error(`판정 ${r.pose}(펴짐 ${r.open}), 기대 ${want}`);
      return JSON.stringify(r);
    });
  }
}

await t('가짜 손으로 한 판: 손바닥 → 주먹 → 펴기 → 결과 → 다음 사람', async () => {
  await load(ORIGIN + '/'); await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); $('#btnNoCam').click(); await wait(100);`);
  const r = await ev(`const a=A(), tr=a.tracker; a.applySettings({...a.S, resultSec:3});
    assert(a.G.state==='wait','처음은 wait: '+a.G.state);
    tr.inject({present:true,x:0.5,y:0.44,open:0.95}); await until(()=>a.G.state==='ready',3000,'ready');
    assert($('#coachText').textContent.includes('주먹'),'주먹 안내');
    tr.inject({present:true,x:0.5,y:0.44,open:0.05}); await until(()=>a.G.state==='aim',3000,'aim');
    assert($('#seenPose').textContent==='주먹','판정 표시: '+$('#seenPose').textContent);
    await wait(250); window.__shotAim=1;
    return a.G.state`);
  await shot('2-aim');
  const r2 = await ev(`const a=A(), tr=a.tracker;
    tr.inject({present:true,x:0.62,y:0.3,open:0.95}); await until(()=>a.G.state==='fly'||a.G.state==='settle',3000,'발사');
    await until(()=>a.G.state==='result',9000,'결과');
    const win=a.G.win, n=a.S.segs.length; assert(win===-1||(win>=0&&win<n),'당첨 칸 '+win);
    assert(!$('#result').hidden,'결과 카드'); const name=$('#resultName').textContent, num=$('#resultNum').textContent;
    assert(win===-1||num===(win+1)+'번','번호 '+num); await wait(700); return {win,num,name}`);
  await shot('3-result');
  await ev(`const a=A(); await until(()=>a.G.state==='wait'||a.G.state==='ready',6000,'다음 차례'); assert($('#result').hidden,'결과 닫힘'); a.tracker.inject(null);`);
  noErrors('한 판'); return JSON.stringify(r2);
});

await t('손이 사라지면 다트를 놓고 처음으로', async () => {
  const r = await ev(`const a=A(), tr=a.tracker; tr.inject({present:true,x:0.5,y:0.4,open:0.9}); await until(()=>a.G.state==='ready',3000,'ready');
    tr.inject({present:true,x:0.5,y:0.4,open:0.02}); await until(()=>a.G.state==='aim',3000,'aim');
    tr.inject({present:false}); await until(()=>a.G.state==='wait',4000,'wait'); tr.inject(null); return a.G.state`);
  noErrors('놓침'); return r;
});

await t('판정: 칸 번호가 꽂힌 위치와 맞음(100번, 4·8칸)', async () => {
  return await ev(`const a=A(), G=a.G; let bad=0, bull=0; const seen=new Set();
    for (const n of [4,8,2]) { a.applySettings({...a.S, spin:0, scatter:0, bull:true, resultSec:3, segs:Array.from({length:n},(_,i)=>({name:'칸'+(i+1),color:a.S.segs[i%a.S.segs.length].color}))});
      for (let k=0;k<34;k++){ const ang=Math.random()*6.2832, rad=G.r*(0.05+0.85*Math.random()); const x=G.cx+Math.cos(ang)*rad, y=G.cy+Math.sin(ang)*rad;
        G.state='wait'; G.angle=Math.random()*6.2832; const ang0=G.angle; a.quickThrow(performance.now(),{x,y}); G.fly.dur=0; await until(()=>G.state==='settle',2000,'꽂힘');
        const local=((Math.atan2(y-G.cy,x-G.cx)-ang0+Math.PI/2)%6.2832+6.2832)%6.2832; const want=rad<G.r*0.15?-1:Math.floor(local/(6.2832/n));
        if (G.win!==want) bad++; if (G.win===-1) bull++; seen.add(n+':'+G.win); G.state='wait'; G.spinTarget=1; G.stuck=null; } }
    assert(bad===0,'어긋난 판정 '+bad); return '칸 종류 '+seen.size+'가지, 정중앙 '+bull+'번'`, 60000);
});

await t('천천히 날아가며 휘어짐: 처음엔 겨눈 쪽, 끝은 꽂힐 곳, 겨눈 곳에서 늘 벗어남', async () => {
  return await ev(`const a=A(), G=a.G; a.applySettings({...a.S, scatter:60, flight:55, spin:30}); assert(a.D.flightMs>1800&&a.D.flightMs<2100,'비행 시간 '+a.D.flightMs);
    let minOff=1e9, maxOff=0; for (let k=0;k<60;k++){ G.state='wait'; const x=G.cx+G.r*0.3, y=G.cy-G.r*0.2; a.quickThrow(performance.now(),{x,y}); const f=G.fly, off=Math.hypot(f.x1-x,f.y1-y)/G.r; minOff=Math.min(minOff,off); maxOff=Math.max(maxOff,off); assert(f.ax===x&&f.ay===y,'겨눈 곳 기록'); }
    assert(minOff>0.07&&maxOff<=0.1801,'벗어남 범위 '+minOff+'-'+maxOff);
    const t0=performance.now(); G.state='wait'; a.quickThrow(t0,{x:G.cx,y:G.cy-G.r*0.5}); await wait(500); assert(G.state==='fly','0.5초 뒤에도 날아가는 중: '+G.state);
    await until(()=>G.state==='settle',4000,'꽂힘'); const took=performance.now()-t0; assert(took>1700,'비행 시간 '+took); await until(()=>G.state==='result',4000,'결과'); a.quickThrow(performance.now());
    return '벗어남 '+minOff.toFixed(2)+'-'+maxOff.toFixed(2)+'R, 비행 '+Math.round(took)+'ms'`, 30000);
});

await t('빗나감 없음: 판 밖을 겨눠도 판 안에 꽂힘', async () => {
  return await ev(`const a=A(), G=a.G; a.applySettings({...a.S, scatter:100}); let max=0;
    for (let k=0;k<40;k++){ G.state='wait'; a.quickThrow(performance.now(),{x:G.cx+G.r*3*(Math.random()-0.5)*2,y:G.cy+G.r*3*(Math.random()-0.5)*2}); const f=G.fly; max=Math.max(max,Math.hypot(f.x1-G.cx,f.y1-G.cy)/G.r); }
    G.fly.dur=0; await until(()=>G.state==='settle',2000,'꽂힘'); await until(()=>G.state==='result',4000,'결과'); a.quickThrow(performance.now()); assert(max<=0.9401,'최대 거리 '+max); return '최대 '+max.toFixed(3)+'R'`);
});

await t('스페이스바로 던지기(대체 입력)', async () => {
  await ev(`const a=A(); await until(()=>a.G.state==='wait',6000,'wait'); a.applySettings({...a.S, resultSec:3});`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  const r = await ev(`const a=A(); await until(()=>a.G.state==='result',9000,'결과'); return $('#resultNum').textContent`);
  noErrors('스페이스'); return r;
});

await t('설정 창: 칸 추가·이름에 태그를 넣어도 글자로만 표시·저장 후 복원', async () => {
  const XSS = `"'><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">`;
  const r = await ev(`const a=A(); a.applySettings({...a.S, segs:a.S.segs.slice(0,2)}); $('#btnSet').click(); await wait(150); assert($('#sheet').open,'설정 열림');
    $('#btnAddSeg').click(); $('#btnAddSeg').click(); await wait(50); const inputs=$$('#segList input[type=text]'); assert(inputs.length===4,'칸 4개: '+inputs.length);
    inputs[0].value=${JSON.stringify(XSS)}.slice(0,20); inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
    inputs[1].value='인공지능 그림 그리기 체험'; inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
    $('#setSpin').value=55; $('#setSpin').dispatchEvent(new Event('input',{bubbles:true})); await wait(200);
    assert(!window.__xss,'스크립트 실행됨'); assert($$('#legend li').length===4,'범례 4개'); assert($('#legend img')===null,'범례에 태그 없음');
    const saved=JSON.parse(localStorage.getItem('hand-dart:v1')); assert(saved.segs.length===4&&saved.spin===55,'저장'); $('#sheet').close(); return saved.segs.map(s=>s.name).join(' | ')`);
  await load(ORIGIN + '/'); const n = await ev(`await until(()=>A(),5000,'앱'); await wait(200); return A().S.segs.length+'칸, 회전 '+A().S.spin+', xss '+(window.__xss||0)`);
  if (!n.startsWith('4칸, 회전 55, xss 0')) throw new Error('복원 실패: ' + n);
  noErrors('설정'); return r;
});

await t('8칸·긴 이름에서도 그리기 오류 없음', async () => {
  await ev(`const a=A(); $('#btnNoCam').click(); a.applySettings({...a.S, segs:Array.from({length:8},(_,i)=>({name:['로봇 코딩','AI 그림 그리기 체험관','드론','가나다라마바사아자차카타파하가나다라','VR','3D 펜','메타버스 교실','AI 작곡'][i],color:a.S.segs[0].color})), spin:30}); await wait(600);`);
  await shot('4-eight'); noErrors('8칸'); return 'ok';
});

await t('가짜 카메라로 시작: 영상 분석이 실제로 돈다', async () => {
  await ev(`localStorage.clear();`); await load(ORIGIN + '/');
  const r = await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); $('#btnStart').click(); await until(()=>$('#gate').hidden,15000,'시작'); const a=A();
    assert(a.tracker.live,'카메라 켜짐'); await until(()=>a.tracker.fps>0,15000,'분석 fps'); assert($('#cam').dataset.live==='1','카메라 칸');
    return a.tracker.delegate+' '+a.tracker.fps+'fps, '+$('#aiChipText').textContent+', 카메라 '+$$('#camSelect option').length+'개 항목'`, 50000);
  await shot('5-live'); noErrors('카메라'); noExternal(); return r;
});

await t('카메라 없이 시작한 뒤 게임 화면에서 카메라 켜기', async () => {
  await load(ORIGIN + '/');
  const r = await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); $('#btnNoCam').click(); await wait(200); const a=A();
    assert(!a.tracker.live,'처음엔 꺼짐'); assert($('#btnCamOn').offsetWidth>0,'켜기 버튼 보임'); $('#btnCamOn').click();
    await until(()=>a.tracker.live&&$('#cam').dataset.live==='1',15000,'카메라 켜짐'); await until(()=>a.tracker.fps>0,15000,'분석'); assert($('#btnCamOn').offsetWidth===0,'켜기 버튼 숨김');
    return a.tracker.fps+'fps, 안내: '+$('#coachText').textContent`, 50000);
  noErrors('카메라 켜기'); return r;
});

await t('좁은 창(1024×600)에서 가로 넘침 없음', async () => {
  await metrics(1024, 600); await sleep(400); const w = await ev(`return document.documentElement.scrollWidth+'x'+document.documentElement.scrollHeight`); await shot('6-small'); await metrics(1600, 900);
  if (w !== '1024x600') throw new Error('크기 ' + w); return w;
});

await t('오프라인 캐시: 서버를 꺼도 다시 열리고 손 인식 모델까지 불러온다', async () => {
  await load(ORIGIN + '/?sw=1');
  const n = await ev(`await navigator.serviceWorker.ready; await until(()=>navigator.serviceWorker.controller,20000,'서비스 워커'); const c=await caches.open((await caches.keys())[0]); return (await c.keys()).length`, 60000);
  if (n < 12) throw new Error('캐시된 파일 ' + n + '개');
  server.closeAllConnections(); await new Promise(r => server.close(r));
  await load(ORIGIN + '/?sw=1', 1500);
  const r = await ev(`await until(()=>A()&&A().tracker.lm,30000,'오프라인 모델'); $('#btnNoCam').click(); await wait(300); return A().tracker.delegate+', 상태 '+A().G.state+', 범례 '+$$('#legend li').length+'칸'`, 50000);
  const bad = [...new Set(errors)].filter(x => !/AudioContext|ERR_CONNECTION_REFUSED|Failed to fetch/.test(x)); if (bad.length) throw new Error(bad.join(' / '));
  return '캐시 ' + n + '개, ' + r;
});

const fail = results.filter(r => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} 통과`);
sock.close(); chrome.kill(); if (server.listening) server.close();
try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
process.exit(fail.length ? 1 : 0);
