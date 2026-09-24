import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { listAuditLog } from "@/modules/audit/server/audit-log";
import { requirePagePermission } from "@/server/actor";
import { AuditLogClient } from "./audit-log-client";

export const metadata: Metadata = { title: "Audit Log" };

export default async function AuditLogPage(props: PageProps<"/admin/audit-log">) {
  const actor = await requirePagePermission("audit:view");
  const sp = await props.searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const data = await listAuditLog(actor, { action: str(sp.aktion), userId: str(sp.benutzer), entityId: str(sp.objekt) });
  return (
    <>
      <PageHeader title="Audit Log" description="Unveränderliches Protokoll kritischer Aktionen: wer, wann, was, von welchem auf welchen Wert und warum. Die letzten 500 Einträge." />
      <AuditLogClient {...data} filter={{ action: str(sp.aktion) ?? "", userId: str(sp.benutzer) ?? "" }} />
    </>
  );
}
