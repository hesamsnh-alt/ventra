import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export function material(color, roughness = 0.62, properties = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, ...properties });
}

export function box(parent, size, position, finish, radius = 0) {
  const geometry = radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, finish);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function cylinder(parent, top, bottom, height, position, finish) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 32), finish);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function curve(parent, points, radius, finish) {
  const path = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 24, radius, 10), finish);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function buildFridge(world, { wood, dark, steel, blackGlass }, { includeHousing = true } = {}) {
  const faceSteel = material(0x9b9b96, 0.28, {
    metalness: 0.94, anisotropy: 0.77, anisotropyRotation: Math.PI / 2, envMapIntensity: 1.32,
  });
  const handleSteel = material(0xbcb8b0, 0.23, { metalness: 0.91, envMapIntensity: 1.15 });
  const liner = material(0xedece3, 0.34);
  const gasket = material(0x474742);
  const milk = material(0xf2ecda, 0.31);
  const cap = material(0x5a8c64, 0.43);
  const glass = material(0x99b5a0, 0.19, { transparent: true, opacity: 0.63 });
  const fruit = [0xc34d2c, 0xe59328, 0x748849].map(color => material(color, 0.43));
  const x = 2.92;
  if(includeHousing)box(world, [0.99, 0.72, 0.69], [x, 2.6, -2.99], wood, 0.014);
  for (const dx of [-0.411, 0.411]) {
    box(world, [0.053, 2.04, 0.72], [x + dx, 1.13, -2.84], steel, 0.01);
    box(world, [0.017, 1.49, 0.59], [x + dx * 0.935, 1.41, -2.84], liner);
  }
  box(world, [0.82, 2.04, 0.045], [x, 1.13, -3.196], liner);
  box(world, [0.82, 0.055, 0.73], [x, 2.155, -2.84], liner);
  box(world, [0.82, 0.055, 0.73], [x, 0.675, -2.84], liner);
  box(world, [0.83, 0.53, 0.68], [x, 0.37, -2.84], dark, 0.013);
  box(world, [0.847, 0.471, 0.066], [x, 0.405, -2.425], faceSteel, 0.017);
  curve(world, [[x - 0.34, 0.562, -2.385], [x - 0.305, 0.562, -2.325], [x, 0.562, -2.313],
    [x + 0.305, 0.562, -2.325], [x + 0.34, 0.562, -2.385]], 0.013, handleSteel);
  box(world, [0.77, 0.046, 0.033], [x, 0.128, -2.464], gasket, 0.005);
  for (const y of [0.91, 1.23, 1.56, 1.86]) {
    box(world, [0.75, 0.014, 0.595], [x, y, -2.85], glass);
    box(world, [0.752, 0.022, 0.024], [x, y, -2.55], liner, 0.004);
  }
  for (const [index, dx] of [-0.22, -0.08, 0.17].entries()) {
    const height = 0.12 + index * 0.026;
    box(world, [0.085, height, 0.073], [x + dx, 1.241 + height / 2, -2.75], milk, 0.009);
    cylinder(world, 0.025, 0.025, 0.027, [x + dx, 1.255 + height, -2.75], cap);
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), fruit[index]);
    apple.scale.y = 0.83;
    apple.position.set(x + dx, 0.964, -2.68);
    world.add(apple);
  }
  for (const [index, dx] of [-0.24, -0.12, 0.04, 0.17].entries()) {
    const y = 1.574 + 0.068 + index * 0.008;
    cylinder(world, 0.036, 0.033, 2 * (y - 1.574), [x + dx, y, -2.78], fruit[index % 3]);
    cylinder(world, 0.037, 0.037, 0.012, [x + dx, 2 * y - 1.57, -2.78], steel);
  }
  box(world, [0.31, 0.112, 0.22], [x - 0.12, 1.92, -2.88], milk, 0.016);
  box(world, [0.23, 0.07, 0.16], [x + 0.22, 1.905, -2.87], cap, 0.012);

  const doors = [-1, 1].map((side, index) => {
    const door = new THREE.Group();
    door.position.set(x + side * 0.429, 1.410, -2.468);
    door.userData.pick = index === 0 ? "fridgeLeft" : "fridgeRight";
    world.add(door);
    const center = -side * 0.2125;
    if (index === 0) {
      // Build the front around the opening so the water dispenser casts its own shadows.
      box(door, [0.425, 0.446, 0.057], [center, 0.52, 0.035], faceSteel, 0.008);
      box(door, [0.425, 0.557, 0.057], [center, -0.4525, 0.035], faceSteel, 0.008);
      for (const dx of [-0.1595, 0.1595]) {
        box(door, [0.106, 0.445, 0.057], [center + dx, 0.048, 0.035], faceSteel, 0.004);
      }
      box(door, [0.207, 0.433, 0.017], [center, 0.048, -0.001], gasket, 0.006);
      for (const dx of [-0.101, 0.101]) box(door, [0.010, 0.439, 0.058], [center + dx, 0.048, 0.032], steel, 0.004);
      box(door, [0.20, 0.061, 0.026], [center, 0.238, 0.052], blackGlass, 0.006);
      box(door, [0.186, 0.020, 0.054], [center, -0.16, 0.031], steel, 0.005);
      box(door, [0.086, 0.091, 0.018], [center, 0.013, 0.017], steel, 0.006);
      cylinder(door, 0.008, 0.009, 0.040, [center, 0.169, 0.038], steel);
    } else {
      box(door, [0.425, 1.456, 0.066], [center, 0, 0.035], faceSteel, 0.013);
      box(door, [0.073, 0.014, 0.006], [center + 0.144, 0.596, 0.069], handleSteel, 0.002);
    }
    box(door, [0.4, 1.417, 0.018], [center, 0, -0.027], gasket, 0.01);
    box(door, [0.376, 1.373, 0.022], [center, 0, -0.044], liner, 0.009);
    const handleX = -side * 0.377;
    curve(door, [[handleX, -0.43, 0.065], [handleX, -0.397, 0.111],
      [handleX, -0.344, 0.125], [handleX, 0.443, 0.125],
      [handleX, 0.500, 0.106], [handleX, 0.523, 0.065]], 0.013, handleSteel);
    for (const y of [-0.504, -0.14, 0.24]) {
      box(door, [0.34, 0.021, 0.112], [center, y, -0.11], liner, 0.005);
      box(door, [0.34, 0.063, 0.014], [center, y + 0.027, -0.163], glass, 0.003);
    }
    return door;
  });
  const interiorLight = new THREE.PointLight(0xe5f0ff, 0, 1.26);
  interiorLight.position.set(x, 2.06, -2.68);
  world.add(interiorLight);
  return { doors, interiorLight };
}

