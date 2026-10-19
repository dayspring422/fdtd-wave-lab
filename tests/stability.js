// Runs every preset for 3000 time steps without a browser and checks the fields stay finite
// and bounded. If the time step broke the Courant condition, the fields would blow up here.
//
//   node tests/stability.js

require('../js/solver.js');
require('../js/presets.js');
const WL = globalThis.WaveLab;

let failed = false;
for (const [id, preset] of Object.entries(WL.PRESETS)) {
  const sim = WL.createSolver();
  sim.n = preset.n || 1.5;
  preset.build(sim, { phaseStep: 0 });
  sim.dirty = true;
  for (let i = 0; i < 3000; i++) sim.step();

  let max = 0;
  for (const x of sim.Ez) max = Math.max(max, Math.abs(x));
  const ok = Number.isFinite(max) && max < 10;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${preset.name.padEnd(14)} max |Ez| = ${max.toFixed(3)}`);
}
process.exit(failed ? 1 : 0);
