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
  const d = await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); return A().tracker.mode + ' ' + A().tracker.delegate + ' / ' + $('#gateStatus').textContent`);
  if (!d.startsWith('worker')) throw new Error('손 인식이 별도 스레드에서 돌지 않음: ' + d);
  noErrors('로드'); noExternal(); await shot('1-gate'); return d;
});

await t('별도 스레드에서도 외부 요청이 두 겹으로 막힘(CSP 물려받음 + 요청 차단)', async () => {
  const r = await ev(`const p=await A().tracker.probe(); return p ? {csp:p.csp, evalBlocked:p.evalBlocked, patched:p.patched} : null`);
  if (!r || !r.patched || !(r.csp || r.evalBlocked)) throw new Error(JSON.stringify(r)); return JSON.stringify(r);
});

if (IMG_DIR) {
  const imgs = { 'woman_hands.jpg': 'open', 'thumbs_up.jpg': 'fist', 'victory.jpg': 'any', 'pointing_up.jpg': 'any' };
  for (const [file, want] of Object.entries(imgs)) {
    await t(`실제 사진 손 인식: ${file}`, async () => {
      const src = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(IMG_DIR, file)).toString('base64');
      const r = await ev(`const img=new Image(); img.src=${JSON.stringify(src)}; await img.decode();
        const tr=A().tracker; let r; for(let i=0;i<4;i++){ r=await tr.analyzeImage(img); await wait(20); }
        return {present:r.present, n:r.hands.length, open:r.present?+r.open.toFixed(2):null, pose:r.present?tr.pose(r.open,'none'):null, x:r.present?+r.x.toFixed(2):null}`);
      if (!r.present) throw new Error('손을 찾지 못함');
      if (want !== 'any' && r.pose !== want) throw new Error(`판정 ${r.pose}(펴짐 ${r.open}), 기대 ${want}`);
      return JSON.stringify(r);
    });
  }
}

await t('가짜 손으로 한 판: 손바닥 → 주먹 → 펴기 → 결과 → 다음 사람', async () => {
  await load(ORIGIN + '/'); await ev(`await until(()=>A()&&A().tracker.lm,30000,'모델'); $('#btnNoCam').click(); await wait(100);`);
  const r = await ev(`const a=A(), tr=a.tracker; a.applySettings({...a.S, resultSec:3, pick:false});
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

// ---------- 체험 선택 화면 ----------
// 칸 4개: 1-3번은 테스트용 체험 주소, 4번은 주소 없음. 판은 멈추고 운은 0으로 해서 겨눈 칸에 그대로 꽂히게 한다.
const PICK = `const a=A(), G=a.G, tr=a.tracker, Z={x0:0.2,x1:0.8,y0:0.14,y1:0.74};
  const setup=(o={})=>{ a.home(performance.now()); a.applySettings({...a.S, segs:[0,1,2,3].map(i=>({name:'체험'+(i+1), color:['#e9604c','#2f76d9','#2ea874','#f0b91f'][i], url:i<3?'/tests/stub.html?n='+i:'', desc:i===2?'손을 올리면 보이는 설명':''})), pick:true, resultSec:3, spin:0, scatter:0, bull:false, ...o}); };
  const throwAt=async(dx,dy)=>{ await until(()=>G.state==='wait'||G.state==='ready',8000,'wait'); G.state='wait'; G.angle=0; G.spin=0; a.quickThrow(performance.now(),{x:G.cx+G.r*dx,y:G.cy+G.r*dy}); G.fly.dur=0; await until(()=>G.state==='result',5000,'결과'); };
  const handOn=(i,open)=>{ const c=$$('#pickGrid .card')[i]; const nx=(c.offsetLeft+c.offsetWidth/2)/G.w, ny=(c.offsetTop+c.offsetHeight/2)/G.h; tr.inject({present:true,x:Z.x0+nx*(Z.x1-Z.x0),y:Z.y0+ny*(Z.y1-Z.y0),open}); };
  const frameSrc=()=>{ const f=$('#runFrame iframe'); return f?f.getAttribute('src'):null; };
  const handOff=async()=>{ tr.inject({present:false}); await wait(80); tr.inject(null); };`;

