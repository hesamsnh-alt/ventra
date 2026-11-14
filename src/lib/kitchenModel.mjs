const interactions = new WeakMap();

function movingParts(meshes, build, apply) {
  const start = meshes.length;
  build();
  const parts = meshes.slice(start);
  const poses = parts.map(mesh => ({
    mesh, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, rotation: mesh.rotation.z,
  }));
  let opened = false;
  const toggle = () => {
    opened = !opened;
    for (const pose of poses) apply(pose, opened);
  };
  for (const mesh of parts) interactions.set(mesh, toggle);
}

export function toggleKitchenPart(mesh) {
  const toggle = interactions.get(mesh);
  if (!toggle) return false;
  toggle();
  return true;
}

export function bindKitchenSwitch(control, effect, ...additionalControls) {
  const toggle = () => { effect.visible = !effect.visible; };
  for (const mesh of [control, effect, ...additionalControls]) interactions.set(mesh, toggle);
}

export function buildKitchenStorage({ type, variant, w, d, h, rot, cx, cy, meshes, addBox, wood, liner, stone, metal }) {
  const wall = Math.min(0.019, w * 0.06, d * 0.08, h * 0.08);
  const counter = type !== "cabinet";
  const top = counter ? Math.min(0.045, h * 0.08) : 0;
  const body = h - top;
  const s = Math.sin(rot);
  const c = Math.cos(rot);

  function run(width, depth, x, y, frontDirection) {
    const columns = Math.min(10, Math.max(1, Math.ceil(width / 0.62)));
    const front = y + frontDirection * (depth / 2 - wall / 2);
    addBox(width, wall, body, x, y - frontDirection * (depth - wall) / 2, body / 2, liner);
    for (const level of [wall / 2, body / 2, body - wall / 2]) {
      addBox(width, depth - wall, wall, x, y, level, liner);
    }
    const columnWidth = width / columns;
    for (let index = 0; index <= columns; index++) {
      const divider = Math.min(width / 2 - wall / 2, -width / 2 + index * columnWidth + wall / 2);
      addBox(wall, depth, body, x + divider, y, body / 2, liner);
    }
    for (let index = 0; index < columns; index++) {
      const center = x - width / 2 + (index + 0.5) * columnWidth;
      const leaf = columnWidth - wall * 0.65;
      const drawerHeight = counter && index === columns - 1 ? body * 0.22 : 0;
      const doorHeight = body - drawerHeight - wall * 0.62;
      const hinge = index % 2 ? 1 : -1;
      const edge = center + hinge * (leaf - wall) / 2;
      movingParts(meshes, () => {
        addBox(leaf, wall, doorHeight, center, front, doorHeight / 2 + wall * 0.24, wood);
        addBox(leaf * 0.73, wall * 0.33, doorHeight * 0.78, center,
          front + frontDirection * wall * 0.49, doorHeight / 2 + wall * 0.24, wood);
        addBox(wall, wall * 1.7, Math.min(0.12, doorHeight * 0.26), center - hinge * leaf * 0.32,
          front + frontDirection * wall * 1.14, doorHeight * 0.76, metal);
      }, (pose, opened) => {
        const angle = opened ? -frontDirection * hinge * 1.45 : 0;
        const px = cx + edge * c - front * s;
        const py = cy + edge * s + front * c;
        const dx = pose.x - px;
        const dy = pose.y - py;
        pose.mesh.position.set(px + dx * Math.cos(angle) - dy * Math.sin(angle),
          py + dx * Math.sin(angle) + dy * Math.cos(angle), pose.z);
        pose.mesh.rotation.z = pose.rotation + angle;
      });
      if (!drawerHeight) continue;
      const slideDepth = depth * 0.68;
      const drawerY = front - frontDirection * slideDepth / 2;
      const drawerZ = body - drawerHeight / 2;
      movingParts(meshes, () => {
        addBox(leaf, wall, drawerHeight - wall * 0.63, center, front, drawerZ, wood);
        addBox(leaf * 0.55, wall * 1.45, wall, center, front + frontDirection * wall * 1.1, drawerZ, metal);
        addBox(leaf - wall, slideDepth, wall * 0.52, center, drawerY, drawerZ - drawerHeight * 0.35, liner);
        for (const side of [-1, 1]) {
          addBox(wall * 0.53, slideDepth, drawerHeight * 0.53, center + side * (leaf - wall * 2.2) / 2, drawerY, drawerZ, liner);
        }
        addBox(leaf - wall, wall * 0.55, drawerHeight * 0.53, center, front - frontDirection * slideDepth, drawerZ, liner);
      }, (pose, opened) => {
        const slide = opened ? frontDirection * slideDepth * 0.87 : 0;
        pose.mesh.position.set(pose.x - s * slide, pose.y + c * slide, pose.z);
      });
    }
    if (counter) addBox(width, depth, top, x, y, h - top / 2, stone);
  }

  if (type === "kitchen_counter" && variant === "l-shape") {
    const corner = Math.min(0.60, d * 0.4, w * 0.4);
    run(w, corner, 0, d / 2 - corner / 2, -1);
    // Build the return as side-opening modules rotated into the other leg.
    const along = (-corner) / 2;
    const across = -w / 2 + corner / 2;
    const localAdd = (width, depth, height, x, y, level, finish) => {
      const mesh = addBox(width, depth, height, across - y, along + x, level, finish);
      mesh.rotation.z += Math.PI / 2;
      return mesh;
    };
    buildKitchenStorage({
      type: "kitchen_counter", w: d - corner, d: corner, h, rot: rot + Math.PI / 2,
      cx: cx + across * c - along * s, cy: cy + across * s + along * c, meshes, addBox: localAdd,
      wood, liner, stone, metal,
    });
    return;
  }
  run(w, d, 0, 0, -1);
}

