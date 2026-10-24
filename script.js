/* =====================================================================
   CONFIGURAÇÃO DA MÚSICA
   Coloque aqui o caminho da sua música (ex.: 'musica.mp3' na mesma pasta
   do site, ou uma URL). Deixe vazio para usar a trilha sintetizada.
   O visitante também pode carregar um arquivo pelo botão "Sua música".
   ===================================================================== */
const CONFIG = { musicUrl: '' };

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = id => document.getElementById(id);

/* ============================ SOM ============================ */
const Sound = (() => {
  let ctx = null, master, analyser, delayIn, revIn, noiseBuf, freq, timer = null;
  let running = false, muted = false, level = 0, nextTime = 0, step = 0;
  let mediaEl = null, mediaFilter = null, custom = false, customLabel = '';
  let avgBass = 0.2, lastOnset = 0, onChange = () => {};
  const BPM = 96, S16 = 60 / BPM / 4, events = [];
  const PROGS = [
    { ch: [[57,60,64],[53,57,60],[48,52,55],[55,59,62]], rt: [45,41,36,43] }, // Am F C G
    { ch: [[57,60,64],[52,55,59],[53,57,60],[55,59,62]], rt: [45,40,41,43] }, // Am Em F G
    { ch: [[50,53,57],[46,50,53],[53,57,60],[48,52,55]], rt: [38,34,41,36] }, // Dm Bb F C
    { ch: [[57,60,64],[55,59,62],[53,57,60],[52,56,59]], rt: [45,43,41,40] }  // Am G F E
  ];
  let CH = PROGS[0].ch, RT = PROGS[0].rt, tr = 0, pendingVar = null;
  const ARP = [0,1,2,1,2,1,0,1];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function ensure(){
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5;
    analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.7;
    freq = new Uint8Array(analyser.frequencyBinCount);
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    delayIn = ctx.createGain(); delayIn.gain.value = 0.45;
    const d = ctx.createDelay(1.5); d.delayTime.value = S16 * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    delayIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
    revIn = ctx.createGain(); revIn.gain.value = 0.5;
    const cv = ctx.createConvolver(); cv.buffer = impulse(3.2, 2.4);
    revIn.connect(cv); cv.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }
  function impulse(sec, decay){
    const r = ctx.sampleRate, len = Math.floor(r * sec), b = ctx.createBuffer(2, len, r);
    for (let c = 0; c < 2; c++){ const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random()*2-1) * Math.pow(1 - i/len, decay); }
    return b;
  }
  function env(g, t, a, peak, d){ g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  function pad(t, notes, dur){
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(level ? 1700 : 1100, t + dur * .5); f.frequency.linearRampToValueAtTime(600, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.055, t + 0.9);
    g.gain.setValueAtTime(0.055, t + dur - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    f.connect(g); g.connect(master); g.connect(revIn);
    notes.forEach(n => [-8, 8].forEach(dt => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = dt; o.connect(f); o.start(t); o.stop(t + dur + 1.3); }));
  }
  function arp(t, n, vol){
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(n);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    const g = ctx.createGain(); env(g, t, 0.005, vol, 0.28);
    o.connect(f); f.connect(g); g.connect(master); g.connect(delayIn); o.start(t); o.stop(t + 0.36);
  }
  function bass(t, n){
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.18);
    const g = ctx.createGain(); env(g, t, 0.004, 0.22, 0.2);
    o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.27);
  }
  function kick(t){
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.45);
  }
  function noise(t, dur, type, fq, vol, toRev){
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = fq;
    const g = ctx.createGain(); env(g, t, 0.002, vol, dur);
    s.connect(f); f.connect(g); g.connect(master); if (toRev) g.connect(revIn); s.start(t); s.stop(t + dur + 0.05);
  }
  function snare(t){
    noise(t, 0.22, 'highpass', 1400, 0.3, true);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain(); env(g, t, 0.002, 0.22, 0.1); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.15);
  }
  function hat(t, open){ noise(t, open ? 0.16 : 0.045, 'highpass', 7500, open ? 0.07 : 0.05, false); }

  function playStep(s, t){
    if ((s & 15) === 0 && pendingVar){ CH = PROGS[pendingVar[0]].ch; RT = PROGS[pendingVar[0]].rt; tr = pendingVar[1]; pendingVar = null; }
    const bar = (s >> 4) & 3, b = s & 15, ch = CH[bar].map(n => n + tr);
    if (b === 0){ pad(t, ch, S16 * 16); events.push({ t, type: 'bar', bar }); }
    if (b % 2 === 0) arp(t, ch[ARP[b >> 1]] + 12 + (b === 14 ? 12 : 0), level ? 0.05 : 0.04);
    if (level >= 2 && (b === 0 || b === 6 || b === 10)) lead(t, b === 0 ? ch[2] + 12 : b === 6 ? ch[1] + 12 : ch[0] + 24);
    if (level > 0){
      if (b % 4 === 0){ kick(t); events.push({ t, type: 'kick' }); }
      if (b === 4 || b === 12){ snare(t); events.push({ t, type: 'snare' }); }
      if (b % 4 === 2) hat(t, b === 14);
      if (b % 2 === 0 || b === 7 || b === 15) bass(t, RT[bar] + tr + (b % 4 === 2 ? 12 : 0));
    }
  }
  function lead(t, n){
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5; const lg = ctx.createGain(); lg.gain.value = 6; lfo.connect(lg); lg.connect(o.detune);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 3;
    const g = ctx.createGain(); env(g, t, 0.03, 0.05, 0.9);
    o.connect(f); f.connect(g); g.connect(master); g.connect(delayIn); g.connect(revIn);
    o.start(t); lfo.start(t); o.stop(t + 1); lfo.stop(t + 1);
  }
  function tick(){ while (nextTime < ctx.currentTime + 0.12){ playStep(step, nextTime); nextTime += S16; step = (step + 1) & 63; } }
  function startSynth(){ if (timer) return; nextTime = ctx.currentTime + 0.08; step = 0; timer = setInterval(tick, 25); tick(); }
  function stopSynth(){ clearInterval(timer); timer = null; events.length = 0; }

  function start(){
    if (!ensure()) return;
    ctx.resume();
    if (running) return;
    running = true;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.85, now + 1.5);
    if (custom) mediaEl.play().catch(fallback); else startSynth();
    onChange();
  }
  function fallback(){
    if (!custom) return;
    custom = false; customLabel = '';
    if (mediaEl) mediaEl.pause();
    if (running && ctx) startSynth();
    onChange();
  }
  function useTrack(url, label){
    if (!ensure()) return;
    if (!mediaEl){
      mediaEl = new window.Audio(); mediaEl.loop = true; mediaEl.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(mediaEl);
      mediaFilter = ctx.createBiquadFilter(); mediaFilter.type = 'lowpass';
      mediaFilter.frequency.value = level ? 20000 : 900;
      src.connect(mediaFilter); mediaFilter.connect(master);
      mediaEl.addEventListener('error', fallback);
    }
    stopSynth();
    custom = true; customLabel = label;
    mediaEl.src = url;
    if (running) mediaEl.play().catch(fallback);
    onChange();
  }
  function setLevel(l){
    level = l;
    if (mediaFilter && ctx){ const t = ctx.currentTime; mediaFilter.frequency.cancelScheduledValues(t); mediaFilter.frequency.setValueAtTime(mediaFilter.frequency.value, t); mediaFilter.frequency.exponentialRampToValueAtTime(l ? 20000 : 900, t + (l ? 1.6 : 0.8)); }
  }
  function setVariation(prog, transpose){ pendingVar = [prog % PROGS.length, transpose]; }
  function setMuted(m){
    muted = m; if (!ctx) return;
    const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(m ? 0 : 0.85, t + 0.4);
    onChange();
  }
  function whoosh(){
    if (!ctx || !running) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    s.connect(f); f.connect(g); g.connect(master); g.connect(revIn); s.start(t); s.stop(t + 2.3);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t + 1.3); o.frequency.exponentialRampToValueAtTime(30, t + 2.6);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t + 1.3); g2.gain.exponentialRampToValueAtTime(0.6, t + 1.35); g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(g2); g2.connect(master); o.start(t + 1.3); o.stop(t + 2.9);
  }
  function energy(){
    if (!ctx || !running) return 0;
    analyser.getByteFrequencyData(freq);
    let s = 0; for (let i = 1; i < 7; i++) s += freq[i];
    return s / (6 * 255);
  }
  function poll(cb){
    if (!ctx || !running) return;
    const now = ctx.currentTime;
    while (events.length && events[0].t <= now) cb(events.shift());
    if (custom && !muted){
      const b = energy();
      avgBass = avgBass * 0.95 + b * 0.05;
      if (b > avgBass * 1.25 && b > 0.3 && now - lastOnset > 0.28){ lastOnset = now; cb({ type: 'kick' }); }
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !running) return;
    if (document.hidden){ ctx.suspend(); if (mediaEl && custom) mediaEl.pause(); }
    else { ctx.resume(); if (mediaEl && custom) mediaEl.play().catch(() => {}); }
  });
  return {
    start, useTrack, setLevel, setMuted, setVariation, whoosh, energy, poll, progCount: PROGS.length,
    get running(){ return running; }, get muted(){ return muted; },
    label(){ return custom ? '♪ ' + customLabel : level >= 2 ? '♪ Trilha sintetizada · 96 BPM · a harmonia muda a cada região' : '♪ Trilha sintetizada · 96 BPM · Lá menor'; },
    onChange(fn){ onChange = fn; }
  };
})();

