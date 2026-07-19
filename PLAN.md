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
  subdivision). Wired in at **M14** (decorative land cover), not before. `polygon-clipping`
  deferred until a stage actually needs boolean ops. Everything through M8 (road-graph
  planarization and water) uses hand-rolled primitives (bbox, inset, SAT, segment/spline
  intersection).
- **Camera:** **near-orthographic** — `@babylonjs/lite` exposes no true orthographic
  projection, so a narrow FOV (~8°) viewed from a correspondingly large radius makes
  perspective divergence negligible, giving the flat, map-like watabou feel. Fixed tilt,
  controls locked, auto-framed to bounds. Widening the FOV yields a perspective "diorama"
  toggle, deferred to **M15**.
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
      polygon.ts           # area, centroid, contains, inset/offset, bbox, SAT overlap
      catmullRom.ts        # centripetal spline through control points
      graph.ts             # road-graph planarization: edge intersection + splitting
      contour.ts           # marching-squares iso-contours (shoreline tracing, M12c)
      sampling.ts          # weighted pick, poisson-disk, jitter
      voronoi.ts           # d3-delaunay wrapper + Lloyd relaxation (M14, land cover)
    stages/
      terrain.ts           # SUBSTRATE: height field, slope, buildability (runs first, M9)
      site.ts              # settlement siting on connected buildable land (M11)
      boundary.ts          # village extent polygon (anchored to the site)
      water.ts             # STRUCTURAL: rivers, ponds, lakes, coast — terrain-driven (M7–M8, M10)
      layout.ts            # settlement morphology + civic space (M5)
      roads.ts             # road graph: primaries + secondaries/spokes + approaches
      approaches.ts        # extend primaries to the map edge as entrances (M6)
      parcels.ts           # subdivide buildable band into lots (water-aware)
      buildings.ts         # place clustered house footprints (water-aware)
      landCover.ts         # DECORATIVE: fields, woodlands, grass (M14)
  render/                  # ── Babylon. Consumes MapModel. ──
    Renderer.ts            # engine/scene lifecycle
    framing.ts             # pure near-orthographic framing math (tested)
    camera.ts              # fixed-angle near-ortho camera + auto-frame to bounds
    palette.ts             # materials/colors
    geometryData.ts        # plain GeometryData type + Babylon upload adapter
    meshers/
      terrainMesher.ts     # terrain samples → raised relief grid (M9)
      groundMesher.ts      # land-cover cells → zoned ground (M14)
      roadMesher.ts        # road polylines → ribbons
      waterMesher.ts       # water bodies/river channel → flat water surface
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

- **Roads:** a small **hierarchy** stored as one planar **graph** (nodes + edges, each
  edge classed `primary | secondary | lane | approach` with a per-class width). Primaries
  are Catmull-Rom through-roads between inset-boundary crossings, biased through a shared
  core; secondaries/lanes connect and stub off them for density; **approach** roads extend
  primaries out to the map edge as entrances. Crossings are **planarized** — edges split at
  intersections into shared junction nodes — so the network is genuinely connected and can
  keep growing without a rewrite. (M2 shipped the single-primary + branch-stub subset;
  M4–M6 generalize it.)
- **Logical clumps:** **Poisson-disk sampling with a spatially-varying density function**
  (higher near roads/center **and water access**, zero over water or outside boundary). One
  primitive drives both house and tree clustering; the falloff function is the "clump"
  control, and water contributes a proximity term (M7–M8).
- **Water is structural terrain, not decoration.** Real settlements are built around water,
  so water is generated **early** (a `water.ts` stage before roads) and *constrains* the
  layout — unlike woodlands/fields, which are painted on at the end. The three forms escalate
  in structural weight: **rivers** behave almost like a road (a crossable water-spine →
  bridges/fords, banked buildings); **ponds/lakes** are closed bodies to avoid and cluster
  near; a large **lake/ocean** becomes a **border** that replaces part of the boundary and
  makes a waterfront town. All feed the density falloff so the village hugs the water.
- **Decorative land cover:** material-zoned ground filling what's left after terrain + water +
  settlement; farmland fields as **Voronoi + Lloyd relaxation** patches (M14); woodlands as
  thin-instanced trees seeded by the Poisson sampler under a density mask. No constraint on layout.
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

