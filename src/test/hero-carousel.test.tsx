import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { renderWithRouter } from "./router-harness";
import { resourcesFor, WithLocale } from "./i18n";
import { createSupabaseMock } from "./supabase-mock";

vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  return { supabase: create().supabase };
});
void createSupabaseMock;

import { HERO_SLIDES } from "@/data/hero-slides";
import { HeroCarousel } from "@/components/marketplace/hero-carousel";
import {
  autoAdvanceDelay,
  IMAGE_SLIDE_MS,
  isHeld,
  keyToAction,
  step,
  swipeToDelta,
  VIDEO_SLIDE_MAX_MS,
} from "@/lib/carousel";
import { routeTree } from "@/routeTree.gen";
import type { Locale } from "@/i18n/locales";

// jsdom has no PointerEvent, so fireEvent.pointer* would lose pointerType.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom has no media playback.
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });

function setMotion({ reduce = false, saveData = false } = {}) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData } });
}

async function renderHero(locale: Locale = "en") {
  const view = renderWithRouter(
    <WithLocale locale={locale}>
      <HeroCarousel />
    </WithLocale>,
  );
  const hero = await screen.findByRole("region");
  await act(async () => {}); // let mount effects (motion preferences) run
  return { ...view, hero };
}
const slides = (hero: HTMLElement) => [...hero.querySelectorAll<HTMLElement>(".hero-slide")];
const activeIndex = (hero: HTMLElement) =>
  slides(hero).findIndex((s) => s.getAttribute("aria-hidden") === "false");
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  // Fake timers that still move with real time, so findBy/router waits work;
  // assertions leave a small margin for the few real ms a test takes.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
  setMotion();
  play.mockClear();
  pause.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("slides config", () => {
  const en = resourcesFor("en").home as Record<string, unknown>;
  const get = (key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], en);
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("has 3 slides: home image, stores image, promo video", () => {
    expect(HERO_SLIDES.map((s) => [s.id, s.kind])).toEqual([
      ["home", "image"],
      ["stores", "image"],
      ["promo", "video"],
    ]);
  });

  it.each(HERO_SLIDES.map((s) => [s.id, s]))(
    "%s: media, alt text, CTA and a real route",
    (_id, s) => {
      const media = s.kind === "image" ? s.image : s.poster;
      expect(media.src).toBeTruthy();
      expect(media.srcSet).toMatch(/ 640w/);
      expect(media.width).toBeGreaterThan(0);
      expect(media.height).toBeGreaterThan(0);
      if (s.kind === "video") {
        expect(s.video.src).toMatch(/\.mp4/);
        expect(s.video.type).toBe("video/mp4");
      }
      expect(typeof get(s.altKey)).toBe("string");
      expect((get(s.altKey) as string).length).toBeGreaterThan(20);
      expect(typeof get(s.ctaKey)).toBe("string");
      for (const k of s.copy ? [s.copy.eyebrowKey, ...s.copy.titleKeys, s.copy.textKey] : [])
        if (k) expect(typeof get(k), k).toBe("string");
      const matched = router.matchRoutes(s.link).map((m) => m.routeId);
      expect(
        matched.some((r) => r !== "__root__"),
        s.link,
      ).toBe(true);
    },
  );

  it("the video carries its own headline, so it gets a CTA only", () => {
    const video = HERO_SLIDES.find((s) => s.kind === "video")!;
    expect(video.copy).toBeUndefined();
  });

  it("image slides offer 640/1024/1600 widths; slide 1 keeps the current headline", () => {
    for (const s of HERO_SLIDES.filter((x) => x.kind === "image"))
      expect(s.kind === "image" && s.image.srcSet.match(/(\d+)w/g)).toEqual([
        "640w",
        "1024w",
        "1600w",
      ]);
    expect(HERO_SLIDES[0]!.copy?.titleKeys).toEqual(["hero.titleLine1", "hero.titleLine2"]);
    expect(get("hero.titleLine1")).toBe("Small stores.");
    expect(get("hero.titleLine2")).toBe("Wonderful discoveries.");
  });
});

