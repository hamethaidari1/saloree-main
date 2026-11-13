/**
 * Pure carousel rules (no React): stepping, keyboard/swipe mapping in either
 * reading direction, and how long a slide stays before auto-advancing.
 */

/** Image slides advance after this long. */
export const IMAGE_SLIDE_MS = 6000;
/** A video slide advances when the video ends, but never later than this. */
export const VIDEO_SLIDE_MAX_MS = 15000;
/** Horizontal finger movement (px) that counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 40;

export type Direction = "ltr" | "rtl";

/** Index `delta` steps away, wrapping around. */
export function step(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * Left/Right arrow keys → -1/+1. In RTL the next slide is to the left, so the
 * keys swap. Home/End jump to the first/last slide (returned as "first"/"last").
 */
export function keyToAction(key: string, dir: Direction): -1 | 1 | "first" | "last" | null {
  if (key === "Home") return "first";
  if (key === "End") return "last";
  const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  if (key === forward) return 1;
  if (key === back) return -1;
  return null;
}

/** A horizontal swipe → -1/+1 (finger moving toward the inline start = next). */
export function swipeToDelta(dx: number, dy: number, dir: Direction): -1 | 1 | null {
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return null;
  const towardStart = dir === "rtl" ? dx > 0 : dx < 0;
  return towardStart ? 1 : -1;
}

/**
 * How long the slide stays before auto-advancing, or null when it must not
 * auto-advance (a video that failed to load waits for the visitor).
 */
export function autoAdvanceDelay(kind: "image" | "video", videoFailed = false): number | null {
  if (kind === "image") return IMAGE_SLIDE_MS;
  return videoFailed ? null : VIDEO_SLIDE_MAX_MS;
}

/** Why auto-rotation is currently held, if at all. */
export interface PauseState {
  /** The visitor pressed Pause (or prefers reduced motion / Save-Data). */
  stopped: boolean;
  hovered: boolean;
  focusWithin: boolean;
  tabHidden: boolean;
  offScreen: boolean;
}
export const isHeld = (s: PauseState) =>
  s.stopped || s.hovered || s.focusWithin || s.tabHidden || s.offScreen;
