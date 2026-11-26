const SCROLL_EVENT = "vinlyn:gesture-scroll";

export function publishGestureScroll(deltaY: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCROLL_EVENT, { detail: deltaY }));
}

export function subscribeGestureScroll(
  listener: (deltaY: number) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (Number.isFinite(detail)) listener(detail);
  };
  window.addEventListener(SCROLL_EVENT, handler);
  return () => window.removeEventListener(SCROLL_EVENT, handler);
}
