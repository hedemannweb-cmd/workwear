"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Bestätigungsdialog für kritische Aktionen mit Pflichtbegründung (Storno, Korrekturen).
 * Die Begründung wird serverseitig erneut validiert.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  pending,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<{ ok: boolean }>;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 5;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setReason("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">Begründung (Pflicht)</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
          <p className="text-xs text-muted-foreground">Mindestens 5 Zeichen. Wird im Audit Log gespeichert.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!valid || pending}
            onClick={async () => {
              const res = await onConfirm(reason.trim());
              if (res.ok) {
                setOpen(false);
                setReason("");
              }
            }}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
