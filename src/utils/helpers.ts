import type { LineItem } from "@/types";

export const lineAmount = (item: LineItem) =>
  (Number(item.price) || 0) * (Number(item.quantity) || 0);

export const computeTotals = (items: LineItem[]) => {
  const subtotal = items.reduce((s, i) => s + lineAmount(i), 0);
  return { subtotal, tax: 0, total: subtotal };
};

export function paymentStatus(total: number, paid: number): "unpaid" | "partial" | "paid" {
  if ((paid || 0) <= 0.009) return "unpaid";
  if ((paid || 0) + 0.009 >= (total || 0) && (total || 0) > 0) return "paid";
  return "partial";
}

let clientSeq = 0;

export const formatDocumentNumber = (prefix: string, year: number, seq: number) => {
  return `${prefix.toUpperCase()}-${year}-${String(seq).padStart(6, "0")}`;
};

export const genOrderNo = (prefix = "SO") => {
  const y = new Date().getFullYear();
  clientSeq += 1;
  const randOffset = Math.floor(Math.random() * 800000 + 100000);
  return `${prefix.toUpperCase()}-${y}-${String(randOffset + clientSeq).padStart(6, "0")}`;
};

export function isSupplierReturnFullyReceived(
  sr: Pick<import("@/types").SupplierReturn, "status" | "items">,
): boolean {
  if (sr.status === "received") return true;
  if (!sr.items || sr.items.length === 0) return true;
  return sr.items.every((it) => {
    const ordered = Number(it.quantity) || 0;
    const received = Number(it.receivedQty) || 0;
    return received >= ordered;
  });
}

export function supplierReturnPendingQty(item: LineItem): number {
  const ordered = Number(item.quantity) || 0;
  const received = Number(item.receivedQty) || 0;
  return Math.max(0, ordered - received);
}
