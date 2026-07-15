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
  subdivision). Wired in at **M9** (decorative terrain), not before. `polygon-clipping`
  deferred until a stage actually needs boolean ops. Everything through M8 (road-graph
  planarization and water) uses hand-rolled primitives (bbox, inset, SAT, segment/spline
  intersection).
- **Camera:** **near-orthographic** — `@babylonjs/lite` exposes no true orthographic
  projection, so a narrow FOV (~8°) viewed from a correspondingly large radius makes
  perspective divergence negligible, giving the flat, map-like watabou feel. Fixed tilt,
  controls locked, auto-framed to bounds. Widening the FOV yields a perspective "diorama"
  toggle, deferred to **M10**.
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
      sampling.ts          # weighted pick, poisson-disk, jitter
      voronoi.ts           # d3-delaunay wrapper + Lloyd relaxation (M9)
    stages/
      boundary.ts          # village extent polygon
      water.ts             # STRUCTURAL: rivers, ponds, lakes, coast (runs early, M7–M8)
      roads.ts             # road graph: primaries + secondaries/spokes + approaches
      parcels.ts           # subdivide buildable band into lots (water-aware)
      buildings.ts         # place clustered house footprints (water-aware)
      terrain.ts           # DECORATIVE: fields, woodlands, grass (M9)
  render/                  # ── Babylon. Consumes MapModel. ──
    Renderer.ts            # engine/scene lifecycle
    framing.ts             # pure near-orthographic framing math (tested)
    camera.ts              # fixed-angle near-ortho camera + auto-frame to bounds
    palette.ts             # materials/colors
    geometryData.ts        # plain GeometryData type + Babylon upload adapter
    meshers/
      groundMesher.ts      # terrain cells → zoned ground
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
- **Decorative terrain:** material-zoned ground filling what's left after water + settlement;
  farmland fields as **Voronoi + Lloyd relaxation** patches (M9); woodlands as thin-instanced
  trees seeded by the Poisson sampler under a density mask. No constraint on layout.
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

> **Status:** Milestones marked `[x]` are shipped. The remaining work starts with **M6**,
> which adds off-map entrances;
> **M7–M8** add *structural water* (rivers, then ponds/lakes/coast) which constrains the
> layout; **M9** paints *decorative terrain* (fields/woodlands) on what is left; **M10** is
> interactivity and polish. Structural layout and water precede decorative terrain
> deliberately: they shape where the town can go, while woodlands fill the gaps.

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

### [ ] M6 — Approach roads (village entrances)
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

### [ ] M7 — Rivers (flowing structural water)
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

### [ ] M8 — Standing water & coastline (ponds, lakes, ocean border)
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

### [ ] M9 — Decorative terrain (fields & woodlands)
Now purely cosmetic: `terrain.ts` fills the countryside inside `mapBounds` that is left over
after water + settlement. Farmland fields as relaxed Voronoi patches (wire in `d3-delaunay`
here), woodlands as thin-instanced trees under a density mask, grass. `groundMesher.ts`
renders material-zoned ground. No layout constraints — this is the decorative half of the
structural/decorative split.

**Deliverable:** houses sit in a landscape; roads run out through fields to the edge; woods
fill the hills.

**Test plan:**
- **Voronoi wrapper:** cells partition the target region; relaxation converges (centroid
  drift decreases across iterations); determinism preserved through the lib.
- **Terrain invariants:** cells partition the non-built, non-water area; no cell overlaps a
  building or water body; forest samples respect the density mask, boundary, and water.
- **Golden:** SVG snapshots including terrain zones.
- **Mesher (headless):** ground `GeometryData` covers bounds; zone material assignment
  matches cell types; tree instance count matches sampled points.

### [ ] M10 — Interactivity & polish
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
