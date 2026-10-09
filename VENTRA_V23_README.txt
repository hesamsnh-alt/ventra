VENTRA ARCHITECTURE V23

Fix target:
- stop corridor walls from being fully sealed when the model only implies a partial divider
- synthesize partial walls from supported raw partition cues instead of closing the full room edge
- still allow full closure for small wet/service rooms

Replace:
- src/app/api/ai/design-3d-preview/route.js
- src/app/projects/[id]/Project3DViewer.jsx

Steps:
1. Stop dev server
2. Delete .next
3. Extract/replace files
4. npm run dev
5. Analyze again
6. Confirm build version interactive-plan-scene-architecture-v23-20260921
