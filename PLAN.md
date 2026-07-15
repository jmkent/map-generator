# Procedural Map Generator — Plan

A seed-based procedural **village generator** rendered at a fixed camera angle in a
`<canvas>`, inspired by [watabou's generators](https://watabou.github.io/) (see the
[village generator](https://watabou.github.io/village.html)). Built on the existing
Vite + TypeScript + Vitest + `@babylonjs/lite` scaffold.

This document covers the target architecture, project layout, milestones, and a
per-milestone test plan. It describes the **first pass to MVP**; later stages will be
planned in more detail once the core slices land.

---

## 1. Core principle: separate generation from rendering

```
seed + params ──▶ [ gen/  pure TS, no Babylon ] ──▶ MapModel (JSON-able) ──▶ [ render/  Babylon ] ──▶ canvas
                                                          │
                                                          └──▶ [ debug/ SVG renderer ] ──▶ golden tests
```

- **`gen/` imports zero Babylon.** Generation is pure functions over points/polygons,
  so it is unit-testable in Vitest's node environment with no WebGPU/canvas.
- **`MapModel` is a plain, serializable graph** (boundary, roads, parcels, buildings,
  terrain). Determinism testing is `deepEqual(generate(seed), generate(seed))`; golden
  testing is a snapshot of the model or its SVG rendering.
- **Meshers emit plain `GeometryData` first**, then a thin Babylon adapter uploads it.
  Geometry is asserted headlessly (vertex counts, bounds, no NaNs); the GPU upload stays
  a thin, untested adapter. (`@babylonjs/lite` needs WebGPU, which Vitest-node lacks.)
- **A headless SVG renderer of the same `MapModel`** is both the primary debugging tool
  and the golden-test format — reviewable as a diff in a PR, no browser required.

This boundary is what makes "refine from there" cheap instead of a rewrite.

## 2. Confirmed decisions

- **Geometry libs:** `d3-delaunay` approved for Voronoi/relaxation (fields, lot
  subdivision). Wired in at **M4**, not before. `polygon-clipping` deferred until a
  stage actually needs boolean ops. Hand-rolled primitives (bbox, inset, Poisson-disk)
  for M0–M3.
- **Camera:** **near-orthographic** — `@babylonjs/lite` exposes no true orthographic
  projection, so a narrow FOV (~8°) viewed from a correspondingly large radius makes
  perspective divergence negligible, giving the flat, map-like watabou feel. Fixed tilt,
  controls locked, auto-framed to bounds. Widening the FOV yields a perspective "diorama"
  toggle, deferred to **M5**.
- **RNG:** seedable 32-bit PRNG (mulberry32/sfc32) with **named streams** — each stage's
  generator derived from `hash(masterSeed, streamName)` so adding/reordering a stage does
  not shift earlier stages' random sequences. Regressions stay local; untouched stages'
  golden tests keep passing.

## 3. Project layout

```
src/
  main.ts                  # bootstrap: parse seed/params from URL, generate, render
  app/
    App.ts                 # wires gen → render → ui
    urlState.ts            # seed & params ⇄ URL query (shareable links)
  gen/                     # ── PURE. No Babylon imports. ──
    rng.ts                 # seedable PRNG + named streams
    types.ts               # MapModel, Boundary, Road, Parcel, Building, TerrainCell, Vec2
    pipeline.ts            # generateVillage(seed, params): MapModel — orchestrator
    geometry/
      vec2.ts              # add/sub/scale/dot/normal/rotate/lerp
      polygon.ts           # area, centroid, contains, inset/offset, bbox
      sampling.ts          # weighted pick, poisson-disk, jitter
      voronoi.ts           # d3-delaunay wrapper + Lloyd relaxation (M4)
    stages/
      boundary.ts          # village extent polygon
      roads.ts             # road graph: main street + branches
      parcels.ts           # subdivide buildable band into lots
      buildings.ts         # place clustered house footprints
      terrain.ts           # fields, forest, grass, optional river/water
  render/                  # ── Babylon. Consumes MapModel. ──
    Renderer.ts            # engine/scene lifecycle
    framing.ts             # pure near-orthographic framing math (tested)
    camera.ts              # fixed-angle near-ortho camera + auto-frame to bounds
    palette.ts             # materials/colors
    geometryData.ts        # plain GeometryData type + Babylon upload adapter
    meshers/
      groundMesher.ts      # terrain cells → zoned ground
      roadMesher.ts        # road polylines → ribbons
      buildingMesher.ts    # footprints → extruded, thin-instanced
  ui/
    controls.ts            # seed field, regenerate, param sliders, screenshot
  debug/
    svgRenderer.ts         # MapModel → SVG string (debug + golden tests)
  style.css
test/
  gen/…                    # unit, determinism, invariant, golden
  render/…                 # geometry-data assertions (headless)
```

`render/` is lazily/dynamically imported from `App.ts` so `gen/` and its tests never pull
Babylon into the module graph.

## 4. Techniques

- **Roads:** main street = Catmull-Rom spline through 3–5 jittered control points; branch
  stubs dropped along its normal at intervals. Stored as a **graph** (nodes + polyline
  edges) so it can grow into real street networks later without a rewrite.
- **Logical clumps:** **Poisson-disk sampling with a spatially-varying density function**
  (higher near roads/center, zero outside boundary). One primitive drives both house and
  tree clustering; the falloff function is the "clump" control.
- **Terrain:** material-zoned ground; farmland fields as **Voronoi + Lloyd relaxation**
  patches (M4); forests as thin-instanced trees seeded by the Poisson sampler under a
  forest density mask; optional river/water.
- **Houses:** footprint polygon (rect with occasional L/T variation) → `inset` for wall
  thickness → extrude to a seeded height → optional roof prism. Thin-instanced via
  `addThinInstance`.
- **Fixed angle:** near-orthographic camera (narrow FOV, large radius) at fixed tilt,
  controls locked, auto-framed to the boundary bbox.

## 5. Determinism rules (enforced by test)

- All randomness flows through the seeded PRNG. **No `Math.random`, no `Date.now`** in
  `gen/` (guard test greps/AST-checks the tree).
- No iteration-order-dependent `Set`/`Map` logic feeding geometry.
- Same seed ⇒ byte-identical `MapModel`.

---

## 6. Milestones

Each milestone is a shippable vertical slice. The village "clicks" visually at **M3**.

### M0 — Scaffold & fixed-angle stage
Strip the sandbox demo from `src/main.ts`. Stand up `Renderer` + a near-orthographic camera
(narrow FOV, large radius) locked at a fixed tilt, auto-framing a bounds rectangle. Parse
seed from URL, show it in a HUD. `git init` + first commit.

**Deliverable:** empty framed ground at a fixed watabou-like angle, `?seed=…` in the URL.

**Test plan:**
- `urlState`: unit tests for seed/param ⇄ URL round-trip, including missing/malformed
  params falling back to defaults.
- `framing`: given a bounds rect, `frameBounds()` produces a target + radius that fit the
  bounds within the frustum with the expected margin (pure math, no GPU).
- Smoke: app boots without throwing (thin; the real coverage is headless in later tiers).

### M1 — Deterministic core + boundary
`rng.ts`, `types.ts`, `geometry/` toolkit, `debug/svgRenderer.ts`, and
`stages/boundary.ts` (jittered organic outline). Developed entirely against the SVG
renderer — no Babylon needed. Render the boundary as a ground patch in Babylon once the
data is right.

**Deliverable:** seed → boundary polygon, rendered as SVG (tests) and as a Babylon ground.

**Test plan:**
- **Geometry (unit, table-driven):** area/centroid of known polygons; `contains` for
  inside/outside/on-edge; `inset` shrinks area monotonically and preserves winding; vec2
  ops.
- **RNG:** same seed ⇒ identical sequence; different seeds differ; named-stream isolation
  (changing one stream's draws leaves another stream's sequence identical).
- **Determinism guard:** assert no `Math.random`/`Date.now` under `gen/`.
- **Boundary invariants:** simple polygon (non-self-intersecting); area within expected
  band for given params.
- **Golden:** SVG of N fixed seeds committed via `toMatchFileSnapshot`.

### M2 — Roads
`stages/roads.ts`: primary Catmull-Rom street + perpendicular branch stubs as a graph.
`roadMesher.ts` renders flat ribbons.

**Deliverable:** seeded road network, visible and shareable by URL.

**Test plan:**
- **Invariants:** graph connected; every branch endpoint touches the main street; no
  zero-length edges; roads stay within boundary.
- **Determinism:** road sub-model identical for same seed; isolated from boundary stream.
- **Golden:** SVG snapshots (boundary + roads) for fixed seeds.
- **Mesher (headless):** `roadMesher` emits `GeometryData` with expected vertex/index
  counts, bbox within road extent, no NaNs.

### M3 — Parcels & buildings  *(the "it's a village" moment)*
`parcels.ts` subdivides the band along roads into lots; `buildings.ts` places house
footprints oriented to their road, clustered by a density falloff. `buildingMesher.ts`
extrudes and thin-instances them.

**Deliverable:** recognizable clustered village of houses along streets.

**Test plan:**
- **Parcel invariants:** lots inside boundary; pairwise overlap area ≈ 0 (tolerance);
  buildable-band coverage ≥ threshold.
- **Building invariants:** all footprints inside boundary; no building–building and no
  building–road overlap; density falloff holds (mean distance-to-center of houses < that
  of uniform samples).
- **Determinism + stream isolation:** buildings vary with seed; changing building params
  leaves boundary/roads sub-models byte-identical.
- **Golden:** SVG snapshots for fixed seeds.
- **Mesher (headless):** thin-instance matrix count == building count; per-footprint
  vertex counts; bounds match model; consistent winding/normals; no NaNs.

### M4 — Terrain
`terrain.ts`: farmland fields as relaxed Voronoi patches (wire in `d3-delaunay` here),
grass, forest clumps (thin-instanced trees under a density mask), optional river/water.
`groundMesher.ts` renders material-zoned ground.

**Deliverable:** houses sit in a landscape.

**Test plan:**
- **Voronoi wrapper:** cells partition the target region; relaxation converges (centroid
  drift decreases across iterations); determinism preserved through the lib.
- **Terrain invariants:** cells partition the non-built area; no cell–building overlap;
  forest samples respect the density mask and boundary.
- **Golden:** SVG snapshots including terrain zones.
- **Mesher (headless):** ground `GeometryData` covers bounds; zone material assignment
  matches cell types; tree instance count matches sampled points.

### M5 — Interactivity & polish
Seed input + regenerate; a few param sliders (village size, density, "has river");
click-to-inspect via `pickAsync`; screenshot export via `captureScreenshot`; full param
set encoded in the shareable URL; perspective-camera toggle.

**Deliverable:** interactive, shareable generator.

**Test plan:**
- `urlState`: full param set round-trips; back/forward navigation regenerates
  deterministically.
- `controls`: regenerate with same seed+params yields identical model; changing a param
  changes only the expected sub-model.
- Picking maps a hit to the correct `MapModel` entity (test the pure hit→entity resolver,
  not the GPU pick).
- **Optional later tier:** pixel/screenshot regression via Playwright or vitest-browser
  (`captureScreenshot`) — not part of MVP.

---

## 7. Test tiers (all headless unless noted)

1. **Unit (table-driven)** — geometry and pure helpers.
2. **Determinism** — same-seed equality, seed variation, named-stream isolation, the
   no-`Math.random` guard.
3. **Invariant / property** — per-stage structural guarantees (§6).
4. **Golden / snapshot** — `MapModel` rendered to SVG via `debug/svgRenderer.ts`,
   committed with `toMatchFileSnapshot`; generation changes surface as reviewable SVG
   diffs.
5. **Mesher (headless)** — assert on emitted `GeometryData`, not pixels. GPU upload stays
   a thin adapter.
6. **Pixel (optional, later)** — `captureScreenshot` under a browser runner.
