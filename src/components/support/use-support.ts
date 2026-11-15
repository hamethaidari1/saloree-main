import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { mergeMessages, titleWithCount } from "@/lib/support";
import { supportKeys, supportService, type SupportMessage } from "@/services/support";

/** support_unread_counts(): { mine, staff }, refreshed live by the notifier. */
export function useUnreadCounts(userId: string | null | undefined) {
  return useQuery({
    queryKey: supportKeys.unread(userId ?? ""),
    queryFn: supportService.unreadCounts,
    enabled: !!userId,
    retry: false,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Messages of one thread: fetch + live inserts, merged without duplicates
// ---------------------------------------------------------------------------
/** A live insert: added once, in order. */
export const applyLiveMessage = (cache: SupportMessage[] | undefined, m: SupportMessage) =>
  mergeMessages(cache, [m]);

/**
 * A (re)fetch: what the server has now, plus anything that arrived live in
 * the meantime (so a message received during the request is never dropped).
 */
export const applyFetch = (cache: SupportMessage[] | undefined, fetched: SupportMessage[]) =>
  mergeMessages(cache, fetched);

export function useThreadMessages(threadId: string, onLive?: (m: SupportMessage) => void) {
  const qc = useQueryClient();
  const live = useRef(onLive);
  live.current = onLive;
  const query = useQuery({
    queryKey: supportKeys.messages(threadId),
    queryFn: async () =>
      applyFetch(
        qc.getQueryData<SupportMessage[]>(supportKeys.messages(threadId)),
        await supportService.messages(threadId),
      ),
    retry: false,
  });
  useEffect(() => {
    const key = supportKeys.messages(threadId);
    return supportService.subscribeMessages(threadId, {
      onMessage: (m) => {
        qc.setQueryData<SupportMessage[]>(key, (old) => applyLiveMessage(old, m));
        live.current?.(m);
      },
      // Every (re)connection: fetch, so a gap never loses a message.
      onSync: () => void qc.invalidateQueries({ queryKey: key }),
    });
  }, [threadId, qc]);
  return query;
}

/** After reading or writing: badges and lists refresh. */
export const refreshSupport = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["support", "unread"] }),
    qc.invalidateQueries({ queryKey: ["support", "threads"] }),
    qc.invalidateQueries({ queryKey: ["support", "last"] }),
  ]);

// ---------------------------------------------------------------------------
// Which conversation is on screen (no toast for it)
// ---------------------------------------------------------------------------
let activeThread: string | null = null;
export const setActiveThread = (id: string | null) => {
  activeThread = id;
};
export const getActiveThread = () => activeThread;

// ---------------------------------------------------------------------------
// Sound (off by default; the one preference kept in localStorage)
// ---------------------------------------------------------------------------
export const SOUND_KEY = "saloree-support-sound";
export function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeSoundPref(on: boolean) {
  try {
    if (on) window.localStorage.setItem(SOUND_KEY, "1");
    else window.localStorage.removeItem(SOUND_KEY);
  } catch {
    /* storage unavailable: the toggle works for this page only */
  }
}
/** A short, quiet two-tone ping (Web Audio; no file, no permission). */
export function playPing() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    gain.connect(ctx.destination);
    for (const [freq, at] of [
      [880, 0],
      [1175, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    }
    window.setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio blocked: stay silent */
  }
}

// ---------------------------------------------------------------------------
// "(1) Page title" while there are unread messages (a count, never text)
// ---------------------------------------------------------------------------
export function useTitleCount(count: number) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = () => {
      const next = titleWithCount(document.title, count);
      if (next !== document.title) document.title = next;
    };
    apply();
    // The router replaces the title on navigation: put the count back.
    const title = document.querySelector("title");
    const observer = title ? new MutationObserver(apply) : null;
    if (title) observer?.observe(title, { childList: true, characterData: true, subtree: true });
    return () => {
      observer?.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [count]);
}
