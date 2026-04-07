import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AlbumCover } from "../lib";
import { UiSfx } from "../lib/sfx";
import "./AlbumRibbon.css";

type Props = {
  albums: AlbumCover[];
  onSelectAlbum?: (album: AlbumCover) => void;
  gestureScroll?: { seq: number; delta: number };
  gestureSelectSeq?: number;
};

/** Square cards — large on screen */
const CARD_BASE = 450;

/** Depth spacing between cards */
const DEPTH_STEP = 84;

/** Diagonal travel from front (bottom-left) to back (top-right) */
const STEP_X = 120;
const STEP_Y = 76;

/** Stack anchor */
const START_X = -650;
const START_Y = 360;

/** Global scene offset to push stack toward bottom-left edge */
const TRACK_SHIFT_X = -180;
const TRACK_SHIFT_Y = 70;

/** Whole-stack perspective */
const TRACK_SCALE = 1.02;

/** Scroll behavior */
const DRAG_GAIN = 0.022;
const DRAG_RESPONSE = 0.4;
const SETTLE_EASING = 0.22;
const RELEASE_MOMENTUM = 11.5;
const STOP_EPSILON = 0.0005;
const IDLE_ZOOM_DELAY_MS = 160;
const IDLE_ZOOM_SCALE = 1.2;
const HOVER_PULL_X = 72;
const LABEL_FOLLOW_EASING = 0.2;
const LABEL_SWITCH_DELAY_MS = 120;
const HOVER_SOUND_THROTTLE_MS = 95;
const CLICK_CANCEL_DISTANCE_PX = 14;
const MOBILE_CLICK_CANCEL_DISTANCE_PX = 26;

/** Number of cards rendered in front/behind for seamless looping */
const RENDER_BEHIND = 3;
const RENDER_AHEAD = 13;
const RENDER_BEHIND_MOBILE = 1;
const RENDER_AHEAD_MOBILE = 8;

/** Camera angles */
const ROT_X = 0;
const ROT_Y = -42;
const ROT_Z = 0;

