import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Nicht gefunden"
      description="Der Datensatz existiert nicht oder liegt außerhalb Ihres Zuständigkeitsbereichs."
      action={
        <Button asChild variant="outline">
          <Link href="/">Zum Dashboard</Link>
        </Button>
      }
    />
  );
}