describe("carousel rules (pure)", () => {
  it("steps and wraps", () => {
    expect(step(0, 3, 1)).toBe(1);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
  });
  it("arrow keys follow the reading direction", () => {
    expect(keyToAction("ArrowRight", "ltr")).toBe(1);
    expect(keyToAction("ArrowLeft", "ltr")).toBe(-1);
    expect(keyToAction("ArrowLeft", "rtl")).toBe(1);
    expect(keyToAction("ArrowRight", "rtl")).toBe(-1);
    expect(keyToAction("Home", "ltr")).toBe("first");
    expect(keyToAction("End", "rtl")).toBe("last");
    expect(keyToAction("Enter", "ltr")).toBeNull();
  });
  it("swipes: toward the inline start means next; small or vertical moves are ignored", () => {
    expect(swipeToDelta(-80, 5, "ltr")).toBe(1);
    expect(swipeToDelta(80, 5, "ltr")).toBe(-1);
    expect(swipeToDelta(80, 5, "rtl")).toBe(1);
    expect(swipeToDelta(-20, 0, "ltr")).toBeNull();
    expect(swipeToDelta(-60, 120, "ltr")).toBeNull();
  });
  it("delays: images 6 s, video up to 15 s, a failed video does not auto-advance", () => {
    expect(autoAdvanceDelay("image")).toBe(IMAGE_SLIDE_MS);
    expect(IMAGE_SLIDE_MS).toBe(6000);
    expect(autoAdvanceDelay("video")).toBe(VIDEO_SLIDE_MAX_MS);
    expect(VIDEO_SLIDE_MAX_MS).toBe(15000);
    expect(autoAdvanceDelay("video", true)).toBeNull();
  });
  it("any hold reason stops rotation", () => {
    const none = {
      stopped: false,
      hovered: false,
      focusWithin: false,
      tabHidden: false,
      offScreen: false,
    };
    expect(isHeld(none)).toBe(false);
    for (const k of Object.keys(none)) expect(isHeld({ ...none, [k]: true }), k).toBe(true);
  });
});

