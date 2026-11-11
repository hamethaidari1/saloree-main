import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelState } from "@/components/seller/panel-state";
import { useAuth } from "@/lib/auth";
import { adminService, type AdminUser, type ManagedRole } from "@/services/admin";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { matches, useAdminAction } from "./use-admin-action";

type RoleChange = { user: AdminUser; role: ManagedRole; grant: boolean };
const who = (u: AdminUser) => u.full_name || u.email || "this user";

export function UsersPanel() {
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: adminKeys.users, queryFn: adminService.listUsers });
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const change = useAdminAction(
    ({ user, role, grant }: RoleChange) =>
      grant ? adminService.addRole(user.id, role) : adminService.removeRole(user.id, role),
    {
      success: ({ user, role, grant }) =>
        `${who(user)} ${grant ? "is now" : "is no longer"} ${role === "admin" ? "an admin" : "a seller"}`,
      errors: { "23505": "That user already has this role." },
    },
  );

  const request = (c: RoleChange) => {
    const name = who(c.user);
    if (c.role === "admin")
      return setConfirm({
        title: c.grant ? `Make ${name} an admin?` : `Remove admin access from ${name}?`,
        description: c.grant
          ? "Admins can publish stores, delete any product, change categories and manage every user's roles."
          : "They will lose access to the admin panel immediately.",
        confirmLabel: c.grant ? "Make admin" : "Remove admin",
        destructive: !c.grant,
        run: () => change.mutateAsync(c),
      });
    if (!c.grant)
      return setConfirm({
        title: `Remove the seller role from ${name}?`,
        description:
          "They will lose access to the seller dashboard. Their stores and products are not deleted.",
        confirmLabel: "Remove seller",
        destructive: true,
        run: () => change.mutateAsync(c),
      });
    change.mutate(c);
  };

  return (
    <section aria-labelledby="admin-users-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-users-heading">Users</h2>
          <p>Grant or remove seller and admin roles.</p>
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder="Search name or email"
          aria-label="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PanelState
        query={users}
        errorText="Users could not be loaded."
        empty={{ title: "No users yet", description: "People appear here after they sign up." }}
      >
        {(all) => {
          const list = all.filter((u) => matches(search, u.full_name, u.email));
          if (!list.length) return <p className="seller-hint">No users match “{search}”.</p>;
          return (
            <ul className="seller-list">
              {list.map((u) => {
                const isSeller = u.roles.includes("seller");
                const isAdmin = u.roles.includes("admin");
                const isMe = u.id === me?.id;
                const busy = change.isPending && change.variables?.user.id === u.id;
                return (
                  <li key={u.id} className="seller-row">
                    <div className="min-w-0 flex-1">
                      <h3 className="seller-row-title">
                        {u.full_name || u.email || u.id}
                        {isMe && <span className="seller-row-meta">(you)</span>}
                      </h3>
                      <p className="seller-row-meta">
                        {u.email}
                        <span aria-hidden>·</span>
                        Joined {new Date(u.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1" aria-label="Roles">
                      {u.roles.length ? (
                        u.roles.map((r) => (
                          <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                            {r}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline">no role</Badge>
                      )}
                    </div>
                    <div className="seller-row-actions gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => request({ user: u, role: "seller", grant: !isSeller })}
                      >
                        {isSeller ? "Remove seller" : "Make seller"}
                      </Button>
                      <Button
                        size="sm"
                        variant={isAdmin ? "outline" : "ghost"}
                        disabled={busy || (isAdmin && isMe)}
                        title={isAdmin && isMe ? "You can't remove your own admin role" : undefined}
                        onClick={() => request({ user: u, role: "admin", grant: !isAdmin })}
                      >
                        {isAdmin ? "Remove admin" : "Make admin"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </PanelState>
      <ConfirmDialog request={confirm} busy={change.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}