> **Status:** Milestones marked `[x]` are shipped (**M0–M11**). **M0–M8** built the settlement
> bottom-up — boundary, roads, morphology, approaches, then *structural water* (rivers, ponds,
> lakes, coast) as the earliest layout constraint. **M9** then inverted the pipeline to be
> *terrain-first*: a `TerrainModel` is generated before anything else, and M9–M11 established the
> relief substrate, terrain-driven hydrology selection, and settlement siting. The remaining work
> (**M12–M15**) hands road, parcel, and building geometry over to the terrain, then paints
> *decorative land cover* (fields/woodlands) on what is left, and finally adds interactivity and
> inspection. Constraints still land at the earliest phase that can enforce them; decoration stays
> last.

### [x] M0 — Scaffold & fixed-angle stage
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

### [x] M1 — Deterministic core + boundary
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

### [x] M2 — Roads
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

### [x] M3 — Parcels & buildings  *(the "it's a village" moment)*
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

### [x] M4 — Road network (multiple primaries + secondary spokes)
Replace the single main street with a small **road hierarchy** planarized into a real
graph, so the village reads as a connected town rather than one street.

**Scope:**
- **Primary roads (2–3):** a curved trunk plus offset, roughly parallel cross streets,
  each between two inset-boundary crossings. Wider than secondaries; the offsets create
  loose grids and ordinary junctions rather than a single central convergence.
- **Secondary roads & lanes:** shorter connectors that link primaries to one another
  (forming loops/blocks) plus lanes that stub off for extra frontage. Each branch is
  long enough for several lots and kept clear of nearby junctions/corridors. Medium/narrow widths.
- **Planarization:** compute pairwise edge crossings and split edges at them, inserting
  shared junction nodes, so crossing roads actually meet. New shared util
  `geometry/graph.ts` (segment intersection, edge splitting, near-coincident node merge).
- **Model migration:** `RoadEdge.kind` becomes a class enum (`primary | secondary | lane`,
  `approach` added in M6) with width per class. Generalize the polyline reconstruction in
  `roads.ts`/`parcels.ts` from "the single main chain" to "every maximal chain per class".

**Deliverable:** a denser, connected village — several roads crossing at junctions, houses
lining more frontage.

**Test plan:**
- **Invariants:** graph connected; **planar** — no two edges cross except at a shared node;
  seed-varied primary count follows the configured target; every edge inside the boundary;
  no zero-length edges; junction
  nodes have degree ≥ 3.
- **Determinism + stream isolation:** road sub-model identical for a seed; unchanged by
  boundary/parcel params.
- **Parcels regression:** lots still non-overlapping and clear of the (denser) corridors;
  lot count scales with total road length.
- **Golden:** SVG snapshots.
- **Mesher (headless):** road `GeometryData` counts/bounds; per-class widths honored.

### [x] M5 — Settlement morphology & civic space

The existing generator makes one settlement morphology: a relatively dense, irregular,
connected village. Real rural settlements are not a flat list of interchangeable road graphs.
Settlement scale, degree of nucleation, and physical layout are related but distinct concerns.
A small hamlet may be linear or clustered; a large farm complex may resemble a tiny village;
and visually similar row settlements may arise from fundamentally different parcel systems.

M5 introduces explicit **settlement morphology**. Forms are generator contracts rather than
claims of exact historical reconstruction. Historical settlement types provide exemplars and
later regional profiles, but the core model describes the spatial rule that roads, civic space,
and parcels must share.

**Taxonomy:** the initial family has seven morphological forms:

| Form | Historical exemplars | Road and parcel consequence |
| --- | --- | --- |
| **Estate** | `Einzelhof`, isolated farmstead, Scandinavian `gård` | A single dominant holding or farm complex with a compact supporting cluster. Generate one principal access route and local yard or service paths; do not invent a village road network. |
| **Dispersed** | `Weiler`, farmstead hamlet, Scottish `farmtoun` / `fermtoun` | Several separated household or farm clusters linked by sparse paths. Preserve meaningful open land between nuclei and allow only limited secondary connections. |
| **Clustered** | `Haufendorf`, Swedish `Klungby`, irregular or nucleated village | A dense, irregular agglomeration without strict geometric order. Evolve the current loose-grid strategy into curved through streets, selective cut-throughs, and a compact non-radial core. |
| **Linear** | `Reihendorf`, `Straßendorf`, Swedish `Radby`, valley or waterside row settlement | Organize settlement along a preferred road, stream, valley, dike, ridge, or clearing edge. Generate an elongated spine with one- or two-sided frontage; parcels follow the axis but need not share regular boundaries or depth. |
| **Tenement** | English toft-and-croft village, planned row village, `Hufendorf` and `Waldhufendorf` analogues | Repeated frontage holdings are the primary organizing geometry. Subdivide one or two settlement fronts into relatively narrow plots and project deep rear holdings from them. Roads serve the tenement structure rather than independently defining it. |
| **Common** | `Angerdorf`, English green village, Danish `Forteby` | Reserve a communal open space first and organize roads and frontage around its boundary. The common may be lens-shaped, elongated, or irregular; roads flank or skirt it without consuming it. |
| **Radial** | `Rundling`, `Runddorf` | Arrange inward-facing farmsteads around a central open space and project wedge-like holdings outward. Prefer one principal entrance and limited secondary access; do not generate a generic ring road or radial traffic hub. |

