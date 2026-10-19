// solver.js
// 2D FDTD solver for Maxwell's equations in TMz mode (Ez, Hx, Hy) on a Yee grid.
//
//   dEz/dt =  (1/eps) (dHy/dx - dHx/dy)
//   dHx/dt = -(1/mu)   dEz/dy
//   dHy/dt =  (1/mu)   dEz/dx
//
// Units are normalized: dx = 1 cell, H is scaled by the free-space impedance so E and H
// share units, and S = c*dt/dx is the Courant number. In 2D the scheme is stable for
// S <= 1/sqrt(2); we use 0.5.

(function (WL) {
  'use strict';

  WL.VACUUM = 0;
  WL.GLASS = 1;
  WL.CONDUCTOR = 2;

  WL.createSolver = function ({ W = 320, H = 180, P = 20, S = 0.5 } = {}) {
    // W x H is the visible region. P cells of absorbing layer surround it on every side.
    const NX = W + 2 * P, NY = H + 2 * P, N = NX * NY;

    const sim = {
      W, H, P, NX, NY, N, S,
      Ez: new Float32Array(N),
      Hx: new Float32Array(N),
      Hy: new Float32Array(N),
      I: new Float32Array(N),         // running time-average of Ez^2 (intensity)
      mat: new Uint8Array(N),         // material per cell; interior cells are authoritative
      nearSrc: new Uint8Array(N),     // cells close to a point source (skipped by autoscale)
      sources: [],
      t: 0,                           // time step counter
      lambda: 18,                     // wavelength in cells
      n: 1.5,                         // refractive index of glass
      dirty: true                     // coefficients need recomputing
    };

    // Update coefficients for each cell.
    const ca = new Float32Array(N), cb = new Float32Array(N);
    const da = new Float32Array(N), db = new Float32Array(N);

    // Absorbing layer: loss grows as the cube of depth into the layer. Applying the same
    // normalized loss to E and H (sigma*/mu = sigma/eps) keeps the layer impedance-matched,
    // so waves enter it without reflecting and then decay.
    const sig = new Float32Array(N);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const d = Math.max(P - i, i - (NX - 1 - P), P - j, j - (NY - 1 - P), 0);
        sig[j * NX + i] = d > 0 ? 0.35 * Math.pow(d / P, 3) : 0;
      }
    }

    // Grid index for interior coordinates (u, v), where (0, 0) is the top-left visible cell.
    sim.K = (u, v) => (v + P) * NX + (u + P);

    sim.computeCoeffs = function () {
      const epsGlass = sim.n * sim.n;  // eps_r = n^2
      for (let j = 0; j < NY; j++) {
        const vj = Math.min(H - 1, Math.max(0, j - P));
        for (let i = 0; i < NX; i++) {
          const ui = Math.min(W - 1, Math.max(0, i - P));
          const k = j * NX + i;
          // Cells in the absorbing layer copy the nearest interior material, so walls and
          // glass continue into the layer instead of ending abruptly at the screen edge.
          const m = sim.mat[sim.K(ui, vj)];
          const eps = m === WL.GLASS ? epsGlass : 1;
          const l = sig[k] / eps;
          if (m === WL.CONDUCTOR) {
            ca[k] = 0; cb[k] = 0;        // perfect conductor: Ez stays 0
          } else {
            ca[k] = (1 - l) / (1 + l);
            cb[k] = S / eps / (1 + l);
          }
          da[k] = (1 - l) / (1 + l);
          db[k] = S / (1 + l);
        }
      }

      sim.nearSrc.fill(0);
      for (const s of sim.sources) {
        if (s.type !== 'point') continue;
        for (let dv = -6; dv <= 6; dv++) {
          for (let du = -6; du <= 6; du++) {
            const u = s.u + du, v = s.v + dv;
            if (u >= 0 && u < W && v >= 0 && v < H) sim.nearSrc[sim.K(u, v)] = 1;
          }
        }
      }
      sim.dirty = false;
    };

    sim.step = function () {
      if (sim.dirty) sim.computeCoeffs();
      const { Ez, Hx, Hy, I } = sim;

      // H half-step: Faraday's law
      for (let j = 0; j < NY - 1; j++) {
        let k = j * NX;
        for (let i = 0; i < NX; i++, k++) Hx[k] = da[k] * Hx[k] - db[k] * (Ez[k + NX] - Ez[k]);
      }
      for (let j = 0; j < NY; j++) {
        let k = j * NX;
        for (let i = 0; i < NX - 1; i++, k++) Hy[k] = da[k] * Hy[k] + db[k] * (Ez[k + 1] - Ez[k]);
      }

      // E half-step: Ampere-Maxwell law
      for (let j = 1; j < NY; j++) {
        let k = j * NX + 1;
        for (let i = 1; i < NX; i++, k++) {
          Ez[k] = ca[k] * Ez[k] + cb[k] * ((Hy[k] - Hy[k - 1]) - (Hx[k] - Hx[k - NX]));
        }
      }

      addSources();

      for (let k = 0; k < N; k++) I[k] = I[k] * 0.985 + Ez[k] * Ez[k] * 0.015;
      sim.t++;
    };

    // Soft sources: add a sinusoid to Ez instead of overwriting it, so waves pass through.
    function addSources() {
      const T = sim.lambda / S;                         // period in time steps
      const w = 2 * Math.PI / T;                        // angular frequency per step
      const kw = 2 * Math.PI / sim.lambda;              // wavenumber per cell
      const ramp = Math.min(1, sim.t / (1.5 * T));      // fade in to avoid a sharp transient
      const { Ez, mat } = sim;

      for (const s of sim.sources) {
        if (s.type === 'point') {
          const k = sim.K(s.u, s.v);
          if (mat[k] !== WL.CONDUCTOR) Ez[k] += ramp * Math.sin(w * sim.t + (s.phase || 0));
          continue;
        }
        // Line source: a column of sources. A phase that varies along the column tilts the
        // wavefront by s.angle; a Gaussian window (s.width) turns it into a beam.
        const sn = Math.sin((s.angle || 0) * Math.PI / 180);
        const i = s.u + P;
        for (let j = 0; j < NY; j++) {
          const v = j - P;
          let a = 0.35;
          if (s.width) a *= Math.exp(-(((v - s.vc) / s.width) ** 2));
          if (a < 1e-3) continue;
          if (mat[sim.K(s.u, Math.min(H - 1, Math.max(0, v)))] === WL.CONDUCTOR) continue;
          Ez[j * NX + i] += ramp * a * Math.sin(w * sim.t - kw * sn * v);
        }
      }
    }

    sim.clearFields = function () {
      sim.Ez.fill(0); sim.Hx.fill(0); sim.Hy.fill(0); sim.I.fill(0);
      sim.t = 0;
    };

    return sim;
  };
})(globalThis.WaveLab = globalThis.WaveLab || {});
