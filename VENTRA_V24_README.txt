VENTRA ARCHITECTURE V24

Core fix:
- relationship rules can no longer create a giant unsupported wall
- room boundaries never expand partial evidence into a full long wall
- long corridor/open passages remain open unless raw partition evidence exists
- small bathroom/storage closures remain allowed
- access-door synthesis only happens when an explicit door relationship exists
- slight furniture contrast improvement

Validation: route syntax PASS, viewer JSX parse PASS.

Install, delete .next, restart, analyze again.
Expected build: interactive-plan-scene-architecture-v24-20260921