/* ============================ RETRATO ============================ */
const el = {
  app: $('app'), figure: $('figure'), lipUp: $('lipUp'), lipLow: $('lipLow'), mouth: $('mouthLine'),
  crease: $('crease'), dimple: $('dimple'), cheek: $('cheekLight'), cheekR: $('cheekLightR'), eyeN: $('eyeN'), eyeF: $('eyeF'), irisN: $('irisN'), irisF: $('irisF'),
  brows: $('brows'), headF: $('headFront'), headB: $('headBack'), body: $('bodyG')
};
const P = { s: 0, target: 0.12, nextSwap: 1.4, blinkT: -1, nextBlink: 2.6, hover: false, tapUntil: 0, force: false,
  gx: 0, gy: 0, tgx: 0, tgy: 0, nextLook: 1.2 };
const f2 = n => n.toFixed(2);

function applyFace(s, bl, t){
  const m = 1.2*s, cLx = 194 - 2*s, cRx = 234 + 2*s, cy = 248 - 4.5*s, u = s;
  el.mouth.setAttribute('d', `M${f2(cLx)},${f2(cy)} C204,${f2(250 + m)} 224,${f2(250 + m)} ${f2(cRx)},${f2(cy)}`);
  el.lipUp.setAttribute('d', `M${f2(cLx)},${f2(cy)} C199,${f2(244 - u)} 204,${f2(239 - u)} 208,${f2(239 - u)} C211,${f2(239 - u)} 213,${f2(241 - u)} 214,${f2(241 - u)} C215,${f2(241 - u)} 217,${f2(239 - u)} 220,${f2(239 - u)} C224,${f2(239 - u)} 229,${f2(244 - u)} ${f2(cRx)},${f2(cy)} C224,${f2(250.5 + m)} 204,${f2(250.5 + m)} ${f2(cLx)},${f2(cy)} Z`);
  el.lipLow.setAttribute('d', `M${f2(cLx + 2)},${f2(cy + 1.5)} C202,${f2(259 + 0.5*s)} 226,${f2(259 + 0.5*s)} ${f2(cRx - 2)},${f2(cy + 1.5)} C224,${f2(252 + m)} 204,${f2(252 + m)} ${f2(cLx + 2)},${f2(cy + 1.5)} Z`);
  el.crease.setAttribute('opacity', f2(s * 0.4));
  el.dimple.setAttribute('opacity', f2(s * 0.4));
  el.cheek.setAttribute('cy', f2(208 - 4*s)); el.cheekR.setAttribute('cy', f2(208 - 4*s));
  const k = Math.max(0.08, 1 - 0.2*s - 0.92*bl);
  el.eyeN.setAttribute('transform', `translate(187 170) scale(1 ${f2(k)}) translate(-187 -170)`);
  el.eyeF.setAttribute('transform', `translate(241 170) scale(1 ${f2(k)}) translate(-241 -170)`);
  const gx = P.gx - 1.2, gy = P.gy - 0.4*s;
  el.irisN.setAttribute('transform', `translate(${f2(gx)} ${f2(gy)})`);
  el.irisF.setAttribute('transform', `translate(${f2(gx)} ${f2(gy)})`);
  el.brows.setAttribute('transform', `translate(0 ${f2(-1.4*s)})`);
  const sway = REDUCED ? 0 : Math.sin(t * 0.7) * 0.6;
  const rot = `rotate(${f2(-1.5 + sway - 1.2*s)} 214 300)`;
  el.headF.setAttribute('transform', rot); el.headB.setAttribute('transform', rot);
  el.body.setAttribute('transform', `translate(0 ${REDUCED ? 0 : f2(Math.sin(t * 1.6) * 1.4)})`);
}
function updatePortrait(dt, t){
  P.nextSwap -= dt;
  if (P.nextSwap <= 0){ const toBig = P.target < 0.5; P.target = toBig ? 1 : 0.12; P.nextSwap = toBig ? 1.6 + Math.random()*1.2 : 2 + Math.random()*2.2; }
  const tgt = (P.hover || P.force || t < P.tapUntil) ? 1 : P.target;
  P.s += (tgt - P.s) * Math.min(1, dt * (tgt > P.s ? 5 : 2.6));
  // olhar natural: pequenos movimentos (sacadas) em direção a quem olha
  P.nextLook -= dt;
  if (P.nextLook <= 0){
    P.nextLook = 0.9 + Math.random() * 2.2;
    const away = Math.random() < 0.18;
    P.tgx = away ? (Math.random() < 0.5 ? -2.8 : 2.8) : (Math.random() - 0.5) * 1.4;
    P.tgy = away ? (Math.random() - 0.5) * 1.6 : (Math.random() - 0.5) * 0.8;
  }
  if (P.hover || t < P.tapUntil){ P.tgx = 0; P.tgy = 0; }
  const ease = Math.min(1, dt * 18);
  P.gx += (P.tgx - P.gx) * ease; P.gy += (P.tgy - P.gy) * ease;
  P.nextBlink -= dt;
  if (P.nextBlink <= 0 && P.blinkT < 0){ P.blinkT = 0; P.nextBlink = 2.4 + Math.random()*3.6; }
  let bl = 0;
  if (P.blinkT >= 0){ P.blinkT += dt; const ph = P.blinkT / 0.17; bl = ph >= 1 ? 0 : Math.sin(Math.PI * ph); if (ph >= 1) P.blinkT = -1; }
  applyFace(P.s, bl, t);
}
el.figure.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') P.hover = true; });
el.figure.addEventListener('pointerleave', () => { P.hover = false; });
el.figure.addEventListener('pointerdown', () => { P.tapUntil = T + 1.8; });

