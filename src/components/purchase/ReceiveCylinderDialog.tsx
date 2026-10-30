import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { isCylinderProduct, parseSerials, suggestSerials } from "@/lib/cylinder-product";
import { lineOrderedQty, lineReceivedQty, lineRemainingQty } from "@/lib/purchase-qty";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurchaseOrder } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

export function ReceiveCylinderDialog({
  po,
  open,
  onOpenChange,
  onReceive,
  pending,
}: {
  po: PurchaseOrder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onReceive: (payload: {
    serialsByItem?: string[][];
    lotNumber?: string;
    qtyByItem?: number[];
    requestId?: string;
  }) => void;
  pending?: boolean;
}) {
  const t = useT();
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylinders = [], refetch: refetchCylinders } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: tracking = "serial" } = useQuery({
    queryKey: ["cylinderTracking"],
    queryFn: () => getCylinderTrackingFn(),
  });
  const [texts, setTexts] = useState<string[]>([]);
  const [qtys, setQtys] = useState<string[]>([]);
  const [lotNumber, setLotNumber] = useState("");
  const requestIdRef = useRef("");

  const lines = useMemo(
    () =>
      po.items.map((it, index) => ({
        it,
        index,
        product: products.find((p) => p.id === it.productId),
        ordered: lineOrderedQty(it),
        received: lineReceivedQty(it, po),
        remaining: lineRemainingQty(it, po),
      })),
    [po, products],
  );

  useEffect(() => {
    if (!open) return;
    requestIdRef.current = `grn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setLotNumber("");
    setQtys(po.items.map((it) => String(lineRemainingQty(it, po))));
    setTexts(po.items.map(() => ""));
    void refetchCylinders();
  }, [open, po, refetchCylinders]);

  const parsedQty = (index: number) => {
    const n = Number(qtys[index]);
    return Number.isFinite(n) ? n : 0;
  };

  const ready =
    lines.every(({ it, index, remaining, product }) => {
      const qty = parsedQty(index);
      if (qty < 0 || qty > remaining) return false;
      if (qty === 0) return true;
      if (tracking === "lot") return Boolean(lotNumber.trim());
      if (tracking === "serial" && (isCylinderProduct(product) || it.itemType === "cylinder")) {
        const serials = parseSerials(texts[index] || "");
        if (serials.length === 0) return true;
        return serials.length === qty;
      }
      return true;
    }) && lines.some((_, index) => parsedQty(index) > 0);

  const hasCylinders = lines.some(
    (row) => (isCylinderProduct(row.product) || row.it.itemType === "cylinder") && parsedQty(row.index) > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {hasCylinders ? t("purchases.receiveCylinders") : t("purchases.receive")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {tracking === "lot" && hasCylinders && (
            <div className="space-y-1.5">
              <Label>{t("inventory.lotNumber")}</Label>
              <Input
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
                placeholder="LOT-2026-001"
              />
            </div>
          )}
          {lines.map(({ it, index, product, ordered, received, remaining }) => {
            const qty = parsedQty(index);
            const serials = parseSerials(texts[index] || "");
            const cyl = isCylinderProduct(product) || it.itemType === "cylinder";
            return (
              <section key={index} className="space-y-2 rounded-lg border p-3">
                <p className="font-medium">{it.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("purchases.orderedQty")}: {ordered} · {t("purchases.receivedQty")}: {received}{" "}
                  · {t("purchases.remainingQty")}: {remaining}
                </p>
                <div className="space-y-1.5">
                  <Label>{t("purchases.receiveNow")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    step="1"
                    value={qtys[index] ?? ""}
                    onChange={(e) =>
                      setQtys((prev) => prev.map((row, i) => (i === index ? e.target.value : row)))
                    }
                  />
                </div>
                {tracking === "serial" && cyl && qty > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {t("deliveries.selectedCount", { selected: serials.length, qty })}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-testid="generate-serials"
                        onClick={async () => {
                          const fresh = await refetchCylinders();
                          const list = fresh.data ?? cylinders;
                          const existing = [
                            ...list
                              .filter((c) => c.productId === (product?.id || it.productId))
                              .map((c) => c.serialNumber),
                            ...texts.flatMap((row, i) =>
                              i === index ? [] : parseSerials(row || ""),
                            ),
                          ];
                          const generated = suggestSerials(
                            product?.code || it.productName,
                            qty,
                            existing,
                          );
                          setTexts((prev) =>
                            prev.map((row, i) => (i === index ? generated.join("\n") : row)),
                          );
                        }}
                      >
                        {t("purchases.generateSerials")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("purchases.serialHint", { qty })}
                    </p>
                    <Textarea
                      rows={Math.min(6, Math.max(3, qty))}
                      value={texts[index] || ""}
                      onChange={(e) =>
                        setTexts((prev) =>
                          prev.map((row, i) => (i === index ? e.target.value : row)),
                        )
                      }
                      placeholder="INS-001"
                    />
                  </>
                )}
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!ready || pending}
            data-testid="grn-submit"
            onClick={() => {
              if (pending || !ready) return;
              onReceive({
                qtyByItem: po.items.map((_, i) => parsedQty(i)),
                serialsByItem:
                  tracking === "serial"
                    ? po.items.map((_, i) => parseSerials(texts[i] || ""))
                    : undefined,
                lotNumber: lotNumber || undefined,
                requestId: requestIdRef.current,
              });
            }}
          >
            {t("purchases.receive")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
