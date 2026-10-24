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

