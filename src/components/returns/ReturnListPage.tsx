import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Cylinder,
  Flame,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Undo2,
  FileText,
  Eye,
} from "lucide-react";
import { returnService } from "@/services/return.service";
import { deliveryService } from "@/services/delivery.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { StatCard } from "@/components/dashboard/widgets/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PrintMeta, PrintSignatures } from "@/components/common/PrintParts";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { formatCurrency, formatDate, formatDateTime } from "@/utils/formatters";
import type { ReturnRecord } from "@/types";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type ReturnTab = "gas" | "cylinder" | "product";

export function ReturnListPage() {
  const t = useT();
  const navigate = useNavigate();
  const { search } = useRouterState({
    select: (r) => ({
      search: (r.location.search as Record<string, string>) || {},
    }),
  });

  const activeTab = (search.tab as ReturnTab) || "gas";

  const { data: allReturns = [], isLoading } = useQuery({
    queryKey: ["returns"],
    queryFn: () => returnService.list(),
  });

  const { data: deliveries = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });

  const [selectedReturn, setSelectedReturn] = useState<ReturnRecord | null>(null);
  const [newReturnDialogOpen, setNewReturnDialogOpen] = useState(false);

  // Filter returns based on the active tab
  const tabReturns = useMemo(() => {
    return allReturns.filter((r) => {
      if (activeTab === "gas") {
        return r.itemClassification === "gas" || r.items.some((it) => it.itemType === "gas");
      }
      if (activeTab === "cylinder") {
        return (
          r.itemClassification === "cylinder" || r.items.some((it) => it.itemType === "cylinder")
        );
      }
      if (activeTab === "product") {
        return (
          r.itemClassification === "product" || r.items.some((it) => it.itemType === "product")
        );
      }
      return true;
    });
  }, [allReturns, activeTab]);

  // Statistics calculation for the active category
  const stats = useMemo(() => {
    const list = tabReturns;
    const totalCount = list.length;
    let totalQty = 0;
    let totalValue = 0;

    for (const r of list) {
      for (const it of r.items) {
        if (it.itemType === activeTab) {
          totalQty += it.returnQuantity;
          totalValue += it.subtotal;
        }
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = list.filter((r) => r.returnDate.startsWith(todayStr)).length;

    return {
      totalCount,
      totalQty,
      totalValue,
      todayCount,
    };
  }, [tabReturns, activeTab]);

  // Deliveries eligible for return
  const eligibleDeliveries = useMemo(() => {
    return deliveries.filter(
      (d) => d.status === "delivered" || d.status === "confirmed",
    );
  }, [deliveries]);

  const tabTitle =
    activeTab === "gas"
      ? t("returns.gasTitle")
      : activeTab === "cylinder"
        ? t("returns.cylTitle")
        : t("returns.prodTitle");

  const tabDesc =
    activeTab === "gas"
      ? t("returns.gasDesc")
      : activeTab === "cylinder"
        ? t("returns.cylDesc")
        : t("returns.prodDesc");

  return (
    <div className="space-y-4">
      <PageHeader
        title={tabTitle}
        description={tabDesc}
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setNewReturnDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("returns.processReturn")}
            </Button>
          </div>
        }
      />

      {/* Segmented Navigation Tabs matching InventoryPage */}
      <div className="flex items-center gap-2 rounded-xl bg-card/60 p-1.5 shadow-sm border backdrop-blur-sm w-fit">
        <Button
          variant={activeTab === "gas" ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-8 gap-2 px-3 text-xs font-medium rounded-lg transition-all",
            activeTab === "gas" && "shadow-sm",
          )}
          onClick={() => navigate({ to: "/returns", search: { tab: "gas" } })}
        >
          <Flame className="h-3.5 w-3.5" />
          {t("returns.gasTitle")}
        </Button>
        <Button
          variant={activeTab === "cylinder" ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-8 gap-2 px-3 text-xs font-medium rounded-lg transition-all",
            activeTab === "cylinder" && "shadow-sm",
          )}
          onClick={() => navigate({ to: "/returns", search: { tab: "cylinder" } })}
        >
          <Cylinder className="h-3.5 w-3.5" />
          {t("returns.cylTitle")}
        </Button>
        <Button
          variant={activeTab === "product" ? "default" : "ghost"}
          size="sm"
          className={cn(
            "h-8 gap-2 px-3 text-xs font-medium rounded-lg transition-all",
            activeTab === "product" && "shadow-sm",
          )}
          onClick={() => navigate({ to: "/returns", search: { tab: "product" } })}
        >
          <Package className="h-3.5 w-3.5" />
          {t("returns.prodTitle")}
        </Button>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("returns.statTotal")}
          value={String(stats.totalCount)}
          icon={RotateCcw}
          tone="default"
        />
        <StatCard
          title={
            activeTab === "gas"
              ? t("returns.statGas")
              : activeTab === "cylinder"
                ? t("returns.statCylinders")
                : t("returns.statProducts")
          }
          value={String(stats.totalQty)}
          icon={FileText}
          tone="info"
        />
        <StatCard
          title={t("returns.statValue")}
          value={formatCurrency(stats.totalValue)}
          icon={Undo2}
          tone="positive"
        />
        <StatCard
          title="Today's Returns"
          value={String(stats.todayCount)}
          icon={RotateCcw}
          tone="default"
        />
      </div>

      {/* Returns Data Table */}
      <DataTable<ReturnRecord>
        rows={tabReturns}
        searchKeys={["returnNo", "challanNo", "customerName", "reason"]}
        dateKey="returnDate"
        onRowClick={(r) => setSelectedReturn(r)}
        columns={[
          {
            key: "returnDate",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.returnDate,
            render: (r) => formatDate(r.returnDate),
          },
          {
            key: "returnNo",
            header: t("returns.returnNo"),
            sortable: true,
            sortValue: (r) => r.returnNo,
            render: (r) => <span className="font-mono text-xs font-semibold">{r.returnNo}</span>,
          },
          {
            key: "challanNo",
            header: t("returns.challanNo"),
            sortable: true,
            sortValue: (r) => r.challanNo,
            render: (r) => (
              <Link
                to="/deliveries/$id"
                params={{ id: r.deliveryId }}
                className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {r.challanNo}
              </Link>
            ),
          },
          {
            key: "customerName",
            header: t("common.customer"),
            sortable: true,
            sortValue: (r) => r.customerName,
            render: (r) => <span className="font-medium text-sm">{r.customerName}</span>,
          },
          {
            key: "items",
            header: t("sales.item"),
            render: (r) => {
              const matchedItems = r.items.filter((it) => it.itemType === activeTab);
              return (
                <div className="flex flex-wrap gap-1 max-w-xs">
                  {matchedItems.map((it, idx) => (
                    <Badge key={idx} variant="outline" className="text-[11px] gap-1">
                      <span>{it.productName}:</span>
                      <strong>{it.returnQuantity}</strong>
                      {it.cylinderCondition && (
                        <span className="text-muted-foreground uppercase text-[9px]">
                          ({it.cylinderCondition})
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              );
            },
          },
          {
            key: "qty",
            header: t("common.quantity"),
            sortable: true,
            sortValue: (r) =>
              r.items
                .filter((it) => it.itemType === activeTab)
                .reduce((s, it) => s + it.returnQuantity, 0),
            render: (r) => {
              const tabQty = r.items
                .filter((it) => it.itemType === activeTab)
                .reduce((s, it) => s + it.returnQuantity, 0);
              return <span className="font-semibold tabular-nums">{tabQty}</span>;
            },
          },
          {
            key: "amount",
            header: t("common.total"),
            sortable: true,
            sortValue: (r) =>
              r.items
                .filter((it) => it.itemType === activeTab)
                .reduce((s, it) => s + it.subtotal, 0),
            render: (r) => {
              const tabAmount = r.items
                .filter((it) => it.itemType === activeTab)
                .reduce((s, it) => s + it.subtotal, 0);
              return <span className="tabular-nums font-mono text-xs">{formatCurrency(tabAmount)}</span>;
            },
          },
          {
            key: "status",
            header: t("common.status"),
            sortable: true,
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge variant="default" className="text-[10px] capitalize">
                {r.status}
              </Badge>
            ),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => setSelectedReturn(r)}
              />
            ),
          },
        ]}
      />

      {/* Return Details Modal with Printable Return Note */}
      {selectedReturn && (
        <Dialog open={Boolean(selectedReturn)} onOpenChange={() => setSelectedReturn(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>{t("returns.viewDetails")} · {selectedReturn.returnNo}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 mr-6"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" />
                  {t("common.print")}
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2 print-sheet">
              <PrintDocHeader
                title="Customer Return Note"
                subtitle={`Return Ref: ${selectedReturn.returnNo}`}
                right={
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold">{selectedReturn.returnNo}</p>
                    <p className="text-xs text-muted-foreground">
                      Challan: {selectedReturn.challanNo}
                    </p>
                    <Badge className="mt-1 text-[10px] uppercase">{selectedReturn.status}</Badge>
                  </div>
                }
              />

              <div className="grid grid-cols-2 gap-4 text-xs border rounded-md p-3 bg-muted/20">
                <div>
                  <p className="font-semibold text-muted-foreground uppercase text-[10px]">
                    Customer Information
                  </p>
                  <p className="font-medium text-sm pt-0.5">{selectedReturn.customerName}</p>
                  {selectedReturn.customerPhone && (
                    <p className="text-muted-foreground">{selectedReturn.customerPhone}</p>
                  )}
                  {selectedReturn.customerAddress && (
                    <p className="text-muted-foreground">{selectedReturn.customerAddress}</p>
                  )}
                </div>
                <div className="space-y-1 text-right">
                  <p>
                    <span className="text-muted-foreground">Return Date: </span>
                    <strong>{formatDate(selectedReturn.returnDate)}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Original Challan: </span>
                    <strong className="font-mono">{selectedReturn.challanNo}</strong>
                  </p>
                  {selectedReturn.receiverName && (
                    <p>
                      <span className="text-muted-foreground">Receiver: </span>
                      {selectedReturn.receiverName}
                    </p>
                  )}
                  {selectedReturn.driverName && (
                    <p>
                      <span className="text-muted-foreground">Deliveryman: </span>
                      {selectedReturn.driverName}
                    </p>
                  )}
                </div>
              </div>

              {selectedReturn.reason && (
                <div className="text-xs border rounded-md p-2 bg-card">
                  <span className="font-semibold text-muted-foreground">Reason / Notes: </span>
                  {selectedReturn.reason}
                </div>
              )}

              {/* Items List Table */}
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>{t("common.product")}</TableHead>
                      <TableHead>{t("common.type")}</TableHead>
                      <TableHead>{t("returns.condition")}</TableHead>
                      <TableHead className="text-right">{t("returns.returnQty")}</TableHead>
                      <TableHead className="text-right">{t("common.price")}</TableHead>
                      <TableHead className="text-right">{t("common.subtotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedReturn.items.map((it, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-xs">{it.productName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {it.itemType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs capitalize">
                          {it.cylinderCondition || "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {it.returnQuantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {formatCurrency(it.price)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-xs">
                          {formatCurrency(it.subtotal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between items-center text-sm font-semibold border-t pt-2">
                <span>Total Return Value</span>
                <span className="font-mono text-base text-primary">
                  {formatCurrency(selectedReturn.totalAmount)}
                </span>
              </div>

              <PrintSignatures left="Authorized Store Officer" right="Customer / Returning Party" />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Select Delivery for New Return Modal */}
      <Dialog open={newReturnDialogOpen} onOpenChange={setNewReturnDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              <span>Select Delivery Challan for Return</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Choose an active delivery challan to process returned gas, cylinders, or products.
            </p>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {eligibleDeliveries.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No confirmed or delivered challans available.
                </div>
              ) : (
                eligibleDeliveries.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                    onClick={() => {
                      setNewReturnDialogOpen(false);
                      navigate({ to: "/deliveries/$id/return", params: { id: d.id } });
                    }}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm">{d.challanNo}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {d.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Customer: <strong>{d.customerName}</strong>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Items: {d.items?.map((it) => `${it.productName} (${it.quantity})`).join(", ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-primary font-medium">Select →</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
