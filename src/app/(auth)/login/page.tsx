import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shirt } from "lucide-react";
import { getCurrentActor } from "@/server/actor";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  if (await getCurrentActor()) redirect(typeof next === "string" && next.startsWith("/") ? next : "/");
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shirt className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold">Arbeitskleidung</h1>
          <p className="text-sm text-muted-foreground">Bitte melden Sie sich mit Ihrem Konto an.</p>
        </div>
        <LoginForm next={typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/"} />
      </div>
    </main>
  );
}
