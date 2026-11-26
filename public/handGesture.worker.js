"use strict";

// MediaPipe's published ESM bundle loads its WASM glue with importScripts.
// Module workers cannot call importScripts, so this worker is loaded as a
// classic script and uses the local bundle that exports a global Vision object.

let config = null;
let landmarker = null;
let initPromise = null;
let disposed = false;

function post(message) {
  if (!disposed) self.postMessage(message);
}

function describeError(error, fallback) {
  return error && error.message ? error.message : fallback;
}

function loadVision() {
  try {
    importScripts(config.visionModuleUrl);
  } catch (error) {
    throw new Error(
      `Could not load gesture runtime: ${describeError(error, "importScripts failed")}`,
    );
  }

  const vision = self.Vision;
  if (!vision || !vision.FilesetResolver || !vision.HandLandmarker) {
    throw new Error("Gesture runtime did not provide HandLandmarker");
  }
  return vision;
}

function sampleFromHand(hand) {
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

async function createLandmarker() {
  const vision = loadVision();
  const fileset = await vision.FilesetResolver.forVisionTasks(config.wasmRoot);
  const options = {
    baseOptions: { modelAssetPath: config.modelUrl, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
  };

  try {
    landmarker = await vision.HandLandmarker.createFromOptions(fileset, options);
    if (disposed) return;
    post({ type: "ready", delegate: "GPU" });
    return;
  } catch {
    landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
    if (disposed) return;
    post({ type: "ready", delegate: "CPU" });
  }
}

function initialize() {
  if (!initPromise) {
    initPromise = createLandmarker().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

self.onmessage = (event) => {
  const message = event.data;

  if (message.type === "init") {
    config = {
      visionModuleUrl: message.visionModuleUrl,
      wasmRoot: message.wasmRoot,
      modelUrl: message.modelUrl,
    };
    void initialize().catch((error) => {
      post({
        type: "error",
        message: describeError(error, "Could not start hand tracking"),
      });
    });
    return;
  }

  if (message.type === "close") {
    disposed = true;
    landmarker?.close();
    landmarker = null;
    initPromise = null;
    self.onmessage = null;
    return;
  }

  if (!landmarker || !config) {
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
      message: describeError(error, "Hand tracking failed"),
    });
  } finally {
    message.frame.close();
    post({ type: "frameDone" });
  }
};
