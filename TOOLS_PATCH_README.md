# Engineering Tools Patch - 2026-10-06

Full source snapshot based on the supplied archive, with engineering tool links and calculations added. This is NOT a commercially certified release. See `Ventra-Commercial-Audit-20261006.md` for launch blockers.

Keep your existing `.env.local` privately; it is deliberately excluded. Do not overwrite production blindly. Extract to a new folder, restore private environment settings, run `npm ci`, `npm run build`, then `npm run dev`. The supplied package manifest requests Next 16.3.8; local audit build used the available Next 16.2.10 runtime, so a clean local build is required.

Visit the homepage Engineering Toolbox, or `/tools/concrete`, `/tools/steel`, `/tools/area`, `/tools/volume`, `/tools/units`, `/tools/mep`. BOQ/quotation/schedule/estimate cards select an existing project and open its corresponding tab. Cost Database opens the published catalog.

No wall/room/opening/3D geometry code was changed. No security or billing fixes are included. Full pre-existing lint/test failures remain documented rather than silently suppressed.
