import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { box, cylinder, curve, material, buildFridge, buildSink, buildCooktop } from "../../lib/kitchenDemoParts.mjs";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { PENDANTS } from "./kitchenFinishes";
import { createFinishes } from "./kitchenTextures";
import { ISLAND_CABINETS, LOWER_CABINETS, UPPER_CABINETS } from "./kitchenStorage";
import { createPresentationPost } from "../../lib/presentationPost.mjs";

function buildVase(world, ceramic, soil) {
  const vase = new THREE.Group();
  vase.position.set(0.68, 1.038, -0.225);
  world.add(vase);
  const profile = [[0, 0], [0.044, 0], [0.055, 0.012], [0.067, 0.047], [0.066, 0.09],
    [0.057, 0.127], [0.041, 0.154], [0.026, 0.177], [0.023, 0.201], [0.025, 0.207],
    [0.020, 0.210], [0.017, 0.200], [0.018, 0.177], [0.032, 0.140]];
  const vaseMesh = new THREE.Mesh(new THREE.LatheGeometry(profile.map(point => new THREE.Vector2(...point)), 48), ceramic);
  vaseMesh.castShadow = vaseMesh.receiveShadow = true;
  vase.add(vaseMesh);
  cylinder(vase, 0.018, 0.019, 0.008, [0, 0.171, 0], soil);

  const twig = material(0x554a35, 0.81);
  const bark = material(0x827052, 0.77);
  const leaves = [0x535d3f, 0x687554, 0x7e8664, 0x3e523a].map(color =>
    material(color, 0.71, { side: THREE.DoubleSide, sheen: 0.22, sheenColor: 0x888362 }));
  const up = new THREE.Vector3(0, 1, 0);
  const branches = [
    { tip: [-0.145, 0.408, 0.040], curve: -0.066, count: 6 },
    { tip: [0.074, 0.467, -0.068], curve: 0.018, count: 7 },
    { tip: [0.152, 0.352, 0.061], curve: 0.079, count: 5 },
    { tip: [-0.042, 0.376, -0.120], curve: -0.040, count: 5 },
  ];

  function addLeaf(origin, tip, width, finish, twist) {
    const axis = tip.clone().sub(origin);
    const lateral = axis.clone().cross(up).normalize();
    lateral.applyAxisAngle(axis.clone().normalize(), twist).multiplyScalar(width);
    const fold = lateral.clone().cross(axis).normalize().multiplyScalar(width * 0.28);
    const positions = [];
    const indices = [];
    for (let i = 0; i <= 6; i++) {
      const along = i / 6;
      const center = origin.clone().addScaledVector(axis, along);
      const fullness = Math.max(0.002, Math.sin(Math.PI * along) ** 1.13);
      for (const edge of [-1, 0, 1]) {
        positions.push(...center.clone().addScaledVector(lateral, edge * fullness)
          .addScaledVector(fold, fullness * (edge === 0 ? 1 : 0.24)));
      }
      if (i === 6) continue;
      const row = i * 3;
      for (let j = 0; j < 2; j++) {
        const a = row + j;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const leaf = new THREE.Mesh(geometry, finish);
    leaf.castShadow = leaf.receiveShadow = true;
    vase.add(leaf);
    const raisedMid = origin.clone().lerp(tip, 0.5).addScaledVector(fold, 1.15);
    curve(vase, [origin.toArray(), raisedMid.toArray(), tip.toArray()], 0.00042, bark);
  }

  for (const [branchIndex, branch] of branches.entries()) {
    const points = [[0, 0.17, 0], [branch.curve * 0.5, 0.254, branch.tip[2] * 0.19],
      [branch.curve, 0.315, branch.tip[2] * 0.65], branch.tip];
    curve(vase, points, 0.00165, twig);
    const stem = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    for (let i = 0; i < branch.count; i++) {
      const origin = stem.getPoint(0.42 + i * 0.52 / branch.count);
      const angle = i * 2.35 + branchIndex * 1.7;
      const length = 0.067 - i * 0.003 + 0.008 * Math.sin(i + branchIndex);
      const direction = new THREE.Vector3(Math.cos(angle), -0.17 + i * 0.092, Math.sin(angle));
      const tip = origin.clone().addScaledVector(direction, length);
      addLeaf(origin, tip, length * 0.18, leaves[(i + branchIndex * 3) % leaves.length], angle * 0.65);
    }
  }
}

function buildStorage(world, { wood, bronze, ceramic, steel }) {
  const parts = new Map();
  const liner = material(0x797065, 0.69);
  const divider = material(0x564a3b, 0.74);
  const wall = 0.019;

  function register(id, group, transform, channel, closed, opened) {
    group.userData.pick = id;
    world.add(group);
    parts.set(id, { transform, channel, closed, opened, target: closed });
  }

  function casework({ x, y, front, width, height, depth, shelves = [] }) {
    const center = front - depth / 2;
    box(world, [width, height, wall], [x, y, front - depth + wall / 2], liner);
    for (const side of [-1, 1]) {
      box(world, [wall, height, depth], [x + side * (width - wall) / 2, y, center], liner);
      box(world, [width - 2 * wall, wall, depth], [x, y + side * (height - wall) / 2, center], liner);
    }
    for (const level of shelves) {
      box(world, [width - 2 * wall, wall, depth - 0.036], [x, y + level, center - 0.012], liner, 0.003);
    }
  }

  function door(id, { x, y, front, width, height, hinge, framed = false }) {
    const panel = new THREE.Group();
    const leafWidth = width - 0.018;
    const leafHeight = height - 0.018;
    const center = -hinge * leafWidth / 2;
    panel.position.set(x - center, y, front);
    box(panel, [leafWidth, leafHeight, 0.022], [center, 0, 0.012], wood, 0.003);
    if (framed) {
      const rail = Math.min(0.058, leafWidth / 5);
      for (const side of [-1, 1]) {
        box(panel, [rail, leafHeight, 0.014], [center + side * (leafWidth - rail) / 2, 0, 0.026], wood, 0.003);
        box(panel, [leafWidth - 2 * rail, rail, 0.014], [center, side * (leafHeight - rail) / 2, 0.026], wood, 0.003);
      }
    }
    const handleHeight = framed ? -leafHeight / 2 + 0.14 : leafHeight / 2 - 0.068;
    const handleX = -hinge * (leafWidth - 0.07);
    box(panel, [0.021, framed ? 0.15 : 0.092, 0.028], [handleX, handleHeight, 0.044], bronze, 0.006);
    for (const side of [-1, 1]) {
      box(panel, [0.039, 0.058, 0.012], [-hinge * 0.039, side * leafHeight * 0.32, -0.008], steel, 0.003);
    }
    register(id, panel, panel.rotation, "y", 0, hinge * 1.5);
  }

  function drawer(id, { x, y, front, width, height, depth, cutlery = false }) {
    const tray = new THREE.Group();
    tray.position.set(x, y, front);
    const inside = width - 0.065;
    box(tray, [width - 0.018, height - 0.012, 0.033], [0, 0, 0.018], wood, 0.006);
    box(tray, [Math.min(width * 0.55, 0.34), 0.021, 0.032], [0, 0.019, 0.049], bronze, 0.006);
    box(tray, [inside, 0.019, depth], [0, -height / 2 + 0.024, -depth / 2], liner);
    for (const side of [-1, 1]) {
      box(tray, [0.016, height * 0.48, depth], [side * (inside - 0.016) / 2, 0, -depth / 2], divider);
    }
    box(tray, [inside, height * 0.48, 0.017], [0, 0, -depth + 0.009], divider);
    if (cutlery) {
      for (const offset of [-0.30, -0.17, -0.04, 0.09, 0.22]) {
        box(tray, [0.012, 0.052, 0.29], [offset + 0.048, -0.032, -0.185], divider, 0.002);
        box(tray, [0.014, 0.012, 0.14], [offset, -0.056, -0.13], steel, 0.004);
        const spoon = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), steel);
        spoon.scale.set(0.023, 0.006, 0.038);
        spoon.position.set(offset, -0.048, -0.215);
        tray.add(spoon);
      }
    }
    register(id, tray, tray.position, "z", front, front + depth * 0.9);
  }

  LOWER_CABINETS.forEach((x, index) => {
    if (index === 4) {
      box(world, [0.78, 0.64, 0.62], [x, 0.54, -2.957], divider, 0.004);
      const opening = { x, y: 0.163, front: -2.626, width: 0.78, height: 0.156, depth: 0.63 };
      casework(opening);
      drawer("lower" + index, { ...opening, depth: 0.45 });
      return;
    }
    const opening = { x, y: 0.48, front: -2.646, width: 0.782, height: 0.785, depth: 0.66, shelves: [-0.02] };
    casework(opening);
    door("lower" + index, { ...opening, hinge: index % 2 ? 1 : -1 });
    for (const [offset, radius] of [[-0.14, 0.113], [0.14, 0.085]]) {
      cylinder(world, radius, radius * 0.78, 0.073, [x + offset, 0.508, -2.915], index % 2 ? ceramic : steel);
    }
  });

  UPPER_CABINETS.forEach((x, index) => {
    const opening = { x, y: 2.349, front: -2.864, width: 0.77, height: 1.30, depth: 0.425, shelves: [-0.22, 0.22] };
    casework(opening);
    door("upper" + index, { ...opening, hinge: index % 2 ? 1 : -1, framed: true });
    for (let plate = 0; plate < 3; plate++) {
      cylinder(world, 0.114, 0.090, 0.016, [x - 0.113, 2.151 + plate * 0.017, -3.067], ceramic);
    }
    for (const offset of [-0.105, 0.04, 0.173]) {
      cylinder(world, 0.043, 0.033, 0.096, [x + offset, 2.627, -3.075], ceramic);
    }
  });

  ISLAND_CABINETS.forEach(({ x, width }, index) => {
    const opening = { x, y: 0.365, front: 0.365, width, height: 0.55, depth: 0.825, shelves: [-0.015] };
    casework(opening);
    door("island" + index, { ...opening, hinge: index === 0 || index === 2 ? -1 : 1 });
    cylinder(world, Math.min(width * 0.30, 0.135), Math.min(width * 0.23, 0.105), 0.07,
      [x, 0.40, 0.03], index % 2 ? steel : ceramic);
  });
  const cutleryOpening = { x: 0.55, y: 0.759, front: 0.383, width: 0.90, height: 0.22, depth: 0.62 };
  casework(cutleryOpening);
  drawer("drawer", { ...cutleryOpening, depth: 0.467, cutlery: true });
  return parts;
}

