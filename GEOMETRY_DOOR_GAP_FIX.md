# Geometry room loop fix

The room detector now closes likely door openings and tiny drafting gaps before planar-face extraction.

- Only dangling endpoints are considered.
- Normal door-width gaps are bridged only when both wall segments are strongly collinear.
- Tiny drafting gaps may be bridged regardless of angle.
- Synthetic bridge count is included in geometry diagnostics.
- No BOQ, estimate, preview, or viewer layout logic was changed.
