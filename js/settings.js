// 운영자 설정: 이 브라우저의 localStorage에만 저장한다.
const KEY = 'hand-dart:v1';
export const PALETTE = ['#e9604c', '#2f76d9', '#2ea874', '#f0b91f', '#8e63d6', '#ef8433', '#22a7b8', '#e05c9f'];
export const MIN_SEGS = 2, MAX_SEGS = 8;

// 처음 켰을 때의 칸. 주소가 있는 칸은 선택 화면에서 고르면 그 체험이 이 화면 안에서 열린다.
// desc: 선택 화면에서 그 카드에 손을 올리면 보여 주는 한 줄 설명
const FIRST_SEGS = [
  { name: 'AI 코딩 공방', desc: '만들고 싶은 앱을 고르면 AI가 뚝딱 만들어 줘요', url: 'https://bin7335.github.io/vibe-taste/' },
  { name: '집중력 레벨 테스트', desc: '눈으로 구슬을 따라가며 내 집중력 레벨을 확인해요', url: 'https://bin7335.github.io/eye-tracking/' },
  { name: '거북목 자세 진단', desc: 'AI가 내 목과 어깨 자세를 살펴 줘요', url: 'https://anstjd-cyber.github.io/posture/booth/' }, // 측정 화면으로 바로 들어간다
  { name: 'AI가 알려주는 관상', desc: 'AI가 내 얼굴을 보고 재미로 관상을 풀어 줘요', url: 'https://tmdry1999-lgtm.github.io/gwan-sang/' },
];
const OLD_NAMES = [['코딩공방'], ['시선추적', '시선추적 집중력 레벨 테스트'], ['거북목'], ['관상']]; // 예전 버전의 기본 이름
const URL_MAX = 300, DESC_MAX = 60;

// 운영자가 적은 주소를 실제로 열 주소로 바꾼다. http·https가 아니면 빈 글자를 돌려준다(javascript: 같은 주소는 열지 않는다).
export function openUrl(v) {
  let t = String(v == null ? '' : v).trim().slice(0, URL_MAX); if (!t) return '';
  if (/^(localhost|127\.0\.0\.1)([:/]|$)/i.test(t)) t = 'http://' + t;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[\w-]+(\.[\w-]+)+([/:?#]|$)/.test(t) && !/\.html?$/i.test(t.split(/[/?#]/)[0])) t = 'https://' + t; // "example.com/app"처럼 앞을 빼고 적은 주소
  try { const u = new URL(t, location.href); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
}

export function defaults() {
  return {
    v: 4,
    segs: FIRST_SEGS.map((g, i) => ({ ...g, color: PALETTE[i] })),
    pick: true,     // 다트 뒤에 체험 선택 화면 보여 주기(주소가 적힌 칸이 하나라도 있을 때)
    spin: 30,       // 판 회전 속도 0-100
    scatter: 60,    // 운의 크기 0-100
    flight: 55,     // 다트가 날아가는 시간 0(빠르게)-100(아주 천천히)
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
    url: String(g && g.url != null ? g.url : '').trim().slice(0, URL_MAX),
    desc: String(g && g.desc != null ? g.desc : '').slice(0, DESC_MAX),
  })) : d.segs;
  if (segs.length < MIN_SEGS) segs = d.segs;
  // 예전 버전에서 칸 이름을 한 번도 안 바꿨으면("체험 1"…) 새 기본 칸(이름·설명·주소)으로 바꾼다. 직접 적은 칸은 그대로 둔다.
  if (s.v !== 4 && segs.length === d.segs.length && segs.every((g, i) => !g.url && (!g.name.trim() || g.name.trim() === '체험 ' + (i + 1)))) segs = d.segs;
  // 예전 기본 이름·주소 그대로인 칸은 지금의 기본 이름·설명으로 바꾼다(색은 그대로).
  segs = segs.map((g, i) => OLD_NAMES[i] && d.segs[i] && g.url === d.segs[i].url && OLD_NAMES[i].includes(g.name.trim()) ? { ...d.segs[i], color: g.color } : g);
  return {
    segs,
    v: 4,
    pick: typeof s.pick === 'boolean' ? s.pick : d.pick,
    // v1에서 저장한 값이 예전 기본값(40)이면 새 기본값으로 올린다. 직접 바꾼 값은 그대로 둔다.
    spin: clamp(s.spin, 0, 100, d.spin), scatter: s.v == null && Number(s.scatter) === 40 ? d.scatter : clamp(s.scatter, 0, 100, d.scatter), lenient: clamp(s.lenient, 0, 100, d.lenient),
    flight: clamp(s.flight, 0, 100, d.flight),
    bull: typeof s.bull === 'boolean' ? s.bull : d.bull,
    resultSec: clamp(s.resultSec, 3, 15, d.resultSec),
    sound: typeof s.sound === 'boolean' ? s.sound : d.sound,
    camId: typeof s.camId === 'string' ? s.camId : '',
  };
}
export function loadSettings() { try { return sanitize(JSON.parse(localStorage.getItem(KEY))); } catch { return defaults(); } }
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장이 막혀도 이번 실행은 그대로 쓴다 */ } }
export const segName = (s, i) => (s.segs[i].name || '').trim() || '체험 ' + (i + 1);
export const segDesc = (s, i) => s.segs[i] ? (s.segs[i].desc || '').trim() : '';
export const segUrl = (s, i) => s.segs[i] ? openUrl(s.segs[i].url) : '';
// 선택 화면을 쓸지: 켜져 있고, 열 수 있는 주소가 적힌 칸이 하나라도 있을 때
export const usesPick = s => !!s.pick && s.segs.some((g, i) => segUrl(s, i));