await t('선택 화면: 다트가 고른 체험을 표시하고, 손을 올려 두기만 해서는 선택되지 않고 주먹을 쥐어야 열림 → 체험 안에서 R을 누르면 처음으로', async () => {
  const r = await ev(`${PICK} setup(); await throwAt(0.4,-0.4); assert(G.win===0,'1번 칸에 꽂힘: '+G.win);
    a.quickThrow(performance.now()); await until(()=>G.state==='pick',2000,'선택 화면'); assert(!$('#pick').hidden&&$('#result').hidden,'선택 화면 보임');
    const cards=$$('#pickGrid .card'); assert(cards.length===4,'카드 4장'); assert(cards[0].classList.contains('is-rec')&&!cards[1].classList.contains('is-rec'),'다트가 고른 카드 표시');
    assert(cards[3].querySelector('.card__note').textContent.includes('부스'),'주소 없는 칸 안내'); assert($('#pickTitle').textContent.includes('체험1'),'제목: '+$('#pickTitle').textContent);
    handOn(2,0.95); await wait(500); assert(!$('#pickCursor').hidden,'손 커서 보임'); assert(cards[2].classList.contains('is-hover'),'카드 강조'); assert($('.side').offsetWidth<=1,'오른쪽 칸 숨김: '+$('.side').offsetWidth); assert($('#pickHint').textContent.includes('주먹')&&parseFloat(getComputedStyle($('#pickHint')).fontSize)>=22,'주먹 안내가 크게: '+getComputedStyle($('#pickHint')).fontSize);
    const d2=cards[2].querySelector('.card__desc'); assert(d2.textContent==='손을 올리면 보이는 설명'&&d2.offsetHeight>0,'손을 올린 카드에 설명'); assert(cards[0].querySelector('.card__desc').offsetHeight===0,'다른 카드는 설명 없음');
    window.__shotPick=1; return 'ok'`);
  await shot('7-pick');
  const r2 = await ev(`${PICK} await wait(3000); assert(G.state==='pick','손을 올려 두기만 해서는 선택되지 않음: '+G.state); const t0=performance.now(); handOn(2,0.04); await until(()=>G.state==='picked',2500,'주먹으로 선택'); const took=performance.now()-t0; assert(G.pick.chosen===2,'3번 카드 선택: '+G.pick.chosen);
    await until(()=>G.state==='run',3000,'체험 열림'); await handOff(); assert(!$('#run').hidden,'체험 틀 보임'); assert(frameSrc().endsWith('/tests/stub.html?n=2'),'주소 '+frameSrc()); assert($('#runName').textContent==='체험3','이름');
    const f=$('#runFrame iframe'); await until(()=>a.runner.keys,5000,'체험 화면의 키 받기'); window.__took=took; return 'ok'`);
  await shot('8-run');
  const r3 = await ev(`${PICK} const f=$('#runFrame iframe');
    const inp=f.contentDocument.getElementById('name'); inp.dispatchEvent(new f.contentWindow.KeyboardEvent('keydown',{code:'KeyR',key:'r',bubbles:true})); await wait(80); assert(G.state==='run','이름을 적는 중의 R은 무시');
    f.contentDocument.body.dispatchEvent(new f.contentWindow.KeyboardEvent('keydown',{code:'KeyR',key:'r',bubbles:true}));
    await until(()=>G.state==='wait',2000,'처음으로'); assert($('#run').hidden&&!$('#runFrame iframe')&&$('#pick').hidden,'체험 닫힘'); assert($('.side').offsetWidth>100,'오른쪽 칸 다시 보임');
    return '손만 올린 3.5초 동안은 그대로, 주먹을 쥔 뒤 '+Math.round(window.__took)+'ms에 선택'`);
  noErrors('선택 화면'); noExternal(); return r3;
});

