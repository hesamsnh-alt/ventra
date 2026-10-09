# V6 Validation

## Static validation

PASS: `node --check src/app/api/ai/design-3d-preview/route.js`

## Scope validation

`diff -qr V5 V6` reports only:

- `src/app/api/ai/design-3d-preview/route.js`
- V6 documentation files

## Sensitive file hashes

`Project3DViewer.jsx`

`6b59f223743c1682591df1db047171e6fc4976b610c30c3d087671d33e1f09c2`

This matches V5 and the original 2026-09-19 project ZIP.

`next.config.mjs`

`35058ea8efadfd09740b396507e759ef3471f0c1490023798f0ead5a6a96de7d`

This matches V5 and the original 2026-09-19 project ZIP.

## Runtime acceptance criteria

For the two-bedroom test plan, the diagnostic should show:

- `accepted: true`
- `roomCount: 7`
- `dimensionLock.applied: true` when the printed dimensions form a stable shared grid
- `footprintRepair.repaired: true` when the room-supported outline is safer than the raw model outline

If dimension constraints conflict, the solver intentionally falls back instead of forcing broken geometry.
