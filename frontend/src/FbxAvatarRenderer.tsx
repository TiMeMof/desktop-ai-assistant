import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { AssistantEvent } from "./types";
import type { AvatarRendererProps } from "./avatarRendererTypes";

type MotionName = AssistantEvent["motion"] | "chatting";

const fbxFiles = {
  idle: new URL("../fbx/待机1.fbx", import.meta.url).href,
  idleAlt: new URL("../fbx/待机2.fbx", import.meta.url).href,
  ask: new URL("../fbx/蓄力出拳.fbx", import.meta.url).href,
  present_result: new URL("../fbx/落地.fbx", import.meta.url).href,
  error: new URL("../fbx/受击倒地.fbx", import.meta.url).href,
  wave: new URL("../fbx/回旋踢.fbx", import.meta.url).href
};

const motionToFile: Record<MotionName, keyof typeof fbxFiles> = {
  idle: "idle",
  chatting: "idle",
  nod: "idleAlt",
  ask: "ask",
  present_result: "present_result",
  error: "error",
  wave: "wave"
};

type LoadedAvatar = {
  object: THREE.Group;
  clips: THREE.AnimationClip[];
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

function fitAvatar(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const scale = 3.4 / maxAxis;
  object.scale.setScalar(scale);
  object.position.set(-center.x * scale, -box.min.y * scale - 1.7, -center.z * scale);
}

export function FbxAvatarRenderer({ assistantEvent, ...canvasProps }: AvatarRendererProps) {
  const mountRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentRef = useRef<THREE.Group | null>(null);
  const loadedRef = useRef<Map<keyof typeof fbxFiles, LoadedAvatar>>(new Map());
  const pendingRef = useRef<MotionName | null>(null);
  const latestEventRef = useRef<AssistantEvent | null>(null);

  useEffect(() => {
    const canvas = mountRef.current;
    if (!canvas) return;

    let disposed = false;
    let frame = 0;
    const clock = new THREE.Clock();
    const loader = new FBXLoader();
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(34, 320 / 480, 0.1, 100);
    camera.position.set(0, 0.35, 6.5);
    camera.lookAt(0, 0.05, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(320, 480, false);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(2.5, 4, 3);
    scene.add(keyLight);

    async function loadAvatar(key: keyof typeof fbxFiles): Promise<LoadedAvatar> {
      const cached = loadedRef.current.get(key);
      if (cached) return cached;
      const object = await loader.loadAsync(fbxFiles[key]);
      fitAvatar(object);
      object.visible = false;
      loadedRef.current.set(key, { object, clips: object.animations });
      return { object, clips: object.animations };
    }

    function showAvatar(key: keyof typeof fbxFiles, loop: boolean) {
      const loaded = loadedRef.current.get(key);
      if (!loaded || !sceneRef.current) return false;

      if (currentRef.current && currentRef.current !== loaded.object) {
        currentRef.current.visible = false;
        sceneRef.current.remove(currentRef.current);
      }
      if (!loaded.object.parent) {
        sceneRef.current.add(loaded.object);
      }
      loaded.object.visible = true;
      currentRef.current = loaded.object;

      mixerRef.current?.stopAllAction();
      mixerRef.current = new THREE.AnimationMixer(loaded.object);
      const clip = loaded.clips[0];
      if (clip) {
        const action = mixerRef.current.clipAction(clip);
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.clampWhenFinished = !loop;
        action.play();
        if (!loop) {
          const mixer = mixerRef.current;
          const onFinished = () => {
            mixer.removeEventListener("finished", onFinished);
            showAvatar("idle", true);
          };
          mixer.addEventListener("finished", onFinished);
        }
      }
      return true;
    }

    async function playMotion(motion: MotionName) {
      const key = motionToFile[motion];
      const loop = key === "idle" || motion === "chatting";
      if (!loadedRef.current.has(key)) {
        pendingRef.current = motion;
        await loadAvatar(key);
        if (disposed) return;
        if (pendingRef.current !== motion) return;
        pendingRef.current = null;
      }
      showAvatar(key, loop);
    }

    loadAvatar("idle")
      .then((loaded) => {
        if (disposed) return;
        scene.add(loaded.object);
        showAvatar("idle", true);
        Object.keys(fbxFiles)
          .filter((key) => key !== "idle")
          .forEach((key) => {
            loadAvatar(key as keyof typeof fbxFiles).catch((err) => console.error("FBX preload failed", err));
          });
      })
      .catch((err) => console.error("FBX setup failed", err));

    function animate() {
      frame = window.requestAnimationFrame(animate);
      mixerRef.current?.update(clock.getDelta());
      renderer.render(scene, camera);
    }
    animate();

    (canvas as HTMLCanvasElement & { playAvatarMotion?: (motion: MotionName) => void }).playAvatarMotion = playMotion;
    if (latestEventRef.current) {
      playMotion(latestEventRef.current.state === "chatting" ? "chatting" : latestEventRef.current.motion);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      mixerRef.current?.stopAllAction();
      loadedRef.current.forEach((loaded) => disposeObject(loaded.object));
      loadedRef.current.clear();
      renderer.dispose();
      scene.clear();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestEventRef.current = assistantEvent;
    const motion = assistantEvent?.state === "chatting" ? "chatting" : assistantEvent?.motion ?? "idle";
    const canvas = mountRef.current as (HTMLCanvasElement & { playAvatarMotion?: (motion: MotionName) => void }) | null;
    canvas?.playAvatarMotion?.(motion);
  }, [assistantEvent]);

  return <canvas ref={mountRef} aria-label="FBX 3D assistant" {...canvasProps} />;
}
