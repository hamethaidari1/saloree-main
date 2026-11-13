import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HERO_SIZES,
  HERO_SLIDES,
  type HeroSlide,
  type ResponsiveImage,
  type VideoSlide,
} from "@/data/hero-slides";
import { useCarousel, useMotionPreferences } from "@/hooks/use-carousel";
import { dirFor } from "@/i18n/locales";
import { useLocale } from "@/i18n/hooks";
import { autoAdvanceDelay, keyToAction, swipeToDelta } from "@/lib/carousel";

function HeroImage({ image, alt, eager }: { image: ResponsiveImage; alt: string; eager: boolean }) {
  return (
    <img
      className="hero-media"
      src={image.src}
      srcSet={image.srcSet}
      sizes={HERO_SIZES}
      width={image.width}
      height={image.height}
      alt={alt}
      decoding="async"
      {...(eager ? { fetchPriority: "high" as const } : { loading: "lazy" as const })}
    />
  );
}

/**
 * Muted, inline, no controls, no loop. Nothing is downloaded until this slide
 * is showing or next (preload="none" + poster before that). Plays only while
 * the slide is active and the carousel isn't held; a load error falls back to
 * the poster (reported through onFailed).
 */
function HeroVideo({
  slide,
  active,
  upcoming,
  playing,
  label,
  onEnded,
  onFailed,
}: {
  slide: VideoSlide;
  active: boolean;
  upcoming: boolean;
  playing: boolean;
  label: string;
  onEnded: () => void;
  onFailed: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Start from the beginning each time the slide comes back.
  useEffect(() => {
    const v = ref.current;
    if (v && active) v.currentTime = 0;
  }, [active]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && playing) {
      v.muted = true; // the property must be set for autoplay to be allowed
      void v.play().catch(() => {
        /* autoplay refused: the poster stays, the max-duration timer moves on */
      });
    } else v.pause();
  }, [active, playing]);
  return (
    <video
      ref={ref}
      className="hero-media"
      src={slide.video.src}
      poster={slide.poster.src}
      width={slide.video.width}
      height={slide.video.height}
      muted
      playsInline
      preload={active || upcoming ? "auto" : "none"}
      disablePictureInPicture
      disableRemotePlayback
      aria-label={label}
      onEnded={onEnded}
      onError={onFailed}
    />
  );
}

/**
 * Home page hero: 3 slides (two images, one video). Auto-advances (images 6 s,
 * the video when it ends, max 15 s), holds on hover, focus, hidden tab or when
 * scrolled away, and has a real Pause/Play button. Reduced motion or Save-Data:
 * posters only and no auto-advance until the visitor presses Play.
 */
export function HeroCarousel({ slides = HERO_SLIDES }: { slides?: readonly HeroSlide[] }) {
  const { t } = useTranslation("home");
  const dir = dirFor(useLocale());
  const motion = useMotionPreferences();
  const quiet = motion.reducedMotion || motion.saveData;
  const [optedIn, setOptedIn] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const count = slides.length;

  const carousel = useCarousel({
    count,
    stoppedByDefault: quiet,
    delayFor: (i) => {
      const s = slides[i];
      return s ? autoAdvanceDelay(s.kind, !!failed[s.id]) : null;
    },
  });
  const { index, goTo, next, prev, stopped, setStopped, held } = carousel;
  const videoAllowed = !quiet || optedIn;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const action = keyToAction(e.key, dir);
    if (action == null) return;
    e.preventDefault();
    if (action === "first") goTo(0);
    else if (action === "last") goTo(count - 1);
    else if (action === 1) next();
    else prev();
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const delta = swipeToDelta(e.clientX - start.x, e.clientY - start.y, dir);
    if (delta === 1) next();
    else if (delta === -1) prev();
  };
  const togglePlay = () => {
    if (stopped && quiet) setOptedIn(true); // the visitor asked for motion
    setStopped(!stopped);
  };

  // RTL: the track moves the other way (the next slide is on the left).
  const offset = (dir === "rtl" ? 1 : -1) * index * 100;

  return (
    <section
      ref={carousel.rootRef}
      className="home-hero"
      aria-roledescription={t("carousel.roledescription")}
      aria-label={t("carousel.label")}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
      {...carousel.holdHandlers}
    >
      <div
        className="hero-track"
        style={{ transform: `translateX(${offset}%)` }}
        // Announce slide changes only when they are the visitor's own doing.
        aria-live={stopped ? "polite" : "off"}
      >
        {slides.map((slide, i) => {
          const active = i === index;
          const label = t(slide.altKey);
          const Title = i === 0 ? "h1" : "h2";
          return (
            <div
              key={slide.id}
              className="hero-slide"
              data-slide={slide.id}
              data-kind={slide.kind}
              role="group"
              aria-roledescription={t("carousel.slide")}
              aria-label={t("carousel.slideLabel", { number: i + 1, total: count })}
              aria-hidden={!active}
              inert={!active}
            >
              {slide.kind === "image" ? (
                <HeroImage image={slide.image} alt={label} eager={i === 0} />
              ) : videoAllowed && !failed[slide.id] ? (
                <HeroVideo
                  slide={slide}
                  active={active}
                  upcoming={i === (index + 1) % count}
                  playing={!held}
                  label={label}
                  onEnded={() => {
                    if (!held) next();
                  }}
                  onFailed={() => setFailed((f) => ({ ...f, [slide.id]: true }))}
                />
              ) : (
                <HeroImage image={slide.poster} alt={label} eager={false} />
              )}
              {slide.copy && <span className="hero-scrim" aria-hidden="true" />}
              <div className={slide.copy ? "hero-content" : "hero-content hero-content-cta-only"}>
                {slide.copy?.eyebrowKey && (
                  <span className="eyebrow">
                    <Sparkles size={12} aria-hidden />
                    {t(slide.copy.eyebrowKey)}
                  </span>
                )}
                {slide.copy && (
                  <Title className="hero-title">
                    {t(slide.copy.titleKeys[0])}
                    {slide.copy.titleKeys[1] && (
                      <>
                        <br />
                        <span>{t(slide.copy.titleKeys[1])}</span>
                      </>
                    )}
                  </Title>
                )}
                {slide.copy?.textKey && <p>{t(slide.copy.textKey)}</p>}
                <Button asChild size="lg" className="hero-cta">
                  <Link to={slide.link}>
                    {t(slide.ctaKey)}
                    <ArrowRight size={15} className="rtl:-scale-x-100" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="hero-arrow hero-arrow-prev"
        aria-label={t("carousel.previous")}
        onClick={prev}
      >
        <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
      </button>
      <button
        type="button"
        className="hero-arrow hero-arrow-next"
        aria-label={t("carousel.next")}
        onClick={next}
      >
        <ChevronRight aria-hidden className="rtl:-scale-x-100" />
      </button>

      <div className="hero-controls">
        <div className="hero-index">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              className="hero-dot"
              aria-label={t("carousel.dot", { number: i + 1, total: count })}
              aria-current={i === index ? "true" : undefined}
              onClick={() => goTo(i)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="hero-toggle"
          aria-label={stopped ? t("carousel.play") : t("carousel.pause")}
          onClick={togglePlay}
        >
          {stopped ? <Play aria-hidden /> : <Pause aria-hidden />}
        </button>
      </div>
    </section>
  );
}
