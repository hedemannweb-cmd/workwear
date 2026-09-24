"use client";

import { Search, Shirt, ShoppingCart, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { EMPLOYEE_STATUS, ORDER_STATUS, StatusOf } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchAction } from "@/modules/search/actions";
import type { SearchResult } from "@/modules/search/server/search";

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const res = await searchAction(query);
        if (res.ok) setResult(res.data);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    setResult(null);
    router.push(href);
  };

  const visible = query.trim().length >= 2 ? result : null;
  const empty = visible && !visible.employees.length && !visible.articles.length && !visible.orders.length;

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-full max-w-md justify-start gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Suche öffnen"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate">Mitarbeiter, Personalnummer, Artikel …</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Suche" description="Mitarbeiter, Artikel und Bestellungen suchen" className="sm:max-w-2xl">
        <Command shouldFilter={false}>
        <CommandInput placeholder="Name, Personalnummer, SKU oder Bestellnummer …" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[70vh]">
          {query.trim().length < 2 && <CommandEmpty>Mindestens zwei Zeichen eingeben.</CommandEmpty>}
          {empty && !pending && <CommandEmpty>Keine Treffer.</CommandEmpty>}
          {visible && visible.employees.length > 0 && (
            <CommandGroup heading="Mitarbeiter">
              {visible.employees.map((e) => (
                <CommandItem key={e.id} value={`e-${e.id}`} onSelect={() => go(`/employees/${e.id}`)} className="flex-col items-stretch gap-1">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{e.name}</span>
                    <span className="text-muted-foreground">· {e.employeeNumber} · {e.department}</span>
                    <span className="ml-auto">
                      <StatusOf map={EMPLOYEE_STATUS} status={e.status} />
                    </span>
                  </div>
                  {e.quota.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-6 text-xs text-muted-foreground">
                      {e.quota.map((q) => (
                        <span key={q.group}>
                          {q.group}: <span className={q.available === 0 ? "text-danger-foreground" : "font-medium text-foreground"}>{q.available ?? "∞"} verfügbar</span>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-2 hover:underline"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          go(`/employees/${e.id}?ausgabe=1`);
                        }}
                      >
                        Ausgabe / Bestellung →
                      </button>
                    </div>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {visible && visible.articles.length > 0 && (
            <CommandGroup heading="Artikel">
              {visible.articles.map((a) => (
                <CommandItem key={a.id} value={`a-${a.id}`} onSelect={() => go(`/articles/${a.id}`)}>
                  <Shirt className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">{a.sku}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {visible && visible.orders.length > 0 && (
            <CommandGroup heading="Bestellungen">
              {visible.orders.map((o) => (
                <CommandItem key={o.id} value={`o-${o.id}`} onSelect={() => go(`/orders/${o.id}`)}>
                  <ShoppingCart className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{o.orderNumber}</span>
                  <span className="text-muted-foreground">{o.supplier}</span>
                  <span className="ml-auto">
                    <StatusOf map={ORDER_STATUS} status={o.status} />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