/* ============================ COSMOS ============================ */
const cv = $('space'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, T = 0;
let spaceOn = false, warp = 0, pulse = 0, flash = 0, beatClock = 0;
let mx = 0, my = 0, tmx = 0, tmy = 0;
const stars = [], shoots = [], parts = [];
let ridgeBack = [], ridgeFront = [];
const sunCv = document.createElement('canvas'), sg = sunCv.getContext('2d');

const PAL = [
  { name: 'Neon de Miami',    sky0:'#07021a', sky1:'#1b0640', sky2:'#5b0d6e', sky3:'#ff3fb4', sun0:'#ffe86b', sun1:'#ff9a3c', sun2:'#ff2f8e', grid:'#ff3fd0', ground:'#0c0222', mount:'#16063a', edge:'#2de2ff', star:'#ffffff' },
  { name: 'Aurora Ciano',     sky0:'#010814', sky1:'#03243a', sky2:'#0b5560', sky3:'#2de2c4', sun0:'#e2fff6', sun1:'#4df0d0', sun2:'#2f7dff', grid:'#29f0d0', ground:'#02101c', mount:'#03162a', edge:'#a98bff', star:'#dff8ff' },
  { name: 'Ocaso Carmim',     sky0:'#120208', sky1:'#3a0820', sky2:'#8a1a2c', sky3:'#ff7a3c', sun0:'#fff1a8', sun1:'#ffb347', sun2:'#ff4d4d', grid:'#ff8a3c', ground:'#160409', mount:'#24060f', edge:'#ff3f8e', star:'#ffe9d6' }
];
const KEYS = ['sky0','sky1','sky2','sky3','sun0','sun1','sun2','grid','ground','mount','edge','star'];
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
PAL.forEach(p => { p.c = {}; KEYS.forEach(k => p.c[k] = hex(p[k])); });
let palI = 0, palFrom = PAL[0], palTo = PAL[0], palK = 1, palSpeed = 0.9;
function snapPal(){ const o = { name: palTo.name, c: {} }; KEYS.forEach(k => { const A = palFrom.c[k], B = palTo.c[k]; o.c[k] = A.map((v, i) => v + (B[i] - v) * palK); }); return o; }
function setPal(p, speed){ palFrom = snapPal(); palTo = p; palK = 0; palSpeed = speed; }
function hsl(h, s, l){
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1/6 ? p + (q - p) * 6 * t : t < 1/2 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p; };
  return [f(h + 1/3) * 255, f(h) * 255, f(h - 1/3) * 255];
}
function genPalette(name){
  const h = Math.random() < 0.8 ? 175 + Math.random() * 170 : Math.random() * 30, d = Math.random() < 0.5 ? 1 : -1; // faixa synthwave: ciano → roxo → magenta → laranja
  return { name, c: {
    sky0: hsl(h, .6, .04), sky1: hsl(h, .6, .13), sky2: hsl(h + 20*d, .7, .3), sky3: hsl(h + 40*d, 1, .6),
    sun0: hsl(h + 60*d, 1, .82), sun1: hsl(h + 30*d, 1, .63), sun2: hsl(h, .95, .58),
    grid: hsl(h - 30*d, 1, .62), ground: hsl(h, .6, .06), mount: hsl(h, .5, .1),
    edge: hsl(h + 170, 1, .6), star: hsl(h, .4, .95) } };
}
function C(k, a = 1){
  const A = palFrom.c[k], B = palTo.c[k], t = palK;
  return `rgba(${(A[0] + (B[0]-A[0])*t) | 0},${(A[1] + (B[1]-A[1])*t) | 0},${(A[2] + (B[2]-A[2])*t) | 0},${a})`;
}

