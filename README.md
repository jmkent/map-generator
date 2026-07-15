# Village Generator

A seed-based **procedural village generator** rendered at a fixed camera angle in
a browser `<canvas>`, built with [`@babylonjs/lite`](https://www.npmjs.com/package/@babylonjs/lite),
TypeScript, and Vite. It's inspired by [watabou's generators](https://watabou.github.io/) —
in particular the [village generator](https://watabou.github.io/village.html) —
and aims to grow from an organic village outline into roads, clustered houses,
fields, and terrain.

The same seed always produces the same village, and the seed lives in the URL, so
any view is reproducible and shareable.

## Architecture in one line

Generation is a **pure, deterministic function** (`src/gen/`, no Babylon) that
produces a plain `MapModel`, which is then consumed by either the Babylon
renderer (`src/render/`) or a headless SVG renderer (`src/debug/`) used for
debugging and golden tests. See [PLAN.md](./PLAN.md) for the full design,
milestones, and per-milestone test plans.

```
seed + params ─▶ gen/ (pure) ─▶ MapModel ─┬─▶ render/ (Babylon) ─▶ canvas
                                           └─▶ debug/  (SVG)      ─▶ golden tests
```

### Layout

| Path | Responsibility |
| --- | --- |
| `src/gen/` | Pure generation: RNG, geometry, stages, `pipeline.ts`. **No Babylon imports.** |
| `src/render/` | Babylon scene, fixed-angle camera, meshers (consume `MapModel`). |
| `src/debug/` | Headless SVG renderer of a `MapModel`. |
| `src/app/`, `src/ui/` | URL/seed state and the on-canvas HUD. |
| `test/` | Vitest suites: unit, determinism, invariant, golden, mesher. |

## Status

Implemented through **M4**: deterministic core (seeded RNG with named streams,
geometry toolkit incl. Catmull–Rom splines and SAT overlap tests), an organic
village **boundary**, a **road network** (a planar loose grid of primary streets,
secondary block connectors, and lanes), and
**parcels + houses** — burgage lots lining the streets, each holding a
road-oriented house clustered toward a denser core. Roads and boundary render as
flat meshes; houses as thin-instanced boxes; everything also renders to SVG for
tests. Next up (see [PLAN.md](./PLAN.md)): off-map road entrances (M5), then
*structural water* — rivers, ponds, lakes, and coastlines that
constrain the layout (M6–M7) — and finally *decorative terrain* like fields and woodlands
(M8).

## Running

Requires Node and a **WebGPU-capable browser** (`@babylonjs/lite` is WebGPU-only).

```bash
npm install
npm run dev        # Vite dev server; open the printed localhost URL
```

Pass a seed via the URL, e.g. `http://localhost:5173/?seed=riverford`. With no
seed, a random one is generated and written back to the URL.

```bash
npm run build      # type-check (tsc) + production build to dist/
npm run preview    # serve the production build
```

## Testing

```bash
npm test           # Vitest in watch mode
npm run test:run   # single run (CI-style)
```

The suite is **headless** — it exercises the pure generation and framing code
without a GPU:

- **Unit** — geometry (`vec2`, `polygon`) and framing math, table-driven.
- **Determinism** — same seed ⇒ identical model; named-stream isolation; a guard
  test asserts nothing under `src/gen/` uses `Math.random` / `Date.now`.
- **Invariant** — the boundary is a simple, CCW polygon within its radius band.
- **Golden** — a `MapModel` rendered to SVG via `src/debug/svgRenderer.ts`,
  snapshotted under `test/debug/__snapshots__/`. After an intentional generation
  change, update them with `npm run test:run -- -u` and review the SVG diff.
- **Mesher** — asserts on emitted `GeometryData` (vertex/index counts, bounds),
  not pixels; the GPU upload stays a thin adapter.

## Further reading

Techniques used or planned (see PLAN.md for where each lands):

- Watabou, *How to generate a village* and related devlogs —
  https://watabou.github.io/ and the [village generator](https://watabou.github.io/village.html)
- Seedable PRNGs (mulberry32 / xmur3 hashing) —
  https://github.com/bryc/code/blob/master/jshash/PRNGs.md
- Red Blob Games — polygon maps, noise, and grids —
  https://www.redblobgames.com/ (esp. [polygonal map generation](https://www.redblobgames.com/maps/mapgen4/) and [making maps with noise](https://www.redblobgames.com/maps/terrain-from-noise/))
- Poisson-disk sampling (for clustered house/tree placement) —
  https://www.jasondavies.com/poisson-disc/ and Bridson's algorithm
- Voronoi diagrams + Lloyd's relaxation (for fields/parcels, M8) —
  [`d3-delaunay`](https://github.com/d3/d3-delaunay)
- Catmull–Rom splines (for organic road curves, M2) —
  https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
- Road-network generation + planar graph planarization (for the multi-road network, M4–M5) —
  https://en.wikipedia.org/wiki/Planar_graph and segment-intersection / arrangement methods
- Structural water — rivers/lakes/coast as layout constraints (M6–M7) —
  watabou's water-bearing generators (e.g. [village](https://watabou.github.io/village.html))
  and river meander modeling https://en.wikipedia.org/wiki/Meander
- Point-in-polygon and polygon offsetting —
  https://en.wikipedia.org/wiki/Point_in_polygon, https://en.wikipedia.org/wiki/Straight_skeleton

## License

Not yet specified.
