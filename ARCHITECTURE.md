# Architecture

This document explains how the village generator currently works through M6.
It starts with the problem each phase solves, then names the techniques used in
the code. Read `PLAN.md` for the roadmap; use this document to understand the
implemented system and the rules that shape its output.

## The overall idea

A generated village should be repeatable, understandable, and useful as input
to several views. Given the same seed and parameters, the generator makes the
same settlement every time. It first establishes a place to build, then creates
ways to move through it, then adds the lots and houses that make those streets
feel inhabited.

```text
seed + parameters
        |
        v
named RNG streams -> boundary -> settlement layout -> village roads -> approaches -> parcels -> buildings -> MapModel
                                                               |         |
                                                               v         v
                                                     Babylon renderer   SVG debug/goldens
```

`MapModel` is the shared description of the village. It contains data only;
rendering does not make layout choices. That separation means a visual problem
can be reproduced from a seed, inspected in SVG, and tested without a browser
or GPU.

| Area | What it is for |
| --- | --- |
| `src/gen/` | Makes the village: random choices, geometry, stages, and model data. It has no Babylon imports. |
| `src/render/` | Draws a completed model with Babylon. |
| `src/debug/` | Draws the same model as SVG for fast inspection and golden tests. |
| `test/` | Checks the rules that make generated villages valid and repeatable. |

## Rules that apply everywhere

### Repeatable choices