function newStar(s, far){ s.x = (Math.random()*2 - 1) * 1.5; s.y = (Math.random()*2 - 1.1) * 1.1; s.z = far ? 1 : 0.15 + Math.random()*0.85; s.tf = 1 + Math.random()*3; s.tp = Math.random()*6.28; return s; }
for (let i = 0; i < 620; i++) stars.push(newStar({}, false));

function makeRidge(n, amp){
  const pts = [];
  for (let i = 0; i < n; i++){
    const x = i / (n - 1);
    const prof = Math.pow(Math.abs(x - 0.5) * 2, 1.5);
    const jag = i % 2 ? 0.55 + Math.random()*0.2 : 0.8 + Math.random()*0.3;
    pts.push([x, (prof * jag + 0.015) * amp]);
  }
  return pts;
}
function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  ridgeBack = makeRidge(30, 1); ridgeFront = makeRidge(18, 0.62);
}
addEventListener('resize', resize); resize();

function ridge(pts, shift, HY, scale, fillA, edgeA){
  g.beginPath(); g.moveTo(-60, HY + 1);
  const xs = [];
  for (const [x, h] of pts){ const px = x * (W + 120) - 60 + shift, py = HY - h * H * scale; xs.push([px, py]); g.lineTo(px, py); }
  g.lineTo(W + 60, HY + 1); g.closePath();
  g.fillStyle = C('mount', fillA); g.fill();
  g.strokeStyle = C('edge', edgeA); g.lineWidth = 1.4; g.stroke();
  g.beginPath();
  for (const [px, py] of xs){ if (HY - py > 8){ g.moveTo(px, py); g.lineTo(px + (W/2 - px) * 0.08, HY); } }
  g.strokeStyle = C('edge', edgeA * 0.3); g.lineWidth = 1; g.stroke();
}

/* ---- sequência da viagem: cosmos → decolagem → universo infinito ---- */
const journey = { phase: 'idle', t: 0 };
const COSMOS_HOLD = 12, LIFT = 4.2, ZMAX = 4;
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const objs = [];
let gridPhase = 0, spawnT = 0, ringT = 0, ly = 0, hudT = 0, autoPalT = 0;
function liftAmount(){ return journey.phase === 'lift' ? ease(journey.t / LIFT) : journey.phase === 'infinite' ? 1 : 0; }

function drawStars(cx, cy, sc, speed, ymax, dt){
  g.fillStyle = C('star'); g.strokeStyle = C('star');
  const base = g.globalAlpha;
  for (const s of stars){
    const pz = s.z; s.z -= dt * speed;
    if (s.z <= 0.03){ newStar(s, true); continue; }
    const x = cx + s.x / s.z * sc, y = cy + s.y / s.z * sc;
    if (x < -20 || x > W + 20 || y < -20 || y > ymax){ if (warp > 0.05 && s.z < 0.4) newStar(s, true); continue; }
    const tw = 0.55 + 0.45 * Math.sin(T * s.tf + s.tp);
    g.globalAlpha = base * Math.min(1, (1 - s.z) * 1.4) * (warp > 0.05 ? 1 : tw);
    if (warp > 0.05){
      const z0 = Math.min(1, pz + dt * speed * 5);
      g.lineWidth = 0.6 + (1 - s.z) * 1.8;
      g.beginPath(); g.moveTo(cx + s.x / z0 * sc, cy + s.y / z0 * sc); g.lineTo(x, y); g.stroke();
    } else {
      const r = (1 - s.z) * 1.7 + 0.35; g.fillRect(x - r/2, y - r/2, r, r);
    }
  }
  g.globalAlpha = base;
}