export function buildSink(world, steel, dark) {
  const basin = material(0x25292a, 0.29, { metalness: 0.68, anisotropy: 0.34 });
  const chrome = material(0xe1e4e8, 0.095, { metalness: 1, envMapIntensity: 1.52, clearcoat: 0.18 });
  const gasket = material(0x181b1c, 0.59);
  const x = -0.30;
  const z = -0.0385;
  const top = 1.037;
  const bottom = 0.831;
  const width = 0.598;
  const depth = 0.379;

  function roundedCorners(w, d, radius, y) {
    const points = [];
    for (const [index, corner] of [[1, 1], [-1, 1], [-1, -1], [1, -1]].entries()) {
      for (let step = 0; step <= 8; step++) {
        const angle = (index + step / 8) * Math.PI / 2;
        points.push(new THREE.Vector3(
          x + corner[0] * (w / 2 - radius) + Math.cos(angle) * radius,
          y,
          z + corner[1] * (d / 2 - radius) + Math.sin(angle) * radius,
        ));
      }
    }
    return points;
  }
  const sections = [
    roundedCorners(width + 0.014, depth + 0.014, 0.018, top + 0.004),
    roundedCorners(width - 0.016, depth - 0.016, 0.022, top - 0.004),
    roundedCorners(width - 0.023, depth - 0.023, 0.030, top - 0.033),
    roundedCorners(width - 0.067, depth - 0.068, 0.050, bottom + 0.017),
    roundedCorners(width - 0.095, depth - 0.098, 0.045, bottom),
  ];
  const shell = new THREE.BufferGeometry();
  const positions = sections.flatMap(section => section.flatMap(point => point.toArray()));
  const count = sections[0].length;
  const indices = [];
  for (let band = 0; band < sections.length - 1; band++) {
    for (let index = 0; index < count; index++) {
      const a = band * count + index;
      const b = band * count + (index + 1) % count;
      indices.push(a, a + count, b, b, a + count, b + count);
    }
  }
  const bowlCenter = positions.length / 3;
  positions.push(x, bottom, z);
  for (let edge = 0; edge < count; edge++) {
    indices.push(bowlCenter, (sections.length - 1) * count + (edge + 1) % count,
      (sections.length - 1) * count + edge);
  }
  shell.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  shell.setIndex(indices);
  shell.computeVertexNormals();
  shell.addGroup(0, count * 6, 0);
  shell.addGroup(count * 6, indices.length - count * 6, 1);
  const bowl = new THREE.Mesh(shell, [steel, basin]);
  bowl.receiveShadow = true;
  world.add(bowl);

  const outletZ = 0.007;
  const outletY = 1.263;
  cylinder(world, 0.035, 0.035, 0.007, [x, bottom + 0.004, outletZ], chrome);
  cylinder(world, 0.027, 0.027, 0.008, [x, bottom + 0.008, outletZ], gasket);
  for (let hole = 0; hole < 7; hole++) {
    const angle = hole * Math.PI * 2 / 7;
    cylinder(world, 0.0027, 0.0027, 0.0015,
      [x + Math.cos(angle) * 0.015, bottom + 0.013, outletZ + Math.sin(angle) * 0.015], steel);
  }

  const overflowZ = z - depth / 2 + 0.030;
  box(world, [0.070, 0.023, 0.006], [x + 0.092, top - 0.059, overflowZ], steel, 0.004);
  box(world, [0.058, 0.012, 0.004], [x + 0.092, top - 0.059, overflowZ + 0.004], gasket, 0.003);
  const rackX = x - 0.186;
  for (const edge of [-1, 1]) {
    box(world, [0.014, 0.013, 0.338], [rackX + edge * 0.091, top - 0.004, z], gasket, 0.004);
  }
  for (let bar = 0; bar < 13; bar++) {
    box(world, [0.168, 0.006, 0.006], [rackX, top - 0.004, z + (bar - 6) * 0.025], steel, 0.002);
  }

  const faucet = new THREE.Group();
  faucet.userData.pick = "faucet";
  world.add(faucet);
  const stemZ = -0.277;
  cylinder(faucet, 0.044, 0.044, 0.003, [x, top + 0.002, stemZ], gasket);
  cylinder(faucet, 0.037, 0.042, 0.016, [x, top + 0.013, stemZ], chrome);
  cylinder(faucet, 0.026, 0.029, 0.129, [x, top + 0.077, stemZ], chrome);

  const neck = new THREE.CatmullRomCurve3([
    [x, 1.146, stemZ], [x, 1.336, stemZ], [x, 1.456, -0.238],
    [x, 1.500, -0.141], [x, 1.462, -0.044], [x, 1.370, outletZ], [x, 1.344, outletZ],
  ].map(point => new THREE.Vector3(...point)));
  const spout = new THREE.Mesh(new THREE.TubeGeometry(neck, 72, 0.018, 24, false), chrome);
  spout.castShadow = true;
  faucet.add(spout);

  const led = material(0x315ca2, 0.2, { emissive: 0x3978ff, emissiveIntensity: 0.06 });
  const lightStrip = new THREE.CatmullRomCurve3(neck.getPoints(48).slice(12, 45).map(point => {
    point.x += 0.016;
    return point;
  }));
  faucet.add(new THREE.Mesh(new THREE.TubeGeometry(lightStrip, 36, 0.0017, 8, false), led));

  const nozzleHeight = 0.083;
  cylinder(faucet, 0.022, 0.020, nozzleHeight, [x, outletY + nozzleHeight / 2, outletZ], chrome);
  cylinder(faucet, 0.021, 0.021, 0.005, [x, outletY + nozzleHeight, outletZ], gasket);
  cylinder(faucet, 0.0193, 0.0199, 0.009, [x, outletY + 0.007, outletZ], steel);
  cylinder(faucet, 0.0155, 0.0155, 0.003, [x, outletY, outletZ], gasket);
  box(faucet, [0.009, 0.019, 0.014], [x + 0.020, outletY + 0.056, outletZ], gasket, 0.004);
  box(faucet, [0.009, 0.010, 0.013], [x + 0.020, outletY + 0.033, outletZ], gasket, 0.003);

  const lever = new THREE.Group();
  lever.position.set(x + 0.042, 1.137, stemZ);
  faucet.add(lever);
  const axle = cylinder(lever, 0.018, 0.018, 0.052, [0, 0, 0], chrome);
  axle.rotation.z = Math.PI / 2;
  const leverStem = cylinder(lever, 0.0057, 0.0068, 0.082, [0.023, 0.038, 0], chrome);
  leverStem.rotation.z = -0.12;
  cylinder(lever, 0.0062, 0.0062, 0.005, [0.028, 0.079, 0], steel);

  const water = new THREE.Group();
  water.name = "faucet-water";
  water.position.set(x, bottom + 0.01, outletZ);
  water.visible = false;
  world.add(water);
  const length = outletY - bottom - 0.01;
  const waterFinish = material(0xd9edee, 0.17, {
    transparent: true, opacity: 0.64, depthWrite: false, clearcoat: 0.8,
    metalness: 0.10, emissive: 0x718889, emissiveIntensity: 0.18,
  });
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.0075, length, 24, 12, true), waterFinish);
  jet.position.y = length / 2;
  water.add(jet);
  const jetVertices = jet.geometry.getAttribute("position");
  const rest = Float32Array.from(jetVertices.array);
  const splashes = [];
  const splashGeometry = new THREE.SphereGeometry(0.0034, 8, 6);
  for (let i = 0; i < 12; i++) {
    const bead = new THREE.Mesh(splashGeometry, waterFinish);
    water.add(bead);
    splashes.push(bead);
  }
  const ringGeometry = new THREE.RingGeometry(0.036, 0.038, 30);
  const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
    color: 0xc3d3d1, transparent: true, opacity: 0.25, depthWrite: false,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  water.add(ring);

  return {
    chrome,
    setRunning(running) {
      water.visible = running;
      lever.rotation.x = running ? -0.43 : 0;
      led.emissiveIntensity = running ? 1.65 : 0.06;
    },
    animate(time) {
      if (!water.visible) return false;
      const seconds = time / 1000;
      for (let i = 0; i < jetVertices.count; i++) {
        const u = rest[i * 3 + 1] / length + 0.5;
        const ripple = 1 + 0.14 * (1 - u) * Math.sin(u * 36 + seconds * 36 + Math.atan2(rest[i * 3 + 2], rest[i * 3]) * 3);
        jetVertices.setX(i, rest[i * 3] * ripple);
        jetVertices.setZ(i, rest[i * 3 + 2] * ripple);
      }
      jetVertices.needsUpdate = true;
      for (const [i, bead] of splashes.entries()) {
        const phase = (seconds * (3.1 + i % 3 * 0.38) + i * 0.219) % 1;
        const angle = i * 2.39996;
        bead.position.set(Math.cos(angle) * phase * 0.059, 0.11 * phase * (1 - phase),
          Math.sin(angle) * phase * 0.059);
        bead.scale.setScalar(1 - phase * 0.64);
      }
      const cycle = (seconds * 2.5) % 1;
      ring.scale.setScalar(0.32 + cycle * 1.43);
      ring.material.opacity = (1 - cycle) * 0.34;
      return true;
    },
  };
}

