import type { GestureLandmark } from "./gestureMessages";
import type { GestureSample } from "./gestureMath";

type Point = { x: number; y: number };

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const INDEX_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
];

function pixelPoint(point: GestureLandmark, width: number, height: number): Point {
  return { x: point.x * width, y: point.y * height };
}

function strokeConnection(
  ctx: CanvasRenderingContext2D,
  landmarks: GestureLandmark[],
  width: number,
  height: number,
  from: number,
  to: number,
): void {
  const start = landmarks[from];
  const end = landmarks[to];
  if (!start || !end) return;

  const a = pixelPoint(start, width, height);
  const b = pixelPoint(end, width, height);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawGestureOverlay(
  canvas: HTMLCanvasElement | null,
  landmarks: GestureLandmark[] | null,
  sample: GestureSample | null,
): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks?.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(20, 20, 20, 0.36)";
  ctx.lineWidth = Math.max(2, width / 260);
  for (const [from, to] of HAND_CONNECTIONS) {
    strokeConnection(ctx, landmarks, width, height, from, to);
  }

  ctx.strokeStyle = "rgba(20, 20, 20, 0.88)";
  ctx.lineWidth = Math.max(3, width / 180);
  for (const [from, to] of INDEX_CONNECTIONS) {
    strokeConnection(ctx, landmarks, width, height, from, to);
  }

  const thumb = landmarks[4];
  const index = landmarks[8];
  if (sample && thumb && index && sample.span > 0.001) {
    const pinching = sample.pinchDistance / sample.span < 0.45;
    const a = pixelPoint(thumb, width, height);
    const b = pixelPoint(index, width, height);
    ctx.strokeStyle = pinching
      ? "rgba(168, 54, 42, 0.95)"
      : "rgba(20, 20, 20, 0.3)";
    ctx.lineWidth = pinching ? Math.max(4, width / 140) : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  if (index) {
    const y = pixelPoint(index, width, height).y;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = "rgba(20, 20, 20, 0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(20, 20, 20, 0.9)";
    ctx.beginPath();
    ctx.moveTo(width - 14, y);
    ctx.lineTo(width - 3, y - 6);
    ctx.lineTo(width - 3, y + 6);
    ctx.closePath();
    ctx.fill();
  }

  landmarks.forEach((point, indexNumber) => {
    const p = pixelPoint(point, width, height);
    const prominent = indexNumber === 0 || indexNumber === 4 || indexNumber === 8;
    ctx.fillStyle = prominent ? "rgba(255, 255, 255, 0.96)" : "rgba(255, 255, 255, 0.84)";
    ctx.strokeStyle = prominent
      ? "rgba(20, 20, 20, 0.95)"
      : "rgba(20, 20, 20, 0.6)";
    ctx.lineWidth = prominent ? 2 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, prominent ? Math.max(5, width / 110) : Math.max(3, width / 190), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

export function gestureOverlayStatus(
  sample: GestureSample | null,
  landmarks: GestureLandmark[] | null,
  fps: number,
): string {
  if (!landmarks?.length || !sample) {
    return "HAND NOT FOUND · SHOW YOUR HAND TO THE CAMERA";
  }

  const pinchRatio = sample.pinchDistance / sample.span;
  const action = pinchRatio < 0.45 ? "PINCHING · RELEASE TO SELECT AGAIN" : "MOVE FINGER UP OR DOWN";
  return `HAND FOUND · ${action} · ${fps > 0 ? `${fps} FPS` : "TRACKING"}`;
}