function drawCosmos(dt, L){
  const HY = H * (0.64 + L * 0.8), gh = H - HY;
  const gr = g.createLinearGradient(0, 0, 0, HY);
  gr.addColorStop(0, C('sky0')); gr.addColorStop(0.45, C('sky1')); gr.addColorStop(0.82, C('sky2')); gr.addColorStop(1, C('sky3'));
  g.fillStyle = gr; g.fillRect(0, 0, W, Math.min(H, HY + 1));

  drawStars(W/2 - mx*24, H*0.42 - my*14 + L*H*0.35, Math.max(W, H) * 0.5, 0.012 + warp*warp*(REDUCED ? 0.2 : 2.4), Math.min(H, HY), dt);

  // sol listrado (afunda na decolagem)
  const R = Math.min(W, H) * 0.21 * (1 + pulse * 0.035);
  const sx = W/2 - mx*10, sy = HY - R * 0.42 + L * R * 0.8;
  const glow = g.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 2.3);
  glow.addColorStop(0, C('sun2', 0.42 + pulse * 0.18)); glow.addColorStop(1, C('sun2', 0));
  g.fillStyle = glow; g.fillRect(sx - R*2.4, sy - R*2.4, R*4.8, R*4.8);
  const size = Math.ceil(R * 2 + 4);
  if (sunCv.width !== size){ sunCv.width = size; sunCv.height = size; }
  sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, size, size);
  const lg = sg.createLinearGradient(0, 0, 0, size);
  lg.addColorStop(0, C('sun0')); lg.addColorStop(0.5, C('sun1')); lg.addColorStop(1, C('sun2'));
  sg.fillStyle = lg; sg.beginPath(); sg.arc(size/2, size/2, R, 0, Math.PI*2); sg.fill();
  sg.globalCompositeOperation = 'destination-out';
  const roll = REDUCED ? 0 : (T * (0.35 + L)) % 1;
  for (let i = 0; i < 9; i++){ const f = (i + roll) / 9; sg.fillRect(0, size * 0.3 + f * size * 0.5, size, 1 + f * R * 0.1); }
  g.drawImage(sunCv, sx - size/2, sy - size/2);

  ridge(ridgeBack, -mx * 12, HY, 0.24, 0.92, 0.55);
  ridge(ridgeFront, -mx * 26, HY, 0.24, 1, 0.8);

  // chão e grade (acelera na decolagem)
  gridPhase += dt * (1.1 + L * 7);
  if (gh > 0){
    g.fillStyle = C('ground'); g.fillRect(0, HY, W, gh);
    const vpx = W/2 - mx*36, ph = REDUCED ? 0.3 : gridPhase % 1, b = 0.55 + pulse * 0.45;
    g.beginPath();
    for (let n = 1; n < 40; n++){ const z = n - ph; const y = HY + gh * 0.85 / z; if (y > H + 2) continue; g.moveTo(0, y); g.lineTo(W, y); }
    for (let j = -26; j <= 26; j++){ g.moveTo(vpx + j * 3, HY); g.lineTo(vpx + j * W * 0.1, H); }
    g.strokeStyle = C('grid', 0.16 * b); g.lineWidth = 5; g.stroke();
    g.strokeStyle = C('grid', 0.85 * b); g.lineWidth = 1.2; g.stroke();
    const fg = g.createLinearGradient(0, HY, 0, HY + gh * 0.45);
    fg.addColorStop(0, C('ground', 0.95)); fg.addColorStop(1, C('ground', 0));
    g.fillStyle = fg; g.fillRect(0, HY, W, gh * 0.45);
  }
  if (HY < H + 34){
    const hg = g.createLinearGradient(0, HY - 34, 0, HY + 34);
    hg.addColorStop(0, C('sky3', 0)); hg.addColorStop(0.5, C('sky3', 0.55 + pulse * 0.3)); hg.addColorStop(1, C('sky3', 0));
    g.fillStyle = hg; g.fillRect(0, HY - 34, W, 68);
    g.fillStyle = C('sun0', 0.9); g.fillRect(0, HY - 0.75, W, 1.5);
  }
}

