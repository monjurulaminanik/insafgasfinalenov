import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Truck,
  Package,
  ShoppingCart,
  ClipboardList,
  Receipt,
  Warehouse,
  BookOpen,
  UserCog,
  BarChart3,
  ShoppingBag,
  Settings,
  Cylinder,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuAction,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/common/BrandLogo";
import { useModuleAccess } from "@/hooks/useModuleAccess";
import { useT, type MessageKey } from "@/i18n";

export function AppSidebar() {
  const t = useT();
  const [returnsExpanded, setReturnsExpanded] = useState(true);
  const { pathname, search } = useRouterState({
    select: (r) => ({
      pathname: r.location.pathname,
      search: (r.location.search as Record<string, string>) || {},
    }),
  });
  const searchTab = search.tab;
  const { canAccessUrl } = useModuleAccess();
  const isActive = (url: string) => {
    if (url === "/") return pathname === "/";
    if (url === "/hr") return pathname === "/hr" || pathname === "/hr/";
    if (url === "/hr/employees")
      return pathname.startsWith("/hr/employees") || /^\/hr\/[^/]+/.test(pathname);
    if (url === "/suppliers") {
      return (
        pathname === "/suppliers" ||
        pathname === "/suppliers/" ||
        (pathname.startsWith("/suppliers/") && !pathname.startsWith("/suppliers/returns"))
      );
    }
    if (url === "/suppliers/returns") return pathname.startsWith("/suppliers/returns");
    if (url === "/products") {
      return (
        pathname === "/products" ||
        pathname === "/products/" ||
        (pathname.startsWith("/products/") && !pathname.startsWith("/products/categories"))
      );
    }
    if (url === "/cylinders") {
      return (
        pathname === "/cylinders" ||
        pathname === "/cylinders/" ||
        (pathname.startsWith("/cylinders/") && !pathname.startsWith("/cylinders/damage"))
      );
    }
    if (url === "/cylinders/damage") return pathname.startsWith("/cylinders/damage");
    if (url === "/inventory") return pathname.startsWith("/inventory");
    if (url === "/returns") return pathname.startsWith("/returns");
    return pathname.startsWith(url);
  };

  const groups: {
    labelKey: MessageKey;
    items: { titleKey: MessageKey; url: string; icon: typeof LayoutDashboard }[];
  }[] = [
    {
      labelKey: "nav.overview",
      items: [
        { titleKey: "nav.dashboard", url: "/", icon: LayoutDashboard },
        { titleKey: "nav.reports", url: "/reports", icon: BarChart3 },
      ],
    },
    {
      labelKey: "nav.masterData",
      items: [
        { titleKey: "nav.customers", url: "/customers", icon: Users },
        { titleKey: "nav.suppliers", url: "/suppliers", icon: Truck },
        { titleKey: "nav.products", url: "/products", icon: Package },
      ],
    },
    {
      labelKey: "nav.operations",
      items: [
        { titleKey: "nav.sales", url: "/sales", icon: ShoppingCart },
        { titleKey: "nav.purchases", url: "/purchases", icon: ShoppingBag },
        { titleKey: "nav.inventory", url: "/inventory", icon: Warehouse },
        { titleKey: "nav.cylinders", url: "/cylinders", icon: Cylinder },
        { titleKey: "nav.deliveries", url: "/deliveries", icon: ClipboardList },
        { titleKey: "nav.returns", url: "/returns", icon: RotateCcw },
      ],
    },
    {
      labelKey: "nav.financeHr",
      items: [
        { titleKey: "nav.accounting", url: "/accounting", icon: BookOpen },
        { titleKey: "nav.expenses", url: "/expenses", icon: Receipt },
        { titleKey: "nav.hr", url: "/hr", icon: UserCog },
        { titleKey: "nav.employees", url: "/hr/employees", icon: Users },
      ],
    },
    {
      labelKey: "nav.system",
      items: [{ titleKey: "nav.settings", url: "/settings", icon: Settings }],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => canAccessUrl(item.url)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <BrandLogo size="md" />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-sm font-semibold tracking-tight">
              {t("brand.name")}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t("brand.erp")}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent data-lenis-prevent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.labelKey}>
            <SidebarGroupLabel>{t(g.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{t(item.titleKey)}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.url === "/suppliers" && canAccessUrl("/suppliers/returns") && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive("/suppliers/returns")}
                            size="sm"
                          >
                            <Link to="/suppliers/returns">
                              <span>{t("nav.suppliersReturn")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    )}
                    {item.url === "/products" && canAccessUrl("/products/categories") && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive("/products/categories")}
                            size="sm"
                          >
                            <Link to="/products/categories">
                              <span>{t("nav.categories")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    )}
                    {item.url === "/inventory" && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === "/inventory" && (searchTab === "gas" || !searchTab)}
                            size="sm"
                          >
                            <Link to="/inventory" search={{ tab: "gas" }}>
                              <span>{t("nav.gasInventory")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === "/inventory" && searchTab === "cylinder"}
                            size="sm"
                          >
                            <Link to="/inventory" search={{ tab: "cylinder" }}>
                              <span>{t("nav.cylinderInventory")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === "/inventory" && searchTab === "product"}
                            size="sm"
                          >
                            <Link to="/inventory" search={{ tab: "product" }}>
                              <span>{t("nav.productInventory")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={pathname === "/inventory" && searchTab === "summary"}
                            size="sm"
                          >
                            <Link to="/inventory" search={{ tab: "summary" }}>
                              <span>{t("nav.inventorySummary")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    )}
                    {item.url === "/cylinders" && canAccessUrl("/cylinders/damage") && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={isActive("/cylinders/damage")}
                            size="sm"
                          >
                            <Link to="/cylinders/damage">
                              <span>{t("nav.damageCylinder")}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    )}
                    {item.url === "/returns" && (
                      <>
                        <SidebarMenuAction
                          className="transition-transform duration-200"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setReturnsExpanded((prev) => !prev);
                          }}
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${
                              !returnsExpanded ? "-rotate-90" : ""
                            }`}
                          />
                          <span className="sr-only">Toggle Returns</span>
                        </SidebarMenuAction>
                        {returnsExpanded && (
                          <SidebarMenuSub>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={
                                  pathname === "/returns" &&
                                  (searchTab === "gas" || (!searchTab && pathname === "/returns"))
                                }
                                size="sm"
                              >
                                <Link to="/returns" search={{ tab: "gas" }}>
                                  <span>{t("nav.gasReturn")}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === "/returns" && searchTab === "cylinder"}
                                size="sm"
                              >
                                <Link to="/returns" search={{ tab: "cylinder" }}>
                                  <span>{t("nav.cylinderReturn")}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === "/returns" && searchTab === "product"}
                                size="sm"
                              >
                                <Link to="/returns" search={{ tab: "product" }}>
                                  <span>{t("nav.productReturn")}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          </SidebarMenuSub>
                        )}
                      </>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
