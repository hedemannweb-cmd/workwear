"use client";

import {
  ClipboardList,
  Gauge,
  History,
  PackageCheck,
  Settings,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Warehouse,
  Building2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { NavIcon, NavItem } from "./nav-config";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: Gauge,
  employees: Users,
  departments: Building2,
  articles: Shirt,
  inventory: Warehouse,
  orders: ShoppingCart,
  receipts: PackageCheck,
  quotas: SlidersHorizontal,
  suppliers: Truck,
  users: UserCog,
  settings: Settings,
  audit: History,
};

export function AppSidebar({ main, admin }: { main: NavItem[]; admin: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const renderItems = (items: NavItem[]) =>
    items.map((item) => {
      const Icon = ICONS[item.icon];
      return (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
            <Link href={item.href}>
              <Icon aria-hidden />
              <span>{item.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ClipboardList className="size-4" aria-hidden />
          </span>
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">Arbeitskleidung</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(main)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {admin.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(admin)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