describe("HeroCarousel", () => {
  it("is a labelled carousel of groups '1 of 3' with dot buttons", async () => {
    const { hero } = await renderHero();
    expect(hero).toHaveAttribute("aria-roledescription", "carousel");
    expect(hero).toHaveAccessibleName("Highlights");
    const groups = within(hero).getAllByRole("group", { hidden: true });
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
    expect(groups.map((g) => g.getAttribute("aria-roledescription"))).toEqual([
      "slide",
      "slide",
      "slide",
    ]);
    const dots = within(hero).getAllByRole("button", { name: /^Slide \d of 3$/ });
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute("aria-current", "true");
    // Hidden slides can't be reached by keyboard.
    expect(groups[1]).toHaveAttribute("inert");
    expect(groups[1]).toHaveAttribute("aria-hidden", "true");
  });

  it("slide 1 image is eager + high priority (LCP); the others are lazy", async () => {
    const { hero } = await renderHero();
    const imgs = hero.querySelectorAll("img");
    expect(imgs[0]).toHaveAttribute("fetchpriority", "high");
    expect(imgs[0]).not.toHaveAttribute("loading");
    expect(imgs[0]).toHaveAttribute("width");
    expect(imgs[0]).toHaveAttribute("sizes");
    expect(imgs[1]).toHaveAttribute("loading", "lazy");
  });

  it("auto-advances every 6 s; the live region is off while rotating", async () => {
    const { hero } = await renderHero();
    expect(activeIndex(hero)).toBe(0);
    expect(hero.querySelector(".hero-track")).toHaveAttribute("aria-live", "off");
    await tick(5800);
    expect(activeIndex(hero)).toBe(0);
    await tick(200);
    expect(activeIndex(hero)).toBe(1);
  });

  it("holds while the mouse is over it, and while the tab is hidden", async () => {
    const { hero } = await renderHero();
    fireEvent.pointerEnter(hero, { pointerType: "mouse" });
    await tick(10_000);
    expect(activeIndex(hero)).toBe(0);
    fireEvent.pointerLeave(hero, { pointerType: "mouse" });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await tick(10_000);
    expect(activeIndex(hero)).toBe(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await tick(6000);
    expect(activeIndex(hero)).toBe(1);
  });

  it("Pause really stops rotation (and announces changes); Play resumes", async () => {
    const { hero } = await renderHero();
    fireEvent.click(within(hero).getByRole("button", { name: "Pause slideshow" }));
    expect(within(hero).getByRole("button", { name: "Play slideshow" })).toBeTruthy();
    expect(hero.querySelector(".hero-track")).toHaveAttribute("aria-live", "polite");
    await tick(30_000);
    expect(activeIndex(hero)).toBe(0);
    fireEvent.click(within(hero).getByRole("button", { name: "Play slideshow" }));
    await tick(6000);
    expect(activeIndex(hero)).toBe(1);
  });

  it("keyboard: Right/Left move, Home/End jump; reversed in RTL", async () => {
    const { hero } = await renderHero();
    fireEvent.keyDown(hero, { key: "ArrowRight" });
    expect(activeIndex(hero)).toBe(1);
    fireEvent.keyDown(hero, { key: "ArrowLeft" });
    expect(activeIndex(hero)).toBe(0);
    fireEvent.keyDown(hero, { key: "End" });
    expect(activeIndex(hero)).toBe(2);
    fireEvent.keyDown(hero, { key: "Home" });
    expect(activeIndex(hero)).toBe(0);
  });

  it("RTL: Left is next and the track moves the other way", async () => {
    const { hero } = await renderHero("ar");
    fireEvent.keyDown(hero, { key: "ArrowLeft" });
    expect(activeIndex(hero)).toBe(1);
    expect((hero.querySelector(".hero-track") as HTMLElement).style.transform).toBe(
      "translateX(100%)",
    );
  });

  it("arrows and dots navigate", async () => {
    const { hero } = await renderHero();
    fireEvent.click(within(hero).getByRole("button", { name: "Next slide" }));
    expect(activeIndex(hero)).toBe(1);
    fireEvent.click(within(hero).getByRole("button", { name: "Previous slide" }));
    expect(activeIndex(hero)).toBe(0);
    fireEvent.click(within(hero).getByRole("button", { name: "Slide 3 of 3" }));
    expect(activeIndex(hero)).toBe(2);
    expect(within(hero).getByRole("button", { name: "Slide 3 of 3" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("video: muted, inline, no controls/loop, not downloaded until it is next", async () => {
    const { hero } = await renderHero();
    const video = hero.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("loop");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("poster");
    expect(video).toHaveAttribute("preload", "none");
    fireEvent.click(within(hero).getByRole("button", { name: "Next slide" })); // video is now next
    expect(hero.querySelector("video")).toHaveAttribute("preload", "auto");
  });

  it("video plays only while its slide is showing, and advances when it ends", async () => {
    const { hero } = await renderHero();
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(within(hero).getByRole("button", { name: "Slide 3 of 3" }));
    await act(async () => {});
    expect(play).toHaveBeenCalled();
    fireEvent.ended(hero.querySelector("video")!);
    expect(activeIndex(hero)).toBe(0);
    expect(pause).toHaveBeenCalled();
  });

  it("video slide moves on after 15 s at most (e.g. if it never ends)", async () => {
    const { hero } = await renderHero();
    fireEvent.click(within(hero).getByRole("button", { name: "Slide 3 of 3" }));
    (document.activeElement as HTMLElement | null)?.blur();
    await tick(14_800);
    expect(activeIndex(hero)).toBe(2);
    await tick(200);
    expect(activeIndex(hero)).toBe(0);
  });

  it("a video that fails to load shows its poster and does not auto-advance", async () => {
    const { hero } = await renderHero();
    fireEvent.click(within(hero).getByRole("button", { name: "Slide 3 of 3" }));
    fireEvent.error(hero.querySelector("video")!);
    expect(hero.querySelector("video")).toBeNull();
    const poster = slides(hero)[2]!.querySelector("img")!;
    expect(poster.getAttribute("src")).toMatch(/poster/);
    expect(poster.getAttribute("alt")).toMatch(/Short video/);
    await tick(60_000);
    expect(activeIndex(hero)).toBe(2);
  });

  it.each([
    ["prefers-reduced-motion", { reduce: true }],
    ["Save-Data", { saveData: true }],
  ])("%s: poster only, no autoplay, no auto-advance until Play", async (_name, motion) => {
    setMotion(motion);
    const { hero } = await renderHero();
    expect(hero.querySelector("video")).toBeNull();
    expect(slides(hero)[2]!.querySelector("img")!.getAttribute("src")).toMatch(/poster/);
    expect(within(hero).getByRole("button", { name: "Play slideshow" })).toBeTruthy();
    await tick(30_000);
    expect(activeIndex(hero)).toBe(0);
    expect(play).not.toHaveBeenCalled();
    // The visitor opts in.
    fireEvent.click(within(hero).getByRole("button", { name: "Play slideshow" }));
    expect(hero.querySelector("video")).not.toBeNull();
    await tick(6000);
    expect(activeIndex(hero)).toBe(1);
  });

  it("cleans up timers and listeners on unmount", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = await renderHero();
    unmount();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    remove.mockRestore();
  });
});
