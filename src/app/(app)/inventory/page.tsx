import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { listInventory } from "@/modules/inventory/server/queries";
import { can, requirePagePermission } from "@/server/actor";
import { InventoryTable } from "./inventory-table";

export const metadata: Metadata = { title: "Lager" };

export default async function InventoryPage(props: PageProps<"/inventory">) {
  const actor = await requirePagePermission("inventory:view");
  const sp = await props.searchParams;
  const { rows, locations } = await listInventory();
  const physical = rows.filter((r) => r.locationType === "STORAGE").reduce((s, r) => s + r.physical, 0);
  const reserved = rows.filter((r) => r.locationType === "STORAGE").reduce((s, r) => s + r.reserved, 0);
  return (
    <>
      <PageHeader
        title="Lager"
        description={`${physical} Stück am Lager · davon ${reserved} für Mitarbeiter reserviert · ${physical - reserved} frei`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/inventory/movements">
              <History className="size-4" /> Bewegungsjournal
            </Link>
          </Button>
        }
      />
      <InventoryTable
        rows={rows}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        canAdjust={can(actor, "inventory:adjust")}
        initialFilter={sp.filter === "unter-mindestbestand" ? "below" : "all"}
      />
    </>
  );
}