These forms intentionally describe **morphology rather than settlement size**. Terms such as
farmstead, hamlet, village, and estate remain useful descriptive or regional labels, but they do
not select road geometry by themselves. Planned urban grids, bastides, fortified towns, and
market towns remain outside this rural settlement milestone; they require a different density,
civic program, and defensive model.

Historical names are retained as **profiles or exemplars**, not top-level generator primitives.
For example, an `Angerdorf` is a `common` settlement with an elongated or lens-shaped common
and two flanking routes; an English green village may use the same form with a broader,
irregular green and less regular frontage. A `Radby` is `linear`; a toft-and-croft village is
`tenement`. This lets later regional generation select historically informed parameter bundles
without duplicating the underlying geometry strategy.

**Model and selection:**
- Select a named preset, not a mutually exclusive morphology. Add
  `SettlementProfile = estate | weiler | haufendorf | reihendorf | tenement | angerdorf |
  rundling`; `VillageParams.settlementProfile` accepts one of these profiles or `auto`.
  `auto` resolves from a named `layout` RNG stream. The selected profile and its resolved layout
  are stored on `MapModel`, giving tests and future controls a stable explicit choice.
- Resolve each profile into composable layout axes:
  `SettlementScale = estate | hamlet | village`,
  `SettlementNucleation = compact | dispersed`, and
  `SettlementGeometry = clustered | linear | frontage | common | radial`.
  A profile may therefore express a linear hamlet, a dispersed farmstead settlement, or a common
  village without pretending that scale and geometry are the same enum. `SettlementLayout` owns the
  resolved axes, settlement anchor and extent, preferred axis or entrance, road-growth budget,
  frontage profile, parcel projection rule, and reserved civic spaces.
- Generalize `Parcel` from a CCW quad to a convex CCW polygon with explicit road-frontage
  metadata (`frontage` segment plus serving edge/class) and a convex `buildablePolygon`. M5
  emits convex strips, wedges, and irregular common-side lots only. Building placement samples a
  road-oriented rectangle and accepts it only when it lies in `buildablePolygon`; it must no
  longer infer orientation or dimensions from four fixed parcel vertices.
- Add `CivicSpace` model data, initially `{ kind: green, polygon }`. Common and radial profiles
  emit a civic space; other profiles emit none by default. Roads, parcels, and buildings treat it
  as a hard exclusion, while renderers show it as reserved open land until terrain or later civic
  generation supplies its surface and use.
- Extend `RoadClass` with `track` for sparse access and service paths. A central class policy
  specifies width, termination behavior, and `supportsFrontage`; `track` is renderable and part
  of movement connectivity but never creates parcel frontage. Estate and dispersed profiles use
  tracks for access paths; `primary`, `secondary`, and `lane` retain their frontage behavior.
- Historical profiles remain parameter bundles rather than public regional/cultural data. They
  select common shape, side count, frontage regularity, strip depth, entrance count, axis source,
  and the resolved axes above.

**Generation rules:**
- In M5, resolve the profile after the boundary and materialize one `SettlementLayout` before road
  growth. M7 changes the physical ordering to `boundary -> profile selection -> water -> layout
  plan -> roads -> parcels`: water may alter the axis, civic-space placement, or viable profile
  parameters, but it must not change the seeded profile selection.
- Reserve form-defining geometry before road growth. For `common` and `radial`, reserve civic
  space first. For `linear`, derive the preferred axis first. For `tenement`, derive settlement
  fronts and the parcel projection direction before generating local roads.
- Dispatch road growth to the form-specific strategy before the existing planarization step.
  Parcel generation consumes the same plan to choose road-side eligibility, frontage spacing,
  projection direction, strip proportions, and density, then applies the existing corridor and
  overlap checks.
- Preserve shared safeguards for every form: inset-boundary containment, restrained Catmull-Rom
  curves, frontage-derived spacing, planar intersections, and soft road budgets.
- The existing M4 loose-grid strategy becomes the basis of `clustered`.
- A form must never be forced to produce its nominal road count when doing so contradicts its
  morphology or leaves no viable lots. Form-defining constraints take precedence over target
  density.
