import { useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, Truck, ShoppingCart } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notificationsFn } from "@/lib/data.functions";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";

export function NotificationsDropdown() {
  const t = useT();
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsFn(),
    staleTime: 60_000,
  });

  const lowStock = notifications?.lowStock || [];
  const pendingDeliveries = notifications?.pendingDeliveries || [];
  const pendingPurchases = notifications?.pendingPurchases || [];
  const pendingSales = notifications?.pendingSales || [];
  const creditReminders = notifications?.creditReminders || [];

  const allIds = useMemo(
    () => [
      ...lowStock.map((p) => `stock-${p.id}`),
      ...pendingDeliveries.map((d) => `del-${d.id}`),
      ...pendingPurchases.map((p) => `po-${p.id}`),
      ...pendingSales.map((s) => `so-${s.id}`),
      ...creditReminders.map((c) => `cr-${c.id}`),
    ],
    [lowStock, pendingDeliveries, pendingPurchases, pendingSales, creditReminders],
  );

  const [seenIds, setSeenIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("seenNotifications") || "[]");
    } catch {
      return [];
    }
  });

  const unreadCount = allIds.filter((id) => !seenIds.includes(id)).length;
  const totalNotifications = allIds.length;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setSeenIds(allIds);
      localStorage.setItem("seenNotifications", JSON.stringify(allIds));
    }
  };

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full p-0 text-[10px] text-white bg-red-500">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b px-4 py-3">
          <h4 className="text-sm font-semibold">Notifications</h4>
        </div>
        <ScrollArea className="max-h-[400px]">
          {totalNotifications === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No new notifications
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-2">
              {lowStock.map((p) => (
                <Link
                  key={`stock-${p.id}`}
                  to="/products"
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-accent"
                >
                  <div className="mt-0.5 rounded-full bg-red-100 p-1.5 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Low Stock: {p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Current stock ({p.stock}) is below reorder level ({p.reorderLevel}).
                    </span>
                  </div>
                </Link>
              ))}

              {pendingDeliveries.map((d) => (
                <Link
                  key={`del-${d.id}`}
                  to="/deliveries/$id"
                  params={{ id: d.id }}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-accent"
                >
                  <div className="mt-0.5 rounded-full bg-amber-100 p-1.5 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <Truck className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Pending Delivery</span>
                    <span className="text-xs text-muted-foreground">
                      Challan {d.challanNo} for {d.customerName} is pending.
                    </span>
                  </div>
                </Link>
              ))}

              {pendingPurchases.map((p) => (
                <Link
                  key={`po-${p.id}`}
                  to="/purchases/$id"
                  params={{ id: p.id }}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-accent"
                >
                  <div className="mt-0.5 rounded-full bg-blue-100 p-1.5 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <ShoppingCart className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Pending Purchase</span>
                    <span className="text-xs text-muted-foreground">
                      PO {p.orderNo} from {p.supplierName} is ordered but not received.
                    </span>
                  </div>
                </Link>
              ))}

              {pendingSales.map((s) => (
                <Link
                  key={`so-${s.id}`}
                  to="/sales/$id"
                  params={{ id: s.id }}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-accent"
                >
                  <div className="mt-0.5 rounded-full bg-green-100 p-1.5 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                    <ShoppingCart className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Confirmed Sale</span>
                    <span className="text-xs text-muted-foreground">
                      SO {s.orderNo} for {s.customerName} is confirmed. Needs delivery/invoice.
                    </span>
                  </div>
                </Link>
              ))}

              {creditReminders.map((c) => (
                <Link
                  key={`cr-${c.id}`}
                  to="/customers/$id"
                  params={{ id: c.id }}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-accent"
                >
                  <div className="mt-0.5 rounded-full bg-amber-100 p-1.5 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Credit reminder: {c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Outstanding for {c.days} days.
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