type CardViewProps = {
  album: AlbumCover;
  i: number;
  px: number;
  py: number;
  pz: number;
  scale: number;
  depth: number;
  z: number;
  cardSize: number;
  hoverPullX: number;
  isHovered: boolean;
  isOpening: boolean;
  onHoverStart: (
    i: number,
    album: AlbumCover,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onHoverMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onHoverEnd: (i: number) => void;
  onSelect: (album: AlbumCover) => void;
};

const FannedCard = memo(function FannedCard({
  album,
  i,
  px,
  py,
  pz,
  scale,
  depth,
  z,
  cardSize,
  hoverPullX,
  isHovered,
  isOpening,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onSelect,
}: CardViewProps) {
  const hoverShiftX = isHovered ? hoverPullX : 0;

  return (
    <button
      type="button"
      className={`ribbon-card${isHovered ? " is-hovered" : ""}${isOpening ? " is-opening" : ""}`}
      style={{
        width: cardSize,
        height: cardSize,
        transform: `translate3d(${px - cardSize / 2 + hoverShiftX}px, ${py - cardSize / 2}px, ${pz}px) scale(${scale})`,
        zIndex: isHovered ? z + 40 : z,
        ["--depth" as string]: depth,
        ["--thickness" as string]: `${Math.max(88, Math.round(cardSize * 0.46))}px`,
        ["--img-bright" as string]: `${Math.max(1, 1.12 - depth * 0.009)}`,
        ["--img-opacity" as string]: `${Math.max(0.48, 0.72 - depth * 0.015)}`,
      }}
      data-album-id={album.id}
      aria-label={`${album.name} by ${album.artist}`}
      onPointerEnter={(e) => onHoverStart(i, album, e)}
      onPointerMove={onHoverMove}
      onPointerLeave={() => onHoverEnd(i)}
      onClick={() => onSelect(album)}
    >
      <div className="ribbon-card__content">
        <span
          className="ribbon-card__side ribbon-card__side--top"
          aria-hidden
        />
        <span
          className="ribbon-card__side ribbon-card__side--right"
          aria-hidden
        />
        <span
          className="ribbon-card__side ribbon-card__side--bottom"
          aria-hidden
        />
        <span
          className="ribbon-card__side ribbon-card__side--left"
          aria-hidden
        />
        {album.imageUrl ? (
          <img
            src={album.imageUrl}
            alt=""
            width={cardSize}
            height={cardSize}
            loading={i < 20 ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="ribbon-card__fallback" aria-hidden />
        )}
      </div>
    </button>
  );
});

export function AlbumRibbon({
  albums,
  onSelectAlbum,
  gestureScroll,
  gestureSelectSeq,
}: Props) {
  const getResponsiveCardSize = () => {
    if (typeof window === "undefined") return CARD_BASE;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 920) {
      const base = Math.min(vw, vh);
      return Math.max(170, Math.min(290, Math.round(base * 0.58)));
    }
    return CARD_BASE;
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState(getResponsiveCardSize);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isIdleZoom, setIsIdleZoom] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [hoverLabelText, setHoverLabelText] = useState("");
  const [isHoverLabelVisible, setIsHoverLabelVisible] = useState(false);
  const [openingAlbumId, setOpeningAlbumId] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const lastYRef = useRef(0);
  const targetOffsetRef = useRef(0);
  const animatedOffsetRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const idleZoomTimerRef = useRef<number | null>(null);
  const hoverLabelRef = useRef<HTMLDivElement>(null);
  const hoverMoveRafRef = useRef<number | null>(null);
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const hoverPosCurrentRef = useRef({ x: 0, y: 0 });
  const hoverHideTimerRef = useRef<number | null>(null);
  const hoverLabelSwitchTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const dragDistanceRef = useRef(0);
  const pointerDownAlbumIdRef = useRef<string | null>(null);
  const albumsRef = useRef<AlbumCover[]>(albums);
  const sfxRef = useRef<UiSfx | null>(null);
  const lastHoverSoundAtRef = useRef(0);
  const lastGestureSoundAtRef = useRef(0);
  const lastTouchDragSoundAtRef = useRef(0);
  const lastGestureScrollSeqRef = useRef<number>(-1);
  const lastGestureSelectSeqRef = useRef<number>(-1);
  const clickCancelDistanceRef = useRef(CLICK_CANCEL_DISTANCE_PX);
  const dragPointerTypeRef = useRef<string | null>(null);
  const smoothedTouchDyRef = useRef(0);

  useEffect(() => {
    albumsRef.current = albums;
  }, [albums]);

  const getSfx = () => {
    if (!sfxRef.current) {
      sfxRef.current = new UiSfx();
    }
    return sfxRef.current;
  };

  const resumeSfx = () => {
    void getSfx().resume();
  };

  const cancelIdleZoomTimer = () => {
    if (idleZoomTimerRef.current !== null) {
      window.clearTimeout(idleZoomTimerRef.current);
      idleZoomTimerRef.current = null;
    }
  };

  const cancelHoverHideTimer = () => {
    if (hoverHideTimerRef.current !== null) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
  };

  const cancelHoverLabelSwitchTimer = () => {
    if (hoverLabelSwitchTimerRef.current !== null) {
      window.clearTimeout(hoverLabelSwitchTimerRef.current);
      hoverLabelSwitchTimerRef.current = null;
    }
  };

  const updateHoverLabelPosition = () => {
    const el = hoverLabelRef.current;
    if (!el) {
      hoverMoveRafRef.current = null;
      return;
    }

    const target = hoverPosRef.current;
    const current = hoverPosCurrentRef.current;
    const nextX = current.x + (target.x - current.x) * LABEL_FOLLOW_EASING;
    const nextY = current.y + (target.y - current.y) * LABEL_FOLLOW_EASING;

    hoverPosCurrentRef.current = { x: nextX, y: nextY };
    el.style.transform = `translate3d(${nextX + 22}px, ${nextY - 24}px, 0)`;

    if (Math.abs(target.x - nextX) > 0.2 || Math.abs(target.y - nextY) > 0.2) {
      hoverMoveRafRef.current = window.requestAnimationFrame(
        updateHoverLabelPosition,
      );
      return;
    }

    hoverMoveRafRef.current = null;
  };

  const scheduleHoverLabelPosition = (x: number, y: number) => {
    hoverPosRef.current = { x, y };
    if (!isHoverLabelVisible) {
      hoverPosCurrentRef.current = { x, y };
    }
    if (hoverMoveRafRef.current !== null) return;
    hoverMoveRafRef.current = window.requestAnimationFrame(
      updateHoverLabelPosition,
    );
  };

  const tick = () => {
    const current = animatedOffsetRef.current;
    const target = targetOffsetRef.current;
    const delta = target - current;
    let next = current;

    if (draggingRef.current) {
      next = current + delta * DRAG_RESPONSE;
    } else {
      next =
        Math.abs(delta) < STOP_EPSILON
          ? target
          : current + delta * SETTLE_EASING;
    }

    animatedOffsetRef.current = next;
    setScrollOffset(next);

    if (draggingRef.current || Math.abs(target - next) > STOP_EPSILON) {
      rafRef.current = window.requestAnimationFrame(tick);
      return;
    }

    animatedOffsetRef.current = target;
    velocityRef.current = 0;
    setScrollOffset(target);
    rafRef.current = null;
  };

  const ensureAnimation = () => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(tick);
  };

  const applyTrackTransform = () => {
    const el = trackRef.current;
    if (!el) return;
    const viewportH = window.innerHeight;
    const sceneScale = cardSize / CARD_BASE;
    const dy = Math.round(viewportH * 0.02) + TRACK_SHIFT_Y * sceneScale;
    const shiftX = TRACK_SHIFT_X * sceneScale;
    const activeScale = isIdleZoom
      ? TRACK_SCALE * IDLE_ZOOM_SCALE
      : TRACK_SCALE;
    el.style.transform = `translate(calc(-50% + ${shiftX}px), calc(-50% + ${dy}px)) rotateX(${ROT_X}deg) rotateY(${ROT_Y}deg) rotateZ(${ROT_Z}deg) scale3d(${activeScale}, ${activeScale}, ${activeScale})`;
  };

  useLayoutEffect(() => {
    applyTrackTransform();
  }, [cardSize, isIdleZoom]);

  useEffect(() => {
    const onResize = () => {
      setCardSize(getResponsiveCardSize());
      applyTrackTransform();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cardSize, isIdleZoom]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (hoverMoveRafRef.current !== null) {
        window.cancelAnimationFrame(hoverMoveRafRef.current);
        hoverMoveRafRef.current = null;
      }
      getSfx().stopDragLoop();
      cancelHoverLabelSwitchTimer();
      cancelHoverHideTimer();
      cancelIdleZoomTimer();
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const rawDy = e.clientY - lastYRef.current;
      lastYRef.current = e.clientY;
      dragDistanceRef.current += Math.abs(rawDy);

      let dy = rawDy;
      if (dragPointerTypeRef.current === "touch") {
        const smoothed = smoothedTouchDyRef.current * 0.55 + rawDy * 0.45;
        smoothedTouchDyRef.current = smoothed;
        dy = Math.abs(smoothed) < 0.25 ? 0 : smoothed;
      } else {
        smoothedTouchDyRef.current = 0;
      }

      if (dy === 0) return;

      const step = -dy * DRAG_GAIN;
      targetOffsetRef.current += step;
      velocityRef.current = step;

      const speed = Math.min(1, Math.abs(dy) / 20);
      getSfx().updateDragLoop(speed);

      // Touch pointer move events can feel sparse on some phones; add a direct pulse.
      if (dragPointerTypeRef.current === "touch" && Math.abs(dy) > 0.5) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastTouchDragSoundAtRef.current > 26) {
          getSfx().playDragScrub(Math.max(0.22, speed));
          lastTouchDragSoundAtRef.current = now;
        }
      }

      ensureAnimation();
    };

    const endDrag = () => {
      if (!draggingRef.current) return;

      const tappedAlbumId =
        dragDistanceRef.current <= clickCancelDistanceRef.current
          ? pointerDownAlbumIdRef.current
          : null;

      draggingRef.current = false;
      getSfx().stopDragLoop();
      dragPointerTypeRef.current = null;
      smoothedTouchDyRef.current = 0;
      targetOffsetRef.current += velocityRef.current * RELEASE_MOMENTUM;
      velocityRef.current = 0;
      setIsDragging(false);
      pointerDownAlbumIdRef.current = null;
      cancelIdleZoomTimer();
      idleZoomTimerRef.current = window.setTimeout(() => {
        setIsIdleZoom(true);
      }, IDLE_ZOOM_DELAY_MS);

      if (tappedAlbumId) {
        const tapped = albumsRef.current.find(
          (item) => item.id === tappedAlbumId,
        );
        if (tapped) {
          onCardSelect(tapped);
        }
      }

      ensureAnimation();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  const onCardHoverStart = (
    i: number,
    album: AlbumCover,
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (draggingRef.current) return;
    resumeSfx();
    const now = performance.now();
    if (now - lastHoverSoundAtRef.current > HOVER_SOUND_THROTTLE_MS) {
      getSfx().playHover();
      lastHoverSoundAtRef.current = now;
    }

    cancelHoverHideTimer();
    cancelHoverLabelSwitchTimer();
    setHoveredCard(i);
    setIsHoverLabelVisible(true);
    scheduleHoverLabelPosition(e.clientX, e.clientY);

    if (!hoverLabelText) {
      setHoverLabelText(album.name);
      return;
    }

    hoverLabelSwitchTimerRef.current = window.setTimeout(() => {
      setHoverLabelText(album.name);
    }, LABEL_SWITCH_DELAY_MS);
  };

  const onCardHoverMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (draggingRef.current || !isHoverLabelVisible) return;
    scheduleHoverLabelPosition(e.clientX, e.clientY);
  };

  const onCardHoverEnd = (i: number) => {
    setHoveredCard((prev) => (prev === i ? null : prev));
    cancelHoverLabelSwitchTimer();
    cancelHoverHideTimer();
    hoverHideTimerRef.current = window.setTimeout(() => {
      setIsHoverLabelVisible(false);
      setHoverLabelText("");
    }, 70);
  };

  const onCardSelect = (album: AlbumCover) => {
    if (!onSelectAlbum) return;
    if (dragDistanceRef.current > clickCancelDistanceRef.current) return;
    if (openingAlbumId) return;

    setOpeningAlbumId(album.id);
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
    }
    openTimerRef.current = window.setTimeout(() => {
      onSelectAlbum(album);
      openTimerRef.current = null;
      setOpeningAlbumId(null);
    }, 230);
  };

  const selectFrontAlbum = () => {
    if (!albums.length) return;
    const frontIndex =
      ((Math.round(scrollOffset) % albums.length) + albums.length) %
      albums.length;
    const target = albums[frontIndex];
    if (target) {
      onCardSelect(target);
    }
  };

  useEffect(() => {
    if (!gestureScroll) return;
    if (gestureScroll.seq === lastGestureScrollSeqRef.current) return;
    lastGestureScrollSeqRef.current = gestureScroll.seq;

    const deltaPx = gestureScroll.delta;
    if (!Number.isFinite(deltaPx) || Math.abs(deltaPx) < 0.1) return;

    const now = performance.now();
    const speed = Math.min(1, Math.abs(deltaPx) / 24);
    if (now - lastGestureSoundAtRef.current > 38) {
      resumeSfx();
      getSfx().playDragScrub(speed);
      lastGestureSoundAtRef.current = now;
    }

    targetOffsetRef.current += -deltaPx * DRAG_GAIN;
    ensureAnimation();
  }, [gestureScroll]);

  useEffect(() => {
    if (typeof gestureSelectSeq !== "number") return;
    if (gestureSelectSeq === lastGestureSelectSeqRef.current) return;
    lastGestureSelectSeqRef.current = gestureSelectSeq;
    selectFrontAlbum();
  }, [gestureSelectSeq, scrollOffset]);

  if (albums.length === 0) {
    return <div className="ribbon-empty">No albums to show yet.</div>;
  }

  const baseIndex = Math.floor(scrollOffset);
  const fraction = scrollOffset - baseIndex;
  const isMobileStack = cardSize < 320;
  const renderBehind = isMobileStack ? RENDER_BEHIND_MOBILE : RENDER_BEHIND;
  const renderAhead = isMobileStack ? RENDER_AHEAD_MOBILE : RENDER_AHEAD;

  const cards = Array.from(
    { length: renderAhead + renderBehind },
    (_, slot) => {
      const virtualIndex = baseIndex + slot - renderBehind;
      const normalized =
        albums.length === 0
          ? 0
          : ((virtualIndex % albums.length) + albums.length) % albums.length;
      const album = albums[normalized]!;
      const depthI = slot - renderBehind - fraction;
      const sceneScale = cardSize / CARD_BASE;
      const px = (START_X + depthI * (STEP_X + 8)) * sceneScale;
      const py = (START_Y - depthI * (STEP_Y + 4)) * sceneScale;
      const pz = (180 - depthI * (DEPTH_STEP - 6)) * sceneScale;
      const depth = Math.max(0, depthI);
      const scale = Math.max(0.82, 1 - depth * 0.014);
      const distanceFromFront = Math.abs(slot - renderBehind);
      const z = 2000 - distanceFromFront * 20 - (slot < renderBehind ? 1 : 0);

      return {
        album,
        i: virtualIndex,
        px,
        py,
        pz,
        scale,
        depth,
        z,
      };
    },
  );

  return (
    <div
      ref={rootRef}
      className={`ribbon-root${isDragging ? " is-dragging" : ""}`}
      onPointerDown={(e) => {
        resumeSfx();
        getSfx().playTap();
        getSfx().startDragLoop();
        getSfx().playDragScrub(0.52);
        getSfx().updateDragLoop(0.4);
        draggingRef.current = true;
        dragPointerTypeRef.current = e.pointerType;
        smoothedTouchDyRef.current = 0;
        lastTouchDragSoundAtRef.current = 0;
        setIsDragging(true);
        setIsIdleZoom(false);
        setHoveredCard(null);
        setIsHoverLabelVisible(false);
        setHoverLabelText("");
        cancelHoverLabelSwitchTimer();
        cancelHoverHideTimer();
        cancelIdleZoomTimer();
        dragDistanceRef.current = 0;
        clickCancelDistanceRef.current =
          e.pointerType === "touch"
            ? MOBILE_CLICK_CANCEL_DISTANCE_PX
            : CLICK_CANCEL_DISTANCE_PX;
        lastYRef.current = e.clientY;
        const target = e.target as HTMLElement | null;
        pointerDownAlbumIdRef.current =
          target?.closest(".ribbon-card")?.getAttribute("data-album-id") ||
          null;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      role="application"
      aria-label="Album stack. Drag up and down to move through albums."
    >
      <div className="ribbon-scene">
        <div ref={trackRef} className="ribbon-track">
          {cards.map(({ album, i, px, py, pz, scale, depth, z }) => (
            <FannedCard
              key={`${album.id}-${i}`}
              album={album}
              i={i}
              px={px}
              py={py}
              pz={pz}
              scale={scale}
              depth={depth}
              z={z}
              cardSize={cardSize}
              hoverPullX={HOVER_PULL_X * (cardSize / CARD_BASE)}
              isHovered={hoveredCard === i}
              isOpening={openingAlbumId === album.id}
              onHoverStart={onCardHoverStart}
              onHoverMove={onCardHoverMove}
              onHoverEnd={onCardHoverEnd}
              onSelect={onCardSelect}
            />
          ))}
        </div>
      </div>
      <div
        ref={hoverLabelRef}
        className={`ribbon-hover-label${isHoverLabelVisible ? " is-visible" : ""}`}
        aria-hidden
      >
        {hoverLabelText}
      </div>
    </div>
  );
}
