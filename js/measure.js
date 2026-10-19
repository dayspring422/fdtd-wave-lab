// measure.js
// Measures wave properties directly from the simulated field, so the results can be
// checked against theory without assuming them.
//
// Method: once the simulation reaches steady state, every cell oscillates as
//   Ez(t) = Re{ A e^(i w t) }
// with a complex amplitude A (a phasor). We extract A by summing Ez(t) e^(-i w t) over
// exactly one period (a lock-in amplifier). For a plane wave A ~ e^(-i k.r), so the phase
// difference between neighbouring cells gives the wavevector k: its direction is the
// propagation angle and w/|k| is the phase velocity.

(function (WL) {
  'use strict';

  // Lock-in amplifier over the whole grid. Call sample() after every sim.step().
  WL.createLockIn = function (sim, { settle = 800 } = {}) {
    const re = new Float64Array(sim.N), im = new Float64Array(sim.N);
    const lock = {
      Are: new Float64Array(sim.N),
      Aim: new Float64Array(sim.N),
      ready: false,       // a finished phasor is available
      startT: settle,     // step at which accumulation starts
      settle,
      count: 0,
      lambda: sim.lambda
    };

    // Start over (after a preset, wavelength or material change).
    lock.reset = function () {
      lock.ready = false;
      lock.count = 0;
      lock.startT = sim.t + lock.settle;
      re.fill(0); im.fill(0);
    };

    lock.sample = function () {
      if (sim.lambda !== lock.lambda) { lock.lambda = sim.lambda; lock.reset(); }
      if (sim.t < lock.startT) return;
      const T = Math.round(sim.lambda / sim.S);   // period in steps (an integer here)
      const w = 2 * Math.PI / T;
      // Ez after step() corresponds to source phase w*(t-1).
      const c = Math.cos(w * (sim.t - 1)), s = Math.sin(w * (sim.t - 1));
      const Ez = sim.Ez;
      for (let k = 0; k < sim.N; k++) { re[k] += Ez[k] * c; im[k] -= Ez[k] * s; }
      if (++lock.count === T) {
        for (let k = 0; k < sim.N; k++) { lock.Are[k] = 2 * re[k] / T; lock.Aim[k] = 2 * im[k] / T; }
        re.fill(0); im.fill(0);
        lock.count = 0;
        lock.ready = true;
      }
    };

    lock.progress = function () {
      if (lock.ready) return 1;
      const T = Math.round(sim.lambda / sim.S);
      return Math.max(0, Math.min(1, (sim.t - (lock.startT - lock.settle)) / (lock.settle + T)));
    };

    return lock;
  };

  // Mean wavevector over the cells for which include(u, v) is true. Each neighbour pair
  // contributes A[next] * conj(A[here]), which weights strong-field cells most, so weak
  // stray waves barely affect the result. Returns kx, ky in radians per cell
  // (+x to the right, +y downward).
  WL.waveVector = function (sim, lock, include) {
    const { Are, Aim } = lock;
    let pxr = 0, pxi = 0, pyr = 0, pyi = 0;
    for (let v = 0; v < sim.H - 1; v++) {
      for (let u = 0; u < sim.W - 1; u++) {
        if (!include(u, v) || !include(u + 1, v) || !include(u, v + 1)) continue;
        const k = sim.K(u, v), kx = k + 1, ky = k + sim.NX;
        pxr += Are[kx] * Are[k] + Aim[kx] * Aim[k];
        pxi += Aim[kx] * Are[k] - Are[kx] * Aim[k];
        pyr += Are[ky] * Are[k] + Aim[ky] * Aim[k];
        pyi += Aim[ky] * Are[k] - Are[ky] * Aim[k];
      }
    }
    // A ~ e^(-i k.r), so the phase step to the next cell is -k.
    return { kx: -Math.atan2(pxi, pxr), ky: -Math.atan2(pyi, pyr) };
  };

  // Propagation angle in degrees, measured from +x and positive downward.
  WL.angleOf = kv => Math.atan2(kv.ky, kv.kx) * 180 / Math.PI;

  // Phase velocity as a fraction of c: v = w/|k| cells per step, and c = S cells per step.
  WL.speedOf = (sim, kv) => {
    const w = 2 * Math.PI * sim.S / sim.lambda;
    return w / Math.hypot(kv.kx, kv.ky) / sim.S;
  };

  // Cells where |A| is at least frac of the largest |A| among the cells region(u, v) allows.
  // This picks out the beam without telling the measurement where the beam should be.
  WL.strongCells = function (sim, lock, region, frac = 0.5) {
    let max = 0;
    for (let v = 0; v < sim.H; v++) for (let u = 0; u < sim.W; u++) {
      if (!region(u, v)) continue;
      const k = sim.K(u, v);
      max = Math.max(max, Math.hypot(lock.Are[k], lock.Aim[k]));
    }
    const thr = frac * max;
    return (u, v) => {
      if (u < 0 || v < 0 || u >= sim.W || v >= sim.H || !region(u, v)) return false;
      const k = sim.K(u, v);
      return Math.hypot(lock.Are[k], lock.Aim[k]) >= thr;
    };
  };

  // Refraction of a tilted plane wave at a vertical vacuum/glass interface at u = uI.
  // The incident angle is set exactly by the source (its phase along the source line fixes
  // the tangential wavenumber). The transmitted angle and speed are measured from the field
  // inside the glass, below the top edge where the plane wave is cut off.
  WL.measureTransmitted = function (sim, lock, { uI, thetaInc }) {
    const region = (u, v) => u >= uI + 15 && u <= sim.W - 30 && v >= Math.round(sim.H * 0.45) && v <= sim.H - 10;
    const kv = WL.waveVector(sim, lock, WL.strongCells(sim, lock, region, 0.6));
    const theta2 = WL.angleOf(kv);
    const predicted = Math.asin(Math.sin(thetaInc * Math.PI / 180) / sim.n) * 180 / Math.PI;
    return {
      theta2,
      predicted,
      errPct: Math.abs(theta2 - predicted) / predicted * 100,
      speed: WL.speedOf(sim, kv),       // measured phase velocity in the glass, v/c
      speedTheory: 1 / sim.n
    };
  };
})(globalThis.WaveLab = globalThis.WaveLab || {});
