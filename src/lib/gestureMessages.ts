import type { GestureSample } from "./gestureMath";

export type GestureWorkerRequest =
  | { type: "init" }
  | { type: "frame"; frame: ImageBitmap; timestamp: number }
  | { type: "close" };

export type GestureWorkerResponse =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | { type: "sample"; sample: GestureSample | null }
  | { type: "frameDone" }
  | { type: "error"; message: string };
