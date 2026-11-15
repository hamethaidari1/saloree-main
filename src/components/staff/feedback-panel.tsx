import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_STATUSES,
  feedbackErrorText,
  feedbackKeys,
  feedbackService,
  type FeedbackRow,
  type FeedbackStatus,
} from "@/services/feedback";

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
};

const ACTIONS: Record<FeedbackStatus, { to: FeedbackStatus; label: string; done: string }[]> = {
  new: [
    { to: "read", label: "Mark read", done: "Marked as read" },
    { to: "archived", label: "Archive", done: "Archived" },
  ],
  read: [
    { to: "archived", label: "Archive", done: "Archived" },
    { to: "new", label: "Mark new again", done: "Marked as new" },
  ],
  archived: [
    { to: "read", label: "Mark read", done: "Marked as read" },
    { to: "new", label: "Mark new again", done: "Marked as new" },
  ],
};

function FeedbackItem({ row }: { row: FeedbackRow }) {
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: (to: FeedbackStatus) => feedbackService.mark(row.id, to),
    onSuccess: async (_d, to) => {
      toast.success(ACTIONS[row.status].find((a) => a.to === to)?.done ?? "Saved");
      await qc.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
  return (
    <li className="feedback-item" data-testid="feedback-item">
      {/* Shown as text only: never interpreted as HTML or Markdown. */}
      <p className="feedback-message" dir="auto">
        {row.message}
      </p>
      <dl className="feedback-meta">
        <div>
          <dt>Page</dt>
          <dd dir="ltr">
            <code>{row.page_path || "—"}</code>
          </dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{row.locale || "—"}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>
            <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
          </dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>
            {row.contact_email ? (
              <a href={`mailto:${row.contact_email}`} dir="ltr">
                {row.contact_email}
              </a>
            ) : (
              "Not given"
            )}
          </dd>
        </div>
        <div>
          <dt>Signed in</dt>
          <dd>
            {row.user_id ? (
              <code title="User id (shortened)">{row.user_id.slice(0, 8)}</code>
            ) : (
              "No"
            )}
          </dd>
        </div>
      </dl>
      <div className="feedback-actions">
        {ACTIONS[row.status].map((a) => (
          <Button
            key={a.to}
            size="sm"
            variant={a.to === "archived" ? "ghost" : "outline"}
            disabled={mark.isPending}
            onClick={() => mark.mutate(a.to)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {mark.isError && (
        <p role="alert" className="seller-error">
          {feedbackErrorText(mark.error)}
        </p>
      )}
    </li>
  );
}

/** Feedback from the site's side widget (admin and content_admin). */
export function FeedbackPanel() {
  const [status, setStatus] = useState<FeedbackStatus>("new");
  const counts = useQuery({
    queryKey: feedbackKeys.counts,
    queryFn: feedbackService.counts,
    retry: false,
  });
  const list = useInfiniteQuery({
    queryKey: feedbackKeys.list(status),
    queryFn: ({ pageParam }) => feedbackService.list(status, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
    retry: false,
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];
  const nextPageError = list.isFetchNextPageError ? list.error : null;

  return (
    <section aria-labelledby="feedback-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="feedback-heading">Feedback</h2>
          <p>Messages sent from the Feedback button on the site, newest first.</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="Filter by status" className="seller-segmented mb-4">
        {FEEDBACK_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABEL[s]}
            {counts.isSuccess && (
              <span className="verify-count" aria-label={`${counts.data[s]} messages`}>
                {counts.data[s]}
              </span>
            )}
          </button>
        ))}
      </div>
      {counts.isError && (
        <p role="alert" className="seller-error mb-3">
          Counts could not be loaded: {feedbackErrorText(counts.error)}
        </p>
      )}

      {list.isPending ? (
        <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
          <div />
          <div />
        </div>
      ) : list.isError ? (
        <div role="alert" className="seller-empty">
          <h3>Feedback could not be loaded.</h3>
          <p>{feedbackErrorText(list.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : !rows.length ? (
        <div className="seller-empty">
          <h3>No {STATUS_LABEL[status].toLowerCase()} feedback</h3>
          <p>Messages appear here when visitors use the Feedback button.</p>
        </div>
      ) : (
        <>
          <ul className="feedback-list">
            {rows.map((r) => (
              <FeedbackItem key={r.id} row={r} />
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
          {nextPageError && (
            <p role="alert" className="seller-error mt-2">
              {feedbackErrorText(nextPageError)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
