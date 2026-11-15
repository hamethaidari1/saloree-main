import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { shouldNotify } from "@/lib/support";
import { supportService } from "@/services/support";
import { englishSupportT } from "./support-text";
import {
  getActiveThread,
  playPing,
  readSoundPref,
  refreshSupport,
  useTitleCount,
  useUnreadCounts,
} from "./use-support";

function Notifier({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { t } = useTranslation("support");
  // Seller and staff screens are English; elsewhere the site's language.
  const english = useRouterState({
    select: (s) => /^\/(seller|admin)(\/|$)/.test(s.location.pathname),
  });
  const text = useRef("");
  text.current = english ? englishSupportT()("newMessageFromTeam") : t("newMessageFromTeam");
  const counts = useUnreadCounts(userId);
  useTitleCount(counts.data?.mine ?? 0);

  useEffect(() => {
    const announced = new Map<string, string>();
    return supportService.subscribeThreads(`notify-${userId}`, {
      onThread: (thread) => {
        void refreshSupport(qc);
        if (!shouldNotify(thread, userId, getActiveThread(), announced)) return;
        // Only this sentence: never the message, the subject or the sender.
        toast(text.current);
        if (readSoundPref()) playPing();
      },
      // Every (re)connection: refresh, so nothing changed meanwhile is missed.
      onSync: () => void refreshSupport(qc),
    });
  }, [userId, qc]);
  return null;
}

/** Live badges, toasts and the title count for whoever is signed in. */
export function SupportNotifier() {
  const { user } = useAuth();
  return user ? <Notifier userId={user.id} /> : null;
}

/** A small count badge (hidden from screen readers: the link's label says it). */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="nav-count support-badge" aria-hidden data-testid="unread-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}
