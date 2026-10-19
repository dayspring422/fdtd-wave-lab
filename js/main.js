// main.js
// Connects the solver, presets and renderer to the page controls.

(function (WL) {
  'use strict';

  const $ = id => document.getElementById(id);
  const sim = WL.createSolver();
  const renderer = WL.createRenderer(sim, $('field'), $('overlay'));
  const lock = WL.createLockIn(sim, { settle: 900 });   // measures the field for the readout
  const { W, H, K } = sim;
  const BRUSH = 4;  // brush radius in cells

  const ui = {
    preset: 'slit',
    view: 'field',
    tool: 'source',
    speed: 3,         // time steps per animation frame
    gain: 1,
    phaseStep: 0,     // degrees, for the antenna array
    running: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    hover: null
  };

  // ---------- presets ----------
  function loadPreset(id) {
    const p = WL.PRESETS[id];
    ui.preset = id;
    sim.mat.fill(WL.VACUUM);
    sim.clearFields();
    setN(p.n || 1.5);
    p.build(sim, ui);
    setView(p.view);
    $('phaseGroup').hidden = !p.phase;
    $('exTitle').textContent = p.title;
    $('exBody').innerHTML = p.body;
    document.querySelectorAll('#presets .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === id));
    lock.reset();
    updateReadout();
    sim.dirty = true;
  }

  // Advance one time step, feeding the lock-in amplifier when this preset measures.
  function advance() {
    sim.step();
    if (WL.PRESETS[ui.preset].measure) lock.sample();
  }

  const presetBar = $('presets');
  for (const [id, p] of Object.entries(WL.PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.p = id;
    b.textContent = p.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => loadPreset(id));
    presetBar.appendChild(b);
  }

  // ---------- readouts ----------
  function updateStatus() {
    const T = sim.lambda / sim.S;
    $('status').innerHTML =
      `<span>step <b>${sim.t}</b></span>` +
      `<span>λ <b>${sim.lambda}</b> cells</span>` +
      `<span>period <b>${T.toFixed(0)}</b> steps</span>` +
      `<span>Courant S <b>${sim.S.toFixed(2)}</b></span>` +
      `<span>glass speed <b>${(1 / sim.n).toFixed(2)}c</b></span>`;
  }

  // Measured values next to theory. For refraction everything on the left of the comparison
  // is read from the simulated field (see measure.js); only the incident angle is an input.
  function updateReadout() {
    const r = $('readout');
    const m = WL.PRESETS[ui.preset].measure;
    if (m) {
      r.hidden = false;
      if (!lock.ready) {
        r.textContent = `Measuring from the field: waiting for steady state (${Math.round(lock.progress() * 100)}%)`;
        return;
      }
      const res = WL.measureTransmitted(sim, lock, m);
      const spErr = Math.abs(res.speed - res.speedTheory) / res.speedTheory * 100;
      r.innerHTML =
        `<span>θ₁ = ${m.thetaInc.toFixed(1)}° (set at the source)</span>` +
        `<span>θ₂ measured from the field: <b>${res.theta2.toFixed(2)}°</b></span>` +
        `<span>Snell's law predicts ${res.predicted.toFixed(2)}° · difference ${res.errPct.toFixed(2)}%</span>` +
        `<span>Speed in glass: measured <b>${res.speed.toFixed(3)}c</b>, theory c/n = ${res.speedTheory.toFixed(3)}c · difference ${spErr.toFixed(2)}%</span>`;
    } else if (ui.preset === 'guide') {
      r.hidden = false;
      r.textContent = `Critical angle for total internal reflection: θc = ${(Math.asin(1 / sim.n) * 180 / Math.PI).toFixed(1)}° (from the strip's edge normal)`;
    } else {
      r.hidden = true;
    }
  }

  // ---------- drawing on the field ----------
  function cellFromEvent(e) {
    const rect = $('overlay').getBoundingClientRect();
    return {
      u: Math.min(W - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * W))),
      v: Math.min(H - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rect.height * H)))
    };
  }

  function paint(c) {
    const val = ui.tool === 'conductor' ? WL.CONDUCTOR : ui.tool === 'glass' ? WL.GLASS : WL.VACUUM;
    for (let dv = -BRUSH; dv <= BRUSH; dv++) {
      for (let du = -BRUSH; du <= BRUSH; du++) {
        if (du * du + dv * dv > BRUSH * BRUSH) continue;
        const u = c.u + du, v = c.v + dv;
        if (u < 0 || u >= W || v < 0 || v >= H) continue;
        const k = K(u, v);
        sim.mat[k] = val;
        if (val === WL.CONDUCTOR) { sim.Ez[k] = 0; sim.I[k] = 0; }
      }
    }
    if (ui.tool === 'erase') {
      sim.sources = sim.sources.filter(s => s.type !== 'point' || (s.u - c.u) ** 2 + (s.v - c.v) ** 2 > (BRUSH + 2) ** 2);
    }
    sim.dirty = true;
    lock.reset();
  }

  const overlay = $('overlay');
  let down = false, last = null;

  overlay.addEventListener('pointerdown', e => {
    const c = cellFromEvent(e);
    if (ui.tool === 'source') {
      const hit = sim.sources.findIndex(s => s.type === 'point' && (s.u - c.u) ** 2 + (s.v - c.v) ** 2 <= 25);
      if (hit >= 0) sim.sources.splice(hit, 1);
      else if (sim.sources.filter(s => s.type === 'point').length < 12) sim.sources.push({ type: 'point', u: c.u, v: c.v, phase: 0 });
      sim.dirty = true;
      lock.reset();
      return;
    }
    down = true; last = c;
    overlay.setPointerCapture(e.pointerId);
    paint(c);
  });

  overlay.addEventListener('pointermove', e => {
    const c = cellFromEvent(e);
    ui.hover = c;
    if (!down) return;
    // Fill in between pointer events so fast strokes stay continuous.
    const n = Math.max(Math.abs(c.u - last.u), Math.abs(c.v - last.v), 1);
    for (let s = 1; s <= n; s++) {
      paint({ u: Math.round(last.u + (c.u - last.u) * s / n), v: Math.round(last.v + (c.v - last.v) * s / n) });
    }
    last = c;
  });
  overlay.addEventListener('pointerup', () => { down = false; });
  overlay.addEventListener('pointerleave', () => { ui.hover = null; });

  const HINTS = {
    source: 'Click to add a point source. Click a source again to remove it.',
    conductor: 'Drag to draw a perfect conductor. Waves reflect off it.',
    glass: 'Drag to paint glass with the refractive index set below.',
    erase: 'Drag to erase drawings and point sources.'
  };
  document.querySelectorAll('#tools .tool').forEach(b => b.addEventListener('click', () => {
    ui.tool = b.dataset.tool;
    document.querySelectorAll('#tools .tool').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('toolHint').textContent = HINTS[ui.tool];
  }));

  // ---------- controls ----------
  function setView(v) {
    ui.view = v;
    $('viewField').setAttribute('aria-pressed', v === 'field');
    $('viewInt').setAttribute('aria-pressed', v === 'intensity');
    renderer.scale = 20;
  }
  function setN(n) {
    sim.n = n;
    $('nIdx').value = n;
    $('nOut').textContent = n.toFixed(2);
    sim.dirty = true;
    lock.reset();
    updateReadout();
  }
  function setPlay(r) {
    ui.running = r;
    $('play').textContent = r ? 'Pause' : 'Play';
  }

  $('play').addEventListener('click', () => setPlay(!ui.running));
  $('stepBtn').addEventListener('click', () => { setPlay(false); advance(); });
  $('resetFields').addEventListener('click', () => { sim.clearFields(); lock.reset(); renderer.scale = 20; });

  // Boundary switch: compare the split-field PML with the older graded-loss layer.
  document.querySelectorAll('#bounds .tool').forEach(b => b.addEventListener('click', () => {
    sim.setBoundary(b.dataset.b);
    document.querySelectorAll('#bounds .tool').forEach(x => x.setAttribute('aria-pressed', x === b));
    lock.reset();
  }));
  $('viewField').addEventListener('click', () => setView('field'));
  $('viewInt').addEventListener('click', () => setView('intensity'));
  $('clearAll').addEventListener('click', () => { sim.mat.fill(WL.VACUUM); sim.sources = []; sim.clearFields(); sim.dirty = true; });

  $('lam').addEventListener('input', e => { sim.lambda = +e.target.value; $('lamOut').textContent = sim.lambda + ' cells'; });
  $('speed').addEventListener('input', e => { ui.speed = +e.target.value; $('speedOut').textContent = ui.speed + ' steps/frame'; });
  $('gain').addEventListener('input', e => { ui.gain = +e.target.value; $('gainOut').textContent = '×' + ui.gain.toFixed(1); });
  $('nIdx').addEventListener('input', e => setN(+e.target.value));
  $('phase').addEventListener('input', e => {
    ui.phaseStep = +e.target.value;
    $('phaseOut').textContent = ui.phaseStep + '°';
    WL.applyPhase(sim, ui.phaseStep);
  });
  ['lam', 'speed', 'gain', 'phase'].forEach(id => $(id).dispatchEvent(new Event('input')));

  // ---------- theme ----------
  renderer.readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderer.readColors);
  new MutationObserver(renderer.readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- start ----------
  loadPreset('slit');
  setPlay(ui.running);
  // Warm up so the first frame already shows waves instead of an empty screen.
  for (let s = 0; s < 260; s++) advance();
  for (let s = 0; s < 30; s++) renderer.autoscale(ui.view);

  let frame = 0;
  function loop() {
    if (ui.running) for (let s = 0; s < ui.speed; s++) advance();
    else if (sim.dirty) sim.computeCoeffs();
    if (frame % 6 === 0) renderer.autoscale(ui.view);
    if (frame % 15 === 0 && WL.PRESETS[ui.preset].measure) updateReadout();
    frame++;
    renderer.render({ view: ui.view, gain: ui.gain, hover: ui.hover, tool: ui.tool, brush: BRUSH });
    updateStatus();
    requestAnimationFrame(loop);
  }
  loop();
})(globalThis.WaveLab);
