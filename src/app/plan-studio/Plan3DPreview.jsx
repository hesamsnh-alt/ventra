"use client";

import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createPlanScene, disposePlanScene } from "@/lib/planStudio/scene.mjs";
import { bounds } from "@/lib/planStudio/geometry.mjs";
import { bindKitchenInputs } from "@/lib/kitchenModel.mjs";
import { raycastVisibleMeshes } from "@/lib/raycastMeshes.mjs";
import { previewPixelRatio } from "@/lib/interiorRenderQuality.mjs";
import { capturePresentationEnvironment, createReferenceLighting, setPresentationReflections } from "@/lib/referenceLighting.mjs";
import { createPresentationPost } from "@/lib/presentationPost.mjs";

export default function Plan3DPreview({ doc }) {
  const host = useRef(null);
  const runtime = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const parent = host.current;
    const scene = new T.Scene();
    scene.background = new T.Color("#151e2b");
    let renderer, controls, observer, root, environment, lighting, post, currentBounds, grid, unbindKitchen;
    let lightingBounds, initialized = false;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.AgXToneMapping;
      renderer.shadowMap.enabled = true;
      parent.appendChild(renderer.domElement);
      const mobile = parent.clientWidth <= 600;
      environment = capturePresentationEnvironment(renderer);
      scene.environment = environment.texture;

      const camera = new T.PerspectiveCamera(45, 1, 0.02, 10000);
      camera.up.set(0, 0, 1);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.screenSpacePanning = true;
      post = createPresentationPost(renderer, scene, camera, { mobile });

      grid = new T.GridHelper(100, 100, "#4b6279", "#26364b");
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -0.14;
      scene.add(grid);

      const render = () => {
        if (post) post.render();
        else renderer.render(scene, camera);
      };
      const raycaster = new T.Raycaster();
      unbindKitchen = bindKitchenInputs(renderer.domElement, {
        canInteract: () => Boolean(root),
        pick(event) {
          const rect = renderer.domElement.getBoundingClientRect();
          if (!root || !rect.width || !rect.height) return null;
          root.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          raycaster.setFromCamera(new T.Vector2(
            (event.clientX - rect.left) * 2 / rect.width - 1,
            1 - (event.clientY - rect.top) * 2 / rect.height,
          ), camera);
          return raycastVisibleMeshes(raycaster, root, T)[0]?.object;
        },
        render,
      });
      const fit = () => {
        const { x, y, width, height } = currentBounds;
        const span = Math.max(width, height, 4);
        camera.up.set(0, 0, 1);
        camera.position.set(x + width / 2 + span * 0.8, y + height / 2 - span, span * 0.9);
        controls.target.set(x + width / 2, y + height / 2, 0.7);
        controls.update();
        render();
      };
      controls.addEventListener("change", render);
      const resize = () => {
        if (!parent.clientWidth) return;
        const width = parent.clientWidth;
        const height = Math.max(300, parent.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(previewPixelRatio(width, height, window.devicePixelRatio, mobile));
        renderer.setSize(width, height);
        post?.resize(width, height);
        if (root) render();
      };
      observer = new ResizeObserver(resize);
      observer.observe(parent);
      resize();
      runtime.current = {
        setDocument(next) {
          const nextRoot = createPlanScene(next);
          if (root) {
            scene.remove(root);
            disposePlanScene(root, environment.texture);
          }
          root = nextRoot;
          scene.add(root);
          currentBounds = bounds(next.entities);
          const { x, y, width, height } = currentBounds;
          const boundsChanged = [x, y, width, height].join("|");
          if (lightingBounds !== boundsChanged) {
            lighting?.dispose();
            lighting = createReferenceLighting(scene, renderer, {
              span: Math.max(width, height, 4),
              mobile,
              sceneData: { width, depth: height, designDefaults: { viewOriginMeters: { x: -x, y: -y } } },
            });
            lightingBounds = boundsChanged;
          }
          lighting.panel.intensity = (next.lighting?.intensity ?? 1) * 0.7;
          lighting.panel.color.set(next.lighting?.color || "#ffdfb6");
          root.traverse(object => {
            if (object.material?.isMeshPhysicalMaterial) setPresentationReflections(object.material, scene);
          });
          if (!initialized) {
            initialized = true;
            fit();
          } else render();
        },
        fit,
        top() {
          const target = controls.target;
          camera.position.set(target.x, target.y, Math.max(10, camera.position.distanceTo(target)));
          camera.up.set(0, 1, 0);
          controls.update();
          render();
        },
      };
    } catch (cause) {
      setError("3D preview unavailable: " + cause.message);
    }
    return () => {
      observer?.disconnect();
      controls?.dispose();
      if (root) disposePlanScene(root, environment?.texture);
      unbindKitchen?.();
      grid?.dispose();
      lighting?.dispose();
      post?.dispose();
      environment?.dispose();
      renderer?.dispose();
      renderer?.domElement?.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      if (runtime.current) {
        runtime.current.setDocument(doc);
        setError("");
      }
    } catch (cause) {
      setError(cause.message);
    }
  }, [doc]);

  return <section className="ps-preview">
    <div className="ps-preview-tools">
      <span>LIVE 3D</span>
      <button type="button" onClick={() => runtime.current?.fit()}>Fit / نمایش کامل</button>
      <button type="button" onClick={() => runtime.current?.top()}>Top / بالا</button>
    </div>
    <div ref={host} className="ps-three-host" />
    {error && <p role="alert">{error}</p>}
    <small>Drag: orbit · Right drag: pan · Wheel: zoom</small>
  </section>;
}
