import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Kein Zugriff" };

export default function NoAccessPage() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Kein Zugriff"
      description="Für diesen Bereich fehlt Ihrer Rolle die Berechtigung. Wenden Sie sich bei Bedarf an einen Administrator."
      action={
        <Button asChild variant="outline">
          <Link href="/">Zum Dashboard</Link>
        </Button>
      }
    />
  );
}
