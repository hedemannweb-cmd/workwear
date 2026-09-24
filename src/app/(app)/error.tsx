"use client";

import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

/** Keine technischen Details anzeigen – sie stehen mit dem Digest im Server-Log. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Die Seite konnte nicht geladen werden"
      description={`Bitte versuchen Sie es erneut. Besteht das Problem weiter, nennen Sie dem Administrator diese Kennung: ${error.digest ?? "–"}`}
      action={<Button onClick={reset}>Erneut versuchen</Button>}
    />
  );
}
