"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** Palette this scene cycles through — material colors, the spot light wash, and the legend badges below all draw from the same four swatches. */
const PALETTE = {
  grey: new THREE.Color("#d4d4d8"),
  indigo: new THREE.Color("#a5b4fc"),
  green: new THREE.Color("#86efac"),
  red: new THREE.Color("#fca5a5"),
};
const CYCLE = [PALETTE.grey, PALETTE.indigo, PALETTE.green, PALETTE.red];

/** Procedural checker texture for the ground plane — no external image asset needed. */
function createGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, size, size);
  const cell = size / 8;
  ctx.fillStyle = "#e4e4e7";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ThreeShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e4e4e7");
    scene.fog = new THREE.Fog("#e4e4e7", 12, 26);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 3.4, 8.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(0, 1, 0);
    controls.autoRotate = !reducedMotionRef.current;
    controls.autoRotateSpeed = 0.6;

    // Fill light — soft ambient sky/ground so shadow sides aren't pure black.
    const hemiLight = new THREE.HemisphereLight("#f4f4f5", "#71717a", 0.55);
    scene.add(hemiLight);

    // Directional light — the sun. Casts the primary shadow.
    const dirLight = new THREE.DirectionalLight("#ffffff", 1.8);
    dirLight.position.set(6, 9, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.bias = -0.0015;
    scene.add(dirLight);

    // Spot light — an orbiting indigo accent light, its target swept via Vector3.
    const spotLight = new THREE.SpotLight(PALETTE.indigo, 6, 20, Math.PI / 7, 0.45, 1.2);
    spotLight.position.set(-4, 6, 3);
    spotLight.castShadow = true;
    spotLight.shadow.mapSize.set(1024, 1024);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0, 0);
    scene.add(spotTarget);
    spotLight.target = spotTarget;
    scene.add(spotLight);

    // Ground.
    const groundTexture = createGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.92, metalness: 0.04 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Three primitives spanning the roughness/metalness range, one per accent color.
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 48, 48),
      new THREE.MeshStandardMaterial({ color: PALETTE.indigo, roughness: 0.15, metalness: 1 }),
    );
    sphere.position.set(-2.6, 1, 0);

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.7, 0.24, 128, 32),
      new THREE.MeshStandardMaterial({ color: PALETTE.green, roughness: 0.85, metalness: 0.1 }),
    );
    knot.position.set(0, 1.3, 0);

    const box = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({ color: PALETTE.red, roughness: 0.4, metalness: 0.6 }),
    );
    box.position.set(2.6, 1, 0);

    for (const mesh of [sphere, knot, box]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // Raycaster + Vector2 pointer tracking — hovering a primitive scales it up.
    const pointer = new THREE.Vector2(-10, -10);
    const raycaster = new THREE.Raycaster();
    let hovered: THREE.Mesh | null = null;
    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    container.addEventListener("pointermove", onPointerMove);

    // Optional GLB — dropped into public/models/demo.glb. Falls back to the
    // primitives above if it's missing or fails to parse; never fatal.
    let mixer: THREE.AnimationMixer | null = null;
    const loader = new GLTFLoader();
    loader.load(
      "/models/demo.glb",
      (gltf) => {
        if (disposed) return;
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        gltf.scene.scale.setScalar(0.028);
        gltf.scene.position.set(0, 0, 3);
        scene.add(gltf.scene);
        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(gltf.scene);
          mixer.clipAction(gltf.animations[0]).play();
        }
        setModelStatus("ready");
      },
      undefined,
      () => setModelStatus("unavailable"),
    );

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const delta = clock.getDelta();
      const still = reducedMotionRef.current;

      if (!still) {
        // Vector3-driven orbit for the spot light target — a moving highlight.
        spotTarget.position.set(Math.sin(elapsed * 0.5) * 2.5, 0, Math.cos(elapsed * 0.5) * 2.5);
        spotLight.position.set(Math.cos(elapsed * 0.3) * 5, 6, Math.sin(elapsed * 0.3) * 5);

        sphere.rotation.y += delta * 0.6;
        knot.rotation.x += delta * 0.4;
        knot.rotation.y += delta * 0.5;
        box.rotation.y -= delta * 0.5;
        knot.position.y = 1.3 + Math.sin(elapsed * 1.4) * 0.15;

        // Color-lerp the icosahedron through the full palette on a loop.
        const cyclePos = (elapsed * 0.25) % CYCLE.length;
        const i = Math.floor(cyclePos);
        const t = cyclePos - i;
        const from = CYCLE[i];
        const to = CYCLE[(i + 1) % CYCLE.length];
        (box.material as THREE.MeshStandardMaterial).color.copy(from).lerp(to, t);

        mixer?.update(delta);
      }

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects([sphere, knot, box]);
      const target = (intersects[0]?.object as THREE.Mesh) ?? null;
      if (target !== hovered) {
        hovered?.scale.setScalar(1);
        target?.scale.setScalar(1.12);
        hovered = target;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", onPointerMove);
      controls.dispose();
      groundTexture.dispose();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // Deliberately empty: the effect owns the whole scene lifecycle and reads
    // live values through reducedMotionRef instead of restarting on change.
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative h-[60vh] min-h-[420px] w-full overflow-hidden rounded-md border border-border"
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-sm border border-zinc-300 bg-zinc-100 px-2 py-1 text-zinc-700">
          light grey — ground &amp; fill light
        </span>
        <span className="rounded-sm border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">
          light indigo — spot light &amp; metal sphere
        </span>
        <span className="rounded-sm border border-green-200 bg-green-50 px-2 py-1 text-green-700">
          light green — matte torus knot
        </span>
        <span className="rounded-sm border border-red-200 bg-red-50 px-2 py-1 text-red-700">
          light red — cycling icosahedron
        </span>
        <span className="rounded-sm border border-zinc-300 bg-white px-2 py-1 text-zinc-500">
          model:{" "}
          {modelStatus === "loading" ? "loading…" : modelStatus === "ready" ? "loaded (fox.glb)" : "primitives only"}
        </span>
      </div>
    </div>
  );
}
