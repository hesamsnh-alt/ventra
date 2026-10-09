VENTRA V36.1 - SCHEMATIC API STABILITY FIX

Changed file only:
src/app/api/ai/design-3d/route.js

Root cause:
The POST route returned handleSchematicRequest(body) without awaiting it.
If prepareVisionImage() or another early async operation rejected, that error
escaped the surrounding try/catch and Next.js generated a framework 500 response.

Fixes:
1. Uses:
   return await handleSchematicRequest(body)
2. Image optimization is now fault-tolerant.
3. If image download/Sharp optimization fails, Ventra falls back to the original image URL.
4. Unhandled API errors now always include a JSON diagnostic code and route version.
5. Adds image-preparation logs.

Expected route version:
generic-floorplan-engine-v36.1-api-stability

Expected logs:
[VENTRA JPG IMAGE PREP v36.1] { optimized: true }
or
[VENTRA JPG IMAGE PREP v36.1] { optimized: false, fallback: "original_image_url", ... }

Install:
Replace only:
src/app/api/ai/design-3d/route.js

Then:
Ctrl + C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev

No Viewer replacement is needed.
Re-run JPG Analyze.
