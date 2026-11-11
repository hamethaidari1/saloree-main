import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmRequest {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Label for the dismiss button (default "Cancel"). */
  cancelLabel?: string;
  destructive?: boolean;
  run: () => Promise<unknown>;
}

/** One dialog per screen; pass the pending request or null. */
export function ConfirmDialog({
  request,
  busy,
  onClose,
}: {
  request: ConfirmRequest | null;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{request?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={
              request?.destructive ? buttonVariants({ variant: "destructive" }) : undefined
            }
            onClick={async (e) => {
              e.preventDefault();
              if (!request) return;
              try {
                await request.run();
              } catch {
                /* The action's own error toast reports failures. */
              } finally {
                onClose();
              }
            }}
          >
            {busy ? "Working…" : request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
