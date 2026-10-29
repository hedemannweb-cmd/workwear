import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { GlobalSearch } from "@/components/layout/global-search";
import { ADMIN_NAV, MAIN_NAV, type NavItem } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { can, getCurrentActor } from "@/server/actor";
import { ROLE_LABELS } from "@/server/permissions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const visible = (i: NavItem) => (i.permission === "ADMIN_ONLY" ? actor.role === "ADMIN" : can(actor, i.permission));

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar main={MAIN_NAV.filter(visible)} admin={ADMIN_NAV.filter(visible)} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <GlobalSearch />
          <div className="ml-auto">
            <UserMenu name={actor.name} email={actor.email} roleLabel={ROLE_LABELS[actor.role]} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-6 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