- `linear` and `tenement` must remain distinct. Linear settlement follows an axis and may have
  irregular frontage and parcel depth. Tenement settlement derives repeated holdings from
  frontage subdivision and rearward projection even when its road graph is visually simple.
- `common` and `radial` must remain distinct. Common settlements face or border shared land;
  radial settlements additionally require inward-facing frontage and outward parcel projection.

**Delivery sequence:**
- **M5a - morphology foundation:** add profile selection and resolved axes, `SettlementLayout`, civic
  spaces, convex parcels with frontage/buildable metadata, building containment against generic
  buildable polygons, and `track` class policy. Migrate the existing M4 output to the
  `haufendorf` profile and keep its current golden coverage.
- **M5b - core forms:** implement `reihendorf`/`tenement` and `angerdorf` on the new contracts.
  These validate the axis, frontage-projection, and civic-space systems with the largest visual
  and parcel-generation differences.
- **M5c - sparse and radial forms:** implement `estate`, `weiler`, and `rundling` after the
  shared contracts are proven. M5 is complete only once all named profiles pass the common test
  suite, but M5a and M5b are individually reviewable vertical slices.

**Deliverable:** seed-varied or explicitly selected rural settlements whose road graph, reserved
civic space, and parcel arrangement agree with a recognizable settlement morphology. Historical
profiles may produce Angerdorf-, Rundling-, Radby-, Haufendorf-, or toft-and-croft-like results
without requiring those names to become unrelated top-level algorithms.

**Test plan:**
- **Selection:** same seed plus `auto` resolves identically; an explicit form override is
  honored; adding the `layout` stream does not alter boundary output.
- **Shared invariants:** every profile remains inside the boundary; its complete movement graph,
  including `track` edges, is planar and connected; parcels and buildings remain clear of roads,
  tracks, and civic spaces. Only edges whose class policy supports frontage may generate parcels.
- **Estate:** has exactly one frontage-serving chain or a single `track` approach into the
  holding, no road cycle, and all accepted parcels lie within `2 * lotDepth` of the dominant
  holding center.
- **Dispersed:** retains at least two household clusters whose closest building or parcel points
  are separated by at least `1.5 * lotDepth`; tracks, rather than frontage roads, bridge gaps.
- **Clustered:** has at least two degree-3-or-greater junctions, no junction degree above five,
  and frontage on at least three distinct road chains.
- **Linear:** has a longitudinal-to-transverse settlement-bounds ratio of at least `2:1` and
  concentrates at least 80% of frontage on one or two chains aligned within 20 degrees of its
  preferred axis.
- **Tenement:** produces repeated frontage subdivisions with materially deeper rear holdings and
  broadly consistent projection away from the settlement front: median lot depth is at least
  twice median frontage, and at least 90% of parcel projection vectors point to the same side of
  their serving front.
- **Common:** keeps its reserved common clear, has two or more frontage-serving chains within
  `lotDepth` of different sides of the civic-space boundary, and does not require radial parcel
  geometry.
- **Radial:** keeps its central green clear, produces inward-facing frontage and wedge-like
  outward holdings over at least 180 degrees of the civic-space perimeter, and has no road cycle
  that encloses the civic-space polygon.
- **Golden:** add fixed-seed SVG snapshots for every explicit form, representative historical
  profiles where they materially alter geometry, and the `auto` selection path.

### [x] M6 — Approach roads (village entrances)
Extend the primaries out to the **map edge** so the village connects to the surrounding
country — the roads you actually arrive on.

**Scope:**
- **Map extent:** introduce `mapBounds` — the village bounds expanded by a countryside
  margin — as the world the village sits in. The camera frames `mapBounds`, not the tight
  boundary. (This also gives the later water and terrain stages a countryside to fill,
  M7–M9.)
- **Entrances (2–4):** from selected primary endpoints, continue the road's tangent
  outward, crossing the village boundary once, to a point on the `mapBounds` edge. Class
  `approach` (primary width). Entrances are spread by angle; not every endpoint gets one.
- Planarize approaches into the graph (one end is the primary's endpoint node, the other a
  node on the map edge).

**Deliverable:** a few roads leading off-map at entrances; camera reframed to show the
countryside margin around the village.

**Test plan:**
- **Invariants:** each approach joins a primary endpoint to the map edge; its outer node
  lies on the `mapBounds` edge (within eps); each approach crosses the village boundary
  exactly once; graph stays connected; entrance count within `[min, max]`.
- **Framing:** camera frames `mapBounds` (contains village boundary + margin).
- **Determinism + golden.**

