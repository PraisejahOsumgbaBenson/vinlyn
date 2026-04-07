import { useEffect, useRef } from "react";

type HandGestureControllerProps = {
  enabled: boolean;
  onScroll: (deltaY: number) => void;
  onSelect: () => void;
  onStateChange?: (state: "idle" | "ready" | "error", message?: string) => void;
};

const LOCAL_VISION_MODULE = "/mediapipe/vision_bundle.mjs";
const VISION_WASM_ROOT = "/mediapipe/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type LandmarkPoint = { x: number; y: number; z?: number };

type HandLandmarkerLike = {
  detectForVideo: (
    video: HTMLVideoElement,
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
        baseOptions: { modelAssetPath: string };
        runningMode: "VIDEO";
        numHands: number;
      },
    ) => Promise<HandLandmarkerLike>;
  };
};

export function HandGestureController({
  enabled,
  onScroll,
  onSelect,
  onStateChange,
}: HandGestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      onStateChange?.("idle");
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let handLandmarker: HandLandmarkerLike | null = null;
    let previousIndexY: number | null = null;
    let pinchDown = false;
    let lastSelectAt = 0;
    let visionBlobUrl: string | null = null;

    const cleanup = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
      }
      if (visionBlobUrl) {
        URL.revokeObjectURL(visionBlobUrl);
        visionBlobUrl = null;
      }
    };

    const run = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 360 },
          audio: false,
        });
        if (!mountedRef.current) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = media;
        const video = videoRef.current;
        if (!video) {
          cleanup();
          return;
        }
        video.srcObject = media;
        await video.play();

        const moduleResponse = await fetch(LOCAL_VISION_MODULE);
        if (!moduleResponse.ok) {
          throw new Error(
            `Could not load gesture runtime (${moduleResponse.status})`,
          );
        }
        const moduleCode = await moduleResponse.text();
        visionBlobUrl = URL.createObjectURL(
          new Blob([moduleCode], { type: "text/javascript" }),
        );
        const vision = (await import(
          /* @vite-ignore */ visionBlobUrl
        )) as VisionModuleLike;
        const filesetResolver =
          await vision.FilesetResolver.forVisionTasks(VISION_WASM_ROOT);
        handLandmarker = await vision.HandLandmarker.createFromOptions(
          filesetResolver,
          {
            baseOptions: { modelAssetPath: HAND_MODEL },
            runningMode: "VIDEO",
            numHands: 1,
          },
        );

        onStateChange?.("ready", "Camera gestures enabled");

        const tick = () => {
          if (!video || !handLandmarker || video.readyState < 2) {
            rafRef.current = window.requestAnimationFrame(tick);
            return;
          }

          const now = performance.now();
          const result = handLandmarker.detectForVideo(video, now);
          const hand = result?.landmarks?.[0];

          if (hand && hand.length > 8) {
            const indexTip = hand[8];
            const thumbTip = hand[4];

            if (previousIndexY !== null) {
              const normalizedDelta = indexTip.y - previousIndexY;
              const deltaPx = normalizedDelta * 1400;
              if (Math.abs(deltaPx) > 1.8) {
                onScroll(deltaPx);
              }
            }
            previousIndexY = indexTip.y;

            const pinchDistance = Math.hypot(
              thumbTip.x - indexTip.x,
              thumbTip.y - indexTip.y,
            );
            const isPinching = pinchDistance < 0.05;
            if (isPinching && !pinchDown && now - lastSelectAt > 500) {
              onSelect();
              lastSelectAt = now;
            }
            pinchDown = isPinching;
          } else {
            previousIndexY = null;
            pinchDown = false;
          }

          rafRef.current = window.requestAnimationFrame(tick);
        };

        rafRef.current = window.requestAnimationFrame(tick);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not enable camera gestures";
        onStateChange?.("error", message);
        cleanup();
      }
    };

    void run();
    return cleanup;
  }, [enabled, onScroll, onSelect, onStateChange]);

  if (!enabled) return null;

  return (
    <div className="gesture-preview" aria-live="polite">
      <video
        ref={videoRef}
        className="gesture-preview__video"
        muted
        playsInline
      />
      <span className="gesture-preview__label">Hand Control On</span>
    </div>
  );
}
