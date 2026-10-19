// presets.js
// Ready-made experiments. Each preset places sources and materials using interior grid
// coordinates (u to the right, v downward) on the 320 x 180 visible region.

(function (WL) {
  'use strict';

  function rect(sim, u0, v0, u1, v1, val) {
    for (let v = Math.max(0, v0); v <= Math.min(sim.H - 1, v1); v++) {
      for (let u = Math.max(0, u0); u <= Math.min(sim.W - 1, u1); u++) sim.mat[sim.K(u, v)] = val;
    }
  }

  // Antenna array: each element fires later than its neighbor by phaseStepDeg.
  WL.applyPhase = function (sim, phaseStepDeg) {
    const p = phaseStepDeg * Math.PI / 180;
    for (const s of sim.sources) if (s.arr !== undefined) s.phase = -s.arr * p;
  };

  WL.PRESETS = {
    slit: {
      name: 'Double slit',
      view: 'field',
      build(sim) {
        sim.sources = [{ type: 'line', u: 8 }];
        rect(sim, 92, 0, 95, sim.H - 1, WL.CONDUCTOR);   // wall
        rect(sim, 92, 66, 95, 75, WL.VACUUM);             // upper slit
        rect(sim, 92, 105, 95, 114, WL.VACUUM);           // lower slit
      },
      title: 'Double-slit interference',
      body: `<p>A plane wave hits a conducting wall with two narrow openings. Each slit acts as a new source, and the two circular waves overlap. Where crests meet crests the field doubles; where a crest meets a trough it cancels.</p>
<p>Switch to <b>Intensity</b> to see the time-averaged pattern: bright and dark fringes fanning out from the slits. Making the wavelength longer spreads the fringes apart, since the bright directions satisfy d sin θ = mλ.</p>`
    },

    refract: {
      name: 'Refraction',
      view: 'field',
      snell: true,
      build(sim) {
        sim.sources = [{ type: 'line', u: 8, angle: 25, width: 26, vc: 52 }];
        rect(sim, 165, 0, sim.W - 1, sim.H - 1, WL.GLASS);
      },
      title: 'Refraction and reflection at glass',
      body: `<p>A beam tilted at 25° crosses from vacuum into glass. Inside the glass the wave travels at c/n, so the wavelength shrinks and the beam bends toward the normal. Part of the wave reflects back up and to the left.</p>
<p>Raise the refractive index to bend the beam more and strengthen the reflection. The bending angle comes out of Maxwell's equations alone; Snell's law is never coded in.</p>`
    },

    lens: {
      name: 'Lens',
      view: 'intensity',
      build(sim) {
        sim.sources = [{ type: 'line', u: 8 }];
        // Biconvex lens: the overlap of two disks of radius R, 24 cells thick at the center.
        const R = 150, c = 90, uc = 100;
        for (let v = 0; v < sim.H; v++) {
          for (let u = 0; u < sim.W; u++) {
            const inA = (u - (uc - (R - 12))) ** 2 + (v - c) ** 2 <= R * R;
            const inB = (u - (uc + (R - 12))) ** 2 + (v - c) ** 2 <= R * R;
            if (inA && inB) sim.mat[sim.K(u, v)] = WL.GLASS;
          }
        }
      },
      title: 'Focusing with a lens',
      body: `<p>A plane wave passes through a convex glass lens. The wave is slowed more in the thick middle than at the thin edges, so the flat wavefront curves inward and converges to a focus.</p>
<p>The intensity view shows the bright focal spot. For a thin lens 1/f = (n − 1)(2/R), so raising the refractive index pulls the focus closer to the lens.</p>`
    },

    guide: {
      name: 'Fiber',
      view: 'field',
      n: 2,
      build(sim) {
        sim.sources = [{ type: 'point', u: 30, v: 90 }];
        rect(sim, 20, 82, sim.W - 1, 98, WL.GLASS);
      },
      title: 'Light trapped in a fiber',
      body: `<p>A source sits inside a strip of high-index glass. Waves that hit the glass edge at a shallow angle undergo total internal reflection and stay trapped, so the energy travels down the strip. Steeper waves leak out into the surroundings.</p>
<p>This is how optical fiber carries signals. Lower the refractive index toward 1 and watch the confinement weaken as the critical angle grows.</p>`
    },

    array: {
      name: 'Antenna array',
      view: 'field',
      phase: true,
      build(sim, ui) {
        sim.sources = [];
        // Five elements spaced half a wavelength apart (9 cells at the default 18-cell wavelength).
        for (let a = 0; a < 5; a++) sim.sources.push({ type: 'point', u: 70, v: 90 + (a - 2) * 9, arr: a, phase: 0 });
        WL.applyPhase(sim, ui.phaseStep);
      },
      title: 'Phased antenna array',
      body: `<p>Five antennas sit half a wavelength apart. When they oscillate in step, their waves add up straight ahead and cancel off to the sides, producing a narrow beam.</p>
<p>Drag the <b>phase step</b>. Each antenna fires slightly later than its neighbor, which tilts the combined wavefront and steers the beam. Radar and 5G base stations aim their beams this way.</p>`
    },

    cage: {
      name: 'Faraday cage',
      view: 'field',
      build(sim) {
        sim.sources = [{ type: 'point', u: 70, v: 90 }];
        const C = WL.CONDUCTOR;
        // Closed box
        rect(sim, 170, 14, 250, 16, C); rect(sim, 170, 72, 250, 74, C);
        rect(sim, 170, 14, 172, 74, C); rect(sim, 248, 14, 250, 74, C);
        // Box with a gap facing the source
        rect(sim, 170, 106, 250, 108, C); rect(sim, 170, 164, 250, 166, C);
        rect(sim, 248, 106, 250, 166, C);
        rect(sim, 170, 106, 172, 124, C); rect(sim, 170, 148, 172, 166, C);
      },
      title: 'Shielding with a Faraday cage',
      body: `<p>Two conducting boxes sit beside a source. Charges in the conductor rearrange to cancel the field, so E<sub>z</sub> is zero on the walls and the closed upper box stays dark inside.</p>
<p>The lower box has a gap facing the source. The wave leaks through the opening and rings around inside. A cage only shields when its openings are small compared with the wavelength; try a longer wavelength and see the leak weaken.</p>`
    },

    blank: {
      name: 'Blank',
      view: 'field',
      build(sim) {
        sim.sources = [{ type: 'point', u: 100, v: 90 }];
      },
      title: 'Build your own experiment',
      body: `<p>This preset starts with a single wave source and nothing else, so you can set up an experiment of your own. Use the tools on the right: <b>Source</b> adds a wave source wherever you click, <b>Conductor</b> draws walls that reflect waves, <b>Glass</b> paints material that slows waves down and bends them, and <b>Erase</b> removes anything you've drawn.</p>
<p>Some setups to try: draw an L-shaped wall around the source to make a corner reflector, draw a curved wall to focus waves the way a satellite dish does, paint a glass triangle to bend the wave like a prism, or add a second source and watch the two waves form an interference pattern.</p>`
    }
  };
})(globalThis.WaveLab = globalThis.WaveLab || {});
