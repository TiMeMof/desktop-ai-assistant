import { useEffect, useRef } from "react";
import type { AssistantEvent } from "./types";

type Live2DModelLike = {
  x: number;
  y: number;
  width: number;
  height: number;
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

const electronAPI =
  typeof window !== "undefined"
    ? (window as unknown as { electronAPI?: {
        startDrag: (x: number, y: number) => void;
        doDrag: (x: number, y: number) => void;
        endDrag: () => void;
      } }).electronAPI
    : undefined;

export function Live2DWindow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Live2DModelLike | null>(null);
  const eventRef = useRef<AssistantEvent | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

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
          backgroundAlpha: 0,
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
        const originalWidth = model.width;
        const originalHeight = model.height;
        const scale = Math.min(canvasWidth / originalWidth, canvasHeight / originalHeight) * 0.9;
        model.scale.set(scale);
        model.x = canvasWidth / 2;
        model.y = canvasHeight / 2 + 20;
        pixiApp.stage.addChild(model);
        pixiApp.render();

        modelRef.current = model as Live2DModelLike;

        const currentEvent = eventRef.current;
        if (currentEvent) {
          const motion = motionFor(currentEvent);
          if (motion) model.motion(motion).catch(() => undefined);
          if (currentEvent.emotion !== "neutral") model.expression(currentEvent.emotion).catch(() => undefined);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Live2D setup failed", err);
      }
    }

    setup();

    const channel = new BroadcastChannel("assistant_events");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "assistant_event") return;
      const assistantEvent = data.payload as AssistantEvent;
      eventRef.current = assistantEvent;
      const model = modelRef.current;
      if (!model) return;
      const motion = motionFor(assistantEvent);
      if (motion) model.motion(motion).catch(() => undefined);
      if (assistantEvent.emotion !== "neutral") model.expression(assistantEvent.emotion).catch(() => undefined);
    };

    return () => {
      disposed = true;
      channel.close();
      channelRef.current = null;
      modelRef.current?.destroy();
      modelRef.current = null;
      app?.destroy(false, { children: true });
    };
  }, []);

  if (!modelUrl) {
    return <div className="live2d-window-fallback">No Live2D model configured</div>;
  }

  function onPointerDown(event: React.PointerEvent) {
    electronAPI?.startDrag(event.screenX, event.screenY);
  }

  function onPointerMove(event: React.PointerEvent) {
    electronAPI?.doDrag(event.screenX, event.screenY);
  }

  function onPointerUp() {
    electronAPI?.endDrag();
  }

  return (
    <div className="live2d-window">
      <canvas
        ref={canvasRef}
        aria-label="Live2D assistant"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}
