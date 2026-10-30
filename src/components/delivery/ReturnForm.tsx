import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw, AlertTriangle, ArrowLeft } from "lucide-react";
import { returnService } from "@/services/return.service";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { CylinderReturnCondition } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type ItemReturnState = {
  productId: string;
  returnQuantity: number;
  cylinderCondition: CylinderReturnCondition;
};

export function ReturnForm({ deliveryId }: { deliveryId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    data: summary,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["deliveryReturnSummary", deliveryId],
    queryFn: () => returnService.getDeliverySummary(deliveryId),
  });

  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [returnItems, setReturnItems] = useState<Record<string, ItemReturnState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Initialize return items map
  useEffect(() => {
    if (!summary?.items) return;
    const initial: Record<string, ItemReturnState> = {};
    for (const it of summary.items) {
      initial[it.productId] = {
        productId: it.productId,
        returnQuantity: 0,
        cylinderCondition: "empty",
      };
    }
    setReturnItems(initial);
  }, [summary]);

  const updateItemQty = (productId: string, qty: number, maxQty: number) => {
    const validQty = Math.max(0, Math.min(maxQty, Number(qty) || 0));
    setReturnItems((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        returnQuantity: validQty,
      },
    }));
  };

  const updateItemCondition = (productId: string, condition: CylinderReturnCondition) => {
    setReturnItems((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        cylinderCondition: condition,
      },
    }));
  };

  const fillFullReturn = () => {
    if (!summary?.items) return;
    const updated: Record<string, ItemReturnState> = {};
    for (const it of summary.items) {
      updated[it.productId] = {
        productId: it.productId,
        returnQuantity: it.remainingReturnableQuantity,
        cylinderCondition: returnItems[it.productId]?.cylinderCondition || "empty",
      };
    }
    setReturnItems(updated);
    toast.info("Eligible quantities selected for full return");
  };

  const clearAllReturn = () => {
    if (!summary?.items) return;
    const cleared: Record<string, ItemReturnState> = {};
    for (const it of summary.items) {
      cleared[it.productId] = {
        productId: it.productId,
        returnQuantity: 0,
        cylinderCondition: returnItems[it.productId]?.cylinderCondition || "empty",
      };
    }
    setReturnItems(cleared);
  };

  // Selected items with returnQuantity > 0
  const selectedItems = (summary?.items || [])
    .map((it) => {
      const state = returnItems[it.productId];
      const returnQty = state?.returnQuantity || 0;
      const subtotal = returnQty * it.price;
      return {
        ...it,
        returnQuantity: returnQty,
        cylinderCondition: state?.cylinderCondition || "empty",
        subtotal,
      };
    })
    .filter((it) => it.returnQuantity > 0);

  const totalReturnUnits = selectedItems.reduce((sum, it) => sum + it.returnQuantity, 0);
  const totalReturnValue = selectedItems.reduce((sum, it) => sum + it.subtotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (selectedItems.length === 0) {
        throw new Error(t("returns.noItemsSelected"));
      }

      for (const it of selectedItems) {
        if (it.returnQuantity > it.remainingReturnableQuantity) {
          throw new Error(
            `${t("returns.exceedsRemaining")}: ${it.productName} (${it.returnQuantity} > ${it.remainingReturnableQuantity})`,
          );
        }
      }

      return returnService.processReturn({
        deliveryId,
        returnDate: new Date(returnDate).toISOString(),
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        items: selectedItems.map((it) => ({
          productId: it.productId,
          returnQuantity: it.returnQuantity,
          cylinderCondition: it.itemType === "cylinder" ? it.cylinderCondition : undefined,
          cylinderIds: it.cylinderIds,
        })),
      });
    },
    onSuccess: (record) => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveryReturnSummary", deliveryId] });
      qc.invalidateQueries({ queryKey: ["returns"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["inventorySummary"] });

      toast.success(t("returns.success"));
      setConfirmOpen(false);
      navigate({
        to: "/returns",
        search: {
          tab:
            record.itemClassification === "gas"
              ? "gas"
              : record.itemClassification === "cylinder"
                ? "cylinder"
                : "product",
        },
      });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
    },
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (isError || !summary) {
    return (
      <div className="p-6 text-sm text-destructive">
        Delivery challan could not be loaded for returns.
      </div>
    );
  }

  const { delivery, items, totalRemaining, isFullyReturned } = summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${t("returns.processReturn")} · ${delivery.challanNo}`}
        description={`${t("common.customer")}: ${delivery.customerName}`}
        backTo={`/deliveries/${delivery.id}`}
        backLabel={t("deliveries.title")}
      />

      {isFullyReturned && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{t("returns.allReturned")}</span>
        </div>
      )}

      {/* Top Delivery & Customer Information (matching Sales Order Form pattern) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("common.customer")}</Label>
              <Input disabled value={delivery.customerName} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("sales.receiver")}</Label>
              <Input disabled value={delivery.receiverName || "—"} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("deliveries.deliveryman")}</Label>
              <Input disabled value={delivery.driverName || "—"} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("sales.contactNo")}</Label>
              <Input disabled value={delivery.customerPhone || "—"} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("deliveries.vehicle")}</Label>
              <Input disabled value={delivery.vehicleNo || "—"} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("returns.date")}</Label>
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
              <Label>{t("common.address")}</Label>
              <Input disabled value={delivery.customerAddress || "—"} />
            </div>

            <div className="space-y-1.5">
              <Label>{t("returns.reason")}</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("returns.reasonOptional")}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label>{t("common.notes")}</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optionalNotes")}
              />
            </div>
          </div>

          {/* Quick Return Mode Actions */}
          {!isFullyReturned && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                Enter quantities below to process a <strong>Partial Return</strong>, or click{" "}
                <strong>{t("returns.fullReturn")}</strong> to return all remaining items.
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fillFullReturn}
                  disabled={totalRemaining <= 0}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  {t("returns.fullReturn")} ({totalRemaining})
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAllReturn}>
                  {t("common.all")} 0
                </Button>
              </div>
            </div>
          )}

          {/* Delivered Items & Return Selection Table */}
          <div className="overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="min-w-[11rem]">{t("common.product")}</TableHead>
                    <TableHead className="w-24">{t("common.category")}</TableHead>
                    <TableHead className="w-28">{t("common.type")}</TableHead>
                    <TableHead className="w-24 text-right">{t("returns.deliveredQty")}</TableHead>
                    <TableHead className="w-24 text-right">{t("returns.alreadyReturned")}</TableHead>
                    <TableHead className="w-28 text-right font-semibold">
                      {t("returns.remainingQty")}
                    </TableHead>
                    <TableHead className="w-32 text-right text-primary font-bold">
                      {t("returns.returnQty")}
                    </TableHead>
                    <TableHead className="w-32">{t("returns.condition")}</TableHead>
                    <TableHead className="w-28 text-right">{t("common.price")}</TableHead>
                    <TableHead className="w-28 text-right">{t("common.subtotal")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, idx) => {
                    const current = returnItems[it.productId] || {
                      productId: it.productId,
                      returnQuantity: 0,
                      cylinderCondition: "empty",
                    };
                    const isExhausted = it.remainingReturnableQuantity <= 0;
                    const rowSubtotal = current.returnQuantity * it.price;

                    return (
                      <TableRow
                        key={it.productId}
                        className={cn(isExhausted && "opacity-60 bg-muted/20")}
                      >
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="min-w-[11rem]">
                          <div className="font-medium text-sm">{it.productName}</div>
                          {it.unit && (
                            <span className="text-[10px] text-muted-foreground uppercase">
                              Unit: {it.unit}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {it.category || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              it.itemType === "gas"
                                ? "default"
                                : it.itemType === "cylinder"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="capitalize text-[11px]"
                          >
                            {it.itemType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.deliveredQuantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {it.previouslyReturnedQuantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {it.remainingReturnableQuantity}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={it.remainingReturnableQuantity}
                            value={current.returnQuantity === 0 ? "" : current.returnQuantity}
                            placeholder="0"
                            disabled={isExhausted}
                            onChange={(e) =>
                              updateItemQty(
                                it.productId,
                                Number(e.target.value),
                                it.remainingReturnableQuantity,
                              )
                            }
                            className="w-24 ml-auto text-right font-medium"
                          />
                        </TableCell>
                        <TableCell>
                          {it.itemType === "cylinder" ? (
                            <Select
                              value={current.cylinderCondition}
                              disabled={isExhausted || current.returnQuantity <= 0}
                              onValueChange={(val) =>
                                updateItemCondition(it.productId, val as CylinderReturnCondition)
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="empty">{t("returns.condition.empty")}</SelectItem>
                                <SelectItem value="full">{t("returns.condition.full")}</SelectItem>
                                <SelectItem value="damaged">{t("returns.condition.damaged")}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {formatCurrency(it.price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatCurrency(rowSubtotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Return Summary Box */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 rounded-md border bg-card p-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Return Summary</div>
              <div className="text-xs text-muted-foreground">
                Selected for return: <strong>{totalReturnUnits} items</strong> across{" "}
                <strong>{selectedItems.length} product(s)</strong>
              </div>
            </div>
            <div className="w-full md:w-auto text-right space-y-1">
              <div className="text-xs text-muted-foreground">{t("returns.statValue")}</div>
              <div className="text-xl font-bold font-mono text-primary">
                {formatCurrency(totalReturnValue)}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate({ to: "/deliveries/$id", params: { id: delivery.id } })}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (selectedItems.length === 0) {
                  toast.error(t("returns.noItemsSelected"));
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={selectedItems.length === 0 || mutation.isPending}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              {t("returns.saveReturn")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Explicit Confirmation Dialog before committing */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("returns.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2 text-left">
              <span>{t("returns.confirmDesc")}</span>
              <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/30">
                <p>
                  <strong>Delivery Challan:</strong> {delivery.challanNo}
                </p>
                <p>
                  <strong>Customer:</strong> {delivery.customerName}
                </p>
                <p>
                  <strong>Items Returning:</strong> {totalReturnUnits} units
                </p>
                <ul className="list-disc pl-4 pt-1 space-y-0.5">
                  {selectedItems.map((it) => (
                    <li key={it.productId}>
                      {it.productName} ({it.itemType}): <strong>{it.returnQuantity} units</strong>
                      {it.itemType === "cylinder" && ` [Condition: ${it.cylinderCondition}]`}
                    </li>
                  ))}
                </ul>
                <p className="pt-1 text-primary font-medium">
                  <strong>Total Value:</strong> {formatCurrency(totalReturnValue)}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t("returns.saving") : t("returns.saveReturn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
