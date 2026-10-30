import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Truck, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supplierReturnService } from "@/services/supplier-return.service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { SupplierReturn } from "@/types";
import { useT } from "@/i18n";

type ItemReceiveState = {
  productId: string;
  productName: string;
  returnedQty: number;
  previouslyReceived: number;
  pendingQty: number;
  receiveNow: string;
};

export function ReceiveSupplierDeliveryDialog({
  open,
  onOpenChange,
  supplierReturn,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierReturn: SupplierReturn | null;
  onSuccess?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemReceiveState[]>([]);
  const requestIdRef = useRef("");

  useEffect(() => {
    if (!open || !supplierReturn) return;

    requestIdRef.current = `srd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");

    const initial = (supplierReturn.items || []).map((it) => {
      const returned = Number(it.quantity) || 0;
      const prev = Number(it.receivedQty) || 0;
      const pending = Math.max(0, returned - prev);
      return {
        productId: it.productId,
        productName: it.productName,
        returnedQty: returned,
        previouslyReceived: prev,
        pendingQty: pending,
        receiveNow: String(pending),
      };
    });
    setItems(initial);
  }, [open, supplierReturn]);

  const updateItemQty = (productId: string, val: string) => {
    setItems((prev) =>
      prev.map((it) => (it.productId === productId ? { ...it, receiveNow: val } : it)),
    );
  };

  const handleReceiveAll = () => {
    setItems((prev) => prev.map((it) => ({ ...it, receiveNow: String(it.pendingQty) })));
  };

  const handleClearAll = () => {
    setItems((prev) => prev.map((it) => ({ ...it, receiveNow: "0" })));
  };

  const parsedTotals = useMemo(() => {
    let totalPending = 0;
    let totalReceiving = 0;
    let hasError = false;

    for (const it of items) {
      totalPending += it.pendingQty;
      const n = parseInt(it.receiveNow, 10);
      if (isNaN(n) || n < 0 || n > it.pendingQty) {
        hasError = true;
      } else {
        totalReceiving += n;
      }
    }

    return { totalPending, totalReceiving, hasError };
  }, [items]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!supplierReturn) throw new Error("No supplier return selected");
      if (parsedTotals.hasError) {
        throw new Error(
          t("supplierReturns.invalidQty") || "Received quantity cannot exceed pending quantity",
        );
      }
      if (parsedTotals.totalReceiving <= 0) {
        throw new Error(
          t("supplierReturns.noQtyToReceive") || "Please enter at least one quantity to receive",
        );
      }

      const payloadItems = items.map((it) => ({
        productId: it.productId,
        quantity: Math.max(0, parseInt(it.receiveNow, 10) || 0),
      }));

      return supplierReturnService.receiveDelivery({
        id: supplierReturn.id,
        requestId: requestIdRef.current,
        date,
        notes: notes.trim() || undefined,
        items: payloadItems,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplierReturns"] });
      if (supplierReturn) {
        qc.invalidateQueries({ queryKey: ["supplierReturns", supplierReturn.id] });
      }
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });

      toast.success(
        t("supplierReturns.deliveryReceived") || "Delivery received successfully. Stock updated.",
      );
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending || parsedTotals.hasError || parsedTotals.totalReceiving <= 0) return;
    mutation.mutate();
  };

  if (!supplierReturn) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {t("supplierReturns.receiveDeliveryTitle")}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {supplierReturn.returnNo} · {supplierReturn.supplierName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Action Helper Toolbar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md border">
            <div>
              {t("supplierReturns.pendingQty")}:{" "}
              <span className="font-semibold text-foreground">{parsedTotals.totalPending}</span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={handleClearAll}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={handleReceiveAll}
              >
                {t("supplierReturns.receiveAll")}
              </Button>
            </div>
          </div>

          {/* Items Table */}
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">{t("common.product")}</TableHead>
                  <TableHead className="w-20 text-right text-xs font-semibold">
                    {t("supplierReturns.returnedQty")}
                  </TableHead>
                  <TableHead className="w-20 text-right text-xs font-semibold">
                    {t("supplierReturns.receivedQty")}
                  </TableHead>
                  <TableHead className="w-20 text-right text-xs font-semibold">
                    {t("supplierReturns.pendingQty")}
                  </TableHead>
                  <TableHead className="w-28 text-right text-xs font-semibold text-primary">
                    {t("supplierReturns.receiveNow")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => {
                  const valNum = parseInt(row.receiveNow, 10);
                  const isItemErr = isNaN(valNum) || valNum < 0 || valNum > row.pendingQty;

                  return (
                    <TableRow key={row.productId}>
                      <TableCell className="py-2.5">
                        <div className="font-medium text-sm">{row.productName}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs py-2.5">
                        {row.returnedQty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground py-2.5">
                        {row.previouslyReceived}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold text-foreground py-2.5">
                        {row.pendingQty}
                      </TableCell>
                      <TableCell className="text-right py-2.5">
                        <Input
                          type="number"
                          min="0"
                          max={row.pendingQty}
                          step="1"
                          value={row.receiveNow}
                          onChange={(e) => updateItemQty(row.productId, e.target.value)}
                          disabled={row.pendingQty <= 0 || mutation.isPending}
                          className={`h-8 text-right tabular-nums font-semibold ${
                            isItemErr ? "border-destructive focus-visible:ring-destructive" : ""
                          }`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {parsedTotals.hasError && (
            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2.5 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t("supplierReturns.invalidQty")}</span>
            </div>
          )}

          {/* Delivery Date & Notes */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="receive-delivery-date">{t("supplierReturns.deliveryDate")}</Label>
              <Input
                id="receive-delivery-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receive-delivery-notes">{t("supplierReturns.deliveryNotes")}</Label>
              <Input
                id="receive-delivery-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Challan #9876, refilled cylinders"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                parsedTotals.hasError ||
                parsedTotals.totalReceiving <= 0
              }
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {mutation.isPending
                ? t("common.loading") || "Saving..."
                : `${t("supplierReturns.confirmReceive")} (${parsedTotals.totalReceiving})`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
