import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/server/actor";
import { EmployeeImportClient } from "./import-client";

export const metadata: Metadata = { title: "Mitarbeiter importieren" };

export default async function EmployeeImportPage() {
  const actor = await requirePagePermission("employee:import");
  return (
    <>
      <PageHeader
        title="Mitarbeiter importieren"
        description={`Mitarbeiter aus einer Excel-Datei anlegen${actor.departmentIds ? " (nur in Ihren Abteilungen)" : ""}. Vorhandene Personalnummern werden übersprungen.`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/employees">
              <ArrowLeft className="size-4" /> Zur Mitarbeiterliste
            </Link>
          </Button>
        }
      />
      <EmployeeImportClient />
    </>
  );
}
