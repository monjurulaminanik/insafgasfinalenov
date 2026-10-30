import type { LineItem, PurchaseOrder, PurchaseStatus } from "@/types";

const FULLY_RECEIVED: PurchaseStatus[] = ["received", "billed", "paid"];

export function lineOrderedQty(item: Pick<LineItem, "quantity">) {
  return Math.max(0, Number(item.quantity) || 0);
}

/** Backward compatible: historical full GRNs have no receivedQty. */
export function lineReceivedQty(item: LineItem, po: Pick<PurchaseOrder, "status">) {
  if (item.receivedQty != null && Number.isFinite(Number(item.receivedQty))) {
    return Math.max(0, Number(item.receivedQty));
  }
  if (FULLY_RECEIVED.includes(po.status)) return lineOrderedQty(item);
  if (item.cylinderIds?.length) return item.cylinderIds.length;
  return 0;
}

export function lineRemainingQty(item: LineItem, po: Pick<PurchaseOrder, "status">) {
  return Math.max(0, lineOrderedQty(item) - lineReceivedQty(item, po));
}

export function poIsFullyReceived(items: LineItem[], po: Pick<PurchaseOrder, "status">) {
  return items.length > 0 && items.every((it) => lineRemainingQty(it, po) <= 0);
}

export function poHasAnyReceived(items: LineItem[], po: Pick<PurchaseOrder, "status">) {
  return items.some((it) => lineReceivedQty(it, po) > 0);
}

export type ReceivingStatus = "none" | "partial" | "received";

export function receivingStatus(
  items: LineItem[],
  po: Pick<PurchaseOrder, "status">,
): ReceivingStatus {
  if (poIsFullyReceived(items, po)) return "received";
  if (poHasAnyReceived(items, po)) return "partial";
  return "none";
}

export function poCanReceive(items: LineItem[], po: Pick<PurchaseOrder, "status">) {
  if (po.status === "cancelled") return false;
  return items.some((it) => lineRemainingQty(it, po) > 0);
}

export function nextPurchaseStatus(
  items: LineItem[],
  po: Pick<PurchaseOrder, "status" | "paid" | "total">,
): PurchaseStatus {
  if (po.status === "cancelled") return po.status;
  const fully = poIsFullyReceived(items, { status: "ordered" });
  if (fully) return "received";
  if (poHasAnyReceived(items, { status: "ordered" })) return "partial";
  if (po.status === "draft") return "draft";
  if (po.status === "billed" || po.status === "paid") return po.status;
  return "ordered";
}