export function buildCooktop(world, blackGlass) {
  const top = box(world, [0.81, 0.016, 0.52], [0.35, 0.942, -2.95], blackGlass, 0.006);
  top.material.envMapIntensity = 1.22;
  const markings = material(0x817c71, 0.55);
  const zones = [[0.15, -3.070, 0.092], [0.51, -3.062, 0.103],
    [0.19, -2.829, 0.078], [0.55, -2.841, 0.075]];

  return zones.map(([x, z, radius], index) => {
    const zone = new THREE.Group();
    zone.position.set(x, 0.951, z);
    zone.userData.pick = "burner" + index;
    world.add(zone);

    const zoneGlass = blackGlass.clone();
    const surface = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), zoneGlass);
    surface.rotation.x = -Math.PI / 2;
    zone.add(surface);

    const outline = new THREE.Mesh(new THREE.RingGeometry(radius - 0.0014, radius, 48), markings);
    outline.rotation.x = -Math.PI / 2;
    outline.position.y = 0.00025;
    zone.add(outline);

    const coil = new THREE.Group();
    coil.visible = false;
    zone.add(coil);
    const heatingElement = new THREE.MeshStandardMaterial({
      color: 0x4c1510, emissive: 0xff3b0e, emissiveIntensity: 1.8, roughness: 0.41,
    });
    for (const fraction of [0.36, 0.51, 0.66, 0.81]) {
      const turn = new THREE.Mesh(new THREE.RingGeometry(radius * fraction - 0.0024, radius * fraction, 48), heatingElement);
      turn.rotation.x = -Math.PI / 2;
      turn.position.y = 0.00055;
      coil.add(turn);
    }
    const indicator = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 16), heatingElement);
    indicator.rotation.x = -Math.PI / 2;
    indicator.position.set(0, 0.0007, radius + 0.007);
    coil.add(indicator);
    const reflectionLight = new THREE.PointLight(0xff4018, 0, 0.46);
    reflectionLight.position.y = 0.033;
    zone.add(reflectionLight);

    return {
      set(on) {
        coil.visible = on;
        zoneGlass.emissive.setHex(on ? 0x661407 : 0);
        zoneGlass.emissiveIntensity = on ? 0.79 : 0;
        reflectionLight.intensity = on ? 0.067 : 0;
      },
    };
  });
}