function createRoom(world) {
  const finishes = createFinishes();
  const stone = material(0xffffff, 0.115, finishes.get("stone", "charcoal"));
  const floor = material(0xffffff, 0.59, finishes.get("floor", "tile"));
  const wood = material(0xffffff, 0.46, finishes.get("cabinet", "walnut"));
  const tileWall = material(0xcfc4b3, 0.37, finishes.get("stone", "quartz"));
  const plaster = material(0xb0a495);
  const taupe = material(0x79786c);
  const dark = material(0x292721, 0.44);
  const bronze = material(0xa06f43, 0.32, { metalness: 0.82 });
  const steel = material(0xd6d6cc, 0.30, {
    metalness: 0.86,
    anisotropy: 0.65,
    anisotropyRotation: Math.PI / 2,
    clearcoat: 0.16,
  });
  const ceramic = material(0xe2d8c6, 0.29, { clearcoat: 0.45 });
  const blackGlass = material(0x1c211c, 0.19, { metalness: 0.42 });
  const windowGlass = material(0x788b86, 0.14, { transparent: true, opacity: 0.095, depthWrite: false });
  const bulb = material(0xffe2a6, 0.37, { emissive: 0xffbc61, emissiveIntensity: 1 });
  const upholstery = material(0x76644d, 0.87, { sheen: 0.38 });
  const olive = material(0x867e46, 0.47);

  const roomFloor = box(world, [9, 0.12, 8], [0, -0.06, 0.55], floor);
  roomFloor.castShadow = false;
  box(world, [9, 3.3, 0.15], [0, 1.65, -3.39], plaster);
  box(world, [0.15, 0.84, 7.9], [-4.07, 0.42, 0.5], plaster);
  box(world, [0.15, 0.57, 7.9], [-4.07, 3.015, 0.5], plaster);
  box(world, [0.15, 2, 2.2], [-4.07, 1.8, -2.3], plaster);
  box(world, [0.15, 2, 2.65], [-4.07, 1.8, 3.13], plaster);
  const glass = box(world, [0.04, 1.88, 3.03], [-4.06, 1.78, 0.32], windowGlass);
  glass.castShadow = false;
  glass.receiveShadow = false;

  // A lit exterior backdrop keeps the window from reading as an opaque sheet.
  const outside = new THREE.MeshBasicMaterial({ color: 0xb8cbce });
  box(world, [0.04, 5.1, 7.1], [-6.35, 1.69, 0.6], outside).castShadow = false;
  const horizon = new THREE.MeshBasicMaterial({ color: 0x83958b });
  box(world, [0.035, 1.4, 7.1], [-6.27, 0.05, 0.6], horizon).castShadow = false;
  for (const [y, z, size, color] of [
    [0.95, -0.92, 0.68, 0x566b55], [0.66, 0.19, 0.91, 0x677a57],
    [0.83, 1.21, 0.60, 0x718060], [0.52, 2.36, 1.0, 0x5b715b],
  ]) {
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 4), new THREE.MeshBasicMaterial({ color }));
    leaves.scale.set(0.44, 1, 0.84);
    leaves.position.set(-5.96, y, z);
    world.add(leaves);
  }
  for (const z of [-1.2, -0.18, 0.83, 1.84]) {
    box(world, [0.12, 1.96, 0.05], [-3.98, 1.78, z], dark);
  }
  for (const y of [0.81, 1.71, 2.75]) box(world, [0.12, 0.045, 3.1], [-3.98, y, 0.32], dark);

  const storage = buildStorage(world, { wood, bronze, ceramic, steel });
  box(world, [5.66, 0.064, 0.74], [-0.42, 0.902, -2.97], tileWall, 0.012);
  box(world, [5.66, 0.73, 0.048], [-0.42, 1.304, -3.269], tileWall, 0.007);
  const cabinetStrip = box(world, [5.63, 0.018, 0.066], [-0.42, 1.684, -2.865], bulb);
  cabinetStrip.userData.pick = PENDANTS.length;
  box(world, [2.36, 0.77, 0.41], [-0.42, 2.61, -3.078], taupe, 0.01);
  box(world, [1.83, 0.045, 0.41], [-0.42, 2.025, -3.08], wood, 0.006);
  box(world, [1.83, 0.045, 0.41], [-0.42, 1.73, -3.08], wood, 0.006);
  for (const x of [-1.12, -0.98, -0.84]) {
    cylinder(world, 0.055, 0.041, 0.12, [x, 2.105, -3.015], ceramic);
  }
  for (const x of [-0.46, -0.18, 0.07]) {
    cylinder(world, 0.091, 0.055, 0.065, [x, 1.785, -3.034], ceramic);
  }
  const burners = buildCooktop(world, blackGlass);
  box(world, [0.71, 0.54, 0.045], [0.38, 0.514, -2.603], dark, 0.009);
  box(world, [0.62, 0.37, 0.016], [0.38, 0.491, -2.574], blackGlass, 0.012);
  box(world, [0.54, 0.025, 0.048], [0.38, 0.732, -2.554], steel, 0.009);

  const fridge = buildFridge(world, { wood, dark, steel, blackGlass });

  // Split the slab around the bowl to give the sink visible depth.
  for (const [width, depth, x, z] of [
    [0.71, 1.275, -0.955, 0.08], [1.43, 1.275, 0.715, 0.08],
    [0.60, 0.329, -0.30, -0.393], [0.60, 0.566, -0.30, 0.4345],
  ]) {
    const slab = box(world, [width, 0.11, depth], [x, 0.982, z], stone);
    const vertices = slab.geometry.getAttribute("position");
    const uv = slab.geometry.getAttribute("uv");
    for (let index = 0; index < vertices.count; index++) {
      if (Math.abs(slab.geometry.getAttribute("normal").getY(index)) < 0.99) continue;
      uv.setXY(index, (vertices.getX(index) + x + 1.31) / 2.74, (vertices.getZ(index) + z + 0.5575) / 1.275);
    }
  }
  for (const [x, edge, side] of [[-1.268, 0, -1], [1.388, 1, 1]]) {
    const end = box(world, [0.085, 0.945, 1.275], [x, 0.473, 0.08], stone, 0.004);
    const { position, normal, uv } = end.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      if (normal.getX(i) * side < 0.95) continue;
      const down = 1.037 - (position.getY(i) + end.position.y);
      uv.setXY(i, edge + down / 2.74 * side, (position.getZ(i) + 0.6375) / 1.275);
    }
  }
  box(world, [2.39, 0.085, 0.72], [0.06, 0.043, -0.078], dark);
  box(world, [2.52, 0.05, 0.025], [0.06, 0.882, 0.342], wood, 0.004);
  box(world, [2.52, 0.71, 0.025], [0.06, 0.45, -0.46], wood, 0.004);

  const sink = buildSink(world, steel, dark);

  buildVase(world, ceramic, dark);
  cylinder(world, 0.16, 0.095, 0.061, [1.02, 0.968, -2.79], ceramic);
  for (const [x, z] of [[0.94, -2.82], [1.04, -2.75], [1.10, -2.86]]) {
    cylinder(world, 0.038, 0.031, 0.047, [x, 1.012, z], olive);
  }

  for (const x of [-0.7, 0.64]) {
    const z = 1.44;
    const seat = box(world, [0.447, 0.086, 0.414], [x, 0.647, z], upholstery, 0.042);
    seat.rotation.y = x * 0.17;
    for (const dx of [-0.13, 0.13]) {
      for (const dz of [-0.13, 0.13]) {
        const leg = cylinder(world, 0.015, 0.014, 0.6, [x + dx * 1.14, 0.3, z + dz * 1.14], dark);
        leg.rotation.set(dz * 0.7, 0, -dx * 0.7);
      }
    }
    for (const dz of [-0.15, 0.15]) box(world, [0.32, 0.022, 0.022], [x, 0.26, z + dz], bronze, 0.007);
  }

  box(world, [8.15, 0.085, 6.75], [0, 3.33, -0.02], plaster);
  const pendants = PENDANTS.map((x, index) => {
    const fixture = new THREE.Group();
    fixture.position.set(x, 0, 0.17);
    fixture.userData.pick = index;
    world.add(fixture);
    cylinder(fixture, 0.008, 0.008, 1.03, [0, 2.78, 0], dark);
    cylinder(fixture, 0.057, 0.195, 0.227, [0, 2.152, 0], bronze);
    const diffuser = bulb.clone();
    diffuser.emissiveIntensity = 2;
    cylinder(fixture, 0.176, 0.176, 0.02, [0, 2.032, 0], diffuser);
    return diffuser;
  });

  // Cabinet panels use different portions of the veneer instead of repeating one print.
  world.updateMatrixWorld();
  const panelPosition = new THREE.Vector3();
  world.traverse(object => {
    if (object.material !== wood) return;
    object.getWorldPosition(panelPosition);
    const offset = THREE.MathUtils.euclideanModulo(
      panelPosition.x * 0.141 + panelPosition.z * 0.079 + panelPosition.y * 0.117, 0.34);
    const uv = object.geometry.getAttribute("uv");
    for (let vertex = 0; vertex < uv.count; vertex++) {
      uv.setXY(vertex, uv.getX(vertex) * 0.66 + offset, uv.getY(vertex));
    }
  });
  return { finishes, stone, floor, wood, bulb, storage, fridge, pendants, sink, burners };
}