### [x] M7 — Rivers (flowing structural water)
A river behaves *almost like a road* — a meandering water-spine — but it's water, so it
constrains the settlement rather than serving it.

**Pipeline position:** a `water.ts` stage runs **early** (after boundary, before roads), so
every downstream stage already sees the water. Because M0–M6 predate it, this milestone
retrofits water-awareness into the boundary/road/parcel stages (the cost of adding structural
generation late — see the note below).

**Scope:**
- **River path:** a meandering Catmull-Rom polyline, typically map-edge to map-edge (or edge
  to a lake), widening downstream. Reuses the spline + planarization utilities.
- **Crossings:** where a road crosses the river, insert a **bridge/ford** node (a flagged
  crossing edge) instead of a free intersection; a village split by the river stays connected
  only through bridges.
- **Bank bias:** parcels/buildings avoid the channel; the density falloff gains a
  **water-proximity** term so the town banks the river.
- **Model:** `water: WaterBody[]` with a river = `{ kind: "river", path, width }`; road graph
  gains bridge nodes/edges.

**Deliverable:** a village straddling a river, joined by bridges, houses banking the water.

**Test plan:**
- **Invariants:** river path is simple and spans to map edges/bodies; every road×river
  crossing is a bridge node (no road edge passes through open water uncrossed); no building
  footprint overlaps the channel; more buildings within distance *D* of the river than a
  uniform sample (bank bias); graph stays connected across the river.
- **Determinism + stream isolation:** `water` stream identical for a seed; unaffected by
  road/parcel params.
- **Golden:** SVG snapshots. **Mesher:** water surface covers the channel; no NaNs.

> **Note — ordering trade-off.** Structurally, water belongs *before* the settlement in the
> pipeline, so ideally it would have been built before M2–M6. Scheduling it at M7 means the
> road/parcel stages get water-awareness bolted on rather than designed in, and M7–M8 will
> touch code those milestones own. That's an accepted cost of prioritizing the road network
> first; if the retrofit proves large, the alternative is to pull the `water.ts` stage (at
> least a river channel) forward ahead of the M4 road-network work so roads are water-aware
> from the start.

### [x] M8 — Standing water & coastline (ponds, lakes, ocean border)
Closed water bodies, escalating to a large body that becomes a **border**.

**Scope:**
- **Ponds:** small organic water blobs (mini-boundary polygons); local avoidance + mild
  amenity bias.
- **Lakes:** larger closed bodies, optionally fed by the M7 river; shoreline clustering.
- **Coast/ocean as border:** a large body occupying a region of `mapBounds`, its shoreline
  **replacing part of the village boundary** → a waterfront town. The settlement fills the
  land side; roads run parallel to the shore and lead to optional **docks/harbor** where a
  primary road meets the water. Strong shoreline clustering.
- **Model:** `WaterBody.kind` ∈ `pond | lake | coast`; boundary/`mapBounds` become
  water-aware (clipped by a coast).

**Deliverable:** waterfront villages — a lake or ocean edge as a hard border with the town
hugging the shore; ponds dotting the interior.

**Test plan:**
- **Invariants:** water bodies are simple, non-overlapping, inside `mapBounds`; no
  building/road lies in water; a coast body touches a `mapBounds` edge and the village sits
  on its land side; shoreline bias (buildings nearer the shore than a uniform sample); any
  dock road terminates at the shore.
- **Determinism + golden + mesher.**

> **Terrain-first re-architecture (M9–M15).** Through M8, water was the earliest
> structural constraint and the boundary was an unanchored organic outline. M9 inverts this:
> a `TerrainModel` is generated *first* and everything else is progressively handed over to
> it. M9–M11 are shipped and establish the substrate (relief, hydrology selection, siting);
> M12–M15 finish the handover (roads, parcels, land cover, interactivity). Where a shipped
> milestone realized only part of its title, the outstanding half is named explicitly and
> scheduled into a later milestone rather than silently claimed.

### [x] M9 — Terrain substrate & visible relief
Generation now begins with terrain. `stages/terrain.ts` runs first in the pipeline — before the
boundary — drawing from a dedicated `terrain` stream, and produces a `TerrainModel`: a
deterministic analytical landscape roughly three settlement diameters wide that every later
stage can consult.

**Shipped:**
- **Profiles:** nine resolved landforms — `plain`, `river-valley`, `lakeshore`, `coast`, `cove`,
  `peninsula`, `ridge`, `hillside`, `island`. `terrainProfile: "auto"` resolves one from the
  seed; an explicit profile is honored. `VillageParams.terrainProfile` carries the choice.
