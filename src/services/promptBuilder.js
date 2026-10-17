export function buildTakeoffPrompt({
  pageNumber = null,
  projectName = "",
  discipline = "",
} = {}) {
  return `
You are a construction quantity surveyor.

Analyze the uploaded architectural or construction drawing.

Extract only quantities that are clearly visible or can be reasonably inferred from the drawing.

Important rules:

1. Do not invent dimensions.
2. If no usable scale or dimensions are visible, return zero for measurements that cannot be calculated.
3. Count rooms, doors and windows only when they are clearly visible.
4. Length units must be meters.
5. Area units must be square meters.
6. Confidence must be between 0 and 100.
7. Explain uncertainty inside notes.
8. detected_items must include useful visible construction items.
9. Ignore title blocks, logos, stamps, borders and revision tables.
10. This is a preliminary AI takeoff and must be reviewed by a quantity surveyor.

Project name:
${projectName || "Unknown"}

Discipline:
${discipline || "Unknown"}

Page number:
${pageNumber ?? "Unknown"}

PAGE RECONCILIATION RULES:
- Classify page_evidence.kind first. Only an ARCHITECTURAL FLOOR PLAN contributes rooms/doors/windows/floor/ceiling/wall summary fields. Structural plans, elevations, details, schedules and specifications return ZERO for these top-level quantities.
- Identify physical scope from printed labels: ground floor, first floor, basement etc. Use exactly the same scope_id across plans and schedules for that floor. Use project only for an EXPLICIT whole-project total. Unknown scope is null; do not call it a new floor just because it is a new page.
- Do not count one wall twice because it bounds two rooms. Floor area is only walkable floor on this level. Exclude stair voids; keep open terrace area separate from enclosed ceiling. Roof/slab diagrams are not extra floors.
- window_area and door_area are m2, never counts. Return 0 if dimensions are unavailable, explaining the missing measurement; never substitute a count into area.
- Extract schedules/specifications into page_evidence.quantities using the supported semantic key, exact unit and physical scope. A claim is the TOTAL for its key within its stated scope, not one of several unidentified partial rows. Sum rows within this page only when that scope is explicitly complete. If a schedule continues on another page and a complete scope total is unavailable, omit the claim and note it; do not label a partial schedule as a complete total.
- evidence must quote a short printed basis or a transparent formula using only printed dimensions/counts. Compute declared concrete/formwork dimensions and bar weight using the printed schedule and its declared formula; do not infer design, routes, steel ratios, material grades or missing specifications.
- Respect declared measurement conventions (wall centreline vs clear area, net vs gross, opening deductions, beam/slab overlaps). Do not mix them.
- Split internal/external masonry, floor finish types, and fixture/electrical quantities when supported by a complete schedule. door_count means all door sets; it is not exclusively timber doors. Keep unsupported special door categories for manual review.
- Repeated schedule totals/revision tables are evidence of the same scope, not additional quantities.
- Room/zone subsets are not additional floors: wet-room windows/doors are already included in the floor opening schedules. The same kitchen cabinet on a plan and in a specification is one physical cabinet. Preserve the host floor scope; do not sum a room subset with a floor total.
- detected_items on architectural plans must contain each tagged room/space once, using its printed tag at the start of name, its area in m2 and its finish label at the start of description (e.g. WOOD, TILE, EPOXY, OUTDOOR or VOID). Include hall, landing, terrace and void inventories; retain any inferred-area formula in description. Never include an aggregate row as another room.
- floor_area means all walkable floor including open terraces; ceiling_area excludes outdoor terraces. Stair VOID is excluded from both. Do not rename enclosed-only area as all walkable floor.

OPERATION COVERAGE CHECK (before returning JSON):
- For an architectural floor plan with usable printed dimensions, populate area_geometry with the dimensioned outer envelope and space polygons in one metre coordinate frame. Set coverage=complete only when EVERY enclosed space, outdoor terrace, void and applicable wall footprint is dimensioned. If some partitions lack dimensions, set coverage=partial and retain all independently dimensioned spaces, especially halls whose area is inferred; do NOT discard a measurable hall because another room cannot be drawn. Use the same printed room tag in spaces.tag and detected_items.name. Record printed room tags, finish labels and reported areas separately. Polygon vertices must come from printed grid spans, dimension chains or unambiguous dimensioned outlines, never adjusted to make area totals agree. Supply the printed dimensional basis in envelope_evidence and each space's evidence. Use null only when the envelope or every space lacks usable dimensions. Other page roles use null.
- For partial geometry, keep a complete, unique tagged detected_items inventory with clearly printed/reported room areas and finish labels for the spaces lacking polygons. Never invent polygons for those spaces. All inferred room areas need their own independently dimensioned polygon; an envelope-minus-labels remainder is insufficient by itself. Partial geometry and reported areas remain provisional; they do not establish a fully surveyed floor.
- A dimensioned hall band and an adjacent landing are distinct regions unless the drawing shows the landing INSIDE that band. Never subtract a tagged landing just because it is also on the circulation route. Check their physical boundaries first. Preserve L-shaped rooms as polygons. Never infer overlap from the room names.
- Do not copy reported_area into geometry: the application computes polygon areas, rejects overlaps/gaps/outside regions and reconciles the full floor. A room-area sum alone does not prove coverage. Match centreline vs clear measurement convention consistently. Void and terrace are separate physical polygons, not duplicated deductions.
- For a clear_internal measurement basis, retain internal wall footprints as separate kind=wall polygons (finish=unknown). These complete coverage but are excluded from usable floor/ceiling/finish areas. For wall_centerline_zones follow the declared centreline zone convention instead; do not subtract physical wall strips a second time.
- Do not leave a clearly printed operation quantity only in notes or detected_items. Put each complete, supported total in page_evidence.quantities. Top-level floor/room summaries cannot carry the separate operation quantities into BOQ.
- Structural pages: check excavation_volume, pcc_volume, foundation_volume, pedestal_volume, column_volume, beam_volume, ground_slab_volume, first_slab_volume, roof_slab_volume, rebar_kg and each foundation/column/beam/slab_formwork_area. Keep concrete quantities even if concrete grade is unspecified; grade is a separate pricing decision. Never substitute one component total into another.
- Finish/specification pages: check external_block_area, internal_block_area, wood_floor_area, ceramic_floor_area, epoxy_floor_area, terrace_floor_area, plaster_area, paint_area (walls only), ceiling_paint_area, gypsum_ceiling_area, wet_wall_tile_area and backsplash_area. Respect printed deductions. Report each quantity only when its complete dimensions/measurement basis are given on this page; do not assume dimensions from pages you cannot see.
- Waterproofing is a separate operation from the finished surface. Extract roof_waterproofing_area, terrace_waterproofing_area, wet_floor_waterproofing_area and wet_wall_waterproofing_area only if that operation and its extent are explicitly declared. Do not turn wet_floor_area or roof_area into membrane work automatically.
- Services schedules: preserve toilet_count, basin_count, shower_count, kitchen_sink_count, laundry_sink_count, socket_count, light_count, distribution_board_count, ac_count, smoke_detector_count, water_pipe_length, waste_pipe_length and ac_pipe_length. A light point is not a specific light fixture. An AC count does not specify its tonnage. A pipe length does not specify diameter.
- Other explicitly quantified work: kitchen_cabinet_length, terrace_railing_length, driveway_area and landscape_area. Do not assume grass or interlock merely from an area.
- Evidence must retain scope qualifiers and any printed material/measurement qualifiers. In notes, list relevant operations that cannot be quantified and the missing basis. Do not output fabricated zeros as proof that an operation does not exist.

Return only valid JSON matching the provided schema.
  `.trim();
}