function captureFinishReflections(generator) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x292823);
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(6.2, 6.8, 7.8), toneMapped: false });
  const softbox = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.07, 1.78), toneMapped: false });

  // A separated set of panes makes the reflection readable on polished stone.
  for (const z of [-0.6, 0.33, 1.26]) {
    for (const y of [1.29, 2.26]) {
      box(studio, [0.025, 0.90, 0.86], [-3.64, y, z], glass);
    }
  }
  // Broad highlights keep lacquer on vertical wood faces readable at eye level.
  box(studio, [1.65, 0.90, 0.02], [1.75, 2.53, 2.19], softbox);
  box(studio, [2.4, 0.02, 0.70], [-0.92, 2.94, -2.04], softbox);

  const reflection = generator.fromScene(studio, 0.018, 0.1, 18, {
    size: 256,
    position: new THREE.Vector3(0.05, 1.07, 0.05),
  });
  for (const mesh of studio.children) mesh.geometry.dispose();
  glass.dispose();
  softbox.dispose();
  return reflection;
}

const VIEWS = {
  room: { eye: [2.48, 1.66, 3.72], target: [0.18, 1.33, -1.0] },
  cabinets: { eye: [-0.42, 1.69, 1.82], target: [-0.42, 1.66, -2.74] },
  drawer: { eye: [1.70, 1.57, 2.66], target: [0.30, 0.82, 0.22] },
  sink: { eye: [0.79, 1.53, 1.03], target: [-0.23, 1.20, -0.14] },
  cooktop: { eye: [0.37, 1.98, -1.27], target: [0.35, 1.00, -2.90] },
  fridge: { eye: [2.08, 1.55, 0.33], target: [2.93, 1.36, -2.42] },
};

