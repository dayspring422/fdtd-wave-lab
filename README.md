# FDTD Wave Lab

An interactive 2D simulation of electromagnetic waves, built by solving Maxwell's equations directly on a grid with the finite-difference time-domain (FDTD) method. You can run preset experiments (double slit, refraction, a lens, an optical fiber, a phased antenna array, a Faraday cage) or build your own by placing sources and drawing conductors and glass.

## Running it

Open `index.html` in a browser. Nothing needs to be installed or built.

In VS Code, the Live Server extension also works: right-click `index.html` and choose "Open with Live Server", and the page reloads whenever you save a file.

To check that the solver stays numerically stable on every preset (needs Node.js):

```
node tests/stability.js
```

## Project layout

```
index.html          page structure and controls
style.css           layout and colors (light and dark themes)
js/solver.js        the physics: Yee grid, field updates, absorbing boundary, sources
js/presets.js       the ready-made experiments
js/render.js        turns the field values into an image
js/main.js          connects the controls to the solver
tests/stability.js  runs each preset without a browser and checks the fields stay bounded
```

All of the physics lives in `js/solver.js`. The other files handle presets, drawing, and the interface.

## The physics

The simulation uses the TMz mode: the electric field points out of the screen (Ez) and the magnetic field lies in the plane (Hx, Hy). Maxwell's curl equations then reduce to

```
dEz/dt =  (1/eps) (dHy/dx - dHx/dy)
dHx/dt = -(1/mu)   dEz/dy
dHy/dt =  (1/mu)   dEz/dx
```

The Yee scheme stores E and H on grids offset by half a cell, and updates them half a time step apart. Every derivative becomes a centered difference between neighboring cells, so each time step is a pass of H updates followed by a pass of E updates.

A few details worth knowing for questions:

- **Stability.** The Courant number S = c dt/dx is 0.5. In 2D the scheme is stable only for S ≤ 1/√2; above that the fields grow without bound.
- **Materials.** Glass has relative permittivity εr = n², which slows waves to c/n. A perfect conductor forces Ez = 0, which reflects waves completely.
- **Boundaries.** A 20-cell absorbing layer surrounds the visible region. Its loss grows gradually with depth and is applied equally to E and H, which keeps the layer's impedance matched to free space so waves enter it without reflecting.
- **Sources.** Sources are "soft": they add a sine wave to Ez instead of overwriting it, so reflected waves pass through them. A line source with a phase that varies along its length produces a tilted plane wave.

The refraction preset is a good check on the whole thing: the beam bends to the angle Snell's law predicts, even though Snell's law appears nowhere in the code.

## Ideas for extending it

- Add the TE mode (Hz out of the screen, with Ex and Ey in the plane).
- Replace the graded-loss boundary with a split-field PML and compare how much each one reflects.
- Add lossy materials with conductivity σ and measure the skin depth.
- Add a dispersive material (Drude or Lorentz model) so the refractive index depends on frequency.
- Plot the field along a line over time to measure the wavelength in glass and compare it with λ/n.
