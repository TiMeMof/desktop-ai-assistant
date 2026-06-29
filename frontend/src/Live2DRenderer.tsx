import { useEffect, useRef } from "react";
import type { AssistantEvent } from "./types";
import type { AvatarRendererProps } from "./avatarRendererTypes";

type Live2DModelLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: { set: (x: number, y?: number) => void };
  scale: { set: (value: number) => void };
  motion: (group: string, index?: number) => Promise<boolean>;
  expression: (id?: number | string) => Promise<boolean>;
  destroy: () => void;
};

const modelUrl = import.meta.env.VITE_LIVE2D_MODEL_URL as string | undefined;
const coreUrl = import.meta.env.VITE_LIVE2D_CORE_URL as string | undefined;

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function motionFor(event?: AssistantEvent | null): string | null {
  if (!event) return null;
  if (event.motion === "ask") return "TapBody";
  if (event.motion === "present_result") return "Flick";
  if (event.motion === "nod") return "TapHead";
  if (event.motion === "wave") return "Wave";
  return null;
}

export function Live2DRenderer({ assistantEvent, ...canvasProps }: AvatarRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Live2DModelLike | null>(null);

  useEffect(() => {
    if (!modelUrl || !canvasRef.current) {
      return;
    }
    const selectedModelUrl = modelUrl;
    let disposed = false;
    let app: { destroy: (removeView?: boolean, options?: unknown) => void } | null = null;

    async function setup() {
      try {
        if (coreUrl) {
          await loadScript(coreUrl);
        }
        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        (window as unknown as { PIXI?: typeof PIXI }).PIXI = PIXI;
        Live2DModel.registerTicker(PIXI.Ticker);

        const canvasWidth = 320;
        const canvasHeight = 480;
        if (canvasRef.current) {
          canvasRef.current.width = canvasWidth;
          canvasRef.current.height = canvasHeight;
        }
        const pixiApp = new PIXI.Application({
          view: canvasRef.current ?? undefined,
          autoStart: true,
          antialias: false,
          backgroundAlpha: 0,
          autoDensity: false,
          resolution: 1,
          powerPreference: "high-performance",
          width: canvasWidth,
          height: canvasHeight
        });
        app = pixiApp as { destroy: (removeView?: boolean, options?: unknown) => void };

        const model = await Live2DModel.from(selectedModelUrl);
        if (disposed) {
          model.destroy();
          return;
        }
        model.anchor.set(0.5, 0.5);
        const scale = Math.min(canvasWidth / model.width, canvasHeight / model.height) * 0.9;
        model.scale.set(scale);
        model.x = canvasWidth / 2;
        model.y = canvasHeight / 2 + 20;
        pixiApp.stage.addChild(model);
        pixiApp.render();
        modelRef.current = model as Live2DModelLike;
      } catch (err) {
        console.error("Live2D setup failed", err);
      }
    }

    setup();

    return () => {
      disposed = true;
      modelRef.current?.destroy();
      modelRef.current = null;
      app?.destroy(false, { children: true });
    };
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || !assistantEvent) return;
    const motion = motionFor(assistantEvent);
    if (motion) model.motion(motion).catch(() => undefined);
    if (assistantEvent.emotion !== "neutral") {
      model.expression(assistantEvent.emotion).catch(() => undefined);
    }
  }, [assistantEvent]);

  if (!modelUrl) {
    return <div className="avatar-window-fallback">No Live2D model configured</div>;
  }

  return <canvas ref={canvasRef} aria-label="Live2D assistant" {...canvasProps} />;
}
