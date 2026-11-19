// 효과음: 파일 없이 Web Audio로 만든다. 브라우저 정책 때문에 운영자가 시작 버튼을 누른 뒤에만 소리가 난다.
let ac = null, on = true;
export function unlock() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { ac = null; } }
export function setSound(v) { on = !!v; }

function tone(freq, t0, dur, { type = 'sine', gain = 0.18, to = null } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, { gain = 0.2, from = 400, to = 2400 } = {}) {
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(from, t0); f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(ac.destination); s.start(t0);
}
const play = fn => { if (!on || !ac || ac.state !== 'running') return; try { fn(ac.currentTime + 0.01); } catch { /* 소리는 없어도 진행한다 */ } };

export const sfx = {
  seen: () => play(t => { tone(660, t, 0.09, { type: 'triangle', gain: 0.1 }); tone(880, t + 0.08, 0.12, { type: 'triangle', gain: 0.1 }); }),
  grab: () => play(t => { tone(300, t, 0.07, { type: 'square', gain: 0.07 }); tone(520, t + 0.05, 0.09, { type: 'square', gain: 0.07 }); }),
  drop: () => play(t => tone(260, t, 0.16, { type: 'triangle', gain: 0.08, to: 150 })),
  // sec: 다트가 날아가는 시간. 길면 바람 소리도 길게, 멀어지듯 낮아진다.
  throw: (sec = 0.4) => play(t => { noise(t, 0.3, { gain: 0.22, from: 500, to: 3200 }); if (sec > 0.7) noise(t + 0.2, Math.min(2.6, sec - 0.2), { gain: 0.07, from: 2400, to: 500 }); }),
  thunk: () => play(t => { tone(150, t, 0.2, { gain: 0.4, to: 55 }); noise(t, 0.06, { gain: 0.18, from: 1800, to: 900 }); }),
  win: () => play(t => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.11, i === 3 ? 0.5 : 0.16, { type: 'triangle', gain: 0.16 }))),
};
