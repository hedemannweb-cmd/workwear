import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Info, Truck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Einheitliche Statusdarstellung (KONZEPT I, Vorgabe 32): Farbe + Icon + Text,
 * damit Status nie allein über Farbe vermittelt wird.
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-danger text-danger-foreground",
  info: "bg-info text-info-foreground",
  neutral: "bg-muted text-muted-foreground",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  warning: Clock,
  danger: AlertTriangle,
  info: Truck,
  neutral: CircleDashed,
};

export function StatusBadge({
  tone,
  children,
  icon,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  icon?: LucideIcon | null;
  className?: string;
}) {
  const Icon = icon === null ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

export const StatusIcons = { Info, XCircle };

/** Zentrale Zuordnung fachlicher Status → Darstellung */
export const EMPLOYEE_STATUS: Record<string, { tone: Tone; label: string }> = {
  ACTIVE: { tone: "success", label: "Aktiv" },
  INACTIVE: { tone: "neutral", label: "Inaktiv" },
  LEFT: { tone: "neutral", label: "Ausgeschieden" },
};

export const RESERVATION_STATUS: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "warning", label: "Offen" },
  ORDERED: { tone: "info", label: "Bestellt" },
  RECEIVED: { tone: "success", label: "Eingetroffen" },
  ISSUED: { tone: "neutral", label: "Ausgegeben" },
  CANCELLED: { tone: "neutral", label: "Storniert" },
};

export const ORDER_STATUS: Record<string, { tone: Tone; label: string }> = {
  DRAFT: { tone: "warning", label: "Entwurf" },
  ORDERED: { tone: "info", label: "Bestellt" },
  CONFIRMED: { tone: "info", label: "Bestätigt" },
  PARTIALLY_RECEIVED: { tone: "warning", label: "Teilweise geliefert" },
  RECEIVED: { tone: "success", label: "Geliefert" },
  CANCELLED: { tone: "neutral", label: "Storniert" },
};

export const ISSUE_STATUS: Record<string, { tone: Tone; label: string }> = {
  COMPLETED: { tone: "success", label: "Ausgegeben" },
  CANCELLED: { tone: "neutral", label: "Storniert" },
};

export function StatusOf({ map, status }: { map: Record<string, { tone: Tone; label: string }>; status: string }) {
  const s = map[status] ?? { tone: "neutral" as Tone, label: status };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
