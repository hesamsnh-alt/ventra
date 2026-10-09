# Ventra JPG Texture Compatibility V12.1

Fixes the repeated Autodesk/legacy THREE warning:

`Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.`

Changes:
- Explicit `LinearFilter`
- Disables mipmaps for generated canvas textures
- Uses RepeatWrapping only for power-of-two textures
- Falls back to ClampToEdgeWrapping for NPOT textures
- Applies the same safe filtering to room label textures
- Adds `[VENTRA JPG FLOOR TEXTURE v12.1]` diagnostic log

Only relevant code changed:
`src/app/projects/[id]/Project3DViewer.jsx`

DWG / APS calibration / BOQ / Estimate / Quotation are untouched.
