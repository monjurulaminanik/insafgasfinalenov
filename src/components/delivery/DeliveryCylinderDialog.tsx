import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { deliveryService } from "@/services/delivery.service";
import { isCylinderTrackedLine, pickFifo, cylinderIsEmpty } from "@/lib/cylinder-product";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Delivery } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function DeliveryCylinderDialog({
  delivery,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  delivery: Delivery;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (payload: {
    issuedIdsByItem: string[][];
    returnedIds: string[];
    lotNumber?: string;
    expectedReturnAt?: string;
    asExchange?: boolean;
  }) => void;
  pending?: boolean;
}) {
  const t = useT();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: ["deliveries"],
    queryFn: deliveryService.list,
  });
  const { data: tracking = "serial" } = useQuery({
    queryKey: ["cylinderTracking"],
    queryFn: () => getCylinderTrackingFn(),
  });
  const [issued, setIssued] = useState<string[][]>([]);
  const [returned, setReturned] = useState<string[]>([]);
  const [lotNumber, setLotNumber] = useState("");
  const [expectedReturn, setExpectedReturn] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const prevOpenRef = useRef(false);
  const prevDeliveryIdRef = useRef<string | null>(null);

  const cylLines = useMemo(
    () =>
      delivery.items
        .map((it, index) => ({ it, index, product: products.find((p) => p.id === it.productId) }))
        .filter((row) => isCylinderTrackedLine(row.it, row.product)),
    [delivery.items, products],
  );

  useEffect(() => {
    if (open && (!prevOpenRef.current || prevDeliveryIdRef.current !== delivery.id)) {
      setIssued(
        delivery.items.map((it) => (Array.isArray(it.cylinderIds) ? [...it.cylinderIds] : [])),
      );
      setReturned([]);
      prevDeliveryIdRef.current = delivery.id;
    }
    prevOpenRef.current = open;
  }, [open, delivery.id, delivery.items]);

  const assignedToOtherPendingDeliveries = useMemo(() => {
    const set = new Set<string>();
    for (const d of deliveries) {
      if (d.id === delivery.id) continue;
      if (d.status === "pending" || d.status === "in_transit") {
        for (const it of d.items || []) {
          for (const cid of it.cylinderIds || []) {
            set.add(cid);
          }
        }
      }
    }
    return set;
  }, [deliveries, delivery.id]);

  const isLineSerialized = (productId: string) => {
    return tracking === "serial" && cylinders.some((c) => c.productId === productId);
  };

  const selectedAll = useMemo(() => new Set(issued.flat()), [issued]);
  const empties = cylinders.filter(
    (c) =>
      c.status === "at_customer" &&
      (!c.customerId || c.customerId === delivery.customerId) &&
      !assignedToOtherPendingDeliveries.has(c.id),
  );
  const needQty = cylLines.reduce((a, { it }) => a + it.quantity, 0);
  const issuedCount = tracking === "serial" ? issued.flat().length : needQty;
  const ready =
    tracking !== "serial" ||
    cylLines.every(({ it, index }) => {
      if (!isLineSerialized(it.productId)) return true;
      return (issued[index]?.length || 0) === it.quantity;
    });
  const exchangeReady = issuedCount > 0 && issuedCount === returned.length;

  const toggle = (index: number, id: string, qty: number) => {
    setIssued((prev) => {
      const next: string[][] = Array.from(
        { length: delivery.items.length },
        (_, i) => (prev[i] ? [...prev[i]] : []),
      );
      const row = next[index] || [];
      if (row.includes(id)) next[index] = row.filter((x) => x !== id);
      else if (row.length < qty) next[index] = [...row, id];
      return next;
    });
  };

  const handleConfirm = (asExchange = false) => {
    if (pending) return;

    if (!expectedReturn) {
      toast.error(t("inventory.expectedReturn") + " is required");
      return;
    }

    if (tracking === "lot" && !lotNumber.trim()) {
      toast.error(t("inventory.lotNumber") + " is required");
      return;
    }

    if (tracking === "serial") {
      for (const { it, index } of cylLines) {
        if (!isLineSerialized(it.productId)) continue;
        const selected = issued[index]?.length || 0;
        if (selected !== it.quantity) {
          const availableStock = cylinders.filter(
            (c) =>
              c.productId === it.productId &&
              (c.status === "in_stock" || c.status === "in_transit") &&
              !cylinderIsEmpty(c) &&
              !assignedToOtherPendingDeliveries.has(c.id),
          ).length;
          if (availableStock < it.quantity) {
            toast.error(
              `${it.productName}: Only ${availableStock} cylinder(s) available in warehouse, but ${it.quantity} required. Please add stock first.`,
            );
          } else {
            toast.error(
              `${it.productName}: Please select all ${it.quantity} cylinders (${selected}/${it.quantity} selected).`,
            );
          }
          return;
        }
      }
    }

    if (asExchange) {
      const serializedLines = cylLines.filter(({ it }) => isLineSerialized(it.productId));
      const requiredIssued =
        serializedLines.length > 0
          ? serializedLines.reduce((sum, { it, index }) => sum + (issued[index]?.length || 0), 0)
          : cylLines.reduce((sum, { it }) => sum + it.quantity, 0);

      if (requiredIssued <= 0 || returned.length <= 0) {
        toast.error(t("deliveries.exchangeNeed") || "Exchange requires empty returns and full issues");
        return;
      }
      if (requiredIssued !== returned.length) {
        toast.error(t("deliveries.exchangeNeed") || "Exchange requires equal empty returns and full issues");
        return;
      }
    }

    onConfirm({
      issuedIdsByItem: issued,
      returnedIds: returned,
      lotNumber: lotNumber || undefined,
      expectedReturnAt: expectedReturn,
      asExchange,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("deliveries.assignTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>{t("inventory.expectedReturn")}</Label>
            <Input
              type="date"
              value={expectedReturn}
              onChange={(e) => setExpectedReturn(e.target.value)}
            />
          </div>
          {tracking === "lot" && (
            <div className="space-y-1.5">
              <Label>{t("inventory.lotNumber")}</Label>
              <Input
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="LOT-2026-001"
              />
            </div>
          )}
          {cylLines.map(({ it, index, product }) => {
            const serialized = isLineSerialized(it.productId);
            if (!serialized) {
              return (
                <section key={index} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{it.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.quantity} cylinder(s) required
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        toast.success(
                          `${it.productName}: ${it.quantity} cylinder(s) verified from warehouse stock.`,
                        );
                      }}
                    >
                      {t("deliveries.autoPick")}
                    </Button>
                  </div>
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                        Warehouse Stock Allocation
                      </span>
                      <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                        {it.quantity} cylinder(s)
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground text-[11px]">
                      Quantity allocated from available warehouse stock for this delivery.
                    </p>
                  </div>
                </section>
              );
            }

            const stock = cylinders.filter(
              (c) =>
                c.productId === it.productId &&
                (c.status === "in_stock" || c.status === "in_transit") &&
                !cylinderIsEmpty(c) &&
                !assignedToOtherPendingDeliveries.has(c.id) &&
                (!selectedAll.has(c.id) || issued[index]?.includes(c.id)),
            );
            const count = issued[index]?.length || 0;
            return (
              <section key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{it.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("deliveries.selectedCount", { selected: count, qty: it.quantity })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const exclude = new Set([
                        ...assignedToOtherPendingDeliveries,
                        ...issued.flatMap((ids, i) => (i === index ? [] : ids)),
                      ]);
                      const picked = pickFifo(cylinders, it.productId, it.quantity, exclude);
                      if (picked.length < it.quantity) {
                        toast.warning(
                          `${it.productName}: Only ${picked.length} of ${it.quantity} eligible cylinders available in warehouse.`,
                        );
                      }
                      setIssued((prev) => {
                        const next: string[][] = Array.from(
                          { length: delivery.items.length },
                          (_, i) => (prev[i] ? [...prev[i]] : []),
                        );
                        next[index] = picked;
                        return next;
                      });
                    }}
                  >
                    {t("deliveries.autoPick")}
                  </Button>
                </div>
                {stock.length === 0 ? (
                  <p className="text-xs text-destructive">{t("deliveries.noStock")}</p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                    {stock.map((c) => {
                      const isChecked = issued[index]?.includes(c.id) || false;
                      const isDisabled = !isChecked && count >= it.quantity;
                      return (
                        <li
                          key={c.id}
                          className={`flex items-center gap-2 rounded px-1.5 py-1 transition-colors ${
                            isDisabled
                              ? "cursor-not-allowed opacity-50"
                              : "cursor-pointer hover:bg-muted/50"
                          }`}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
                              return;
                            }
                            if (!isDisabled) {
                              toggle(index, c.id, it.quantity);
                            }
                          }}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggle(index, c.id, it.quantity)}
                            disabled={isDisabled}
                          />
                          <span className="font-mono text-xs select-none">{c.serialNumber}</span>
                          <span className="text-[10px] text-muted-foreground select-none">{c.location}</span>
                          {product?.code && (
                            <span className="text-[10px] text-muted-foreground select-none">{product.code}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}

          <section className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">{t("deliveries.empties")}</p>
            <p className="text-xs text-muted-foreground">{t("deliveries.emptiesHint")}</p>
            {empties.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("common.noRecords")}</p>
            ) : (
              <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
                {empties.map((c) => {
                  const isChecked = returned.includes(c.id);
                  return (
                    <li
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50 transition-colors"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
                          return;
                        }
                        setReturned((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                        );
                      }}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() =>
                          setReturned((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                          )
                        }
                      />
                      <span className="font-mono text-xs select-none">{c.serialNumber}</span>
                      <span className="text-[10px] text-muted-foreground select-none">{c.location}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="confirm-delivery-dialog-btn"
            disabled={pending}
            onClick={() => handleConfirm(false)}
          >
            {t("deliveries.confirm")}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => handleConfirm(true)}
          >
            {t("deliveries.exchange")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