/* ---- universo infinito: objetos gerados sem fim ---- */
function spawnObj(z, type){
  if (!type) type = zone ? pickWeighted(zone.weights) : (() => { const r = Math.random(); return r < 0.42 ? 'planet' : r < 0.68 ? 'nebula' : r < 0.9 ? 'galaxy' : 'ring'; })();
  const side = () => Math.random() < 0.5 ? -1 : 1;
  const o = { type, z, rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3, v: Math.random() < 0.5 ? 0 : 1 };
  if (type === 'planet'){ o.size = 0.1 + Math.random()*0.16; o.x = side()*(0.35 + Math.random()*0.8); o.y = (Math.random()*2 - 1)*0.6; o.ring = Math.random() < 0.55; }
  else if (type === 'ring'){ o.size = 0.3; o.x = (Math.random()*2 - 1)*0.06; o.y = (Math.random()*2 - 1)*0.05; }
  else if (type === 'nebula'){
    o.size = 0.7 + Math.random()*0.6; o.x = side()*(0.3 + Math.random()*1.2); o.y = (Math.random()*2 - 1)*0.8;
    o.blobs = Array.from({ length: 5 }, () => [(Math.random() - 0.5)*1.2, (Math.random() - 0.5)*0.8, 0.35 + Math.random()*0.5, ['sky3','edge','sun2','grid'][(Math.random()*4) | 0]]);
  } else if (type === 'asteroid'){
    o.size = 0.22 + Math.random()*0.12; o.x = side()*(0.25 + Math.random()*0.9); o.y = (Math.random()*2 - 1)*0.7;
    o.rocks = Array.from({ length: 6 + ((Math.random()*7) | 0) }, () => ({ dx: (Math.random() - 0.5)*1.6, dy: (Math.random() - 0.5), r: 0.06 + Math.random()*0.14, a: Math.random()*6.28, sp: (Math.random() - 0.5)*1.4, pts: Array.from({ length: 7 }, () => 0.7 + Math.random()*0.45) }));
  } else if (type === 'crystal'){
    o.size = 0.1 + Math.random()*0.1; o.x = side()*(0.25 + Math.random()*0.8); o.y = (Math.random()*2 - 1)*0.6; o.spin = 0.6 + Math.random()*0.8;
  } else if (type === 'star'){
    o.size = 0.45 + Math.random()*0.35; o.x = side()*(0.7 + Math.random()*0.8); o.y = (Math.random()*2 - 1)*0.5;
  } else {
    o.size = 0.35 + Math.random()*0.25; o.x = side()*(0.4 + Math.random()*0.9); o.y = (Math.random()*2 - 1)*0.7; o.spin *= 0.3;
    o.pts = Array.from({ length: 170 }, (_, i) => { const t = Math.random(); return [t*4.6 + (i % 2)*Math.PI + (Math.random() - 0.5)*0.5, Math.pow(t, 0.8), Math.random() < 0.15 ? 2 : 1]; });
  }
  objs.push(o);
}
const DRAW = {
  asteroid(o, x, y, s){
    for (const r of o.rocks){
      const rx = x + r.dx*s, ry = y + r.dy*s, rr = r.r*s, a0 = r.a + T*r.sp*0.3;
      g.beginPath();
      r.pts.forEach((q, i) => { const a = a0 + i/7*Math.PI*2, px = rx + Math.cos(a)*rr*q, py = ry + Math.sin(a)*rr*q; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath();
      g.fillStyle = C('mount'); g.fill();
      g.strokeStyle = C('edge', 0.75); g.lineWidth = Math.max(0.8, rr*0.08); g.stroke();
    }
  },
  crystal(o, x, y, s){
    const a = o.rot, b = T*0.7 + o.rot, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const V = [[1,0,0],[-1,0,0],[0,1.5,0],[0,-1.5,0],[0,0,1],[0,0,-1]].map(([vx, vy, vz]) => { const x1 = vx*ca + vz*sa, z1 = -vx*sa + vz*ca, y1 = vy*cb - z1*sb; return [x + x1*s, y + y1*s]; });
    const E = [[0,2],[0,3],[1,2],[1,3],[4,2],[4,3],[5,2],[5,3],[0,4],[4,1],[1,5],[5,0]];
    g.beginPath(); for (const [i, j] of E){ g.moveTo(V[i][0], V[i][1]); g.lineTo(V[j][0], V[j][1]); }
    const b2 = 0.6 + pulse*0.4;
    g.strokeStyle = C('edge', 0.2*b2); g.lineWidth = Math.max(3, s*0.08); g.stroke();
    g.strokeStyle = C('edge', 0.95*b2); g.lineWidth = Math.max(1, s*0.02); g.stroke();
  },
  star(o, x, y, s){
    const gl = g.createRadialGradient(x, y, s*0.7, x, y, s*2.4);
    gl.addColorStop(0, C('sun2', 0.4)); gl.addColorStop(1, C('sun2', 0));
    g.fillStyle = gl; g.fillRect(x - s*2.4, y - s*2.4, s*4.8, s*4.8);
    g.save(); g.beginPath(); g.arc(x, y, s, 0, Math.PI*2); g.clip();
    const lg = g.createLinearGradient(0, y - s, 0, y + s);
    lg.addColorStop(0, C('sun0')); lg.addColorStop(0.5, C('sun1')); lg.addColorStop(1, C('sun2'));
    g.fillStyle = lg; g.fillRect(x - s, y - s, s*2, s*2);
    g.fillStyle = C('sky1', 0.9);
    const roll = (T*0.35) % 1;
    for (let i = 0; i < 8; i++){ const f = (i + roll)/8; g.fillRect(x - s, y + f*s, s*2, 1 + f*s*0.1); }
    g.restore();
  },
  planet(o, x, y, s){
    const gl = g.createRadialGradient(x, y, s*0.8, x, y, s*2.2);
    gl.addColorStop(0, C(o.v ? 'edge' : 'sun2', 0.3)); gl.addColorStop(1, C('sun2', 0));
    g.fillStyle = gl; g.fillRect(x - s*2.2, y - s*2.2, s*4.4, s*4.4);
    const tilt = o.rot * 0.2 - 0.25;
    if (o.ring){ g.strokeStyle = C('edge', 0.85); g.lineWidth = Math.max(1, s*0.05); g.beginPath(); g.ellipse(x, y, s*1.9, s*0.42, tilt, Math.PI, Math.PI*2); g.stroke(); }
    g.save(); g.beginPath(); g.arc(x, y, s, 0, Math.PI*2); g.clip();
    const pg = g.createRadialGradient(x - s*0.4, y - s*0.45, s*0.05, x, y, s*1.05);
    if (o.v){ pg.addColorStop(0, C('star')); pg.addColorStop(0.4, C('edge')); pg.addColorStop(1, C('sky0')); }
    else { pg.addColorStop(0, C('sun0')); pg.addColorStop(0.45, C('sun1')); pg.addColorStop(0.8, C('sun2')); pg.addColorStop(1, C('sky1')); }
    g.fillStyle = pg; g.fillRect(x - s, y - s, s*2, s*2);
    g.fillStyle = C('sky0', 0.35);
    for (let k = 0; k < 6; k++) g.fillRect(x - s, y + s*(0.05 + k*0.16), s*2, Math.max(0.5, s*0.025*(1 + k*0.7)));
    g.restore();
    if (o.ring){ g.strokeStyle = C('edge', 0.85); g.lineWidth = Math.max(1, s*0.05); g.beginPath(); g.ellipse(x, y, s*1.9, s*0.42, tilt, 0, Math.PI); g.stroke(); }
  },
  ring(o, x, y, s){
    const b = 0.6 + pulse * 0.4;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI*2);
    g.strokeStyle = C('grid', 0.18*b); g.lineWidth = Math.max(3, s*0.09); g.stroke();
    g.strokeStyle = C('grid', 0.9*b); g.lineWidth = Math.max(1, s*0.022); g.stroke();
    g.setLineDash([s*0.12, s*0.09]); g.lineDashOffset = -T * s * 0.4;
    g.beginPath(); g.arc(x, y, s*0.9, o.rot, o.rot + Math.PI*2);
    g.strokeStyle = C('edge', 0.7); g.lineWidth = Math.max(1, s*0.012); g.stroke(); g.setLineDash([]);
  },
  nebula(o, x, y, s){
    g.globalCompositeOperation = 'lighter';
    for (const [dx, dy, r, k] of o.blobs){
      const bx = x + dx*s, by = y + dy*s, rr = r*s;
      const ng = g.createRadialGradient(bx, by, 0, bx, by, rr);
      ng.addColorStop(0, C(k, 0.22)); ng.addColorStop(1, C(k, 0));
      g.fillStyle = ng; g.fillRect(bx - rr, by - rr, rr*2, rr*2);
    }
    g.globalCompositeOperation = 'source-over';
  },
  galaxy(o, x, y, s){
    g.globalCompositeOperation = 'lighter';
    const cg = g.createRadialGradient(x, y, 0, x, y, s*0.35);
    cg.addColorStop(0, C('sun0', 0.9)); cg.addColorStop(1, C('sun2', 0));
    g.fillStyle = cg; g.fillRect(x - s*0.35, y - s*0.35, s*0.7, s*0.7);
    const cr = Math.cos(o.rot), sr = Math.sin(o.rot);
    g.fillStyle = C('star', 0.85);
    for (const [an, r, sz] of o.pts){
      const a = an + T*0.15, dx = Math.cos(a)*r*s, dy = Math.sin(a)*r*s*0.42;
      const q = Math.max(0.6, sz*s*0.012);
      g.fillRect(x + dx*cr - dy*sr, y + dx*sr + dy*cr, q, q);
    }
    g.globalCompositeOperation = 'source-over';
  }
};
/* ---- regiões: cada uma com paleta, cenário, objetos, velocidade e harmonia próprios ---- */
const FEATURES = ['clear', 'nebula', 'tunnel', 'aurora', 'storm'];
const OBJ_TYPES = ['planet', 'nebula', 'galaxy', 'ring', 'asteroid', 'crystal', 'star'];
const NAME_A = ['Nebulosa', 'Setor', 'Mar', 'Abismo', 'Cinturão', 'Véu', 'Corredor', 'Jardim', 'Deriva', 'Coroa', 'Arquipélago', 'Vale', 'Fenda', 'Órbita'];
const NAME_B = ['Magenta', 'Ciano', 'de Cristal', 'de Néon', 'Sideral', 'de Órion', 'Solar', 'Violeta', 'Ultravioleta', 'Estelar', 'Polar', 'Lunar', 'de Prisma', 'de Cobalto', 'Vaporwave', 'de Vênus'];
let zone = null, prevZone = null, zoneT = 0, zoneN = 0;
const pick = a => a[(Math.random() * a.length) | 0];
function pickWeighted(w){ let sum = 0; for (const k in w) sum += w[k]; let r = Math.random() * sum; for (const k in w){ r -= w[k]; if (r <= 0) return k; } return 'planet'; }
function newZone(){
  if (zone) prevZone = zone;
  zoneN++;
  let feature; do { feature = pick(FEATURES); } while (zone && feature === zone.feature);
  const weights = {}; OBJ_TYPES.forEach(t => weights[t] = Math.random() < 0.4 ? 0 : 0.2 + Math.random());
  weights.ring = Math.max(weights.ring, 0.12);
  if (weights.planet + weights.galaxy + weights.asteroid + weights.crystal + weights.star < 0.3) weights.planet = 1;
  let name; do { name = pick(NAME_A) + ' ' + pick(NAME_B); } while (zone && name === zone.name);
  zone = { feature, weights, name, rate: 0.7 + Math.random()*1.2, speed: 0.75 + Math.random()*0.75, dur: 18 + Math.random()*10, fade: 0,
    seed: Math.random()*10, sides: 3 + ((Math.random()*6) | 0), dir: Math.random() < 0.5 ? -1 : 1 };
  zoneT = 0;
  setPal(genPalette(name), 0.22);
  Sound.setVariation((Math.random() * Sound.progCount) | 0, pick([0, -2, 2, 3, -3, 5, -5]));
  flash = 1; warp = Math.max(warp, 0.55);
  updateHud();
}
function drawFeature(z, a, cx, cy, sc){
  if (a <= 0) return;
  if (z.feature === 'nebula'){
    g.globalCompositeOperation = 'lighter';
    ['sky3', 'edge', 'sun2'].forEach((k, i) => {
      const bx = cx + Math.cos(T*0.05 + i*2.1 + z.seed)*W*0.32, by = cy + Math.sin(T*0.04 + i*1.7 + z.seed)*H*0.3, r = Math.max(W, H)*0.55;
      const ng = g.createRadialGradient(bx, by, 0, bx, by, r); ng.addColorStop(0, C(k, 0.16*a)); ng.addColorStop(1, C(k, 0));
      g.fillStyle = ng; g.fillRect(0, 0, W, H);
    });
    g.globalCompositeOperation = 'source-over';
  } else if (z.feature === 'tunnel'){
    const n = z.sides, rot = T*0.15*z.dir, ph = REDUCED ? 0.3 : (T*0.9*z.speed) % 1;
    g.beginPath();
    for (let k = 1; k < 16; k++){
      const zz = k - ph, r = sc*0.9/zz; if (r < 6) continue;
      for (let i = 0; i <= n; i++){ const an = rot + i/n*Math.PI*2, px = cx + Math.cos(an)*r, py = cy + Math.sin(an)*r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    }
    for (let i = 0; i < n; i++){ const an = rot + i/n*Math.PI*2; g.moveTo(cx + Math.cos(an)*6, cy + Math.sin(an)*6); g.lineTo(cx + Math.cos(an)*sc*4, cy + Math.sin(an)*sc*4); }
    const b = 0.5 + pulse*0.5;
    g.strokeStyle = C('grid', 0.12*a*b); g.lineWidth = 5; g.stroke();
    g.strokeStyle = C('grid', 0.55*a*b); g.lineWidth = 1.1; g.stroke();
  } else if (z.feature === 'aurora'){
    g.globalCompositeOperation = 'lighter';
    ['sky3', 'edge', 'grid', 'sun1'].forEach((k, i) => {
      g.beginPath();
      for (let x = -24; x <= W + 24; x += 24){ const y = H*(0.14 + i*0.12) + Math.sin(x*0.0045 + T*0.6 + i*1.3 + z.seed)*H*0.06 + Math.sin(x*0.011 - T*0.4)*H*0.02; x === -24 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.strokeStyle = C(k, 0.1*a); g.lineWidth = 40 + i*14; g.stroke();
      g.strokeStyle = C(k, 0.35*a); g.lineWidth = 1.5; g.stroke();
    });
    g.globalCompositeOperation = 'source-over';
  }
}
function drawInfinite(dt, alpha){
  const cx = W/2 - mx*30, cy = H/2 - my*20, sc = Math.max(W, H) * 0.5;
  g.globalAlpha = alpha;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
  bg.addColorStop(0, C('sky1')); bg.addColorStop(1, C('sky0'));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (prevZone) drawFeature(prevZone, prevZone.fade, cx, cy, sc);
  if (zone) drawFeature(zone, zone.fade, cx, cy, sc);
  const storm = (zone && zone.feature === 'storm' ? zone.fade : 0) + (prevZone && prevZone.feature === 'storm' ? prevZone.fade : 0);
  const zs = zone ? zone.speed : 1;
  if (journey.phase === 'infinite') drawStars(cx, cy, sc, (0.1 + storm*0.45) * zs + warp*warp*(REDUCED ? 0.2 : 2.4) + pulse*0.03, H, dt);
  const sp = (REDUCED ? 0.2 : (0.32 + pulse*0.12) * zs + warp*1.8) * dt;
  for (const o of objs){ o.z -= sp; o.rot += o.spin * dt; }
  for (let i = objs.length - 1; i >= 0; i--) if (objs[i].z < 0.04) objs.splice(i, 1);
  objs.sort((a, b) => b.z - a.z);
  for (const o of objs){
    const s = o.size / o.z * sc, x = cx + o.x / o.z * sc, y = cy + o.y / o.z * sc, m = s * 2.5;
    if (x + m < 0 || x - m > W || y + m < 0 || y - m > H) continue;
    const a = Math.min(1, (ZMAX - o.z) / 0.9) * Math.min(1, (o.z - 0.04) / 0.2);
    g.globalAlpha = alpha * a;
    DRAW[o.type](o, x, y, s);
  }
  g.globalAlpha = 1;
}

function drawSpace(dt){
  pulse = Math.max(0, pulse - dt * 2.6); flash = Math.max(0, flash - dt * 3);
  warp = Math.max(0, warp - dt * 0.5);
  if (palK < 1) palK = Math.min(1, palK + dt * palSpeed);
  mx += (tmx - mx) * Math.min(1, dt * 2); my += (tmy - my) * Math.min(1, dt * 2);

  const L = liftAmount();
  if (journey.phase === 'lift') warp = Math.max(warp, Math.pow(Math.max(0, (journey.t / LIFT - 0.5) * 2), 2));
  if (journey.phase !== 'infinite') drawCosmos(dt, L);
  const ia = journey.phase === 'infinite' ? 1 : journey.phase === 'lift' ? ease((journey.t / LIFT - 0.62) / 0.38) : 0;
  if (ia > 0) drawInfinite(dt, ia);

  // estrelas cadentes
  if (Math.random() < dt * 0.22) spawnShoot(Math.random() * W, Math.random() * H * 0.3);
  for (let i = shoots.length - 1; i >= 0; i--){
    const s = shoots[i]; s.life -= dt; if (s.life <= 0){ shoots.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt;
    const a = Math.min(1, s.life / s.max * 2);
    const tx = s.x - s.vx * 0.14, ty = s.y - s.vy * 0.14;
    const sgd = g.createLinearGradient(s.x, s.y, tx, ty);
    sgd.addColorStop(0, C('star', a)); sgd.addColorStop(0.3, C('sky3', a * 0.6)); sgd.addColorStop(1, C('sky3', 0));
    g.strokeStyle = sgd; g.lineWidth = 2; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(tx, ty); g.stroke();
  }
  // partículas
  for (let i = parts.length - 1; i >= 0; i--){
    const p = parts[i]; p.life -= dt; if (p.life <= 0){ parts.splice(i, 1); continue; }
    p.vx *= 0.985; p.vy = p.vy * 0.985 - 6 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    g.globalAlpha = Math.min(1, p.life / p.max * 1.6);
    g.fillStyle = p.c; g.fillRect(p.x, p.y, p.r, p.r);
  }
  g.globalAlpha = 1;

  if (flash > 0){ g.fillStyle = C('sky3', flash * 0.05); g.fillRect(0, 0, W, H); }
  const vg = g.createRadialGradient(W/2, H/2, Math.min(W, H) * 0.35, W/2, H/2, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

function spawnShoot(x, y, dir){
  const d = dir || (Math.random() < 0.5 ? -1 : 1);
  const sp = 520 + Math.random() * 260;
  shoots.push({ x, y, vx: d * sp * 0.82, vy: sp * 0.5, life: 1.1, max: 1.1 });
}
function burst(){
  const r = el.figure.getBoundingClientRect();
  const cols = ['#8796ae','#b6c1d3','#ffffff','#ff3fb4','#2de2ff','#56627f'];
  const n = REDUCED ? 120 : 560;
  for (let i = 0; i < n; i++){
    const x = r.left + r.width * (0.2 + Math.random() * 0.65), y = r.top + r.height * (0.1 + Math.random() * 0.88);
    const ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 260;
    const life = 1.4 + Math.random() * 1.8;
    parts.push({ x, y, vx: Math.cos(ang) * sp - 60, vy: Math.sin(ang) * sp - 50, life, max: life, r: 1 + Math.random() * 2.4, c: cols[(Math.random() * cols.length) | 0] });
  }
}

