import { HalfFloatType, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

export function createPresentationPost(renderer, world, camera, { mobile = false } = {}) {
  if (!renderer.extensions?.has("EXT_color_buffer_float")) return null;

  const samples = Math.min(renderer.capabilities.maxSamples, mobile ? 2 : 4);
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  const scenePass = new RenderPass(world, camera);
  const contact = new GTAOPass(world, camera, 1, 1);
  contact.updateGtaoMaterial({ radius: 0.25, thickness: 0.36, scale: 1.12, samples: mobile ? 12 : 24 });
  contact.updatePdMaterial({ radius: 3.4, samples: mobile ? 8 : 16 });
  contact.blendIntensity = 0.56;
  const output = new OutputPass();
  const antialias = samples < 2 ? new ShaderPass(FXAAShader) : null;
  for (const pass of [scenePass, contact, output]) composer.addPass(pass);
  if (antialias) composer.addPass(antialias);

  return {
    resize(width, height) {
      const ratio = Math.min(renderer.getPixelRatio(), 2.4, 1920 / width, 1600 / height, Math.sqrt((mobile ? 1_000_000 : 1_680_000) / (width * height)));
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      antialias?.uniforms.resolution.value.set(1 / (width * ratio), 1 / (height * ratio));
    },
    render() {
      composer.render();
    },
    dispose() {
      contact.dispose();
      contact.gtaoMaterial.dispose();
      contact.blendMaterial.dispose();
      output.dispose();
      antialias?.dispose();
      composer.dispose();
    },
  };
}
