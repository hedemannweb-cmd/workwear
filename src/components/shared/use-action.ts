"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

/**
 * Führt eine Server Action aus, zeigt Erfolg/Fehler als Toast und aktualisiert die Seite.
 * Feldfehler werden zurückgegeben, damit Formulare sie anzeigen können.
 */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void; refresh?: boolean } = {},
  ) {
    return new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        const res = await action();
        if (res.ok) {
          setFieldErrors({});
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
          if (opts.refresh !== false) router.refresh();
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          toast.error(res.error);
        }
        resolve(res);
      });
    });
  }

  return { run, pending, fieldErrors };
}
