"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { useAction } from "@/components/shared/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveEmployeeAction } from "@/modules/employees/actions";
import { employeeSchema, type EmployeeInput } from "@/modules/employees/schemas";

export function EmployeeForm({
  id,
  defaults,
  departments,
}: {
  id: string | null;
  defaults: EmployeeInput;
  departments: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const form = useForm<EmployeeInput>({ resolver: zodResolver(employeeSchema), defaultValues: defaults });
  const err = (name: keyof EmployeeInput) => form.formState.errors[name]?.message ?? fieldErrors[name]?.[0];

  const onSubmit = form.handleSubmit(async (values) => {
    await run(() => saveEmployeeAction(id, values), {
      success: id ? "Mitarbeiter gespeichert." : "Mitarbeiter angelegt.",
      onSuccess: (d) => router.push(`/employees/${d.id}`),
    });
  });

  return (
    <Card className="max-w-3xl">
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={!!err("employeeNumber")}>
                <FieldLabel htmlFor="employeeNumber">Personalnummer</FieldLabel>
                <Input id="employeeNumber" {...form.register("employeeNumber")} aria-invalid={!!err("employeeNumber")} />
                <FieldError>{err("employeeNumber")}</FieldError>
              </Field>
              <Field data-invalid={!!err("firstName")}>
                <FieldLabel htmlFor="firstName">Vorname</FieldLabel>
                <Input id="firstName" {...form.register("firstName")} aria-invalid={!!err("firstName")} />
                <FieldError>{err("firstName")}</FieldError>
              </Field>
              <Field data-invalid={!!err("lastName")}>
                <FieldLabel htmlFor="lastName">Nachname</FieldLabel>
                <Input id="lastName" {...form.register("lastName")} aria-invalid={!!err("lastName")} />
                <FieldError>{err("lastName")}</FieldError>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!err("departmentId")}>
                <FieldLabel>Abteilung</FieldLabel>
                <Controller
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!id}>
                      <SelectTrigger className="w-full" aria-invalid={!!err("departmentId")}>
                        <SelectValue placeholder="Bitte wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {id && <p className="text-xs text-muted-foreground">Änderung über „Abteilung wechseln“ auf der Mitarbeiterseite (mit Historie).</p>}
                <FieldError>{err("departmentId")}</FieldError>
              </Field>
              <Field data-invalid={!!err("status")}>
                <FieldLabel>Status</FieldLabel>
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Aktiv</SelectItem>
                        <SelectItem value="INACTIVE">Inaktiv (z. B. Elternzeit)</SelectItem>
                        <SelectItem value="LEFT">Ausgeschieden</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError>{err("status")}</FieldError>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!err("entryDate")}>
                <FieldLabel htmlFor="entryDate">Eintritt</FieldLabel>
                <Input id="entryDate" type="date" {...form.register("entryDate")} aria-invalid={!!err("entryDate")} />
                <FieldError>{err("entryDate")}</FieldError>
              </Field>
              <Field data-invalid={!!err("exitDate")}>
                <FieldLabel htmlFor="exitDate">Austritt (optional)</FieldLabel>
                <Input id="exitDate" type="date" {...form.register("exitDate", { setValueAs: (v) => v || null })} aria-invalid={!!err("exitDate")} />
                <FieldError>{err("exitDate")}</FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="notes">Notizen</FieldLabel>
              <Textarea id="notes" rows={3} {...form.register("notes", { setValueAs: (v) => v || null })} />
              <p className="text-xs text-muted-foreground">Nur arbeitsbezogene Hinweise – keine sensiblen personenbezogenen Daten.</p>
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />} Speichern
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Abbrechen
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
