# Faint source lines v138

The raster path previously excluded neutral pixels lighter than a fixed gray threshold. It now retains locally darker strokes as well as dark ink, using the surrounding paper brightness. The same contrast evidence feeds source-line extraction, downstream geometry checks and door leaf/arc reading, preventing a recovered faint line from being rejected later by the old threshold.

Faintness alone is not grounds for discarding a visible candidate. Semantic classification still distinguishes architecture from dimensions, text and furniture; detected ink is not automatically a measured wall. Unreadable or unsupported geometry remains unresolved.

Focused tests cover JPEG gray walls at RGB 210 and 240 on white, gray walls on darker paper, smooth paper shading with low-amplitude noise, a faint door leaf/arc, and rejection of uniform fill as a door symbol. Together with graph, pipeline and door regression tests: 38 passed. On the supplied JPG, local extraction returns 227 source segments, 362 candidate lines and 118 opening hypotheses, within the existing processing budget. These counts do not establish end-to-end recognition.

Final offline suite: 1,544 passed, zero failures. Production build and zero-API local handler bundling check passed.

No paid API requests or deployment were made for this change. Lines whose contrast is below the usable image signal cannot be reliably recovered. IFC/DWG/DXF geometry readers are outside this raster-only change.
