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
//
// Ez is stored split into two parts, Ez = Ezx + Ezy, so the absorbing boundary can damp
// waves travelling in x and in y independently (a split-field PML, after Berenger 1994).
// Away from the boundary the split changes nothing: the two parts simply add up to the
// ordinary Yee update.

(function (WL) {
  'use strict';

  WL.VACUUM = 0;
  WL.GLASS = 1;
  WL.CONDUCTOR = 2;

  // boundary: 'pml'    split-field perfectly matched layer (default)
  //           'graded' the same loss applied equally to every field component. This is
  //                    impedance matched only for waves hitting it head-on, so it reflects
  //                    more at oblique angles. Kept for comparison.
  WL.createSolver = function ({ W = 320, H = 180, P = 20, S = 0.5, boundary = 'pml', lossMax = 0.35 } = {}) {
    const NX = W + 2 * P, NY = H + 2 * P, N = NX * NY;

    const sim = {
      W, H, P, NX, NY, N, S,
      Ez: new Float32Array(N),
      Ezx: new Float32Array(N),
      Ezy: new Float32Array(N),
      Hx: new Float32Array(N),
      Hy: new Float32Array(N),
      I: new Float32Array(N),         // running time-average of Ez^2 (intensity)
      mat: new Uint8Array(N),         // material per cell; interior cells are authoritative
      nearSrc: new Uint8Array(N),     // cells close to a point source (skipped by autoscale)
      sources: [],
      t: 0,                           // time step counter
      lambda: 18,                     // wavelength in cells
      n: 1.5,                         // refractive index of glass
      boundary,
      dirty: true                     // coefficients need recomputing
    };

    // Update coefficients, one set per field component.
    const cax = new Float32Array(N), cbx = new Float32Array(N);   // Ezx
    const cay = new Float32Array(N), cby = new Float32Array(N);   // Ezy
    const dHxa = new Float32Array(N), dHxb = new Float32Array(N); // Hx
    const dHya = new Float32Array(N), dHyb = new Float32Array(N); // Hy

    // Depth into the absorbing layer, in cells, measured from its inner edge. Fractional
    // positions are used for H, which sits half a cell away from Ez on the Yee grid.
    const depthX = x => Math.max(P - x, x - (NX - 1 - P), 0);
    const depthY = y => Math.max(P - y, y - (NY - 1 - P), 0);
    // Normalized loss l = sigma*dt/(2*eps0). It grows as the cube of depth, so the wave
    // meets no sudden change; lossMax = 0.35 over 20 cells gives a theoretical round-trip
    // attenuation of about exp(-14), roughly 1e-6.
    const profile = d => (d > 0 ? lossMax * Math.pow(Math.min(d, P) / P, 3) : 0);

    // Grid index for interior coordinates (u, v), where (0, 0) is the top-left visible cell.
    sim.K = (u, v) => (v + P) * NX + (u + P);

    sim.computeCoeffs = function () {
      const epsGlass = sim.n * sim.n;  // eps_r = n^2
      const pml = sim.boundary === 'pml';
      for (let j = 0; j < NY; j++) {
        const vj = Math.min(H - 1, Math.max(0, j - P));
        for (let i = 0; i < NX; i++) {
          const ui = Math.min(W - 1, Math.max(0, i - P));
          const k = j * NX + i;
          // Cells in the absorbing layer copy the nearest interior material, so walls and
          // glass continue into the layer instead of ending abruptly at the screen edge.
          const m = sim.mat[sim.K(ui, vj)];
          const eps = m === WL.GLASS ? epsGlass : 1;

          let lEx, lEy, lHx, lHy;
          if (pml) {
            // Each component is damped only by the loss along its own direction of
            // derivative. Equal electric and magnetic loss (sigma*/mu = sigma/eps) makes
            // the layer reflectionless at every angle in the continuous equations.
            lEx = profile(depthX(i)) / eps;
            lEy = profile(depthY(j)) / eps;
            lHx = profile(depthY(j + 0.5)) / eps;  // Hx involves d/dy
            lHy = profile(depthX(i + 0.5)) / eps;  // Hy involves d/dx
          } else {
            const l = profile(Math.max(depthX(i), depthY(j))) / eps;
            lEx = lEy = lHx = lHy = l;
          }

          if (m === WL.CONDUCTOR) {
            cax[k] = cbx[k] = cay[k] = cby[k] = 0;  // perfect conductor: Ez stays 0
          } else {
            cax[k] = (1 - lEx) / (1 + lEx); cbx[k] = S / eps / (1 + lEx);
            cay[k] = (1 - lEy) / (1 + lEy); cby[k] = S / eps / (1 + lEy);
          }
          dHxa[k] = (1 - lHx) / (1 + lHx); dHxb[k] = S / (1 + lHx);
          dHya[k] = (1 - lHy) / (1 + lHy); dHyb[k] = S / (1 + lHy);
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
      const { Ez, Ezx, Ezy, Hx, Hy, I } = sim;

      // H half-step: Faraday's law
      for (let j = 0; j < NY - 1; j++) {
        let k = j * NX;
        for (let i = 0; i < NX; i++, k++) Hx[k] = dHxa[k] * Hx[k] - dHxb[k] * (Ez[k + NX] - Ez[k]);
      }
      for (let j = 0; j < NY; j++) {
        let k = j * NX;
        for (let i = 0; i < NX - 1; i++, k++) Hy[k] = dHya[k] * Hy[k] + dHyb[k] * (Ez[k + 1] - Ez[k]);
      }

      // E half-step: Ampere-Maxwell law, split into its x- and y-derivative parts
      for (let j = 1; j < NY; j++) {
        let k = j * NX + 1;
        for (let i = 1; i < NX; i++, k++) {
          Ezx[k] = cax[k] * Ezx[k] + cbx[k] * (Hy[k] - Hy[k - 1]);
          Ezy[k] = cay[k] * Ezy[k] - cby[k] * (Hx[k] - Hx[k - NX]);
          Ez[k] = Ezx[k] + Ezy[k];
        }
      }

      addSources();

      for (let k = 0; k < N; k++) I[k] = I[k] * 0.985 + Ez[k] * Ez[k] * 0.015;
      sim.t++;
    };

    // Add a value to Ez at grid index k (keeps the split parts consistent).
    sim.inject = function (k, value) {
      sim.Ez[k] += value;
      sim.Ezx[k] += value;
    };

    // Soft sources: add a sinusoid to Ez instead of overwriting it, so waves pass through.
    function addSources() {
      const T = sim.lambda / S;                         // period in time steps
      const w = 2 * Math.PI / T;                        // angular frequency per step
      const kw = 2 * Math.PI / sim.lambda;              // wavenumber per cell
      const ramp = Math.min(1, sim.t / (1.5 * T));      // fade in to avoid a sharp transient
      const { mat } = sim;

      for (const s of sim.sources) {
        if (s.type === 'point') {
          const k = sim.K(s.u, s.v);
          if (mat[k] !== WL.CONDUCTOR) sim.inject(k, ramp * Math.sin(w * sim.t + (s.phase || 0)));
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
          sim.inject(j * NX + i, ramp * a * Math.sin(w * sim.t - kw * sn * v));
        }
      }
    }

    sim.setBoundary = function (b) {
      sim.boundary = b;
      sim.dirty = true;
    };

    sim.clearFields = function () {
      for (const a of [sim.Ez, sim.Ezx, sim.Ezy, sim.Hx, sim.Hy, sim.I]) a.fill(0);
      sim.t = 0;
    };

    return sim;
  };
})(globalThis.WaveLab = globalThis.WaveLab || {});