Procedural generation is only useful when a reported seed can be reproduced.
All variation therefore comes from a seeded pseudo-random number generator
(PRNG), rather than `Math.random` or the current time. The project uses
[named random streams](https://github.com/bryc/code/blob/master/jshash/PRNGs.md):
boundary, layout, roads, approaches, parcels, and buildings each receive their own stream derived
from the main seed.

In practical terms, changing how many random choices road generation makes must
not silently change the boundary or houses for that seed. This is why stream
ownership lives in `src/gen/pipeline.ts`.

### Shape before rendering

The generator works with points, outlines, road connections, lots, and building
footprints before it works with meshes. These are ordinary geometry and graph
data structures, which makes questions such as "does this road cross that one?"
or "does this house fit?" answerable in tests. Babylon receives the finished
model and turns it into visual geometry afterwards.

### A good village is allowed to leave space empty

The generator treats safety and buildability as more important than meeting a
count. A candidate road, lot, or building is omitted when it would be too close
to something else or lie outside the settlement. This is why configured road
counts are soft budgets: they describe how much the generator may try to add,
not a requirement to fill the map with unusable streets.

## Generation phases

### 1. Start with a seed and a work area

The pipeline needs a common scale before it can judge whether a road is too
short for houses or whether a connection is too close to an existing junction.
`src/gen/pipeline.ts` owns the defaults and runs the stages in order:

1. Make the settlement outline.
2. Resolve the settlement form and reserve civic land.
3. Make roads within that outline and around any reserved land.
4. Extend selected primary routes into the countryside.
5. Make roadside lots from the roads.
6. Put buildings into viable lots.
7. Derive village and map bounds for framing.

The normal village radius is 125 units. This is intentionally large enough to
hold several primary routes and central blocks while leaving enough frontage for
houses. It avoids forcing every road through a single central crossing simply
because there is no other viable space.

### 2. Define where the village can exist

The boundary gives the settlement a distinct edge rather than treating the map
as an infinite plane. `src/gen/stages/boundary.ts` makes a seeded, irregular
outline around the center. The technical representation is a simple,
counter-clockwise [polygon](https://en.wikipedia.org/wiki/Simple_polygon).

The shape is irregular so that the village does not read as a perfect circle,
but it must not fold over itself. A simple polygon supports the later operations
the generator needs: checking whether a point is inside it, measuring distance
to its edge, and shrinking it slightly. Background on these basic operations is
available in [point-in-polygon](https://en.wikipedia.org/wiki/Point_in_polygon)
and [polygon offsetting](https://en.wikipedia.org/wiki/Parallel_curve).

Road placement uses a smaller version of the boundary, called an inset safe
area. This leaves room between the settlement edge and road ribbons, curve
bends, lots, and buildings. The original boundary remains the final hard limit
for later stages.

### 3. Choose a settlement form before growing roads

A village is not always a loose grid. `src/gen/stages/layout.ts` resolves a
named `SettlementProfile` from either the requested parameter or the dedicated
`layout` random stream. It stores the result as `SettlementLayout` on
`MapModel`, including scale, nucleation, preferred axis, anchor, and any civic
spaces. This gives roads, lots, renderers, and tests one shared decision rather
than letting each stage independently guess what kind of settlement it is.

The shipped profiles are `estate`, `weiler`, `haufendorf`, `reihendorf`,
`tenement`, `angerdorf`, and `rundling`. They are practical spatial rules, not
claims to reconstruct a particular historical settlement: estate uses one
access route, weiler stays sparse, haufendorf retains the irregular clustered
network, reihendorf and tenement use an axis and frontage, and angerdorf and
rundling reserve a central green. `auto` is deterministic for a given seed.

The green is a `CivicSpace` polygon. It is reserved before roads are grown;
roads, parcels, and buildings treat it as exclusion land, and both renderers
draw it as open space. This is the same broad idea as a
[land-use reservation](https://en.wikipedia.org/wiki/Land-use_planning): decide
which area has a non-building purpose before filling the remaining area.

### 4. Make a road network that supports movement and homes

Roads are not independent random lines. They should let someone travel through
the village, offer enough continuous frontage for lots, and create a denser
center without making every route converge at one node. `src/gen/stages/roads.ts`
therefore grows a small hierarchy in a deliberate sequence.

#### Describe roads as connections, not just strokes

Before a road can support routing, loops, or lots, the system needs to know
which crossings are actual junctions. Road candidates begin as sampled curved
lines. `planarize()` in `src/gen/geometry/graph.ts` then turns them into a
[planar graph](https://en.wikipedia.org/wiki/Planar_graph): nodes are junctions
or endpoints, and edges are the pieces of road between them.

This process is called **planarization**. It tests pairs of straight sampled
segments for [segment intersection](https://cp-algorithms.com/geometry/check-segments-intersection.html),
splits an edge at a crossing, merges nearly identical endpoints, and removes
duplicate edges. The result is that visually crossing roads actually meet in the
data model; there are no accidental overpasses.

Each edge carries a road class. The class says what the road is for and provides
a width for rendering and a density preference for parcel placement.

| Class | Default width | What it is used for | Parcel density weight |
| --- | ---: | --- | ---: |
| `primary` | 3.5 | Main routes that carry movement across the village: the trunk and cross streets. | 1.00 |
| `secondary` | 2.5 | Two-ended local connectors that make central blocks and alternative paths. | 0.82 |
| `lane` | 1.8 | Short frontage branches where a dead end can still be useful. | 0.65 |
| `track` | 1.26 | Sparse access or service path. It contributes to movement but never creates parcel frontage. | n/a |

Planarization can split one visible road into several graph edges at junctions.
`roadChains()` rebuilds maximal same-class paths for parcel generation, so lots
still follow a continuous length of street instead of stopping at every graph
node.

#### Build the network in a useful order

For the clustered `haufendorf` profile, the population order reserves the
valuable central space for connected movement before it considers optional
frontage branches.

1. **Give the village a spine.** A primary trunk crosses the safe area from one
   side to the other through a slightly jittered center. It gives the settlement
   an initial direction and a dependable long route.
2. **Add several ways across that spine.** Offset primary cross streets meet the
   trunk at separated positions. Their number varies around the configured
   target for seed variety, but the normal multi-road configuration maintains a
   three-route minimum. The spacing is what prevents a star-shaped central hub.
3. **Join streets into real blocks.** Secondary roads connect different primary
   cross streets at similar positions on the same side of the trunk. This gives
   the core more than one route through it and forms rectangular or loose blocks.
   Every secondary has two connected ends; it is not emitted as an orphaned
   line.
4. **Add frontage only where it fits.** Lanes grow from existing roads after the
   connected core is established. A lane may end because its role is to provide
   a small amount of additional house frontage, not necessarily another route
   through town.
5. **Record every crossing correctly.** After those candidates are accepted,
   planarization creates the final `RoadNetwork` that parcels consume.

The connector rule is intentionally narrower than "make any loop." A trunk and
one cross street already meet, so linking them again nearby would make a small,
decorative triangle with little movement value. Connecting *separate* cross
streets instead creates a continuation that can lead somewhere else. This is the
mechanism that turns a few major roads into a usable loose grid.

#### Keep routes organic without making them arbitrary

Villages should not look like they were drawn only with a ruler, but unrestricted
curves are difficult to contain and can waste valuable buildable space. The code
uses [centripetal Catmull-Rom splines](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)
to sample smooth road paths through a small set of control points:

- the trunk gets a restrained seeded bend around its center;
- a connector uses a controlled midpoint; and
- a lane can have a small departure wiggle.

If a sampled curve leaves the inset safe area, it is rejected or replaced with a
simpler curve. The technical name matters because Catmull-Rom interpolation
passes through its control points, which makes it a useful fit for roads that
must still attach at known junctions.

#### Decide whether a proposed road earns its space

The road stage applies spatial rules based on the practical question: can this
street make a useful contribution without preventing nearby homes?

- Major-route anchors and junctions must be separated by at least
  `max(lot frontage * 2.5, village radius * 0.18)`.
- A branch or connector needs enough length to serve several lots; a very short
  segment is omitted.
- A connector must begin and end on existing routes, stay clear of existing
  junctions, and fit within a bounded local span.
- Every accepted curve must stay inside the inset boundary.
- Secondary and lane targets are budgets. Failed candidates do not trigger a
  replacement orphan road elsewhere.

These rules prefer fewer useful streets and more viable parcels. The expected
result is a connected, loose central grid with local cycles and ordinary
junctions, rather than a central star, a field of isolated spokes, or repeated
small loops that do not continue to another major route.

#### Check the road graph, not just its appearance

Tests exercise multiple seeds, including `tarry` and `waxony`, because a single
attractive seed is not enough evidence for a procedural rule. They verify that
the graph is connected and planar, has no zero-length edges, stays inside the
boundary, avoids a high-degree central hub, and can create block-scale cycles.
They also ensure that secondary roads have two connected ends while lanes may
end normally.

This is an example of testing **invariants**: properties that should hold for
all generated outputs, rather than a single expected layout. The SVG snapshots
are the complementary visual check; they make intentional changes to a seed's
character easy to review.

Form-specific routes are created as compact topology templates, then passed to
the same planarization step. A linear or tenement settlement therefore has a
single dominant spine rather than an arbitrary grid; common settlements use
flanking routes and connectors that skirt the green; sparse forms use only the
limited access they need. This keeps the shared graph and containment rules
while allowing road growth to follow the selected morphology.

### 5. Continue selected roads into the countryside

The village boundary is not the edge of the world. M6 derives `mapBounds` by
expanding the tight village bounds with a countryside margin. The renderer and
camera use that larger rectangle, while the original boundary still defines
where village parcels and buildings may exist.

`src/gen/stages/approaches.ts` examines degree-one primary endpoints, follows
each endpoint's outgoing tangent through the village boundary, and continues it
to an edge of `mapBounds`. A seeded angular-spread selection keeps two to four
entrances from clustering on one side. The new segments use the `approach` road
class: they render at primary width, remain part of the connected planar graph,
and never create parcel frontage. The existing graph plus selected approaches is
planarized again so this remains a single routing model.

### 6. Turn useful street frontage into parcels

Houses need a reason to be where they are. `src/gen/stages/parcels.ts` uses
continuous road chains as the source of frontage, then attempts lots on both
sides of each chain. Lot widths vary around a configured value so that rows do
not become mechanically uniform.

Each candidate is kept only when it remains inside the boundary, clears every
road corridor and reserved civic space, and does not overlap a parcel already accepted. This is a simple
greedy packing process backed by polygon containment and overlap checks. The
same broad family of convex-overlap test used here is the
[separating axis theorem](https://dyn4j.org/2010/01/sat/), which is also useful
background for collision-style geometry.

Not every viable lot receives the same density preference. Primary roads are
most likely to be lined with houses, secondary roads somewhat less so, and lanes
least so. A center falloff adds a second preference for denser development near
the middle. In plain terms, more streets are valuable only when they can provide
real, non-overlapping places for homes.

Lots carry their road-facing segment, serving road class, and a convex
`buildablePolygon`. That makes the contract work for future wedges and irregular
lots as well as today’s frontage strips. `track` chains are skipped entirely,
so service paths cannot accidentally create implausible roadside housing.

### 7. Put buildings in the lots

`src/gen/stages/buildings.ts` makes each house answer to a parcel rather than
placing buildings independently across the map. It creates a seeded footprint
inside a viable lot, keeps it behind the roadside setback, aligns it with the
road-facing side, and chooses deterministic dimensions and height. Candidates
that do not fit containment or collision rules are not kept.

This parcel-led approach makes the visible settlement follow its streets: denser
where useful frontage is available and more open where the road graph leaves
space alone.

### 8. Draw and inspect the completed model

The renderer's job is presentation, not generation. Bounds derived from the
boundary frame the fixed-angle camera; the Babylon renderer converts model data
into ground, civic-green, road, and house meshes. Babylon's
[mesh documentation](https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/)
is useful background for that final adapter layer.

For debugging, `src/debug/svgRenderer.ts` creates a compact SVG from the same
model. Headless tests validate determinism, containment, topology, parcel
clearance, and emitted mesh data. SVG golden snapshots provide the human check:
they show whether a fixed seed still reads as the intended kind of village after
a deliberate generation change.

## Future phase boundaries

The following work is planned but intentionally does not alter the current M4
rules yet:

- **M5 village types and civic space:** select a topology strategy before roads and reserve
  shared green space where the selected layout needs it.
- **M6 approaches:** extend selected primary routes to a future countryside map
  extent with the `approach` road class.
- **M7-M8 structural water:** make rivers, ponds, lakes, or coast before roads,
  so water can decide where a settlement may connect and build.
- **M9 decorative terrain:** add fields and woodland after the settlement is
  fixed. [Voronoi diagrams](https://www.redblobgames.com/x/2022-voronoi-maps/)
  are planned for field-like patches, but terrain should fill remaining land,
  not choose the road graph.
- **M10 interaction and polish:** expose controls and presentation features
  without weakening the generation/rendering boundary.

When a new feature introduces a real layout constraint, it belongs at the
earliest phase that can enforce it. Water, for example, must constrain road
candidates before parcels and buildings are derived. A material or lighting
choice belongs after `MapModel` is already complete.
