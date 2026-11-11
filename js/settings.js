// 운영자 설정: 이 브라우저의 localStorage에만 저장한다.
const KEY = 'hand-dart:v1';
export const PALETTE = ['#e9604c', '#2f76d9', '#2ea874', '#f0b91f', '#8e63d6', '#ef8433', '#22a7b8', '#e05c9f'];
export const MIN_SEGS = 2, MAX_SEGS = 8;

export function defaults() {
  return {
    segs: [1, 2, 3, 4].map(i => ({ name: '체험 ' + i, color: PALETTE[i - 1] })),
    spin: 30,       // 판 회전 속도 0-100
    scatter: 40,    // 운의 크기 0-100
    lenient: 70,    // 손동작 판정 0(엄격)-100(후하게)
    bull: true,     // 정중앙 자유 선택
    resultSec: 7,
    sound: true,
    camId: '',
  };
}
const clamp = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };

export function sanitize(raw) {
  const d = defaults(), s = raw && typeof raw === 'object' ? raw : {};
  let segs = Array.isArray(s.segs) ? s.segs.slice(0, MAX_SEGS).map((g, i) => ({
    name: String(g && g.name != null ? g.name : '').slice(0, 20),
    color: PALETTE.includes(g && g.color) ? g.color : PALETTE[i % PALETTE.length],
  })) : d.segs;
  if (segs.length < MIN_SEGS) segs = d.segs;
  return {
    segs,
    spin: clamp(s.spin, 0, 100, d.spin), scatter: clamp(s.scatter, 0, 100, d.scatter), lenient: clamp(s.lenient, 0, 100, d.lenient),
    bull: typeof s.bull === 'boolean' ? s.bull : d.bull,
    resultSec: clamp(s.resultSec, 3, 15, d.resultSec),
    sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
    camId: typeof s.camId === 'string' ? s.camId : '',
  };
}
export function loadSettings() { try { return sanitize(JSON.parse(localStorage.getItem(KEY))); } catch { return defaults(); } }
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장이 막혀도 이번 실행은 그대로 쓴다 */ } }
export const segName = (s, i) => (s.segs[i].name || '').trim() || '체험 ' + (i + 1);

// 설정 숫자를 실제 게임 값으로 바꾼다.
export function derive(s) {
  const g = s.lenient / 100;
  return {
    spinRad: (s.spin / 100) * 1.6,              // 초당 라디안. 100이면 약 4초에 한 바퀴
    scatter: (s.scatter / 100) * 0.3,           // 판 반지름 대비 흩어짐
    fistBelow: 0.22 + 0.2 * g,                  // 펴진 정도가 이 값보다 작으면 주먹
    openAbove: 0.74 - 0.2 * g,                  // 이 값보다 크면 손바닥
    grabHoldMs: 420 - 280 * g,                  // 주먹을 이만큼 유지해야 다트를 잡는다
    releaseHoldMs: 110 - 60 * g,
    minAimMs: 450,
  };
}
const SPIN_WORD = v => v === 0 ? '멈춤' : v < 25 ? '아주 천천히' : v < 50 ? '천천히' : v < 75 ? '보통' : '빠르게';
const SCATTER_WORD = v => v === 0 ? '겨눈 대로' : v < 35 ? '조금' : v < 70 ? '반쯤 운' : '거의 운';
const LENIENT_WORD = v => v < 30 ? '엄격하게' : v < 65 ? '보통' : '후하게';

// 설정 창. onChange(settings)는 값이 바뀔 때마다 불린다(바로 반영·저장).
export function bindSettings({ dialog, get, set, cameras, onCamera }) {
  const $ = id => dialog.querySelector('#' + id);
  const list = $('segList');
  const commit = mut => { const s = get(); mut(s); set(sanitize(s)); };

  function renderSegs() {
    const s = get(); list.textContent = '';
    $('segCount').textContent = `${s.segs.length}칸 (2-8칸)`;
    s.segs.forEach((g, i) => {
      const li = document.createElement('li');
      const num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1;
      const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'swatch'; sw.style.background = g.color; sw.title = '색 바꾸기';
      sw.addEventListener('click', () => { commit(st => { st.segs[i].color = PALETTE[(PALETTE.indexOf(st.segs[i].color) + 1) % PALETTE.length]; }); renderSegs(); });
      const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 20; inp.value = g.name; inp.placeholder = '체험 ' + (i + 1); inp.setAttribute('aria-label', `${i + 1}번 칸 이름`);
      inp.addEventListener('input', () => commit(st => { st.segs[i].name = inp.value; }));
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn--small'; del.textContent = '빼기'; del.disabled = s.segs.length <= MIN_SEGS;
      del.addEventListener('click', () => { commit(st => { st.segs.splice(i, 1); }); renderSegs(); });
      li.append(num, sw, inp, del); list.append(li);
    });
    $('btnAddSeg').disabled = s.segs.length >= MAX_SEGS;
  }
  function renderValues() {
    const s = get();
    $('setSpin').value = s.spin; $('outSpin').textContent = SPIN_WORD(s.spin);
    $('setScatter').value = s.scatter; $('outScatter').textContent = SCATTER_WORD(s.scatter);
    $('setLenient').value = s.lenient; $('outLenient').textContent = LENIENT_WORD(s.lenient);
    $('setResult').value = s.resultSec; $('outResult').textContent = s.resultSec + '초';
    $('setBull').checked = s.bull; $('setSound').checked = s.sound;
  }
  const range = (id, key) => $(id).addEventListener('input', e => { commit(st => { st[key] = Number(e.target.value); }); renderValues(); });
  range('setSpin', 'spin'); range('setScatter', 'scatter'); range('setLenient', 'lenient'); range('setResult', 'resultSec');
  $('setBull').addEventListener('change', e => commit(st => { st.bull = e.target.checked; }));
  $('setSound').addEventListener('change', e => commit(st => { st.sound = e.target.checked; }));
  $('btnAddSeg').addEventListener('click', () => {
    commit(st => { if (st.segs.length < MAX_SEGS) { const used = st.segs.map(g => g.color); st.segs.push({ name: '체험 ' + (st.segs.length + 1), color: PALETTE.find(c => !used.includes(c)) || PALETTE[st.segs.length % PALETTE.length] }); } });
    renderSegs();
  });
  $('btnReset').addEventListener('click', () => { const cam = get().camId; set({ ...defaults(), camId: cam }); renderSegs(); renderValues(); });
  $('camSelect2').addEventListener('change', e => { commit(st => { st.camId = e.target.value; }); onCamera(e.target.value); });

  return {
    open() { renderSegs(); renderValues(); fillCameras($('camSelect2'), cameras(), get().camId); if (!dialog.open) dialog.showModal(); },
  };
}

export function fillCameras(select, list, current) {
  select.textContent = '';
  const first = document.createElement('option'); first.value = ''; first.textContent = '기본 카메라'; select.append(first);
  list.forEach((c, i) => { const o = document.createElement('option'); o.value = c.deviceId; o.textContent = c.label || `카메라 ${i + 1}`; select.append(o); });
  select.value = list.some(c => c.deviceId === current) ? current : '';
}
