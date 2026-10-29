"use client";

import { useState } from "react";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { updateRolePermissionsAction } from "@/modules/settings/actions";
import type { ConfigurableRole, Permission, PERMISSION_GROUPS } from "@/server/permissions";

type RoleState = { role: ConfigurableRole; label: string; permissions: Permission[]; defaults: Permission[]; isDefault: boolean };

const sameSet = (a: Iterable<Permission>, b: Iterable<Permission>) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((p) => y.has(p));
};

export function PermissionsClient({ groups, roles }: { groups: typeof PERMISSION_GROUPS; roles: RoleState[] }) {
  const { run, pending } = useAction();
  const [values, setValues] = useState<Record<ConfigurableRole, Set<Permission>>>(
    () => Object.fromEntries(roles.map((r) => [r.role, new Set(r.permissions)])) as Record<ConfigurableRole, Set<Permission>>,
  );

  const toggle = (role: ConfigurableRole, permission: Permission, on: boolean) =>
    setValues((prev) => {
      const next = new Set(prev[role]);
      if (on) next.add(permission);
      else next.delete(permission);
      return { ...prev, [role]: next };
    });

  const changedRoles = roles.filter((r) => !sameSet(values[r.role], r.permissions));

  const save = async () => {
    for (const r of changedRoles) {
      const res = await run(() => updateRolePermissionsAction(r.role, [...values[r.role]]), { success: `Rechte für ${r.label} gespeichert.` });
      if (!res.ok) return;
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Berechtigung</TableHead>
              <TableHead className="w-36 text-center">Administrator</TableHead>
              {roles.map((r) => (
                <TableHead key={r.role} className="w-36 text-center">
                  {r.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => [
              <TableRow key={g.label} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={2 + roles.length} className="font-medium">
                  {g.label}
                </TableCell>
              </TableRow>,
              ...g.permissions.map((p) => (
                <TableRow key={p.key}>
                  <TableCell>
                    <div>{p.label}</div>
                    {p.warning && <div className="text-xs text-muted-foreground">{p.warning}</div>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked disabled aria-label={`${p.label}: Administrator`} className="mx-auto" />
                  </TableCell>
                  {roles.map((r) => (
                    <TableCell key={r.role} className="text-center">
                      <Checkbox
                        checked={values[r.role].has(p.key)}
                        onCheckedChange={(c) => toggle(r.role, p.key, c === true)}
                        disabled={pending}
                        aria-label={`${p.label}: ${r.label}`}
                        className="mx-auto"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || changedRoles.length === 0} onClick={save}>
          Speichern
        </Button>
        <Button
          variant="outline"
          disabled={pending || changedRoles.length === 0}
          onClick={() => setValues(Object.fromEntries(roles.map((r) => [r.role, new Set(r.permissions)])) as Record<ConfigurableRole, Set<Permission>>)}
        >
          Verwerfen
        </Button>
        {roles.map((r) => (
          <Button
            key={r.role}
            variant="ghost"
            disabled={pending || sameSet(values[r.role], r.defaults)}
            onClick={() => setValues((prev) => ({ ...prev, [r.role]: new Set(r.defaults) }))}
          >
            {r.label}: Standard wiederherstellen
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Abteilungseinschränkungen einzelner Benutzer gelten zusätzlich. „Rollenrechte“ selbst bleibt immer Administratoren vorbehalten.
      </p>
    </div>
  );
}
