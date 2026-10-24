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
    if (b === 0){ pad(t, ch, S16 * 16); events.push({ t, type: 'bar', bar, chord: ch }); }
    if (b % 2 === 0){ const n = ch[ARP[b >> 1]] + 12 + (b === 14 ? 12 : 0); arp(t, n, level ? 0.05 : 0.04); events.push({ t, type: 'note', n }); }
    if (level >= 2 && (b === 0 || b === 6 || b === 10)){ const n = b === 0 ? ch[2] + 12 : b === 6 ? ch[1] + 12 : ch[0] + 24; lead(t, n); events.push({ t, type: 'note', n }); }
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
  let wbuf = null;
  function spectrum(){ if (!ctx || !running || muted) return null; analyser.getByteFrequencyData(freq); return freq; }
  function wave(){ if (!ctx || !running || muted) return null; if (!wbuf) wbuf = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(wbuf); return wbuf; }
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
    spectrum, wave,
    get running(){ return running; }, get muted(){ return muted; }, get synth(){ return running && !custom && !muted; },
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
  } else if (type === 'note'){
    o.size = 0.09 + Math.random()*0.07; o.x = side()*(0.2 + Math.random()*0.9); o.y = (Math.random()*2 - 1)*0.6;
    o.g = pick(NOTE_GLYPHS); o.k = pick(['sun1', 'edge', 'sky3', 'sun0']);
  } else if (type === 'disc'){
    o.size = 0.12 + Math.random()*0.08; o.x = side()*(0.3 + Math.random()*0.8); o.y = (Math.random()*2 - 1)*0.6; o.spin = 3.5;
  } else if (type === 'star'){
    o.size = 0.45 + Math.random()*0.35; o.x = side()*(0.7 + Math.random()*0.8); o.y = (Math.random()*2 - 1)*0.5;
  } else {
    o.size = 0.35 + Math.random()*0.25; o.x = side()*(0.4 + Math.random()*0.9); o.y = (Math.random()*2 - 1)*0.7; o.spin *= 0.3;
    o.pts = Array.from({ length: 170 }, (_, i) => { const t = Math.random(); return [t*4.6 + (i % 2)*Math.PI + (Math.random() - 0.5)*0.5, Math.pow(t, 0.8), Math.random() < 0.15 ? 2 : 1]; });
  }
  objs.push(o);
}
const DRAW = {
  note(o, x, y, s){
    g.font = `${Math.max(8, Math.round(s*2.2))}px ${SYMBOL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C(o.k, 0.3); g.fillText(o.g, x + s*0.06, y + s*0.06);
    g.fillStyle = C(o.k, 0.95); g.fillText(o.g, x, y);
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  },
  disc(o, x, y, s){
    g.beginPath(); g.arc(x, y, s, 0, Math.PI*2); g.fillStyle = C('sky0'); g.fill(); g.strokeStyle = C('edge', 0.8); g.lineWidth = Math.max(1, s*0.03); g.stroke();
    g.beginPath(); for (const q of [0.5, 0.65, 0.8, 0.92]){ g.moveTo(x + s*q, y); g.arc(x, y, s*q, 0, Math.PI*2); }
    g.strokeStyle = C('grid', 0.3); g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, s*0.95, o.rot, o.rot + 0.5); g.closePath(); g.fillStyle = C('star', 0.1); g.fill();
    g.beginPath(); g.arc(x, y, s*0.33, 0, Math.PI*2); g.fillStyle = C('sun1'); g.fill();
    g.beginPath(); g.arc(x, y, s*0.04, 0, Math.PI*2); g.fillStyle = C('sky0'); g.fill();
  },
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
/* ---- dez cenas musicais: tocam em sequência e recomeçam com novas cores e tom ---- */
const SCENES = [
  { name: 'Vinil Cósmico',        feature: 'vinyl',    weights: { disc: 1, note: .4, planet: .3, ring: .2 },     prog: 0, tr: 0 },
  { name: 'Equalizador Estelar',  feature: 'eq',       weights: { planet: .6, crystal: .5, ring: .3, note: .3 }, prog: 1, tr: 0 },
  { name: 'Osciloscópio Sideral', feature: 'scope',    weights: { galaxy: .6, nebula: .5, ring: .3 },            prog: 2, tr: 2 },
  { name: 'Teclado Infinito',     feature: 'keys',     weights: { note: .8, crystal: .4, ring: .3 },             prog: 0, tr: -2 },
  { name: 'Cassete Nebular',      feature: 'cassette', weights: { nebula: .6, disc: .4, star: .4, ring: .2 },    prog: 3, tr: 0 },
  { name: 'Paredão de Caixas',    feature: 'speakers', weights: { asteroid: .6, planet: .5, ring: .3 },          prog: 1, tr: 3 },
  { name: 'Chuva de Notas',       feature: 'staff',    weights: { note: 1.2, galaxy: .3, ring: .2 },             prog: 2, tr: 0 },
  { name: 'Metrônomo Pulsar',     feature: 'metro',    weights: { crystal: .6, star: .3, ring: .4 },             prog: 0, tr: 5 },
  { name: 'Sintonia FM',          feature: 'radio',    weights: { planet: .6, nebula: .4, ring: .3 },            prog: 3, tr: -3 },
  { name: 'Mesa de Som',          feature: 'mixer',    weights: { disc: .5, note: .5, galaxy: .3, ring: .3 },    prog: 1, tr: 0 }
];
let zone = null, prevZone = null, zoneT = 0, zoneN = 0;
let lastKick = -10, beatSide = 1, chordNow = [57, 60, 64], noteClock = 0;
const keyFlash = new Map(), staffNotes = [];
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬'];
const SYMBOL_FONT = "'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif";
const pick = a => a[(Math.random() * a.length) | 0];
function pickWeighted(w){ let sum = 0; for (const k in w) sum += w[k]; let r = Math.random() * sum; for (const k in w){ r -= w[k]; if (r <= 0) return k; } return 'planet'; }

function newZone(){
  if (zone) prevZone = zone;
  const idx = zoneN % SCENES.length, loop = Math.floor(zoneN / SCENES.length) + 1;
  zoneN++;
  const s = SCENES[idx];
  zone = { ...s, idx, loop, rate: 0.9 + Math.random()*0.8, speed: 0.8 + Math.random()*0.5, dur: 18 + Math.random()*6, fade: 0, seed: Math.random()*10 };
  zoneT = 0;
  staffNotes.length = 0;
  setPal(genPalette(s.name), 0.22);
  Sound.setVariation(s.prog, s.tr + [0, 2, -2][(loop - 1) % 3]);
  flash = 1; warp = Math.max(warp, 0.55);
  updateHud();
}

/* dados de áudio: espectro e forma de onda reais, ou simulados com o som desligado */
let SPEC = new Uint8Array(256), WAVE = new Uint8Array(512);
const fakeSpec = new Uint8Array(256), fakeWave = new Uint8Array(512);
function readAudio(){
  const s = Sound.spectrum();
  if (s) SPEC = s;
  else { for (let i = 0; i < 256; i++) fakeSpec[i] = Math.max(0, 255 * (0.35 + 0.5*pulse) * Math.exp(-i/60) * (0.6 + 0.4*Math.sin(T*3 + i*0.7))); SPEC = fakeSpec; }
  const w = Sound.wave();
  if (w) WAVE = w;
  else { for (let i = 0; i < 512; i++) fakeWave[i] = 128 + (Math.sin(i*0.05 + T*8)*0.6 + Math.sin(i*0.13 + T*3)*0.3) * (25 + pulse*55); WAVE = fakeWave; }
}
function band(i, n){
  const lo = Math.floor(Math.pow(i/n, 1.6) * 110) + 1, hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1)/n, 1.6) * 110) + 1);
  let s = 0; for (let k = lo; k < hi; k++) s += SPEC[k];
  return s / (hi - lo) / 255;
}
function neon(k, alpha, lw){ g.strokeStyle = C(k, alpha * 0.2); g.lineWidth = lw * 4; g.stroke(); g.strokeStyle = C(k, alpha); g.lineWidth = lw; g.stroke(); }
function onKick(){ pulse = 1; lastKick = T; beatSide = -beatSide; }
function addStaffNote(n){
  const DI = [0,0,1,1,2,3,3,4,4,5,5,6], diat = m => Math.floor(m / 12) * 7 + DI[((m % 12) + 12) % 12];
  let step = diat(n) - diat(71); // 71 = Si4, linha do meio da pauta em clave de sol
  while (step > 6) step -= 7; while (step < -6) step += 7;
  staffNotes.push({ x: W + 30, step, g: pick(NOTE_GLYPHS), k: pick(['sun1', 'edge', 'sky3', 'sun0']) });
}

const FEAT = {
  // 1 · disco girando a 33⅓ rotações por minuto, com braço da agulha
  vinyl(z, cx, cy, bass, M){
    const R = M * 0.46, rot = T * Math.PI * 2 * (100/3) / 60;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI*2); g.fillStyle = C('sky0', 0.92); g.fill(); neon('edge', 0.8, 1.5);
    g.beginPath(); for (let r = R*0.38; r < R*0.97; r += R*0.03){ g.moveTo(cx + r, cy); g.arc(cx, cy, r, 0, Math.PI*2); }
    g.strokeStyle = C('grid', 0.1 + bass*0.35); g.lineWidth = 1; g.stroke();
    for (const off of [0, Math.PI]){ g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R*0.97, rot + off, rot + off + 0.4); g.closePath(); g.fillStyle = C('star', 0.07); g.fill(); }
    const lg = g.createRadialGradient(cx, cy, 0, cx, cy, R*0.33);
    lg.addColorStop(0, C('sun0')); lg.addColorStop(0.6, C('sun1')); lg.addColorStop(1, C('sun2'));
    g.beginPath(); g.arc(cx, cy, R*0.33, 0, Math.PI*2); g.fillStyle = lg; g.fill();
    g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = C('sky0', 0.85); g.textAlign = 'center';
    g.font = `700 ${Math.round(R*0.045)}px Syncopate, sans-serif`; g.fillText('SYNTHUNIVERSE', 0, -R*0.15);
    g.font = `600 ${Math.round(R*0.045)}px 'Chakra Petch', sans-serif`; g.fillText('LADO A · 33⅓ RPM', 0, R*0.2);
    g.restore();
    g.beginPath(); g.arc(cx, cy, R*0.025, 0, Math.PI*2); g.fillStyle = C('sky0'); g.fill();
    const bx = cx + R*1.12, by = cy - R*0.9;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(cx + R*0.62, cy - R*0.12); g.lineTo(cx + R*0.55, cy - R*0.02); neon('edge', 0.9, Math.max(2, R*0.012));
    g.beginPath(); g.arc(bx, by, R*0.06, 0, Math.PI*2); g.fillStyle = C('mount'); g.fill(); neon('edge', 0.8, 1.5);
  },
  // 2 · equalizador de LEDs com o espectro real, espelhado no topo e com picos
  eq(z, cx, cy, bass, M){
    const n = W < 600 ? 24 : 40, bw = W / n, seg = Math.max(6, H*0.012), gap = 3, top = H*0.42;
    if (!z.peaks || z.peaks.length !== n) z.peaks = new Float32Array(n);
    for (let i = 0; i < n; i++){
      const h = Math.min(1, band(i, n) * 1.25) * top, x = i*bw + 2, w = bw - 4;
      z.peaks[i] = Math.max(z.peaks[i] * 0.985, h);
      for (let yy = 0; yy < h; yy += seg + gap){
        const k = yy / top < 0.5 ? 'grid' : yy / top < 0.8 ? 'sun1' : 'sun2';
        g.fillStyle = C(k, 0.85); g.fillRect(x, H - yy - seg, w, seg);
        g.fillStyle = C(k, 0.22); g.fillRect(x, yy, w, seg);
      }
      g.fillStyle = C('star', 0.9); g.fillRect(x, H - z.peaks[i] - seg - 4, w, 3);
    }
  },
  // 3 · osciloscópio com a forma de onda real sobre a retícula
  scope(z, cx, cy, bass, M){
    g.beginPath();
    for (let i = 0; i <= 10; i++){ const x = W*i/10; g.moveTo(x, 0); g.lineTo(x, H); }
    for (let i = 0; i <= 8; i++){ const y = H*i/8; g.moveTo(0, y); g.lineTo(W, y); }
    g.strokeStyle = C('grid', 0.09); g.lineWidth = 1; g.stroke();
    const n = WAVE.length;
    for (const [k, off, al, inv] of [['sky3', -H*0.16, 0.35, -0.6], ['edge', 0, 1, 1], ['sun1', H*0.16, 0.35, -0.6]]){
      g.beginPath();
      for (let i = 0; i < n; i += 2){ const x = i / (n - 1) * W, y = cy + off + (WAVE[i] - 128) * H * 0.003 * inv; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      neon(k, al, 2);
    }
  },
  // 4 · teclado de sintetizador em perspectiva; acende as notas do acorde e do arpejo
  keys(z, cx, cy, bass, M){
    const HY = H*0.6, N = 22, kw = W*1.9/N, sh = 0.08;
    const px = (x, t) => cx + (x - cx) * (sh + (1 - sh) * t), py = t => HY + (H - HY) * t;
    const held = new Set(chordNow.map(n => ((n % 12) + 12) % 12));
    const flashOf = m => Math.max(keyFlash.get(m) || 0, keyFlash.get(m + 12) || 0, keyFlash.get(m - 12) || 0);
    const quad = (x0, x1, t1) => { g.beginPath(); g.moveTo(px(x0, 0), py(0)); g.lineTo(px(x1, 0), py(0)); g.lineTo(px(x1, t1), py(t1)); g.lineTo(px(x0, t1), py(t1)); g.closePath(); };
    const WPC = [0, 2, 4, 5, 7, 9, 11];
    for (let i = 0; i < N; i++){
      const x0 = cx + (i - N/2) * kw, pc = WPC[i % 7], m = 48 + Math.floor(i / 7) * 12 + pc;
      const lit = Math.max(held.has(pc) ? 0.35 : 0, flashOf(m));
      quad(x0, x0 + kw, 1);
      g.fillStyle = lit ? C('sun1', 0.25 + lit*0.6) : C('star', 0.1); g.fill();
      g.strokeStyle = C('grid', 0.7); g.lineWidth = 1; g.stroke();
    }
    const BPC = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
    for (let i = 0; i < N - 1; i++){
      const b = BPC[i % 7]; if (b === undefined) continue;
      const xm = cx + (i + 1 - N/2) * kw, m = 48 + Math.floor(i / 7) * 12 + b;
      const lit = Math.max(held.has(b) ? 0.35 : 0, flashOf(m));
      quad(xm - kw*0.3, xm + kw*0.3, 0.6);
      g.fillStyle = lit ? C('edge', 0.4 + lit*0.5) : C('sky0', 0.95); g.fill();
      g.strokeStyle = C('grid', 0.7); g.lineWidth = 1; g.stroke();
    }
  },
  // 5 · fita cassete C-60 gigante; a fita passa de um rolo para o outro durante a cena
  cassette(z, cx, cy, bass, M){
    const w = Math.min(W*0.8, M*1.25), h = w / 1.574, x = cx - w/2, y = cy - h/2;
    const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    rr(x, y, w, h, w*0.03); g.fillStyle = C('sky0', 0.85); g.fill(); neon('edge', 0.85, 2);
    const lx = x + w*0.06, ly = y + h*0.08, lw = w*0.88, lh = h*0.6;
    g.fillStyle = C('star', 0.07); g.fillRect(lx, ly, lw, lh);
    ['sun0', 'sun1', 'sun2', 'sky3'].forEach((k, i) => { g.fillStyle = C(k, 0.75); g.fillRect(lx, ly + lh*0.13 + i*lh*0.055, lw, lh*0.035); });
    g.fillStyle = C('star', 0.92); g.font = `700 ${Math.round(w*0.026)}px Syncopate, sans-serif`;
    g.fillText('SYNTHUNIVERSE', lx + lw*0.03, ly + lh*0.1);
    g.textAlign = 'right'; g.fillText('C-60 · LADO A', lx + lw*0.97, ly + lh*0.1); g.textAlign = 'start';
    const wx = x + w*0.27, wy = y + h*0.37, ww = w*0.46, wh = h*0.22;
    rr(wx, wy, ww, wh, wh*0.2); g.fillStyle = C('sky1', 0.95); g.fill(); neon('edge', 0.6, 1);
    const prog = Math.min(1, zoneT / (z.dur || 20));
    const reels = [[x + w*0.335, 1 - prog*0.7], [x + w*0.665, 0.3 + prog*0.7]], ry = wy + wh/2, hub = h*0.075;
    g.save(); rr(wx, wy, ww, wh, wh*0.2); g.clip();
    for (const [rx, amt] of reels){ g.beginPath(); g.arc(rx, ry, hub*(1.15 + amt*1.3), 0, Math.PI*2); g.fillStyle = C('mount', 0.95); g.fill(); g.strokeStyle = C('sun2', 0.4); g.lineWidth = 1; g.stroke(); }
    g.restore();
    reels.forEach(([rx], i) => {
      const a0 = T * (i ? 2.4 : 1.6);
      g.beginPath(); g.arc(rx, ry, hub, 0, Math.PI*2); g.fillStyle = C('sky0'); g.fill(); neon('star', 0.85, 1.5);
      g.beginPath(); for (let k = 0; k < 6; k++){ const a = a0 + k * Math.PI/3; g.moveTo(rx + Math.cos(a)*hub*0.45, ry + Math.sin(a)*hub*0.45); g.lineTo(rx + Math.cos(a)*hub*0.95, ry + Math.sin(a)*hub*0.95); }
      g.strokeStyle = C('star', 0.85); g.lineWidth = 2; g.stroke();
    });
    g.beginPath(); g.moveTo(x + w*0.2, y + h); g.lineTo(x + w*0.25, y + h*0.8); g.lineTo(x + w*0.75, y + h*0.8); g.lineTo(x + w*0.8, y + h); neon('edge', 0.6, 1.5);
    for (const [sx, sy] of [[0.04, 0.06], [0.96, 0.06], [0.04, 0.94], [0.96, 0.94], [0.5, 0.9]]){ g.beginPath(); g.arc(x + w*sx, y + h*sy, w*0.01, 0, Math.PI*2); g.strokeStyle = C('star', 0.6); g.lineWidth = 1; g.stroke(); }
  },
  // 6 · duas caixas de som; os cones empurram com o grave e soltam ondas no bumbo
  speakers(z, cx, cy, bass, M){
    const r = Math.min(H*0.12, W*0.085), age = T - lastKick;
    for (const side of [-1, 1]){
      const x = cx + side * (W*0.5 - r*1.6);
      g.beginPath(); g.rect(x - r*1.3, cy - r*3.9, r*2.6, r*7.8); g.fillStyle = C('sky0', 0.85); g.fill(); neon('edge', 0.6, 1.5);
      for (const [yy, size] of [[cy - r*2.7, 0.5], [cy - r*0.6, 1], [cy + r*2.1, 1]]){
        const rad = r * size, push = 1 + bass * (size > 0.6 ? 0.22 : 0.08);
        g.beginPath(); g.arc(x, yy, rad, 0, Math.PI*2); g.fillStyle = C('mount'); g.fill(); neon('grid', 0.8, 1.5);
        const cg = g.createRadialGradient(x, yy, 0, x, yy, rad*0.82*push);
        cg.addColorStop(0, C('sky2')); cg.addColorStop(1, C('sky0'));
        g.beginPath(); g.arc(x, yy, rad*0.82*push, 0, Math.PI*2); g.fillStyle = cg; g.fill();
        g.beginPath(); g.arc(x, yy, rad*0.6*push, 0, Math.PI*2); g.moveTo(x + rad*0.42*push, yy); g.arc(x, yy, rad*0.42*push, 0, Math.PI*2);
        g.strokeStyle = C('edge', 0.35); g.lineWidth = 1; g.stroke();
        const dg = g.createRadialGradient(x - rad*0.06, yy - rad*0.06, 0, x, yy, rad*0.25*push);
        dg.addColorStop(0, C('sun0')); dg.addColorStop(1, C('sun2'));
        g.beginPath(); g.arc(x, yy, rad*0.25*push, 0, Math.PI*2); g.fillStyle = dg; g.fill();
        if (size > 0.6 && age < 0.8){ g.beginPath(); g.arc(x, yy, rad + age*M*0.5, 0, Math.PI*2); g.strokeStyle = C('sky3', (1 - age/0.8)*0.6); g.lineWidth = 2; g.stroke(); }
      }
    }
  },
  // 7 · pauta ondulante; cada nota tocada entra pela direita na altura certa
  staff(z, cx, cy, bass, M){
    const sp = Math.max(10, H*0.028), wav = x => Math.sin(x*0.005 + T*1.4 + z.seed) * H*0.05;
    g.beginPath();
    for (let k = 0; k < 5; k++) for (let x = 0; x <= W + 16; x += 16){ const y = cy + (k - 2)*sp + wav(x); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    neon('star', 0.5, 1.2);
    g.font = `${Math.round(sp*3.2)}px ${SYMBOL_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const nt of staffNotes){
      const y = cy - nt.step * sp/2 + wav(nt.x) - sp*0.9;
      g.fillStyle = C(nt.k, 0.25); g.fillText(nt.g, nt.x + 2, y + 2);
      g.fillStyle = C(nt.k, 0.95); g.fillText(nt.g, nt.x, y);
    }
  },
  // 8 · metrônomo com o pêndulo batendo junto com o bumbo (♩ = 96)
  metro(z, cx, cy, bass, M){
    const base = H*0.92, top = H*0.2, bw = M*0.36, tw = M*0.1, hgt = base - top;
    g.beginPath(); g.moveTo(cx - bw/2, base); g.lineTo(cx - tw/2, top); g.lineTo(cx + tw/2, top); g.lineTo(cx + bw/2, base); g.closePath();
    g.fillStyle = C('sky0', 0.85); g.fill(); neon('edge', 0.85, 2);
    g.beginPath(); for (let i = 0; i < 14; i++){ const yy = top + hgt*0.12 + i*hgt*0.045; g.moveTo(cx - tw*0.22, yy); g.lineTo(cx + tw*0.22, yy); }
    g.strokeStyle = C('grid', 0.4); g.lineWidth = 1; g.stroke();
    const ph = Math.min(1, (T - lastKick) / 0.625), ang = beatSide * Math.cos(Math.PI * ph) * 0.42;
    const pvx = cx, pvy = base - hgt*0.12, L = hgt*0.95, sa = Math.sin(ang), ca = Math.cos(ang);
    g.beginPath(); g.moveTo(pvx, pvy); g.lineTo(pvx + sa*L, pvy - ca*L); neon('sun1', 0.95, Math.max(2, M*0.006));
    g.save(); g.translate(pvx + sa*L*0.62, pvy - ca*L*0.62); g.rotate(ang);
    g.fillStyle = C('sun2'); g.fillRect(-M*0.03, -M*0.02, M*0.06, M*0.04); g.strokeStyle = C('star', 0.8); g.lineWidth = 1.5; g.strokeRect(-M*0.03, -M*0.02, M*0.06, M*0.04);
    g.restore();
    g.fillStyle = C('star', 0.9); g.font = `700 ${Math.round(M*0.032)}px ${SYMBOL_FONT}`; g.textAlign = 'center';
    g.fillText('♩ = 96', cx, base - hgt*0.03);
    const age = T - lastKick;
    if (age < 0.6){ g.beginPath(); g.arc(cx, top, age*M*0.8, 0, Math.PI*2); g.strokeStyle = C('sky3', (1 - age/0.6)*0.5); g.lineWidth = 2; g.stroke(); }
  },
  // 9 · rádio FM: dial de 88 a 108 MHz passando e ondas saindo da antena
  radio(z, cx, cy, bass, M){
    const ay = H*0.12;
    for (let i = 0; i < 6; i++){ const f = (T*0.6 + i/6) % 1, r = f * M*0.9; g.beginPath(); g.arc(cx, ay, r, Math.PI*0.15, Math.PI*0.85); g.strokeStyle = C('sky3', (1 - f)*0.5); g.lineWidth = 2; g.stroke(); }
    g.beginPath(); g.moveTo(cx, ay); g.lineTo(cx - M*0.03, ay - M*0.08); g.moveTo(cx, ay); g.lineTo(cx + M*0.03, ay - M*0.08); g.moveTo(cx, ay); g.lineTo(cx, ay - M*0.1); neon('edge', 0.9, 1.5);
    const dy = cy + H*0.2, dh = Math.max(64, H*0.13), x0 = W*0.06, x1 = W*0.94, f = 88 + ((T*0.35 + z.seed) % 20), ppm = (x1 - x0) / 8;
    g.beginPath(); g.rect(x0, dy - dh/2, x1 - x0, dh); g.fillStyle = C('sky0', 0.85); g.fill(); neon('edge', 0.7, 1.5);
    g.save(); g.beginPath(); g.rect(x0, dy - dh/2, x1 - x0, dh); g.clip();
    g.beginPath();
    for (let d = Math.floor((f - 5) * 5); d <= (f + 5) * 5; d++){ const m = d / 5; if (m < 87.5 || m > 108) continue; const x = cx + (m - f)*ppm, len = d % 5 === 0 ? dh*0.35 : dh*0.15; g.moveTo(x, dy + dh/2); g.lineTo(x, dy + dh/2 - len); }
    g.strokeStyle = C('grid', 0.8); g.lineWidth = 1; g.stroke();
    g.fillStyle = C('star', 0.85); g.font = `600 ${Math.round(Math.max(11, dh*0.2))}px 'Chakra Petch', sans-serif`; g.textAlign = 'center';
    for (let m = Math.ceil((f - 5) / 2) * 2; m <= f + 5; m += 2){ if (m < 88 || m > 108) continue; g.fillText(String(m), cx + (m - f)*ppm, dy - dh*0.05); }
    g.restore();
    g.beginPath(); g.moveTo(cx, dy - dh*0.62); g.lineTo(cx, dy + dh*0.62); neon('sun2', 1, 2);
    g.fillStyle = C('sun0'); g.font = `700 ${Math.round(Math.max(14, M*0.034))}px Syncopate, sans-serif`;
    g.fillText('FM ' + f.toFixed(1).replace('.', ',') + ' MHz', cx, dy - dh*0.78);
    for (let i = 0; i < 5; i++){ const on = bass * 6 > i; g.fillStyle = C(on ? 'sun1' : 'star', on ? 0.9 : 0.15); g.fillRect(x1 - 70 + i*12, dy - dh*0.85 - i*5, 8, 8 + i*5); }
  },
  // 10 · mesa de som com os canais da própria trilha: faders, botões e medidores de nível
  mixer(z, cx, cy, bass, M){
    const all = [['KICK', 0], ['SNARE', 5], ['HAT', 10], ['BASS', 1], ['PAD', 3], ['ARP', 6], ['LEAD', 7], ['MASTER', -1]];
    const ch = W < 600 ? [all[0], all[3], all[6], all[7]] : all, n = ch.length;
    const ph = Math.min(H*0.44, 360), py0 = H - ph - H*0.03, pw = Math.min(W*0.92, n*120), px0 = cx - pw/2, cw = pw/n;
    g.beginPath(); g.rect(px0, py0, pw, ph); g.fillStyle = C('sky0', 0.82); g.fill(); neon('edge', 0.7, 1.5);
    if (!z.fad || z.fad.length !== n) z.fad = new Float32Array(n);
    ch.forEach(([label, b], i) => {
      const x = px0 + cw*i + cw/2;
      let v = b < 0 ? (band(0, 12) + band(3, 12) + band(6, 12)) / 3 : band(b, 12);
      v = Math.min(1, v * 1.3); z.fad[i] += (v - z.fad[i]) * 0.08;
      for (let k = 0; k < 2; k++){
        const ky = py0 + ph*0.12 + k*ph*0.14, kr = Math.min(cw*0.15, ph*0.05), a = -2.4 + (0.2 + z.fad[i]*0.6 + k*0.15 + 0.1*Math.sin(T*0.5 + i)) * 4.8;
        g.beginPath(); g.arc(x, ky, kr, 0, Math.PI*2); g.fillStyle = C('mount'); g.fill(); neon('grid', 0.8, 1.2);
        g.beginPath(); g.moveTo(x, ky); g.lineTo(x + Math.cos(a)*kr, ky + Math.sin(a)*kr); g.strokeStyle = C('star', 0.9); g.lineWidth = 2; g.stroke();
      }
      const ty0 = py0 + ph*0.42, ty1 = py0 + ph*0.86;
      g.beginPath(); g.moveTo(x - cw*0.08, ty0); g.lineTo(x - cw*0.08, ty1); g.strokeStyle = C('star', 0.3); g.lineWidth = 2; g.stroke();
      const fy = ty1 - (0.25 + 0.65*z.fad[i]) * (ty1 - ty0);
      g.fillStyle = C('sun1'); g.fillRect(x - cw*0.08 - cw*0.16, fy - 5, cw*0.32, 10);
      const leds = 12, lh = (ty1 - ty0) / leds, on = Math.round(v * leds);
      for (let l = 0; l < leds; l++){
        const k = l < 8 ? 'grid' : l < 10 ? 'sun1' : 'sun2';
        g.fillStyle = C(k, l < on ? 0.95 : 0.12); g.fillRect(x + cw*0.18, ty1 - (l + 1)*lh + 1, cw*0.12, lh - 2);
      }
      g.fillStyle = C('star', 0.85); g.font = `600 ${Math.round(Math.max(10, cw*0.12))}px 'Chakra Petch', sans-serif`; g.textAlign = 'center';
      g.fillText(label, x, py0 + ph*0.96);
    });
  }
};
function drawFeature(z, a, cx, cy, sc){
  if (a <= 0) return;
  const ga = g.globalAlpha; g.globalAlpha = ga * a;
  FEAT[z.feature](z, cx, cy, band(0, 12), Math.min(W, H));
  g.globalAlpha = ga; g.globalCompositeOperation = 'source-over'; g.setLineDash([]);
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}
function drawInfinite(dt, alpha){
  const cx = W/2 - mx*30, cy = H/2 - my*20, sc = Math.max(W, H) * 0.5;
  g.globalAlpha = alpha;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
  bg.addColorStop(0, C('sky1')); bg.addColorStop(1, C('sky0'));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (zone || prevZone) readAudio();
  if (prevZone) drawFeature(prevZone, prevZone.fade, cx, cy, sc);
  if (zone) drawFeature(zone, zone.fade, cx, cy, sc);
  const zs = zone ? zone.speed : 1;
  if (journey.phase === 'infinite') drawStars(cx, cy, sc, 0.1 * zs + warp*warp*(REDUCED ? 0.2 : 2.4) + pulse*0.03, H, dt);
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

/* ============================ CENAS & HUD ============================ */
let scene = 'portrait', busy = false;
const ui = { steps: [$('stepP'), $('stepC'), $('stepI')], cta: $('cta'), ctaTxt: $('ctaTxt'), label: $('sceneLabel'), name: $('sceneName'), hint: $('sceneHint'), track: $('trackName'), dist: $('distance'), soundBtn: $('soundBtn'), soundTxt: $('soundTxt') };
const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function updateHud(){
  const st = scene === 'portrait' ? 0 : scene === 'cosmos' ? 1 : 2;
  ui.steps.forEach((e, i) => i === st ? e.setAttribute('aria-current', 'step') : e.removeAttribute('aria-current'));
  ui.ctaTxt.textContent = scene === 'portrait' ? 'Entrar no universo' : 'Reiniciar';
  const txt = {
    portrait: ['Cena 01 · Retrato', 'Azul em nanquim', 'Passe o cursor (ou toque) nela para ver o sorriso.'],
    cosmos:   ['Cena 02 · Cosmos', palTo.name, 'Em instantes a viagem segue sozinha. Clique no céu para soltar estrelas cadentes.'],
    lift:     ['Decolagem', 'Rumo ao infinito', 'O horizonte ficou para trás.'],
    infinite: ['Cena 03 · Universo infinito', palTo.name, 'Dez cenas musicais em sequência. Depois da décima, elas recomeçam com novas cores e outro tom. Clique no céu para soltar estrelas cadentes; Reiniciar volta ao início.']
  }[scene];
  ui.label.textContent = txt[0]; ui.name.textContent = txt[1]; ui.hint.textContent = txt[2];
  ui.dist.hidden = scene !== 'infinite';
  updateSound();
}
function updateSound(){
  ui.track.textContent = Sound.label();
  const on = Sound.running && !Sound.muted;
  ui.soundBtn.classList.toggle('on', on);
  ui.soundBtn.setAttribute('aria-pressed', String(on));
  ui.soundTxt.textContent = on ? 'Som ligado' : (Sound.running ? 'Som mudo' : 'Ligar som');
}
Sound.onChange(updateSound);

// fim da cena 01: sorriso, glitch e dissolução
function toCosmos(){
  if (scene !== 'portrait' || busy) return; busy = true;
  Sound.start(); Sound.setLevel(1); Sound.whoosh();
  P.force = true;
  setTimeout(() => {
    el.figure.classList.remove('arriving'); el.figure.classList.add('leaving');
    el.app.dataset.scene = 'leaving'; spaceOn = true; warp = 1; palK = 1;
  }, 420);
  setTimeout(burst, 880);
  setTimeout(() => {
    el.app.dataset.scene = 'cosmos'; scene = 'cosmos'; busy = false; P.force = false;
    journey.phase = 'cosmos'; journey.t = 0;
    updateHud();
  }, 1750);
}
// fim da cena 02: o sol afunda, a grade acelera e a câmera decola
function startLift(){
  journey.phase = 'lift'; journey.t = 0;
  scene = 'lift'; el.app.dataset.scene = 'lift';
  Sound.whoosh();
  objs.length = 0;
  for (let i = 0; i < 7; i++) spawnObj(1.2 + Math.random() * 2.8);
  for (let i = 0; i < 6; i++) setTimeout(() => { if (journey.phase === 'lift') spawnShoot(Math.random() * W, Math.random() * H * 0.3); }, i * 380);
  updateHud();
}
// cena 03: universo infinito, só para em "Reiniciar"
function startInfinite(){
  journey.phase = 'infinite'; journey.t = 0;
  scene = 'infinite'; el.app.dataset.scene = 'infinite';
  warp = 1; flash = 1; ly = 0; autoPalT = 0; spawnT = 0.5; ringT = 1;
  Sound.setLevel(2);
  zone = null; prevZone = null; zoneN = 0;
  newZone();
}
function restart(){
  if (scene === 'portrait' || busy) return; busy = true;
  journey.phase = 'idle'; journey.t = 0;
  Sound.setLevel(0); Sound.setVariation(0, 0);
  zone = null; prevZone = null; staffNotes.length = 0; keyFlash.clear(); setPal(PAL[palI], 0.9);
  scene = 'portrait'; el.app.dataset.scene = 'portrait';
  el.figure.classList.remove('leaving'); void el.figure.offsetWidth; el.figure.classList.add('arriving');
  updateHud();
  setTimeout(() => { spaceOn = false; parts.length = 0; shoots.length = 0; objs.length = 0; warp = 0; busy = false; }, 1100);
}
function nextPalette(d = 1){
  palI = (palI + d + PAL.length) % PAL.length; setPal(PAL[palI], 0.9); flash = 1;
  updateHud();
}

ui.cta.addEventListener('click', () => scene === 'portrait' ? toCosmos() : restart());
ui.soundBtn.addEventListener('click', () => { if (!Sound.running) Sound.start(); else Sound.setMuted(!Sound.muted); });
$('trackFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  Sound.useTrack(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ''));
  Sound.start();
});
// o som começa na primeira interação (exigência dos navegadores)
document.addEventListener('pointerdown', e => {
  if (Sound.running || e.target.closest('#soundBtn,label[for="trackFile"]')) return;
  Sound.start();
}, true);
document.addEventListener('keydown', e => {
  if (scene === 'portrait') return;
  if (e.key === 'ArrowRight') nextPalette(1);
  else if (e.key === 'ArrowLeft') nextPalette(-1);
});
cv.addEventListener('pointerdown', e => {
  if (scene === 'portrait') return;
  spawnShoot(e.clientX, e.clientY, e.clientX > W/2 ? -1 : 1);
  for (let i = 0; i < 26; i++){
    const a = Math.random() * 6.28, sp = 30 + Math.random() * 120, life = 0.5 + Math.random() * 0.7;
    parts.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, r: 1.5, c: i % 2 ? '#ffffff' : '#ff3fb4' });
  }
});
addEventListener('pointermove', e => { tmx = (e.clientX / W) * 2 - 1; tmy = (e.clientY / H) * 2 - 1; });

