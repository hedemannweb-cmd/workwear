import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ungültiges Datum");

/** Nur die für den Zweck notwendigen Daten (Datenschutz, Vorgabe 35). */
export const employeeSchema = z
  .object({
    employeeNumber: z.string().trim().min(1, "Pflichtfeld").max(20).regex(/^[A-Za-z0-9-]+$/, "Nur Buchstaben, Ziffern und -"),
    firstName: z.string().trim().min(1, "Pflichtfeld").max(60),
    lastName: z.string().trim().min(1, "Pflichtfeld").max(60),
    departmentId: z.string().min(1, "Bitte eine Abteilung wählen"),
    entryDate: isoDate,
    exitDate: isoDate.nullable(),
    status: z.enum(["ACTIVE", "INACTIVE", "LEFT"]),
    notes: z.string().trim().max(1000).nullable(),
  })
  .refine((v) => !v.exitDate || v.exitDate >= v.entryDate, { message: "Austritt vor Eintritt", path: ["exitDate"] })
  .refine((v) => v.status !== "LEFT" || v.exitDate, { message: "Bei „Ausgeschieden“ ist ein Austrittsdatum erforderlich", path: ["exitDate"] });

export type EmployeeInput = z.input<typeof employeeSchema>;
