import { useEffect, useRef } from "react";
import {
  GESTURE_WORKER_URL,
  HAND_MODEL,
  LOCAL_VISION_MODULE,
  VISION_WASM_ROOT,
} from "../lib/gestureConfig";
import { publishGestureScroll } from "../lib/gestureEvents";
import {
  createGestureTracker,
  stepGesture,
  type GestureSample,
} from "../lib/gestureMath";
import type {
  GestureLandmark,
  GestureWorkerRequest,
  GestureWorkerResponse,
} from "../lib/gestureMessages";
import {
  drawGestureOverlay,
  gestureOverlayStatus,
} from "../lib/gestureOverlay";

type HandGestureControllerProps = {
  enabled: boolean;
  onSelect: () => void;
  onStateChange?: (state: "idle" | "ready" | "error", message?: string) => void;
};

type VideoFrameMetadata = { mediaTime: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function HandGestureController({
  enabled,
  onSelect,
  onStateChange,
}: HandGestureControllerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      onStateChange?.("idle");
      return;
    }

    let disposed = false;
    let worker: Worker | null = null;
    let stream: MediaStream | null = null;
    let videoEl: HTMLVideoElement | null = null;
    let rafId: number | null = null;
    let frameCallbackId: number | null = null;
    let visionReady = false;
    let frameInFlight = false;
    let lastVideoTime = -1;
    let lastTimestamp = 0;
    let tracker = createGestureTracker();
    let sampleCount = 0;
    let fpsWindowStart = performance.now();
    let trackingFps = 0;
    let lastStatusAt = 0;

    const stopLoops = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (frameCallbackId !== null) {
        const video = videoEl as VideoWithFrameCallback | null;
        video?.cancelVideoFrameCallback?.(frameCallbackId);
        frameCallbackId = null;
      }
    };

    const cleanup = () => {
      disposed = true;
      stopLoops();
      drawGestureOverlay(overlayRef.current, null, null);
      if (statusRef.current) {
        statusRef.current.textContent = "HAND NOT FOUND · SHOW YOUR HAND TO THE CAMERA";
      }
      videoEl = null;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      if (worker) {
        const close: GestureWorkerRequest = { type: "close" };
        worker.postMessage(close);
        worker.terminate();
        worker = null;
      }
    };

    const sendFrame = async (rawTimestamp: number) => {
      if (disposed || !visionReady || frameInFlight || !worker) return;
      const video = videoEl;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      const timestamp = Math.max(1, Math.floor(rawTimestamp), lastTimestamp + 1);
      let frame: ImageBitmap;
      try {
        frame = await createImageBitmap(video);
      } catch {
        return;
      }
      if (disposed || !worker) {
        frame.close();
        return;
      }

      frameInFlight = true;
      lastTimestamp = timestamp;
      const message: GestureWorkerRequest = {
        type: "frame",
        frame,
        timestamp,
      };
      worker.postMessage(message, [frame]);
    };

    const onVideoFrame = (
      _now: number,
      metadata: VideoFrameMetadata,
    ) => {
      if (disposed) return;
      if (metadata.mediaTime !== lastVideoTime) {
        lastVideoTime = metadata.mediaTime;
        void sendFrame(metadata.mediaTime * 1000);
      }
      scheduleFrame();
    };

    const tick = () => {
      if (disposed) return;
      if (videoEl && videoEl.currentTime !== lastVideoTime) {
        lastVideoTime = videoEl.currentTime;
        void sendFrame(performance.now());
      }
      rafId = window.requestAnimationFrame(tick);
    };

    const scheduleFrame = () => {
      if (disposed) return;
      const video = videoEl as VideoWithFrameCallback | null;
      if (video?.requestVideoFrameCallback) {
        frameCallbackId = video.requestVideoFrameCallback(onVideoFrame);
        return;
      }
      if (rafId === null) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const applySample = (
      sample: GestureSample | null,
      landmarks: GestureLandmark[] | null,
    ) => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const step = stepGesture(tracker, sample, now);
      tracker = step.tracker;
      if (step.deltaPx !== 0) publishGestureScroll(step.deltaPx);
      if (step.select) onSelect();

      sampleCount += 1;
      if (now - fpsWindowStart >= 1000) {
        trackingFps = Math.round((sampleCount * 1000) / (now - fpsWindowStart));
        sampleCount = 0;
        fpsWindowStart = now;
      }

      drawGestureOverlay(overlayRef.current, landmarks, sample);
      if (now - lastStatusAt >= 250 && statusRef.current) {
        lastStatusAt = now;
        statusRef.current.textContent = gestureOverlayStatus(
          sample,
          landmarks,
          trackingFps,
        );
      }
    };

    void (async () => {
      try {
        worker = new Worker(GESTURE_WORKER_URL);

        worker.onmessage = (event: MessageEvent<GestureWorkerResponse>) => {
          if (disposed) return;
          const message = event.data;

          if (message.type === "ready") {
            visionReady = true;
            onStateChange?.(
              "ready",
              `Camera gestures enabled (${message.delegate})`,
            );
            scheduleFrame();
            return;
          }

          if (message.type === "sample") {
            applySample(message.sample, message.landmarks);
            return;
          }

          if (message.type === "frameDone") {
            frameInFlight = false;
            return;
          }

          onStateChange?.("error", message.message);
          cleanup();
        };

        worker.onerror = (event) => {
          if (disposed) return;
          onStateChange?.(
            "error",
            event.message || "Could not start hand tracking",
          );
          cleanup();
        };

        const init: GestureWorkerRequest = {
          type: "init",
          visionModuleUrl: LOCAL_VISION_MODULE,
          wasmRoot: VISION_WASM_ROOT,
          modelUrl: HAND_MODEL,
        };
        worker.postMessage(init);

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        videoEl = videoRef.current;
        if (!videoEl) {
          cleanup();
          return;
        }
        videoEl.srcObject = stream;
        await videoEl.play();
      } catch (error) {
        if (!disposed) {
          onStateChange?.(
            "error",
            errorMessage(error, "Could not enable camera gestures"),
          );
          cleanup();
        }
      }
    })();

    return cleanup;
  }, [enabled, onSelect, onStateChange]);

  if (!enabled) return null;

  return (
    <div className="gesture-preview" aria-live="polite">
      <div className="gesture-preview__frame">
        <video
          ref={videoRef}
          className="gesture-preview__video"
          muted
          playsInline
        />
        <canvas
          ref={overlayRef}
          className="gesture-preview__map"
          width={640}
          height={360}
          aria-hidden="true"
        />
      </div>
      <span ref={statusRef} className="gesture-preview__label">
        HAND NOT FOUND · SHOW YOUR HAND TO THE CAMERA
      </span>
    </div>
  );
}
