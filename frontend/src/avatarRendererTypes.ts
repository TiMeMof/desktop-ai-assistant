import type { MouseEvent, PointerEvent } from "react";
import type { AssistantEvent } from "./types";

export type AvatarRendererProps = {
  assistantEvent: AssistantEvent | null;
  onContextMenu: (event: MouseEvent<HTMLCanvasElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLCanvasElement>) => void;
};
