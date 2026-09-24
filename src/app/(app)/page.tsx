import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Euro, PackageMinus, PackageOpen, ShoppingCart, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ISSUE_STATUS, StatusBadge, StatusOf, type Tone } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDashboard, getDataQuality } from "@/modules/dashboard/server/dashboard";
import { can, requirePagePermission } from "@/server/actor";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requirePagePermission("dashboard:view");
  const d = await getDashboard(actor);
  const quality = can(actor, "report:view") ? await getDataQuality() : null;

  const todo: Array<{ tone: Tone; icon: LucideIcon; text: string; href: string; show: boolean }> = [
    {
      tone: "danger",
      icon: CalendarClock,
      text: `${d.actions.overdue.length} ${d.actions.overdue.length === 1 ? "Lieferung ist" : "Lieferungen sind"} überfällig`,
      href: "/orders?tab=offen",
      show: d.actions.overdue.length > 0 && can(actor, "order:view"),
    },
    {
      tone: "success",
      icon: PackageOpen,
      text: `${d.actions.arrivedWaitingQty} eingetroffene Mitarbeiterartikel warten auf Ausgabe`,
      href: "/orders?tab=eingetroffen",
      show: d.actions.arrivedWaiting > 0,
    },
    {
      tone: "warning",
      icon: ClipboardList,
      text: `${d.actions.pendingDemand} Mitarbeiteranforderungen noch nicht bestellt (${d.actions.pendingDemandQty} Stück)`,
      href: "/orders?tab=bedarf",
      show: d.actions.pendingDemand > 0,
    },
    {
      tone: "danger",
      icon: PackageMinus,
      text: `${d.actions.belowMinimum} Artikel unter Mindestbestand`,
      href: "/inventory?filter=unter-mindestbestand",
      show: d.actions.belowMinimum > 0 && can(actor, "inventory:view"),
    },
    {
      tone: "info",
      icon: ShoppingCart,
      text: `${d.actions.openOrders} offene Bestellungen beim Lieferanten`,
      href: "/orders?tab=offen",
      show: d.actions.openOrders > 0 && can(actor, "order:view"),
    },
    {
      tone: "warning",
      icon: ShoppingCart,
      text: `${d.actions.draftOrders} Bestellentwürfe noch nicht versendet`,
      href: "/orders?tab=entwuerfe",
      show: d.actions.draftOrders > 0 && can(actor, "order:manage"),
    },
  ];
  const visibleTodo = todo.filter((t) => t.show);

  return (
    <>
      <PageHeader title="Dashboard" description={`Überblick ${d.year}`} />

      <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi icon={Users} label="Aktive Mitarbeiter" value={formatNumber(d.kpis.activeEmployees)} href="/employees" />
        <Kpi icon={ShoppingCart} label="Offene Bestellungen" value={formatNumber(d.kpis.openOrders)} href="/orders?tab=offen" />
        <Kpi icon={ClipboardList} label="Offene Reservierungen" value={formatNumber(d.kpis.openReservations)} href="/orders?tab=bedarf" />
        <Kpi icon={CalendarClock} label="Überfällige Bestellungen" value={formatNumber(d.kpis.overdueOrders)} tone={d.kpis.overdueOrders > 0 ? "danger" : undefined} href="/orders?tab=offen" />
        <Kpi icon={PackageMinus} label="Unter Mindestbestand" value={formatNumber(d.kpis.belowMinimum)} tone={d.kpis.belowMinimum > 0 ? "warning" : undefined} href="/inventory?filter=unter-mindestbestand" />
        <Kpi icon={PackageOpen} label="Ausgaben aktueller Monat" value={`${formatNumber(d.kpis.issuedThisMonth)} Stk.`} />
        {d.kpis.orderCostYear !== null && <Kpi icon={Euro} label={`Bestellkosten ${d.year}`} value={formatCurrency(d.kpis.orderCostYear)} />}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Handlungsbedarf</CardTitle>
          </CardHeader>
          <CardContent>
            {visibleTodo.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success-foreground">
                <CheckCircle2 className="size-4" aria-hidden /> Alles erledigt.
              </p>
            ) : (
              <ul className="space-y-2">
                {visibleTodo.map((t) => (
                  <li key={t.text}>
                    <Link href={t.href} className="group flex items-center gap-3 rounded-md border p-2.5 text-sm hover:bg-muted">
                      <StatusBadge tone={t.tone} icon={t.icon} className="h-6 px-1.5">
                        <span className="sr-only">{t.tone === "danger" ? "Problem" : "Hinweis"}</span>
                      </StatusBadge>
                      <span className="flex-1">{t.text}</span>
                      <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d.actions.overdue.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {d.actions.overdue.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="hover:underline">
                      {o.orderNumber} · {o.supplier.name} · erwartet {formatDate(o.expectedDeliveryDate)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Letzte Ausgaben</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recentIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch keine Ausgaben.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zeitpunkt</TableHead>
                    <TableHead>Beleg</TableHead>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead className="text-right">Stück</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.recentIssues.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(i.issuedAt)}</TableCell>
                      <TableCell>{i.issueNumber}</TableCell>
                      <TableCell>
                        <Link href={`/employees/${i.employee.id}`} className="hover:underline">
                          {i.employee.firstName} {i.employee.lastName}
                        </Link>{" "}
                        <span className="text-muted-foreground">({i.employee.employeeNumber})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{i.items.reduce((s, x) => s + x.quantity, 0)}</TableCell>
                      <TableCell>
                        <StatusOf map={ISSUE_STATUS} status={i.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {can(actor, "inventory:view") && (
          <Card>
            <CardHeader>
              <CardTitle>Unter Mindestbestand</CardTitle>
              <CardDescription>Frei verfügbarer Bestand (abzüglich Reservierungen) unter dem Mindestbestand.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.belowMin.length === 0 ? (
                <p className="text-sm text-muted-foreground">Alle Mindestbestände erfüllt.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Frei</TableHead>
                      <TableHead className="text-right">Mindest</TableHead>
                      <TableHead className="text-right">Bestellt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.belowMin.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>
                          <Link href={`/articles/${v.articleId}`} className="hover:underline">
                            {v.articleName} {v.size}
                          </Link>
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", v.free === 0 && "font-medium text-danger-foreground")}>{v.free}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.minStock}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.openOrdered || "–"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {quality && (
          <Card>
            <CardHeader>
              <CardTitle>Datenqualität</CardTitle>
              <CardDescription>Hinweise auf unvollständige oder inkonsistente Daten.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <QualityItem count={quality.withoutSizes.length} label="aktive Mitarbeiter ohne Größen" details={quality.withoutSizes.map((e) => ({ href: `/employees/${e.id}`, label: `${e.firstName} ${e.lastName} (${e.employeeNumber})` }))} />
                <QualityItem count={quality.deptWithoutProfile.length} label="Abteilungen ohne Kontingentprofil" details={quality.deptWithoutProfile.map((x) => ({ href: "/departments", label: x.name }))} />
                <QualityItem count={quality.articlesWithoutSupplier.length} label="Artikel ohne Lieferant" details={quality.articlesWithoutSupplier.map((a) => ({ href: `/articles/${a.id}`, label: `${a.sku} ${a.name}` }))} />
                <QualityItem count={quality.articlesWithoutPrice.length} label="Artikel ohne Einkaufspreis" details={quality.articlesWithoutPrice.map((a) => ({ href: `/articles/${a.id}`, label: `${a.sku} ${a.name}` }))} />
                <QualityItem count={quality.stalePending} label="Reservierungen seit über 14 Tagen nicht bestellt" details={[{ href: "/orders?tab=bedarf", label: "Zum Bedarf" }]} />
                <QualityItem count={quality.inconsistentInventory} label="Lagerbestände weichen vom Bewegungsjournal ab" details={[]} />
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Kpi({ icon: Icon, label, value, tone, href }: { icon: LucideIcon; label: string; value: string; tone?: "danger" | "warning"; href?: string }) {
  const body = (
    <Card className={cn("h-full gap-1 py-4 transition-colors", href && "hover:bg-muted/50", tone === "danger" && "border-danger-foreground/40", tone === "warning" && "border-warning-foreground/40")}>
      <CardContent className="space-y-1 px-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          <span>{label}</span>
          {tone && <AlertTriangle className={cn("ml-auto size-3.5", tone === "danger" ? "text-danger-foreground" : "text-warning-foreground")} aria-label="Achtung" />}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function QualityItem({ count, label, details }: { count: number; label: string; details: Array<{ href: string; label: string }> }) {
  return (
    <li>
      <div className="flex items-center gap-2">
        {count === 0 ? <StatusBadge tone="success">OK</StatusBadge> : <StatusBadge tone="warning">{count}</StatusBadge>}
        <span className={count === 0 ? "text-muted-foreground" : undefined}>{label}</span>
      </div>
      {count > 0 && details.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 pl-10 text-xs">
          {details.slice(0, 6).map((x) => (
            <Link key={x.href + x.label} href={x.href} className="text-primary hover:underline">
              {x.label}
            </Link>
          ))}
          {details.length > 6 && <span className="text-muted-foreground">+{details.length - 6} weitere</span>}
        </div>
      )}
    </li>
  );
}