export function createKitchen(mount, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.4));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.00;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const world = new THREE.Scene();
  world.background = new THREE.Color(0xc5b9a6);
  const camera = new THREE.PerspectiveCamera(47, 1, 0.08, 35);
  renderer.domElement.setAttribute("aria-label", "نمای قابل چرخاندن آشپزخانه");
  mount.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 6.2;
  controls.minAzimuthAngle = -0.58;
  controls.maxAzimuthAngle = 0.91;
  controls.minPolarAngle = 0.96;
  controls.maxPolarAngle = 1.58;

  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  room.traverse(object => {
    if (object.material?.emissiveIntensity >= 17) object.material.emissiveIntensity *= 0.58;
  });
  const environment = generator.fromScene(room, 0.035);
  world.environment = environment.texture;
  world.environmentIntensity = 0.50;
  room.dispose();
  const finishReflections = captureFinishReflections(generator);
  generator.dispose();

  RectAreaLightUniformsLib.init();
  const { finishes, stone, floor, wood, bulb, storage, fridge, pendants, sink, burners } = createRoom(world);
  stone.envMap = wood.envMap = sink.chrome.envMap = finishReflections.texture;
  stone.envMapIntensity = 1.16;
  wood.envMapIntensity = 0.86;
  const windowLight = new THREE.RectAreaLight(0xe8efff, 2.25, 2.92, 1.82);
  windowLight.position.set(-3.94, 1.76, 0.32);
  windowLight.rotation.y = -Math.PI / 2;
  world.add(windowLight);
  const ambient = new THREE.HemisphereLight(0xf2f7ff, 0x8f7e68, 0.23);
  world.add(ambient);
  const daylight = new THREE.DirectionalLight(0xffefd9, 1.6);
  daylight.position.set(-5.2, 3.05, 1.85);
  daylight.target.position.set(0.55, 0.15, -0.75);
  world.add(daylight.target);
  daylight.castShadow = true;
  daylight.shadow.mapSize.set(2048, 2048);
  daylight.shadow.radius = 3;
  Object.assign(daylight.shadow.camera, { left: -5, right: 5, top: 4.5, bottom: -4.5, near: 0.1, far: 15 });
  daylight.shadow.bias = -0.00023;
  daylight.shadow.normalBias = 0.009;
  world.add(daylight);
  const spots = PENDANTS.map(x => {
    const spot = new THREE.SpotLight(0xffd7ad, 5.8, 5, 0.72, 0.77, 2);
    const panel = new THREE.RectAreaLight(0xffdfbd, 7.4, 0.26, 0.26);
    panel.position.set(x, 2.018, 0.17);
    panel.rotation.x = -Math.PI / 2;
    world.add(panel);
    spot.position.set(x, 2.01, 0.17);
    spot.target.position.set(x, 0, -0.02);
    world.add(spot, spot.target);
    return { spot, panel };
  });
  const fill = new THREE.RectAreaLight(0xffe4c9, 2.8, 5.25, 0.12);
  fill.position.set(-0.42, 1.642, -2.89);
  fill.rotation.x = -Math.PI / 2.65;
  world.add(fill);

  const post = createPresentationPost(renderer, world, camera);
  let frame = 0;
  const fridgeGoals = [0, 0];
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const position = new THREE.Vector2();
  const activePointers = new Set();
  let press = null;

  function pick(event) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return undefined;
    world.updateMatrixWorld();
    camera.updateMatrixWorld();
    position.set((event.clientX - bounds.left) * 2 / bounds.width - 1,
      1 - (event.clientY - bounds.top) * 2 / bounds.height);
    raycaster.setFromCamera(position, camera);
    let object = raycaster.intersectObjects(world.children, true).find(hit => hit.object.isMesh && hit.object.parent?.name !== "faucet-water" && hit.object.visible
      && hit.object.parent?.visible)?.object;
    while (object && object.userData.pick === undefined) object = object.parent;
    return object?.userData.pick;
  }

  function pointerDown(event) {
    activePointers.add(event.pointerId);
    press = activePointers.size === 1 && event.button === 0
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  }

  function pointerMove(event) {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7) press = null;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      canvas.style.cursor = pick(event) === undefined ? "grab" : "pointer";
    }
  }

  function pointerUp(event) {
    if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 7) {
      const action = pick(event);
      if (action !== undefined) onPick(action);
    }
    cancelPointer(event);
  }

  function cancelPointer(event) {
    activePointers.delete(event.pointerId);
    press = null;
  }
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("lostpointercapture", cancelPointer);

  function setView(name) {
    const { eye, target } = VIEWS[name];
    camera.position.set(...eye);
    controls.target.set(...target);
    controls.minAzimuthAngle = name === "fridge" ? -0.71 : -0.58;
    controls.minDistance = name === "sink" || name === "cooktop" ? 0.8 : 2;
    controls.update();
    requestRender();
  }

  function render(time) {
    frame = 0;
    for (const part of storage.values()) {
      const { transform, channel, target } = part;
      const gap = target - transform[channel];
      if (Math.abs(gap) > 0.0004) {
        transform[channel] += gap * 0.19;
        renderer.shadowMap.needsUpdate = true;
        requestRender();
      } else if (gap) {
        transform[channel] = part.target;
        renderer.shadowMap.needsUpdate = true;
      }
    }
    let widestDoorAngle = 0;
    fridge.doors.forEach((door, index) => {
      const angleGap = fridgeGoals[index] - door.rotation.y;
      if (Math.abs(angleGap) > 0.0006) {
        door.rotation.y += angleGap * 0.19;
        renderer.shadowMap.needsUpdate = true;
        requestRender();
      } else if (angleGap) {
        door.rotation.y = fridgeGoals[index];
        renderer.shadowMap.needsUpdate = true;
      }
      widestDoorAngle = Math.max(widestDoorAngle, Math.abs(door.rotation.y));
    });
    fridge.interiorLight.intensity = Math.min(widestDoorAngle * 4.2, 3.2);
    if (sink.animate(time)) requestRender();
    controls.update();
    if (post) post.render();
    else renderer.render(world, camera);
  }

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function resize() {
    const { width, height } = mount.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    post?.resize(width, height);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.lerp(47, 57, THREE.MathUtils.clamp((1.22 - camera.aspect) / 0.45, 0, 1));
    camera.updateProjectionMatrix();
    requestRender();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  controls.addEventListener("change", requestRender);
  renderer.shadowMap.needsUpdate = true;
  setView("room");
  resize();

  return {
    finish(group, name) {
      Object.assign({ stone, floor, cabinet: wood }[group], finishes.get(group, name));
      requestRender();
    },
    storage(id, open) {
      const part = storage.get(id);
      part.target = open ? part.opened : part.closed;
      requestRender();
    },
    burner(index, on) {
      burners[index].set(on);
      requestRender();
    },
    faucet(running) {
      sink.setRunning(running);
      requestRender();
    },
    fridgeLeft(open) {
      fridgeGoals[0] = open ? -1.61 : 0;
      requestRender();
    },
    fridgeRight(open) {
      fridgeGoals[1] = open ? 1.78 : 0;
      requestRender();
    },
    lights(states) {
      spots.forEach(({ spot, panel }, index) => {
        spot.intensity = states[index] ? 5.8 : 0;
        panel.intensity = states[index] ? 7.4 : 0;
        pendants[index].emissiveIntensity = states[index] ? 2.0 : 0;
      });
      fill.intensity = states[3] ? 2.8 : 0;
      bulb.emissiveIntensity = states[3] ? 1 : 0;
      requestRender();
    },
    view: setView,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", cancelPointer);
      canvas.removeEventListener("lostpointercapture", cancelPointer);
      const materials = new Set();
      world.traverse(object => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        for (const finish of Array.isArray(object.material) ? object.material : [object.material]) materials.add(finish);
      });
      materials.forEach(finish => finish.dispose());
      finishes.dispose();
      daylight.shadow.dispose();
      environment.dispose();
      finishReflections.dispose();
      post?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
