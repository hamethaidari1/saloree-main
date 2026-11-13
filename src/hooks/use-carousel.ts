import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";
import { isHeld, step } from "@/lib/carousel";

/**
 * Minimal carousel state: current slide, auto-advance timer and every reason
 * to hold it (Pause pressed, hover, focus inside, tab hidden, scrolled away).
 * `delayFor(index)` returns the slide's time on screen, or null for "don't
 * auto-advance this slide". Timers and observers are cleaned up on unmount.
 */
export function useCarousel({
  count,
  delayFor,
  stoppedByDefault = false,
}: {
  count: number;
  delayFor: (index: number) => number | null;
  stoppedByDefault?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(stoppedByDefault);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [offScreen, setOffScreen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // Reduced motion / Save-Data are only known after mount.
  useEffect(() => {
    if (stoppedByDefault) setStopped(true);
  }, [stoppedByDefault]);

  useEffect(() => {
    const update = () => setTabHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOffScreen(!entry || entry.intersectionRatio < 0.5),
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const held = isHeld({ stopped, hovered, focusWithin, tabHidden, offScreen });
  const delay = delayFor(index);

  const goTo = useCallback((i: number) => setIndex(step(i, count, 0)), [count]);
  const next = useCallback(() => setIndex((i) => step(i, count, 1)), [count]);
  const prev = useCallback(() => setIndex((i) => step(i, count, -1)), [count]);

  useEffect(() => {
    if (held || delay == null || count < 2) return;
    const timer = setTimeout(next, delay);
    return () => clearTimeout(timer);
  }, [held, delay, index, count, next]);

  return {
    index,
    goTo,
    next,
    prev,
    stopped,
    setStopped,
    held,
    rootRef,
    /** Spread on the carousel root. */
    holdHandlers: {
      // Mouse only: a tap on a phone should not freeze the slideshow.
      onPointerEnter: (e: { pointerType: string }) => e.pointerType === "mouse" && setHovered(true),
      onPointerLeave: (e: { pointerType: string }) =>
        e.pointerType === "mouse" && setHovered(false),
      onFocus: () => setFocusWithin(true),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      },
    },
  };
}

/** prefers-reduced-motion and Save-Data, read after mount (false on the server). */
export function useMotionPreferences() {
  const [prefs, setPrefs] = useState({ reducedMotion: false, saveData: false, ready: false });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const update = () =>
      setPrefs({ reducedMotion: !!mq?.matches, saveData: !!conn?.saveData, ready: true });
    update();
    mq?.addEventListener?.("change", update);
    return () => mq?.removeEventListener?.("change", update);
  }, []);
  return prefs;
}