- **Height field:** a 65×65 regular grid over square `bounds = radius*3`, row-major
  `TerrainSample[]`. Each profile is a closed-form height function (profile relief + two-phase
  sinusoidal noise) over sea level 0; per-sample `slope` is a central-difference gradient
  magnitude.
- **Buildability classification:** `land = height > seaLevel`;
  `buildable = land && slope < 0.22 && height > 1.5`. `terrainSampleAt(point)` reads the nearest
  sample with clamped grid coordinates.
- **mapBounds becomes terrain-owned:** the pipeline sets `mapBounds = terrain.bounds`, replacing
  the M6 countryside-margin rectangle. The camera frames the terrain extent and approaches run to
  the terrain edge. (The `countrysideMargin` param is now vestigial.)
- **Terrain-oriented settlement:** `layout.ts` seeds the settlement axis from the profile
  (valley/ridge across-slope, coast family along-shore, hillside diagonal) before falling back to
  a random axis.
- **Rendering:** `render/meshers/terrainMesher.ts` emits a raised regular-grid `GeometryData`
  (per-sample height × vertical scale); the Renderer tints water-fronting profiles differently and
  frames `mapBounds`.

**Deliverable:** every seed sits on a visible, deterministic local landscape with a classified
buildable surface; the profile visibly shapes relief and settlement orientation.

**Test plan (shipped):**
- **Determinism:** each profile regenerates byte-identical terrain; `mapBounds === terrain.bounds`;
  `resolution²` samples; all heights/slopes finite; at least one buildable sample.
- **Mesher:** raised field emits `resolution²` vertices and `(resolution-1)²·6` indices, all finite.
- **Orientation:** valley/coast axes align with the profile's preferred direction.

**Deferred:** the substrate is analytical and the legacy boundary/water/road stages still own
their own geometry. M10–M13 progressively hand that ownership to the terrain.

### [x] M10 — Terrain-owned hydrology
`stages/water.ts` gains `generateHydrology`, which resolves all water from the selected terrain
profile instead of from standalone water parameters, and the result is propagated back onto the
terrain samples.

**Shipped:**
- **Profile-driven selection:** `terrainRiverChance` biases river presence by profile
  (river-valley → ≥0.9; ridge/hillside/island → ≤0.15; explicit 0/1 respected). `terrainWaterKind`
  picks the standing-water kind (lakeshore → lake; coast/cove/peninsula/island → coast; else pond)
  unless `standingWaterKind` overrides it.
- **Single hydrology stream:** river + standing water are produced together over `terrain.bounds`
  from one `hydrology` stream; river banks and coast reserves clamp to the terrain extent.
- **Exclusion propagation:** `applyHydrology` marks every terrain sample under a river channel or
  closed body as `land = false, buildable = false`, and stores the resolved bodies on
  `terrain.hydrology` (kept equal to `MapModel.water`).

**Deliverable:** water type and presence follow the landform, and the buildable surface reflects
the water actually placed.

**Test plan (shipped):**
- river-valley yields a river; cove yields coast; lakeshore yields a lake;
  `terrain.hydrology === water`; submerged samples become non-land / non-buildable.

**Deferred (true height-field-derived hydrology):** rivers still meander map-edge-to-edge rather
than descending the gradient to a low point; standing water and coast are still placed by profile
heuristic rather than traced from the sub-sea-level contour; drainage networks and floodplains are
not yet derived. Tracing shoreline and channel geometry from the height field is folded into M12's
crossing work and remains the outstanding half of "terrain-owned" water.

### [x] M11 — Settlement siting & envelope
`stages/site.ts` chooses where the settlement sits on the classified terrain before its outline is
drawn.

**Shipped:**
- **Connected buildable component:** a 4-neighbour flood fill over `buildable` samples finds
  connected components; the largest is the candidate build area.
- **Scored anchor:** each candidate cell scores on centrality (distance to terrain center) and
  flatness (slope) with a small seeded jitter, from the `site` stream. The best cell is
  `SettlementSite.anchor`; the model records `componentSize`, `suitability`, and a human
  `rationale`.
- **Anchored envelope:** the organic boundary is generated at the origin then translated to the
  site anchor, so the settlement, roads, parcels, and buildings all sit on the chosen buildable
  land. Diagnostics surface the site rationale and buildable percentage in the HUD.

**Deliverable:** settlements land on stable, connected, buildable terrain rather than the terrain
center by default, and the choice is inspectable.

**Test plan (shipped):**
- `site.componentSize > 0`; boundary vertices sit within the expected radius of the anchor;
  diagnostics report terrain, site, and buildable percent.

