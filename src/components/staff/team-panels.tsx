import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelState } from "@/components/seller/panel-state";
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog";
import { adminKeys } from "@/components/admin/keys";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { STAFF_ROLES, type StaffRole } from "@/lib/staff-access";
import {
  AUDIT_PAGE_SIZE,
  AUDITED_TABLES,
  auditService,
  describeChanges,
  EMPTY_AUDIT_FILTER,
  type AuditFilter,
} from "@/services/audit";
import { addStaffSchema, STAFF_ROLE_LABELS, teamService, type StaffMember } from "@/services/team";
import { LoadError } from "./marketplace-panels";

const teamKey = [...adminKeys.all, "team"] as const;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
export function TeamPanel({ myUserId }: { myUserId: string }) {
  const staff = useQuery({ queryKey: teamKey, queryFn: teamService.listStaff });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("content_admin");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const add = useAdminAction((v: { email: string; role: StaffRole }) => teamService.addRole(v), {
    success: (v) =>
      `${STAFF_ROLE_LABELS[v.role]} given to ${v.email}. It takes effect when they sign in again.`,
  });
  const remove = useAdminAction(
    (v: { member: StaffMember; role: StaffRole }) =>
      teamService.removeRole(v.member.userId, v.role),
    {
      success: (v) =>
        `${STAFF_ROLE_LABELS[v.role]} removed from ${v.member.name ?? v.member.email}`,
    },
  );

  return (
    <section aria-labelledby="team-heading" className="grid gap-6">
      <div className="seller-panel-head">
        <div>
          <h2 id="team-heading">Team</h2>
          <p>Everyone with a staff role. Changes take effect at their next sign-in.</p>
        </div>
      </div>
      <form
        className="seller-card staff-add-role"
        noValidate
        aria-label="Give a staff role"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = addStaffSchema.safeParse({ email, role });
          if (!parsed.success)
            return setError(parsed.error.issues[0]?.message ?? "Check the email.");
          setError(null);
          try {
            await add.mutateAsync(parsed.data);
            setEmail("");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not add the role.");
          }
        }}
      >
        <div className="seller-field">
          <Label htmlFor="team-email">Email of a registered person</Label>
          <Input
            id="team-email"
            type="email"
            autoComplete="off"
            value={email}
            aria-invalid={!!error}
            aria-describedby="team-email-help"
            onChange={(e) => setEmail(e.target.value)}
          />
          <p
            id="team-email-help"
            className={error ? "seller-error" : "seller-hint"}
            role={error ? "alert" : undefined}
          >
            {error ?? "They must have signed up on Saloree first."}
          </p>
        </div>
        <div className="seller-field">
          <Label htmlFor="team-role">Role</Label>
          <select
            id="team-role"
            className="staff-select"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {STAFF_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="self-end">
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add role"}
          </Button>
        </div>
      </form>
      <PanelState
        query={staff}
        errorText="The team could not be loaded."
        empty={{ title: "No staff yet", description: "Give someone a staff role above." }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((m) => (
              <li key={m.userId} className="seller-row">
                <div className="min-w-0 flex-1">
                  <h3 className="seller-row-title">
                    {m.name ?? "No name"}
                    {m.userId === myUserId && <span className="staff-own"> (you)</span>}
                  </h3>
                  <p className="seller-row-meta">
                    <bdi>{m.email ?? "No email"}</bdi>
                  </p>
                  <ul className="staff-chips" aria-label="Roles">
                    {m.roles.map((r) => {
                      const self = m.userId === myUserId && r.role === "admin";
                      return (
                        <li key={r.role}>
                          <Badge variant="secondary">{STAFF_ROLE_LABELS[r.role]}</Badge>
                          <span className="staff-since">
                            since {r.since ? new Date(r.since).toLocaleDateString() : "—"}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="staff-chip-remove"
                            aria-label={`Remove ${STAFF_ROLE_LABELS[r.role]} from ${m.name ?? m.email}`}
                            title={self ? "You can't remove your own admin role" : "Remove role"}
                            disabled={self || remove.isPending}
                            onClick={() =>
                              setConfirm({
                                title: `Remove ${STAFF_ROLE_LABELS[r.role]}?`,
                                description: `${m.name ?? m.email} loses this access at their next sign-in.`,
                                confirmLabel: "Remove role",
                                destructive: true,
                                run: () => remove.mutateAsync({ member: m, role: r.role }),
                              })
                            }
                          >
                            <X size={14} />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelState>
      <ConfirmDialog request={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export function AuditLogPanel() {
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  const [page, setPage] = useState(0);
  const staff = useQuery({ queryKey: teamKey, queryFn: teamService.listStaff });
  const log = useQuery({
    queryKey: [...adminKeys.all, "audit", page, filter],
    queryFn: () => auditService.list(page, filter),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const set = (k: keyof AuditFilter, v: string) => {
    setFilter((f) => ({ ...f, [k]: v }));
    setPage(0);
  };
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / AUDIT_PAGE_SIZE)) : 1;
  return (
    <section aria-labelledby="audit-heading" className="grid gap-4">
      <div className="seller-panel-head">
        <div>
          <h2 id="audit-heading">Audit log</h2>
          <p>Every change made by staff, newest first. Written by the database; read only.</p>
        </div>
      </div>
      <div
        className="staff-filters staff-filters-wrap"
        role="group"
        aria-label="Filter the audit log"
      >
        <select
          aria-label="Who"
          className="staff-select"
          value={filter.actorId}
          onChange={(e) => set("actorId", e.target.value)}
        >
          <option value="">Everyone</option>
          {(staff.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name ?? m.email ?? m.userId}
            </option>
          ))}
        </select>
        <select
          aria-label="Table"
          className="staff-select"
          value={filter.table}
          onChange={(e) => set("table", e.target.value)}
        >
          <option value="">All tables</option>
          {AUDITED_TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="staff-date">
          From
          <Input type="date" value={filter.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="staff-date">
          To
          <Input type="date" value={filter.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFilter(EMPTY_AUDIT_FILTER);
            setPage(0);
          }}
        >
          Clear
        </Button>
      </div>
      {log.isPending ? (
        <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
          <div />
          <div />
        </div>
      ) : log.isError ? (
        <LoadError what="The audit log" error={log.error} retry={() => log.refetch()} />
      ) : !log.data.rows.length ? (
        <div className="seller-empty">
          <h3>No changes found</h3>
          <p>Staff changes appear here as soon as they are made.</p>
        </div>
      ) : (
        <>
          <div className="staff-table-wrap">
            <table className="seller-order-table staff-audit">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Table</th>
                  <th scope="col">Action</th>
                  <th scope="col">Changes (before → after)</th>
                </tr>
              </thead>
              <tbody>
                {log.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString()}</time>
                    </td>
                    <td>
                      {r.actor?.name ??
                        r.actor?.email ??
                        (r.actor_id ? r.actor_id.slice(0, 8) : "system")}
                      {r.actor?.email && r.actor.name && (
                        <bdi className="block text-muted-foreground">{r.actor.email}</bdi>
                      )}
                      {r.actor_roles?.length ? (
                        <span className="block text-xs text-muted-foreground">
                          {r.actor_roles.join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {r.table_name}
                      {r.row_id && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {r.row_id.slice(0, 13)}
                        </span>
                      )}
                    </td>
                    <td>
                      <Badge
                        variant={
                          r.action === "DELETE"
                            ? "destructive"
                            : r.action === "INSERT"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {r.action}
                      </Badge>
                    </td>
                    <td>
                      <ul className="staff-diff">
                        {describeChanges(r.action, r.changes).map((c) => (
                          <li key={c.field}>
                            <strong>{c.field}</strong>:{" "}
                            <bdi className="staff-diff-old">{c.before}</bdi> →{" "}
                            <bdi className="staff-diff-new">{c.after}</bdi>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="staff-pager" aria-label="Audit log pages">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || log.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              Newer
            </Button>
            <span>
              Page {page + 1} of {pages} · {log.data.total} change{log.data.total === 1 ? "" : "s"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages || log.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