if (CONFIG.musicUrl) Sound.useTrack(CONFIG.musicUrl, 'sua trilha');

function onEvent(ev){
  if (ev.type === 'kick') onKick();
  else if (ev.type === 'snare') flash = Math.max(flash, 0.6);
  else if (ev.type === 'bar'){
    if (scene === 'portrait' && ev.bar % 2 === 0){ P.target = 1; P.nextSwap = 1.8; }
    if (scene === 'cosmos' && Math.random() < 0.5) spawnShoot(Math.random() * W, Math.random() * H * 0.2);
    if (ev.chord) chordNow = ev.chord;
    if (journey.phase === 'infinite' && ev.bar % 2 === 0) spawnObj(ZMAX, 'ring');
  }
  else if (ev.type === 'note'){
    let n = ev.n; while (n < 48) n += 12; while (n > 83) n -= 12;
    keyFlash.set(n, 1);
    if (zone && zone.feature === 'staff') addStaffNote(ev.n);
  }
}

let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
  Sound.poll(onEvent);
  const silent = !Sound.running || Sound.muted;
  if (spaceOn && silent){ beatClock += dt; if (beatClock >= 0.625){ beatClock -= 0.625; onKick(); } }

  if (journey.phase !== 'idle') journey.t += dt;
  if (journey.phase === 'cosmos' && journey.t >= COSMOS_HOLD) startLift();
  else if (journey.phase === 'lift' && journey.t >= LIFT) startInfinite();
  if (journey.phase === 'infinite'){
    ly += dt * 2380 * (1 + warp * 6);
    hudT -= dt; if (hudT <= 0){ hudT = 0.2; ui.dist.textContent = 'Faixa ' + (zone.idx + 1) + ' de ' + SCENES.length + ' · volta ' + zone.loop + ' · ' + fmt.format(ly) + ' anos-luz'; }
    zoneT += dt; zone.fade = Math.min(1, zone.fade + dt / 3);
    if (prevZone){ prevZone.fade -= dt / 3; if (prevZone.fade <= 0) prevZone = null; }
    if (zoneT >= zone.dur) newZone();
    spawnT -= dt; if (spawnT <= 0){ spawnObj(ZMAX); spawnT = zone.rate * (0.6 + Math.random() * 0.8); }
    if (silent){ ringT -= dt; if (ringT <= 0){ spawnObj(ZMAX, 'ring'); ringT = 5; } }
    // sem a trilha sintetizada, as notas do teclado e da pauta são simuladas no mesmo andamento
    if (!Sound.synth){ noteClock -= dt; if (noteClock <= 0){ noteClock = 0.3125; onEvent({ type: 'note', n: pick(chordNow) + 12 }); } }
    for (const [k, v] of keyFlash){ const nv = v - dt * 2.5; if (nv <= 0) keyFlash.delete(k); else keyFlash.set(k, nv); }
    for (let i = staffNotes.length - 1; i >= 0; i--){ staffNotes[i].x -= dt * Math.max(140, W * 0.16); if (staffNotes[i].x < -40) staffNotes.splice(i, 1); }
  }

  if (scene === 'portrait' || busy) updatePortrait(dt, T);
  if (spaceOn) drawSpace(dt);
  requestAnimationFrame(frame);
}
applyFace(0, 0, 0);
updateHud();
requestAnimationFrame(frame);