**Deferred:** the envelope is still the seeded organic outline translated to the anchor, not a
shape derived from the buildable component's extent; terrain–morphology compatibility (rejecting a
profile a site cannot support, biasing profile selection by available land) is not yet resolved.
Both are picked up as siting/morphology refinements in M13.

### [ ] M12 — Terrain-constrained roads & crossings
Roads currently ignore relief. This milestone makes circulation follow the terrain: routes prefer
traversable slope and natural corridors, and river crossings are chosen at good, stable points
before planarization. It also lands the deferred half of M10 — deriving channel/shoreline geometry
from the height field.

**Scope:**
- **Slope-aware routing:** road candidates sample terrain slope along their length (via
  `terrainSampleAt`) and are penalized or rejected where they climb steeper than a traversable
  threshold; trunk/cross-street placement biases toward valleys, shore corridors, ridgelines, and
  passes rather than cutting across steep faces.
- **Height-field hydrology (M10 carryover):** trace river channels down the gradient to a lake or
  coast and shorelines along the sub-sea-level contour, replacing the profile-heuristic placement,
  so crossings sit on real banks.
- **Crossing selection before planarization:** where a route must cross a river, choose the
  crossing at a narrow, low-slope, stable bank point (a ford/bridge site derived from the channel +
  banks) instead of accepting whatever intersection planarization happens to produce; flag it
  `crossing: "bridge"` as today.
- **Corridor continuity:** approaches and primaries prefer to enter the site through terrain gaps
  (valley mouths, shore edges) so entrances read as the ways one would actually arrive.
- **Model:** road generation consumes `TerrainModel` and the resolved hydrology; crossing nodes
  carry the chosen-site rationale.

**Deliverable:** road networks that avoid unbuildable steep ground, run with the grain of the land,
and cross water at deliberate points.

**Delivery sequence:**
- **[x] M12a — terrain-constrained routing (clustered generator).** `roads.ts` consumes the base
  `TerrainModel`. The `haufendorf` trunk runs with the terrain grain (the terrain-derived layout
  axis via `bestThroughRoad`, which searches nearby axes to stay on traversable ground); optional
  cross streets, secondary connectors, and lanes are dropped where they would cross water or ground
  steeper than `MAX_ROAD_SLOPE`. The must-have spine is never dropped, so the graph stays connected.
  Roads see the pre-hydrology terrain, so they avoid height-field water; river crossings stay the
  job of `integrateRiverCrossings`.
- **[x] M12b — deliberate river crossings.** The hydrology stage is split so the river is resolved
  *before* roads (from the same `hydrology` stream, preserving draw order) while standing water
  still follows them. The clustered generator treats the river channel as an obstacle — roads are
  dropped where they would cross open water — except at a chosen **ford**: the gentlest, most
  central bank point (`chooseFords`). The trunk is anchored to cross there, so the one river
  crossing is deliberate and the village stays connected across the banks. `integrateRiverCrossings`
  was hardened to flag crossings that land on a river-centerline vertex (which a ford does), not
  only interior crossings. A straight trunk can still incidentally re-cross a meander; making every
  crossing deliberate (and profile-form crossings) is left to M12d.
- **[x] M12c — height-field hydrology geometry (M10 carryover).** Coastlines are traced from the
  sub-sea-level contour of the height field via marching squares (`geometry/contour.ts` →
  `terrainSea`), so coves, peninsulas, and irregular coasts follow the real land/sea boundary
  instead of a straight jittered strip. Rivers vary in width, tapering from a narrow source to a
  wide mouth, oriented by terrain height so they widen downstream. Approaches no longer run into the
  sea. The traced coast can be concave, so the water mesher ear-clips (not fan-triangulates) and
  parcel/water overlap uses a general (non-convex) test. Deferred: the ring case (an island's
  surrounding sea) needs a polygon-with-hole and still uses the heuristic strip; standing `lake`
  bodies are not yet traced; rivers still follow a Catmull meander rather than steepest descent.
- **[ ] M12d — profile-form & approach corridors, island seas.** Extend terrain-constrained routing
  (and ford crossings) to the non-`haufendorf` profiles; route approaches and primaries through
  terrain gaps (valley mouths, shore edges) rather than only rejecting sea crossings; suppress the
  trunk's incidental re-crossings of a meander so *every* crossing is a chosen ford; and represent
  island/ring seas (polygon-with-hole) so they too are terrain-traced.