// 설정 숫자를 실제 게임 값으로 바꾼다.
export function derive(s) {
  const g = s.lenient / 100;
  return {
    spinRad: (s.spin / 100) * 1.6,              // 초당 라디안. 100이면 약 4초에 한 바퀴
    scatter: (s.scatter / 100) * 0.3,           // 판 반지름 대비 흩어짐
    flightMs: 400 + 28 * s.flight,              // 0.4초-3.2초. 길수록 판이 더 돌아가서 운이 커진다
    fistBelow: 0.22 + 0.2 * g,                  // 펴진 정도가 이 값보다 작으면 주먹
    openAbove: 0.74 - 0.2 * g,                  // 이 값보다 크면 손바닥
    grabHoldMs: 420 - 280 * g,                  // 주먹을 이만큼 유지해야 다트를 잡는다
    releaseHoldMs: 110 - 60 * g,
    minAimMs: 450,
  };
}
const SPIN_WORD = v => v === 0 ? '멈춤' : v < 25 ? '아주 천천히' : v < 50 ? '천천히' : v < 75 ? '보통' : '빠르게';
const SCATTER_WORD = v => v === 0 ? '겨눈 대로' : v < 35 ? '조금' : v < 70 ? '반쯤 운' : '거의 운';
const FLIGHT_WORD = v => v < 20 ? '빠르게' : v < 45 ? '보통' : v < 75 ? '천천히' : '아주 천천히';
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
      const link = document.createElement('input'); link.type = 'text'; link.className = 'segs__url'; link.maxLength = URL_MAX; link.value = g.url || ''; link.placeholder = '체험 주소 (비워 두면 선택 화면에서 안내만 해요)'; link.inputMode = 'url'; link.spellcheck = false; link.setAttribute('aria-label', `${i + 1}번 칸 체험 주소`);
      const mark = () => { link.dataset.bad = link.value.trim() && !openUrl(link.value) ? '1' : '0'; };
      link.addEventListener('input', () => { commit(st => { st.segs[i].url = link.value; }); mark(); }); mark();
      const desc = document.createElement('input'); desc.type = 'text'; desc.className = 'segs__desc'; desc.maxLength = DESC_MAX; desc.value = g.desc || ''; desc.placeholder = '한 줄 설명 (선택 화면에서 손을 올리면 보여요)'; desc.setAttribute('aria-label', `${i + 1}번 칸 설명`);
      desc.addEventListener('input', () => commit(st => { st.segs[i].desc = desc.value; }));
      li.append(num, sw, inp, del, desc, link); list.append(li);
    });
    $('btnAddSeg').disabled = s.segs.length >= MAX_SEGS;
  }
  function renderValues() {
    const s = get();
    $('setSpin').value = s.spin; $('outSpin').textContent = SPIN_WORD(s.spin);
    $('setScatter').value = s.scatter; $('outScatter').textContent = SCATTER_WORD(s.scatter);
    $('setFlight').value = s.flight; $('outFlight').textContent = FLIGHT_WORD(s.flight);
    $('setLenient').value = s.lenient; $('outLenient').textContent = LENIENT_WORD(s.lenient);
    $('setResult').value = s.resultSec; $('outResult').textContent = s.resultSec + '초';
    $('setBull').checked = s.bull; $('setSound').checked = s.sound;
    $('setPick').checked = s.pick;
  }
  const range = (id, key) => $(id).addEventListener('input', e => { commit(st => { st[key] = Number(e.target.value); }); renderValues(); });
  range('setSpin', 'spin'); range('setScatter', 'scatter'); range('setLenient', 'lenient'); range('setFlight', 'flight'); range('setResult', 'resultSec');
  $('setPick').addEventListener('change', e => commit(st => { st.pick = e.target.checked; }));
  $('setBull').addEventListener('change', e => commit(st => { st.bull = e.target.checked; }));
  $('setSound').addEventListener('change', e => commit(st => { st.sound = e.target.checked; }));
  $('btnAddSeg').addEventListener('click', () => {
    commit(st => { if (st.segs.length < MAX_SEGS) { const used = st.segs.map(g => g.color); st.segs.push({ name: '체험 ' + (st.segs.length + 1), desc: '', url: '', color: PALETTE.find(c => !used.includes(c)) || PALETTE[st.segs.length % PALETTE.length] }); } });
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
