# Independent Plan Studio

Route: `/plan-studio`. Links live in the header, toolbox and 3D tool selection page.
The existing project viewer, APS/AI APIs, BOQ, estimate, quotation and their stores
are unchanged. This route requires no upload or model generation request.

## Commands

- `L` LINE, `PL` PLINE; `C` closes; Enter ends; `U` removes the last segment.
- `W` WALL, `FLOOR` closed polygon, `REC` RECTANG, `C` CIRCLE, `A` ARC (three points).
- `TR` TRIM / `EX` EXTEND: choose boundaries, Enter, then choose target part/end.
  Enter without boundaries uses all other edges. Shift swaps trim/extend.
- `EXTRIM`: closed polyline/circle, then pick the inside or outside side to remove.
- `O` OFFSET: distance, object, side. Single line/circle/arc supported.
- Select first: `M` MOVE, `CO` COPY, `RO` ROTATE, `SC` SCALE, `E` ERASE.
- `DLI` DIMLINEAR: two endpoints then dimension location. `DI` DIST measures.
- `T` / `MT` TEXT, `H` HATCH, `BP` BASEPLATE, `PIPE`, `DOOR`, `WINDOW`,
  `ARCHDOOR` and `LIGHT`.
- Ctrl+Z/Y undo/redo; Esc cancels; F3 OSNAP; F8 ORTHO; held Shift is temporary
  ortho. Middle/Space drag pans and wheel zooms around the cursor.

Numbers use centimetres or inches; explicit mm/cm/m/in suffixes also work.
Absolute `x,y`, relative `@x,y`, polar `@length<angle`. Metres remain authoritative
internally. Display units and print scale never rescale source geometry.

Layer names/colors/weights/linetypes/visibility/locks are independent; entity color
can inherit its layer or override it. Dimensions use their own layer. Hatch styles
include interlock, brick, concrete, steel, sand, insulation, diagonal and cross.
Base plates are geometric plate/4-hole/bolt models, with no strength calculation.
Pipes are drawn routes, with no flow, pressure or HVAC analysis. Doors/windows
are linked to straight parent walls; three-point arcs can become curved walls.

Furniture catalog data is imported read-only. A separate snapshot adapter of the
existing measured procedural geometry drives this route's modern Three.js preview;
the existing viewer and rendering path were not refactored. Complete sets add
individual components. No API calls or AI credits are required by this editor.

## Persistence and exports

Drawings autosave to a separate IndexedDB database, `ventra-independent-plan-studio-v1`.
These are **device/browser-local drafts**, not account/cloud-synced projects.
JSON is the editable backup/transfer format; import validates schema/geometry and
assigns a new drawing ID. Export a backup before clearing browser storage.

- JPG: 3000×2000 image of the visible 2D plan.
- PDF: A3 landscape at the selected scale, raster artwork with correctly scaled
  page placement. Print at 100% / Actual size. Oversize plans fail visibly.
- DXF: metre-unit R2000 ASCII, layers, true colors, curves, text, hatch and exploded
  dimension/furniture/baseplate geometry. Dimensions are not associative CAD dimensions.
- **Direct DWG is not implemented**. No validated/licensed DWG encoder is available
  in the application. DXF can be opened and saved as DWG in AutoCAD; renaming the
  extension is not a conversion. The UI marks direct DWG unavailable.

This is a focused CAD-style interior/MEP drafting editor, not an AutoCAD clone,
a complete BIM package or structural/mechanical design verification system.

## QA

`node --import ./scripts/offline-test-guard.mjs --test tests/plan-studio.test.mjs`
checks real operations, unit conversions, collision/closed-outline validation,
undo, wall/opening edits, immutable catalog reuse, modern geometry for catalog
entries, and isolated IndexedDB persistence. The generated DXF is also audited
with ezdxf and the SVG parsed as XML. `scripts/qa-plan-studio.cjs` is an automated
browser/export/reload check for an environment able to launch Chromium and reach
its local server. A restricted executor can prevent browser IPC/local port access;
record that blocker separately instead of treating a script's existence as a pass.

Live browser verification confirmed command-line drawing, dimensions, text, plate,
interlock hatch, temporary Shift ortho, a persisted seven-entity plan after reload,
and completed JSON/DXF/JPG/PDF downloads. The cloud browser has WebGL disabled;
its GPU preview could not be verified. The preview now retains the explanatory
error instead of clearing it on document updates. Geometry generation is tested
offline for every existing single catalog model.
