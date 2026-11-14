import * as THREE from "three";
import { CABINET_FINISHES, FLOOR_FINISHES, STONE_FINISHES } from "./kitchenFinishes";

function grain(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
}

function noise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const top = THREE.MathUtils.lerp(grain(ix, iy), grain(ix + 1, iy), u);
  const bottom = THREE.MathUtils.lerp(grain(ix, iy + 1), grain(ix + 1, iy + 1), u);
  return THREE.MathUtils.lerp(top, bottom, v);
}

function surface(x, y, pattern, dark) {
  const fine = grain(Math.floor(x * 3.17), Math.floor(y * 3.17));
  const clouds = Math.sin(x / 73 + Math.sin(y / 67)) * Math.cos(y / 87 - Math.sin(x / 52));
  switch (pattern) {
    case "marble": {
      const warp = 110 * noise(x / 187, y / 167) + 49 * noise(x / 65, y / 56) + 17 * noise(x / 27, y / 30);
      const field = x * 0.64 + y * 0.82 + warp;
      const broadVein = Math.exp(-Math.abs(field - 256) / 12);
      const vein = Math.exp(-Math.abs(field - 256 - 9 * noise(x / 38, y / 33)) / 1.45);
      const hairline = Math.exp(-Math.abs(field - 354 + 30 * noise(x / 49, y / 64)) / 0.85);
      const branch = Math.exp(-Math.abs(field - 152 + 27 * noise(x / 66, y / 103)) / 1.2);
      const mineral = 16 * noise(x / 78, y / 67) + 5 * noise(x / 18, y / 19);
      return [(dark ? 130 : -44) * vein + (dark ? 17 : -13) * broadVein
        + (dark ? 58 : -22) * branch + (dark ? 46 : -13) * hairline + mineral + 4 * fine, 0];
    }
    case "travertine": {
      const band = Math.sin(y / 5 + Math.sin(x / 103)) * 6 + Math.sin(y / 14 + x / 154) * 11;
      const pit = grain(Math.floor(x / 3), y) > 0.455 && fine > 0 ? -33 : 0;
      return [band + clouds * 8 + fine * 4 + pit, pit / 2];
    }
    case "wood":
    case "planks": {
      const board = Math.floor(x / 102.4);
      const row = Math.floor((y + board * 123) / 256);
      const offset = pattern === "planks" ? grain(board, row) * 23 : 0;
      const taper = noise(x / 85, y / 122);
      const warp = 23 * taper + 9 * noise(x / 48, y / 74) + 3.4 * noise(x / 21, y / 28);
      const growth = (x + warp) * 0.077 + 2.1 * noise(x / 81, y / 239);
      const annualRing = Math.pow(0.5 + 0.5 * Math.sin(growth), 7.5);
      const fiber = noise((x + warp) / 1.8, y / 35) * 11;
      const pores = Math.min(0, noise((x + warp) * 0.64, y / 12) + 0.13) * 26;
      const seam = pattern === "planks" && (x % 102.4 < 1.6 || (y + board * 123) % 256 < 1.5);
      const figure = taper * 24 + noise(x / 39, y / 155) * 10 - annualRing * 15;
      return [figure + fiber + pores + offset + fine * 3 - (seam ? 49 : 0),
        pores + fiber * 0.3 - (seam ? 70 : 0)];
    }
    case "tile": {
      const joint = x < 2.5 || y < 2.5 || Math.abs(x - 256) < 1.5 || Math.abs(y - 256) < 1.5;
      return [10 * clouds + 5 * fine - (joint ? 37 : 0), fine * 8 - (joint ? 85 : 0)];
    }
    case "quartz":
      return [clouds * 4 + fine * 8 - (fine > 0.47 ? 27 : 0), fine * 2];
    case "concrete":
      return [clouds * 18 + fine * 13, fine * 18];
    default:
      return [fine * 3, fine * 3];
  }
}

function textureFrom(canvas, repeat, isColor) {
  const texture = new THREE.CanvasTexture(canvas);
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 8;
  return texture;
}

function makeMaps(finish, repeat) {
  const canvas = document.createElement("canvas");
  const relief = document.createElement("canvas");
  const size = ["marble", "wood", "planks"].includes(finish.pattern) ? 768 : 512;
  canvas.width = canvas.height = relief.width = relief.height = size;
  const colorContext = canvas.getContext("2d");
  const reliefContext = relief.getContext("2d");
  const colorData = colorContext.createImageData(size, size);
  const reliefData = reliefContext.createImageData(size, size);
  const hex = Number.parseInt(finish.color.slice(1), 16);
  const dark = (hex >> 16) < 100;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [tone, depth] = surface(x * 512 / size, y * 512 / size, finish.pattern, dark);
      const index = (y * size + x) * 4;
      colorData.data[index] = (hex >> 16) + tone;
      colorData.data[index + 1] = ((hex >> 8) & 255) + tone;
      colorData.data[index + 2] = (hex & 255) + tone;
      colorData.data[index + 3] = 255;
      const height = 150 + depth;
      reliefData.data[index] = reliefData.data[index + 1] = reliefData.data[index + 2] = height;
      reliefData.data[index + 3] = 255;
    }
  }
  colorContext.putImageData(colorData, 0, 0);
  reliefContext.putImageData(reliefData, 0, 0);
  return { map: textureFrom(canvas, repeat, true), bumpMap: textureFrom(relief, repeat, false) };
}

export function createFinishes() {
  const groups = {
    stone: [STONE_FINISHES, [1, 1], 0.011],
    floor: [FLOOR_FINISHES, [5, 4], 0.025],
    cabinet: [CABINET_FINISHES, [1, 1], 0.0065],
  };
  const cache = new Map();

  return {
    get(group, name) {
      const key = group + "/" + name;
      if (!cache.has(key)) {
        const [finishes, repeat, bumpScale] = groups[group];
        const finish = finishes[name];
        cache.set(key, {
          ...makeMaps(finish, repeat),
          roughness: finish.roughness,
          clearcoat: finish.clearcoat ?? 0,
          clearcoatRoughness: finish.clearcoatRoughness ?? 0.45,
          bumpScale,
        });
      }
      return cache.get(key);
    },
    dispose() {
      for (const { map, bumpMap } of cache.values()) {
        map.dispose();
        bumpMap.dispose();
      }
      cache.clear();
    },
  };
}
