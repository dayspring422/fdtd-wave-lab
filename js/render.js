// render.js
// Draws the simulation: the field as a colored image at grid resolution (scaled up by
// the browser), plus an overlay canvas at screen resolution for sources and the brush.

(function (WL) {
  'use strict';

  function hexToRgb(v) {
    v = v.trim().replace('#', '');
    if (v.length === 3) v = [...v].map(c => c + c).join('');
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  WL.createRenderer = function (sim, fieldCanvas, overlayCanvas) {
    const { W, H, K } = sim;
    const fctx = fieldCanvas.getContext('2d');
    const img = fctx.createImageData(W, H);
    const octx = overlayCanvas.getContext('2d');
    const colors = {};
    const sample = new Float32Array(Math.ceil(W * H / 5));

    const r = { scale: 20 };

    // Colors come from CSS variables so the display follows light and dark themes.
    r.readColors = function () {
      const cs = getComputedStyle(document.documentElement);
      for (const t of ['field-zero', 'field-pos', 'field-neg', 'conductor', 'glass', 'int', 'accent', 'fg']) {
        colors[t] = hexToRgb(cs.getPropertyValue('--' + t));
      }
    };

    // Automatic brightness: scale so the 97th-percentile field value sits near full color.
    // Cells right next to point sources are skipped, since the field there is huge.
    r.autoscale = function (view) {
      let n = 0;
      for (let q = 0; q < W * H; q += 5) {
        const k = K(q % W, (q / W) | 0);
        if (sim.mat[k] === WL.CONDUCTOR || sim.nearSrc[k]) continue;
        sample[n++] = view === 'field' ? Math.abs(sim.Ez[k]) : Math.sqrt(sim.I[k]);
      }
      if (!n) return;
      const arr = sample.subarray(0, n);
      arr.sort();
      const p = arr[Math.floor(n * 0.97)];
      const target = Math.min(40, 1 / Math.max(p, 1e-4));
      r.scale += (target - r.scale) * 0.12;
    };

    r.render = function ({ view, gain, hover, tool, brush }) {
      const d = img.data;
      const z = colors['field-zero'], pos = colors['field-pos'], neg = colors['field-neg'];
      const cond = colors.conductor, gl = colors.glass, it = colors.int;
      const g = r.scale * gain * 0.85;
      const isField = view === 'field';

      let o = 0;
      for (let v = 0; v < H; v++) {
        for (let u = 0; u < W; u++, o += 4) {
          const k = K(u, v), m = sim.mat[k];
          let R, G, B;
          if (m === WL.CONDUCTOR) {
            [R, G, B] = cond;
          } else {
            let c, a;
            if (isField) {
              // Diverging map: positive Ez one color, negative the other, zero = background.
              const x = Math.tanh(sim.Ez[k] * g);
              c = x > 0 ? pos : neg; a = Math.abs(x);
            } else {
              c = it; a = Math.tanh(Math.sqrt(sim.I[k]) * g * 0.8);
            }
            R = z[0] + (c[0] - z[0]) * a;
            G = z[1] + (c[1] - z[1]) * a;
            B = z[2] + (c[2] - z[2]) * a;
            if (m === WL.GLASS) { R = R * 0.74 + gl[0] * 0.26; G = G * 0.74 + gl[1] * 0.26; B = B * 0.74 + gl[2] * 0.26; }
          }
          d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);
      drawOverlay(hover, tool, brush);
    };

    function drawOverlay(hover, tool, brush) {
      const dpr = globalThis.devicePixelRatio || 1;
      const w = overlayCanvas.clientWidth, h = overlayCanvas.clientHeight;
      if (overlayCanvas.width !== Math.round(w * dpr) || overlayCanvas.height !== Math.round(h * dpr)) {
        overlayCanvas.width = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
      }
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.clearRect(0, 0, w, h);
      const sx = w / W, sy = h / H, accent = `rgb(${colors.accent})`;

      for (const s of sim.sources) {
        if (s.type === 'point') {
          octx.beginPath();
          octx.arc((s.u + 0.5) * sx, (s.v + 0.5) * sy, 5, 0, 2 * Math.PI);
          octx.fillStyle = accent; octx.fill();
          octx.lineWidth = 1.5; octx.strokeStyle = `rgb(${colors['field-zero']})`; octx.stroke();
        } else {
          octx.save();
          octx.setLineDash([5, 5]); octx.strokeStyle = accent; octx.lineWidth = 2;
          const x = (s.u + 0.5) * sx;
          octx.beginPath();
          if (s.width) {
            octx.moveTo(x, Math.max(0, (s.vc - 1.6 * s.width) * sy));
            octx.lineTo(x, Math.min(h, (s.vc + 1.6 * s.width) * sy));
          } else {
            octx.moveTo(x, 0); octx.lineTo(x, h);
          }
          octx.stroke();
          octx.restore();
        }
      }

      if (hover && tool !== 'source') {
        octx.beginPath();
        octx.arc((hover.u + 0.5) * sx, (hover.v + 0.5) * sy, brush * sx, 0, 2 * Math.PI);
        octx.globalAlpha = 0.6; octx.lineWidth = 1; octx.strokeStyle = `rgb(${colors.fg})`;
        octx.stroke(); octx.globalAlpha = 1;
      }
    }

    return r;
  };
})(globalThis.WaveLab = globalThis.WaveLab || {});