await t('선택 화면: 자동으로 넘어가지 않음 → 다트가 고른 카드도 주먹을 쥐어야 열림, 아무도 없으면 처음으로', async () => {
  const r = await ev(`${PICK} setup(); await throwAt(0.4,0.4); assert(G.win===1,'2번 칸: '+G.win);
    await until(()=>G.state==='pick',6000,'결과 시간이 지나면 선택 화면'); assert($('#setPickSec')===null,'자동 입장 설정 없음');
    await wait(6000); assert(G.state==='pick'&&!a.runner.active,'6초가 지나도 그대로: '+G.state);
    // 아무도 없이 오래 지나면(20초) 처음으로 돌아간다. 기다리는 시간을 당겨서 확인한다.
    G.pick.activeAt=performance.now()-19500; await until(()=>G.state==='wait',2000,'아무도 없으면 처음으로'); assert($('#pick').hidden&&!a.runner.active,'체험은 열리지 않음');
    await throwAt(0.4,0.4); a.quickThrow(performance.now()); await until(()=>G.state==='pick',2000,'선택 화면'); const t0=performance.now();
    handOn(1,0.95); await wait(1200); handOn(1,0.04); await until(()=>G.state==='run',6000,'다트가 고른 카드에서 주먹을 쥐어 열기'); await handOff(); assert(a.runner.index===1&&frameSrc().endsWith('n=1'),'2번 체험: '+frameSrc());
    a.home(performance.now()); assert(G.state==='wait'&&!a.runner.active,'처음으로'); return '선택 화면이 뜬 뒤 '+Math.round(performance.now()-t0)+'ms에 열림'`, 40000);
  noErrors('손짓으로만 선택'); return r;
});

await t('선택 화면: 주먹을 쥐면 바로 선택, 주소 없는 칸은 안내만 하고 처음으로', async () => {
  const r = await ev(`${PICK} setup(); await throwAt(0.4,-0.4); a.quickThrow(performance.now()); await until(()=>G.state==='pick',2000,'선택 화면');
    handOn(3,0.95); await wait(1000); assert(G.state==='pick','아직 선택 전'); const t0=performance.now(); handOn(3,0.04);
    await until(()=>G.state==='picked',2500,'주먹으로 선택'); const took=performance.now()-t0; assert(G.pick.chosen===3,'4번 카드'); await handOff();
    assert($('#pickTitle').textContent.includes('부스 안에서'),'안내: '+$('#pickTitle').textContent);
    await until(()=>G.state==='wait',6000,'처음으로'); assert(!a.runner.active&&$('#run').hidden,'체험은 열리지 않음'); return '주먹 뒤 '+Math.round(took)+'ms'`);
  noErrors('주먹 선택'); return r;
});

