# Quest walkthrough

Open the existing interior 3D model in Meta Quest Browser over HTTPS. Expand
**VR settings & navigation boundary**, choose Quest 2 (0.8 framebuffer scale)
or Quest 3 (1.0), and then press **Enter VR headset**. WebXR permission is
requested only from that explicit click. No AI/provider requests are made.

- Left stick: head-relative horizontal movement (0.2–1.5 m/s).
- Right stick: one 15/30/45/90-degree snap per deflection. Release to turn again.
- Right A: return the tracked head to the initial clear spawn.
- Headset system menu or page Exit VR: end the session.
- Floor calibration supplies real tracked eye height; the model stays in metres.

Draw 3–32 ordered corners on the top-down plan, then Apply boundary. Crossing,
outside-floor, tiny or blocked regions are rejected. Whole floor resets the
custom region. The visible border becomes red near its edges. Existing floor,
void, wall, opening and furniture collision rules govern joystick movement.
Settings are browser-local per project/drawing/storey. No model, BOQ or quantity
is rewritten. VR uses a separate camera and native stereo render loop, bypasses
screen-space postprocessing and freezes static shadows until resources change.
Desktop camera and lighting return after session end, including denial/failure.

The virtual boundary does **not** restrain physical movement or replace the
headset's real safety boundary. Room-scale tracking is retained; configure the
physical boundary on the headset. Stairs and hand-only locomotion are not provided.

## Verification

Offline tests cover device detection, controller axes, session failure/cancel/end,
Quest quality profiles, metre-axis conversion, virtual boundary movement,
snap pivot, stationary mode, headset A recovery, resource cleanup and the actual
boundary/settings UI. The complete offline regression suite and production build
must pass. No physical Quest 2/3 was attached to this workspace; hardware stereo,
tracking comfort and frame-rate checks remain to be performed on each headset.
