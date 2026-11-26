import type { GestureSample } from "./gestureMath";

export type GestureLandmark = {
  x: number;
  y: number;
  z?: number;
};

export type GestureWorkerRequest =
  | {
      type: "init";
      visionModuleUrl: string;
      wasmRoot: string;
      modelUrl: string;
    }
  | { type: "frame"; frame: ImageBitmap; timestamp: number }
  | { type: "close" };

export type GestureWorkerResponse =
  | { type: "ready"; delegate: "GPU" | "CPU" }
  | {
      type: "sample";
      sample: GestureSample | null;
      landmarks: GestureLandmark[] | null;
    }
  | { type: "frameDone" }
  | { type: "error"; message: string };