await t('도우미 키: F2로 체험 바로 열기, "처음으로" 버튼, 열 수 없는 주소는 무시', async () => {
  await ev(`${PICK} setup(); await until(()=>G.state==='wait'||G.state==='ready',8000,'wait');`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'F2', key: 'F2', windowsVirtualKeyCode: 113 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F2', key: 'F2', windowsVirtualKeyCode: 113 });
  const r = await ev(`${PICK} await until(()=>G.state==='run',3000,'F2'); assert(a.runner.index===1&&frameSrc().endsWith('n=1'),'2번 체험'); $('#btnHome').click(); assert(G.state==='wait'&&!$('#runFrame iframe'),'버튼으로 처음으로');
    const m=await import('/js/settings.js'); const bad=['javascript:alert(1)','data:text/html,<b>x</b>','  ','file:///c:/x.html'].filter(u=>m.openUrl(u)!=='');
    assert(!bad.length,'열면 안 되는 주소: '+bad); assert(m.openUrl('example.com/app')==='https://example.com/app','앞을 뺀 주소'); assert(m.openUrl('localhost:8000/x')==='http://localhost:8000/x','localhost');
    a.applySettings({...a.S, segs:a.S.segs.map((g,i)=>i?g:{...g,url:'javascript:window.__xss=1'})}); assert(a.jump(0,performance.now())===false&&G.state==='wait'&&!window.__xss,'위험한 주소는 열지 않음');
    const old=m.sanitize({v:2,segs:[1,2,3,4].map(i=>({name:'체험 '+i,color:m.PALETTE[i-1]}))}), mine=m.sanitize({v:2,segs:[{name:'로봇',color:m.PALETTE[0]},{name:'드론',color:m.PALETTE[1]}]});
    assert(old.segs[0].name==='AI 코딩 공방'&&old.segs.every(g=>g.url&&g.desc),'이름을 안 바꾼 예전 설정은 새 기본 칸으로'); const prev=m.sanitize({v:3,segs:['코딩공방','시선추적','거북목','관상'].map((n,i)=>({name:n,color:m.PALETTE[i],url:m.defaults().segs[i].url}))}); assert(prev.segs[3].name==='AI가 알려주는 관상'&&prev.segs[1].name==='집중력 레벨 테스트'&&prev.segs[1].desc,'예전 기본 칸도 새 이름으로: '+prev.segs.map(g=>g.name)); const long=m.sanitize({v:4,segs:m.defaults().segs.map((g,i)=>i===1?{...g,name:'시선추적 집중력 레벨 테스트'}:g)}); assert(long.segs[1].name==='집중력 레벨 테스트','긴 예전 이름도 줄인 이름으로: '+long.segs[1].name); assert(mine.segs.length===2&&mine.segs[0].name==='로봇'&&mine.segs[0].url==='','직접 적은 칸은 그대로');
    return old.segs.map(g=>g.name).join('·')`);
  noErrors('도우미 키'); noExternal(); return r;
});

await t('선택 화면을 끄면 예전처럼 결과 뒤에 바로 다음 사람', async () => {
  const r = await ev(`${PICK} setup({pick:false}); await throwAt(0.4,-0.4); await until(()=>G.state==='wait'||G.state==='ready',6000,'다음 차례'); assert($('#pick').hidden&&!a.runner.active,'선택 화면 없음'); return G.state`);
  noErrors('선택 화면 끔'); return r;
});

await t('설정 창: 칸 추가·이름에 태그를 넣어도 글자로만 표시·저장 후 복원', async () => {
  const XSS = `"'><img src=x onerror="window.__xss=1"><svg onload="window.__xss=1">`;
  const r = await ev(`const a=A(); a.applySettings({...a.S, segs:a.S.segs.slice(0,2)}); $('#btnSet').click(); await wait(150); assert($('#sheet').open,'설정 열림');
    $('#btnAddSeg').click(); $('#btnAddSeg').click(); await wait(50); const inputs=$$('#segList input[type=text]:not(.segs__url):not(.segs__desc)'); assert(inputs.length===4,'칸 4개: '+inputs.length); assert($$('#segList .segs__url').length===4&&$$('#segList .segs__desc').length===4,'칸마다 설명·주소 칸');
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

await t('화면 부드러움: 카메라를 분석하는 중에도 프레임이 밀리지 않음(판 회전 최고 속도)', async () => {
  const r = await ev(`const a=A(); a.applySettings({...a.S, spin:100}); await wait(600); const ts=[]; await new Promise(res=>{const f=t=>{ts.push(t); if(ts.length<181) requestAnimationFrame(f); else res();}; requestAnimationFrame(f);});
    const d=ts.slice(1).map((t,i)=>t-ts[i]); const avg=d.reduce((x,y)=>x+y,0)/d.length, worst=Math.max(...d), slow=d.filter(x=>x>34).length;
    return {avg:+avg.toFixed(1), worst:+worst.toFixed(1), slow, frames:d.length, ai:a.tracker.fps, mode:a.tracker.mode||'main'}`, 90000);
  // 손 인식이 별도 스레드에서 돌면 느린 프레임(34ms 초과)이 열에 하나를 넘지 않아야 한다.
  if (r.mode === 'worker' && r.slow > r.frames * 0.1) throw new Error('느린 프레임 ' + r.slow + '/' + r.frames + ' ' + JSON.stringify(r));
  return JSON.stringify(r);
});

await t('체험이 열려 있는 동안 다트 카메라를 끄고, 처음으로 돌아오면 다시 켬', async () => {
  const r = await ev(`const a=A(), G=a.G; a.applySettings({...a.S, spin:30, segs:a.S.segs.map((g,i)=>({...g,url:i?'':'/tests/stub.html'}))}); assert(a.tracker.live,'카메라 켜져 있음');
    assert(a.jump(0,performance.now()),'체험 열기'); assert(!a.tracker.live&&$('#cam').dataset.live==='0'&&G.state==='run','카메라 꺼짐');
    a.home(performance.now()); await until(()=>a.tracker.live&&$('#cam').dataset.live==='1',15000,'카메라 다시 켜짐'); await until(()=>a.tracker.fps>0,15000,'분석'); return G.state+', '+a.tracker.fps+'fps'`, 50000);
  noErrors('카메라 되돌리기'); noExternal(); return r;
});

await t('MR 선택 화면: 카메라가 켜져 있으면 영상 위에 카드가 뜨고, 커서가 영상 속 손 위치에 놓임', async () => {
  const r = await ev(`${PICK} assert(tr.live,'카메라 켜져 있음'); const m=await import('/js/settings.js'); setup({segs:m.defaults().segs.map((g,i)=>({...g,url:i<3?'/tests/stub.html?n='+i:''}))}); await throwAt(0.4,-0.4); a.quickThrow(performance.now()); await until(()=>G.state==='pick',2000,'선택 화면');
    const p=$('#pick'), v=$('#pickVideo'); assert(p.dataset.mr==='1','MR 모드'); await until(()=>v.videoWidth>0&&!v.paused,5000,'배경 영상 재생'); assert(getComputedStyle(v).display!=='none','영상 보임');
    const vw=tr.video.videoWidth, vh=tr.video.videoHeight, s=Math.max(G.w/vw,G.h/vh), mx=(G.w-vw*s)/2, my=(G.h-vh*s)/2;
    const g=$('#pickGrid'), zl=mx+Z.x0*vw*s, zr=mx+Z.x1*vw*s, zb=my+Z.y1*vh*s;
    assert(g.offsetLeft>=zl-2&&g.offsetLeft+g.offsetWidth<=zr+2&&g.offsetTop+g.offsetHeight<=zb+2,'카드가 손이 잘 잡히는 영역 안: '+[g.offsetLeft,g.offsetLeft+g.offsetWidth,g.offsetTop+g.offsetHeight,zl,zr,zb].map(Math.round));
    const t1=tr.lastT; await wait(900); assert(tr.lastT!==t1,'오른쪽 칸을 숨겨도 영상 분석은 계속');
    const c=$$('#pickGrid .card')[3], cx=c.offsetLeft+c.offsetWidth/2, cy=c.offsetTop+c.offsetHeight/2;
    window.__mrHand={x:(cx-mx)/(vw*s),y:(cy-my)/(vh*s)}; tr.inject({present:true,...window.__mrHand,open:0.95}); await wait(600);
    assert(Math.abs(G.pick.cur.x-cx)<6&&Math.abs(G.pick.cur.y-cy)<6,'커서가 손 위치에: '+Math.round(G.pick.cur.x)+','+Math.round(G.pick.cur.y)+' / '+Math.round(cx)+','+Math.round(cy)); assert(c.classList.contains('is-hover'),'카드 강조');
    return vw+'x'+vh+' 영상, 카드 영역 '+Math.round(g.offsetWidth)+'x'+Math.round(g.offsetHeight)`);
  await shot('9-mr');
  await ev(`${PICK} tr.inject({present:true,...window.__mrHand,open:0.04}); await until(()=>G.state==='picked',3000,'주먹으로 선택'); assert(G.pick.chosen===3,'4번 카드'); await handOff();
    await until(()=>G.state==='wait',6000,'처음으로'); assert($('#pick').dataset.mr==='0'&&!$('#pickVideo').srcObject,'배경 영상 정리'); return 'ok'`);
  noErrors('MR 선택 화면'); noExternal(); return r;
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
  if (n < 13) throw new Error('캐시된 파일 ' + n + '개');
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
