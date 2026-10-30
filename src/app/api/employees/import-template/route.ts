import { buildEmployeeImportTemplate } from "@/modules/employees/server/import";
import { can, getCurrentActor } from "@/server/actor";

/** Excel-Vorlage für den Mitarbeiter-Import (mit den Abteilungen des angemeldeten Benutzers). */
export async function GET() {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Nicht angemeldet", { status: 401 });
  if (!can(actor, "employee:import")) return new Response("Keine Berechtigung", { status: 403 });
  const file = await buildEmployeeImportTemplate(actor);
  return new Response(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Mitarbeiter-Importvorlage.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