export function buildKitchenFridge({ w, d, h, rot, cx, cy, meshes, addBox, steel, liner, dark }) {
  const leaf = w / 2;
  const top = h * 0.69;
  const lower = h - top;
  const front = -d / 2;
  const wall = Math.min(w, d, h) * 0.032;
  addBox(w, wall, h, 0, d / 2 - wall / 2, h / 2, liner);
  for (const side of [-1, 1]) addBox(wall, d, h, side * (w - wall) / 2, 0, h / 2, steel);
  addBox(w, d, lower, 0, 0, lower / 2, steel);
  addBox(w * 0.76, wall * 1.7, wall, 0, front - wall * 0.45, lower * 0.77, steel);
  for (const level of [0, 0.28, 0.53, 0.77, 0.98]) {
    addBox(w - wall * 2, d - wall * 2, wall * 0.67, 0, wall * 0.6, lower + top * level, liner);
  }
  for (const side of [-1, 1]) {
    const edge = side * leaf;
    const center = edge / 2;
    movingParts(meshes, () => {
      addBox(leaf - wall * 0.5, wall * 1.55, top - wall * 0.65, center, front + wall * 0.25, lower + top / 2, steel);
      addBox(leaf - wall * 1.65, wall * 0.66, top * 0.94, center, front + wall * 1.24, lower + top / 2, liner);
      addBox(wall * 0.83, wall * 1.72, top * 0.59, side * leaf * 0.15, front - wall * 1.1, lower + top * 0.60, steel);
      if (side === -1) addBox(leaf * 0.53, wall * 0.12, top * 0.25, center, front - wall * 0.57, lower + top * 0.39, dark);
    }, (pose, opened) => {
      const angle = opened ? side * 1.48 : 0;
      const px = cx + edge * Math.cos(rot) - front * Math.sin(rot);
      const py = cy + edge * Math.sin(rot) + front * Math.cos(rot);
      const dx = pose.x - px;
      const dy = pose.y - py;
      pose.mesh.position.set(px + dx * Math.cos(angle) - dy * Math.sin(angle),
        py + dx * Math.sin(angle) + dy * Math.cos(angle), pose.z);
      pose.mesh.rotation.z = pose.rotation + angle;
    });
  }
}

export function buildKitchenFaucet({ THREE, meshes, addBox, project, rim, basinFloor, depth, chrome, dark }) {
  const stem = depth * 0.32;
  const radius = Math.min(0.014, depth * 0.039);
  const rise = Math.min(0.39, depth * 0.88);
  const nozzle = rim + rise * 0.55;
  const section = (size, center, material) => addBox(...size, ...center, material);
  const base = section([radius * 4.5, radius * 4.5, .015], [0, stem, rim + .0075], chrome);
  const Curve = THREE.CatmullRomCurve3 || THREE.SplineCurve3;
  const profile = [[stem, .015], [stem, rise * .55], [stem * .84, rise * .88],
    [stem * .49, rise], [stem * .14, rise * .88], [0, rise * .67]];
  const points = profile.map(([y, z]) => project(0, y, rim + z));
  const origin = points[0].clone();
  for (const point of points) point.sub(origin);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(new Curve(points), 32, radius, 12, false), chrome);
  neck.position.copy(origin);
  neck.castShadow = neck.receiveShadow = true;
  meshes.push(neck);
  const tip = section([radius * 2.55, radius * 2.55, rise * .17], [0, 0, nozzle + rise * .068], chrome);
  const button = section([radius * .48, radius * 1.12, .018], [radius * 1.25, 0, nozzle + .036], dark);
  const lever = section([radius * .56, radius * .64, rise * .23], [radius * 2.6, stem, rim + rise * .20], chrome);
  const drain = section([radius * 3.7, radius * 3.7, .008], [0, 0, basinFloor + .012], chrome);
  drain.castShadow = false;
  const water = section([radius * .95, radius * .95, nozzle - basinFloor - .015], [0, 0,
    (nozzle + basinFloor + .015) / 2], new THREE.MeshBasicMaterial({
    color:0xcce5e6,transparent:true,opacity:.68,depthWrite:false,
  }));
  water.visible = false;
  water.castShadow = false;
  bindKitchenSwitch(base, water, neck, tip, button, lever);
}

export function bindKitchenInputs(canvas, { pick, canInteract, render }) {
  const pointers = new Set();
  let tap = null;
  function down(event) {
    pointers.add(event.pointerId);
    tap = pointers.size === 1 && event.button === 0 && canInteract()
      ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }
  function move(event) {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 7) tap = null;
  }
  function cancel(event) {
    pointers.delete(event.pointerId);
    tap = null;
  }
  function up(event) {
    move(event);
    if (tap?.id === event.pointerId && canInteract() && toggleKitchenPart(pick(event))) render();
    cancel(event);
  }
  const callbacks = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel };
  for (const [name, fn] of Object.entries(callbacks)) canvas.addEventListener(name, fn);
  return () => {
    for (const [name, fn] of Object.entries(callbacks)) canvas.removeEventListener(name, fn);
    pointers.clear();
    tap = null;
  };
}
