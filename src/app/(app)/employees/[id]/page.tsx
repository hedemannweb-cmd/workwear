import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EMPLOYEE_STATUS, StatusBadge, StatusOf } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { currentYear, formatDate, toIsoDateInAppTz } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getEmployeeDetail } from "@/modules/employees/server/detail";
import { employeeFormOptions } from "@/modules/employees/server/employees";
import { getIssueCatalog } from "@/modules/issues/server/catalog";
import { getEmployeeQuota } from "@/modules/quotas/server/quota-service";
import { getSetting } from "@/modules/settings/server/settings";
import { can, requirePagePermission } from "@/server/actor";
import { db } from "@/server/db";
import { isDomainError } from "@/server/errors";
import { EmployeeActions, IssueHistory, ReservationsList, SizesEditor, type IssueDto, type ReservationDto } from "./employee-panels";
import { QuotaTable, type QuotaRow } from "./quota-table";

export const metadata: Metadata = { title: "Mitarbeiter" };

export default async function EmployeeDetailPage(props: PageProps<"/employees/[id]">) {
  const actor = await requirePagePermission("employee:view");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const thisYear = currentYear();
  const year = Number(sp.jahr) >= 2000 && Number(sp.jahr) <= 2100 ? Number(sp.jahr) : thisYear;

  let detail: Awaited<ReturnType<typeof getEmployeeDetail>>;
  try {
    detail = await getEmployeeDetail(actor, id, year);
  } catch (e) {
    if (isDomainError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { employee, quota, reservations, issues, availableYears } = detail;

  const [catalog, currentQuota, options, sameDayOnly, quotaGroups] = await Promise.all([
    getIssueCatalog(employee.id),
    year === thisYear ? Promise.resolve(quota) : getEmployeeQuota(employee.id, thisYear),
    employeeFormOptions(actor),
    getSetting("issue.responsibleCancelSameDayOnly"),
    db.quotaGroup.findMany({ where: { active: true, isQuotaRelevant: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  const active = employee.status === "ACTIVE";
  const name = `${employee.firstName} ${employee.lastName}`;
  // Im Ausgabedialog nur Gruppen anbieten, auf die der Mitarbeiter einen Anspruch hat (oder die ohne Kontingent sind)
  const entitledCatalog = catalog.filter((g) => {
    if (!g.isQuotaRelevant) return true;
    const line = currentQuota.find((q) => q.quotaGroupId === g.id);
    return !!line && line.base + line.adjustments > 0;
  });
  const available = Object.fromEntries(
    catalog.map((g) => [g.id, g.isQuotaRelevant ? (currentQuota.find((q) => q.quotaGroupId === g.id)?.available ?? 0) : null]),
  );
  const freeByVariant = new Map(catalog.flatMap((g) => g.articles.flatMap((a) => a.variants.map((v) => [v.id, v.free] as const))));
  const today = toIsoDateInAppTz(new Date());

  const quotaRows: QuotaRow[] = quota.map((q) => ({
    ...q,
    ledger: q.ledger.map((e) => ({ date: e.date ? e.date.toISOString() : null, kind: e.kind, effect: e.effect, label: e.label })),
  }));

  const reservationDtos: ReservationDto[] = reservations.map((r) => ({
    id: r.id,
    status: r.status,
    quantity: r.quantity,
    quotaYear: r.quotaYear,
    label: [r.articleVariant.article.name, r.articleVariant.color, r.articleVariant.size?.value].filter(Boolean).join(" · "),
    articleVariantId: r.articleVariantId,
    createdAt: r.createdAt.toISOString(),
    free: freeByVariant.get(r.articleVariantId) ?? 0,
    order: r.orderItem
      ? { id: r.orderItem.order.id, orderNumber: r.orderItem.order.orderNumber, expectedDeliveryDate: r.orderItem.order.expectedDeliveryDate?.toISOString() ?? null }
      : null,
    location: r.status === "RECEIVED" ? (r.inventoryLocation?.name ?? null) : null,
  }));

  const issueDtos: IssueDto[] = issues.map((i) => ({
    id: i.id,
    issueNumber: i.issueNumber,
    issuedAt: i.issuedAt.toISOString(),
    status: i.status,
    issuedBy: i.issuedBy.name,
    cancelReason: i.cancelReason,
    cancelledBy: i.cancelledBy?.name ?? null,
    notes: i.notes,
    cancellable:
      can(actor, "issue:cancelAny") ||
      (can(actor, "issue:cancelOwnSameDay") && i.issuedById === actor.userId && (!sameDayOnly || toIsoDateInAppTz(i.issuedAt) === today)),
    items: i.items.map((it) => ({
      id: it.id,
      label: [it.articleVariant.article.name, it.articleVariant.color, it.articleVariant.size?.value].filter(Boolean).join(" · "),
      quantity: it.quantity,
      quotaYear: it.quotaYear,
      location: it.inventoryLocation.name,
      returned: it.returnItems.reduce((s, r) => s + r.quantity, 0),
      returns: it.returnItems.map((r) => ({ returnNumber: r.return.returnNumber, returnedAt: r.return.returnedAt.toISOString(), quantity: r.quantity, type: r.returnType })),
      alternatives: (catalog.find((g) => g.id === it.quotaGroupId)?.articles ?? []).flatMap((a) =>
        a.variants
          .filter((v) => v.id !== it.articleVariantId)
          .map((v) => ({ id: v.id, label: [a.name, v.color, v.size].filter(Boolean).join(" · "), free: v.free })),
      ),
    })),
  }));

  const openReservations = reservations.length;
  const arrived = reservations.filter((r) => r.status === "RECEIVED").length;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {name}
            <StatusOf map={EMPLOYEE_STATUS} status={employee.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Personalnummer <span className="font-medium text-foreground">{employee.employeeNumber}</span>
            </span>
            <Badge variant="secondary">{employee.department.name}</Badge>
            <span>
              Profil: {employee.department.quotaProfile ? employee.department.quotaProfile.name : <span className="text-danger-foreground">kein Kontingentprofil</span>}
            </span>
            <span>Eintritt {formatDate(employee.entryDate)}</span>
            {employee.exitDate && <span>Austritt {formatDate(employee.exitDate)}</span>}
          </span>
        }
        actions={
          <EmployeeActions
            employeeId={employee.id}
            employeeName={`${name} · ${employee.employeeNumber} · ${employee.department.name}`}
            active={active}
            catalog={entitledCatalog}
            available={available}
            quotaGroups={quotaGroups}
            departments={options.departments}
            currentDepartmentId={employee.departmentId}
            year={year}
            perms={{
              issue: can(actor, "issue:create"),
              override: can(actor, "quota:override"),
              adjust: can(actor, "quota:adjust"),
              manage: can(actor, "employee:manage"),
              changeDepartment: can(actor, "employee:changeDepartment") && active,
              pseudonymize: can(actor, "employee:manage") && employee.status === "LEFT" && !employee.pseudonymizedAt,
            }}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Kontingent {year}</CardTitle>
            <CardAction>
              <nav aria-label="Jahr wählen" className="flex gap-1">
                {availableYears.map((y) => (
                  <Link
                    key={y}
                    href={y === thisYear ? `/employees/${employee.id}` : `/employees/${employee.id}?jahr=${y}`}
                    className={cn(
                      "rounded-md px-2 py-1 text-sm tabular-nums",
                      y === year ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                    aria-current={y === year ? "page" : undefined}
                  >
                    {y}
                  </Link>
                ))}
              </nav>
            </CardAction>
          </CardHeader>
          <CardContent>
            {quotaRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Für {year} besteht kein Kontingent (kein Profil oder kein Anspruch).</p>
            ) : (
              <QuotaTable rows={quotaRows} year={year} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Größen</CardTitle>
            </CardHeader>
            <CardContent>
              <SizesEditor
                employeeId={employee.id}
                scales={options.scales.map((s) => ({ id: s.id, name: s.name, sizes: s.sizes.map((z) => ({ id: z.id, value: z.value })) }))}
                categories={options.categories.map((c) => ({ id: c.id, name: c.name, sizeScaleId: c.sizeScaleId }))}
                current={employee.sizes.map((s) => ({ sizeScaleId: s.sizeScaleId, categoryId: s.categoryId, sizeId: s.sizeId }))}
                canEdit={can(actor, "employee:editSizes")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Offene Bestellungen
                {arrived > 0 && <StatusBadge tone="success">{arrived} eingetroffen</StatusBadge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReservationsList
                employeeId={employee.id}
                reservations={reservationDtos}
                canIssue={can(actor, "issue:create")}
                canCancel={can(actor, "reservation:cancel")}
                active={active}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">Historie ({issues.length})</TabsTrigger>
          <TabsTrigger value="departments">Abteilungen</TabsTrigger>
          <TabsTrigger value="notes">Notizen</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="pt-2">
          <IssueHistory employeeId={employee.id} issues={issueDtos} canReturn={can(actor, "return:create") && active} />
        </TabsContent>
        <TabsContent value="departments" className="pt-2">
          <ul className="divide-y rounded-md border text-sm">
            {employee.departmentHistory.map((h) => (
              <li key={h.id} className={cn("flex flex-wrap gap-x-4 px-3 py-2", !h.validTo && "font-medium")}>
                <span className="w-56 tabular-nums">
                  {formatDate(h.validFrom)} – {h.validTo ? formatDate(new Date(h.validTo.getTime() - 86_400_000)) : "heute"}
                </span>
                <span className="flex-1">{h.department.name}</span>
                <span className="text-muted-foreground">
                  {h.reason}
                  {h.changedBy && ` · ${h.changedBy.name}`}
                </span>
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="notes" className="pt-2">
          <p className="text-sm whitespace-pre-wrap">{employee.notes || <span className="text-muted-foreground">Keine Notizen.</span>}</p>
        </TabsContent>
      </Tabs>
      {openReservations > 0 && <span className="sr-only">{openReservations} offene Bestellungen</span>}
    </>
  );
}