**Test plan:**
- **Invariants:** no accepted road segment exceeds the traversable-slope threshold beyond tolerance
  and none lies on water *(M12a — asserted against the base terrain roads consume, across relief
  profiles and seeds)*; a river-straddling village stays a single connected component and its best
  bridge sits at the gentlest bank the river offers inside the settlement *(M12b)*; a traced coast
  agrees with the terrain's own land/sea mask over >90% of cells, reaches the map edge, and is
  detailed (not a ~15-point strip); a river's width varies >2.5× and its wide end sits on lower
  ground *(M12c)*; graph stays connected and planar. Marching-squares contour extraction is unit
  tested (orientation, interpolation, submerged/dry fields).
- **Determinism + stream isolation; golden SVG.** The road-topology and morphology invariants pin
  `plain` terrain so they exercise the algorithm independent of relief (a coast can legitimately
  drop entrances below `approachRoadMin`); separate suites cover relief and coastline behavior.

### [ ] M13 — Terrain-constrained parcels, buildings & siting refinement
Parcels and buildings must respect the same terrain the roads now follow, and settlement
siting/morphology finishes its handover to the terrain (the deferred half of M11).

**Scope:**
- **Terrain exclusions:** parcels and buildings reject water, floodplain, steep, and non-`buildable`
  cells and inaccessible remnants cut off from the road graph, on top of the existing
  corridor/overlap/civic checks.
- **Terrain-weighted density:** the density falloff gains terrain terms — flatter, better-connected,
  water-adjacent buildable land is preferred; civic space is reserved on genuinely usable ground.
- **Envelope & morphology from terrain (finishes M11):** derive the settlement envelope from the
  connected buildable component's extent rather than translating a fixed organic outline; let
  available land and profile resolve/bias the morphology preference and reject infeasible profiles.
- **Model:** parcels/buildings consume `TerrainModel`; the envelope becomes terrain-derived.

**Deliverable:** houses and lots only where the land supports them, density that reads the terrain,
and a settlement shape that fits its site.

**Test plan:**
- **Invariants:** no parcel/building on non-buildable, submerged, floodplain, or steep cells; every
  building reachable from the road graph; envelope contained in the buildable component; density
  correlates with buildability.
- **Determinism + golden + mesher.**

### [ ] M14 — Land cover & countryside structure
With settlement fixed, fill the remaining terrain with decorative land cover — the first stage that
is purely additive and never constrains layout.

**Scope:**
- **Fields:** farmland patches on workable, connected, gently-sloped buildable land left outside the
  settlement, as **Voronoi + Lloyd-relaxation** cells (the first use of `d3-delaunay` — see §2).
  Fields follow their cell boundaries and avoid water/steep ground.
- **Woodland:** thin-instanced trees seeded by a Poisson sampler under a density mask that favors
  steep, remote, high, or otherwise unsuitable-for-building terrain.
- **Grassland / exposed terrain:** material-zoned ground fills what neither settlement, fields, nor
  woods claim; very steep or high cells read as bare/exposed rock.
- **Model:** a decorative `landCover` layer on `MapModel`; renderers add field, tree, and
  ground-zone meshes. No feedback into roads/parcels.

**Deliverable:** a populated countryside — fields near the settlement, woods on the rough margins —
around the village.

**Test plan:**
- **Invariants:** land cover never overlaps settlement footprints, water, or roads; fields occupy
  buildable/workable cells while woods favor steep/remote cells; coverage partitions the remaining
  land without gaps or overlaps.
- **Determinism + golden; mesher (field/tree/ground counts, no NaNs).**

### [ ] M15 — Interactivity & terrain diagnostics
Expose the now terrain-driven model through controls and inspection, and finish presentation polish.

**Scope:**
- **Controls & URL state:** terrain profile, river chance/width, standing-water kind, settlement
  profile, and key density params become UI controls that round-trip through the URL (extending
  `urlState`), with a regenerate/screenshot flow.
- **Inspection overlays:** toggleable overlays for terrain profile/relief, slope/buildability,
  hydrology, exclusions, the chosen site + component, and bridge crossings — driven by the same
  `MapModel`/SVG data used in tests.
- **Diagnostics surface:** promote `geometryDiagnostics` into a visible panel (terrain, site
  rationale, buildable %, road/water/bridge counts).
- **Presentation:** picking, screenshot export, and the deferred near-ortho ↔ perspective "diorama"
  toggle (see §2).

**Deliverable:** a seed's terrain, hydrology, buildability, siting, and circulation are all
inspectable and adjustable from the browser, with shareable URLs and screenshot export.

**Test plan:**
- **URL round-trip** for every exposed param (incl. malformed → default); **overlay data**
  assertions against the model (headless); determinism of diagnostics text; pixel/screenshot checks
  optional under a browser runner.

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
