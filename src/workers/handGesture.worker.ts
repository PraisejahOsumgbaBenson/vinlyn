import {
  HAND_MODEL,
  LOCAL_VISION_MODULE,
  VISION_WASM_ROOT,
} from "../lib/gestureConfig";
import type {
  GestureWorkerRequest,
  GestureWorkerResponse,
} from "../lib/gestureMessages";
import type { GestureSample } from "../lib/gestureMath";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GestureWorkerRequest>) => void) | null;
  postMessage: (message: GestureWorkerResponse) => void;
};

type LandmarkPoint = { x: number; y: number; z?: number };

type HandLandmarkerLike = {
  detectForVideo: (
    frame: ImageBitmap,
    timestampMs: number,
  ) => { landmarks?: LandmarkPoint[][] };
  close: () => void;
};

type VisionModuleLike = {
  FilesetResolver: {
    forVisionTasks: (wasmRootPath: string) => Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions: (
      filesetResolver: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate: "GPU" | "CPU" };
        runningMode: "VIDEO";
        numHands: number;
      },
    ) => Promise<HandLandmarkerLike>;
  };
};

let landmarker: HandLandmarkerLike | null = null;
let initPromise: Promise<void> | null = null;

function post(message: GestureWorkerResponse): void {
  scope.postMessage(message);
}

function sampleFromHand(hand: LandmarkPoint[]): GestureSample | null {
  const wrist = hand[0];
  const middleMcp = hand[9];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  if (!wrist || !middleMcp || !thumbTip || !indexTip) return null;

  return {
    indexY: indexTip.y,
    pinchDistance: Math.hypot(
      thumbTip.x - indexTip.x,
      thumbTip.y - indexTip.y,
    ),
    span: Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y),
  };
}

async function createLandmarker(): Promise<void> {
  const response = await fetch(LOCAL_VISION_MODULE);
  if (!response.ok) {
    throw new Error(`Could not load gesture runtime (${response.status})`);
  }

  const blobUrl = URL.createObjectURL(
    new Blob([await response.text()], { type: "text/javascript" }),
  );
  try {
    const vision = (await import(/* @vite-ignore */ blobUrl)) as VisionModuleLike;
    const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_ROOT);
    const options = {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 1,
    };

    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options);
      post({ type: "ready", delegate: "GPU" });
      return;
    } catch {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
      post({ type: "ready", delegate: "CPU" });
    }
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function initialize(): Promise<void> {
  if (!initPromise) {
    initPromise = createLandmarker().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

scope.onmessage = (event) => {
  const message = event.data;

  if (message.type === "init") {
    void initialize().catch((error: unknown) => {
      post({
        type: "error",
        message: error instanceof Error ? error.message : "Could not start hand tracking",
      });
    });
    return;
  }

  if (message.type === "close") {
    landmarker?.close();
    landmarker = null;
    initPromise = null;
    scope.onmessage = null;
    return;
  }

  if (!landmarker) {
    message.frame.close();
    post({ type: "frameDone" });
    return;
  }

  try {
    const result = landmarker.detectForVideo(message.frame, message.timestamp);
    const hand = result?.landmarks?.[0];
    post({ type: "sample", sample: hand ? sampleFromHand(hand) : null });
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Hand tracking failed",
    });
  } finally {
    message.frame.close();
    post({ type: "frameDone" });
  }
};
