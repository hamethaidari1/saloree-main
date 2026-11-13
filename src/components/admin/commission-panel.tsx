import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commissionSchema } from "@/services/admin";
import { friendlyError } from "@/services/errors";
import { financeService, type CommissionInfo } from "@/services/finance";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { useAdminAction } from "./use-admin-action";

const MISSING_TABLE =
  "The platform_settings table hasn't been created yet. Apply the reviewed SQL, then reload.";

function changedBy(info: CommissionInfo) {
  if (!info.updatedBy) return "";
  const who = info.updatedBy.isMe
    ? "you"
    : (info.updatedBy.name ?? info.updatedBy.email ?? "a staff member");
  return ` by ${who}`;
}

/** Platform commission (admin and finance staff). */
export function CommissionPanel() {
  const settings = useQuery({
    queryKey: adminKeys.settings,
    queryFn: financeService.getCommission,
    retry: false,
  });
  const save = useAdminAction((value: number) => financeService.setCommission(value), {
    success: (v) => `Commission set to ${v}%`,
    errors: { PGRST205: MISSING_TABLE },
  });

  return (
    <section className="seller-card admin-commission" aria-labelledby="admin-commission-heading">
      <h2 id="admin-commission-heading" className="text-lg font-semibold">
        Platform commission
      </h2>
      <p className="seller-hint mb-6">
        The percentage Saloree keeps from each sale. It is copied onto each order when the order is
        placed, so a change applies to new orders only.
      </p>
      {settings.isPending ? (
        <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
          <div />
        </div>
      ) : settings.isError ? (
        <div role="alert" className="seller-empty">
          <h3>The commission setting could not be loaded.</h3>
          <p>{friendlyError(settings.error, { PGRST205: MISSING_TABLE })}</p>
          <Button variant="outline" size="sm" onClick={() => settings.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <CommissionForm
          key={settings.data.updatedAt}
          info={settings.data}
          busy={save.isPending}
          onSave={(v) => save.mutateAsync(v)}
        />
      )}
    </section>
  );
}

function CommissionForm({
  info,
  busy,
  onSave,
}: {
  info: CommissionInfo;
  busy: boolean;
  onSave: (value: number) => Promise<unknown>;
}) {
  const [value, setValue] = useState(String(info.percent));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const parsed = commissionSchema.safeParse(value);
  const unchanged = parsed.success && parsed.data === info.percent;
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid value.");
        setError(null);
        const next = parsed.data;
        setConfirm({
          title: `Change commission to ${next}%?`,
          description: `It applies to NEW orders only. Orders already placed keep the commission they were placed with (now ${info.percent}%).`,
          confirmLabel: "Change commission",
          run: () => onSave(next),
        });
      }}
    >
      <div className="seller-field">
        <Label htmlFor="commission">Commission (%)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="commission"
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            className="max-w-32"
            value={value}
            aria-invalid={!!error}
            aria-describedby="commission-help"
            onChange={(e) => setValue(e.target.value)}
          />
          <span aria-hidden>%</span>
        </div>
        <p id="commission-help" className={error ? "seller-error" : "seller-hint"}>
          {error ??
            (parsed.success
              ? `On a $100.00 sale the platform keeps $${parsed.data.toFixed(2)}.`
              : "Between 0 and 100, up to two decimals.")}
        </p>
        <p className="seller-hint">
          Last changed {new Date(info.updatedAt).toLocaleString()}
          {changedBy(info)}.
        </p>
      </div>
      <div>
        <Button type="submit" disabled={busy || unchanged}>
          {busy ? "Saving…" : "Save commission"}
        </Button>
      </div>
      <ConfirmDialog request={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </form>
  );
}
