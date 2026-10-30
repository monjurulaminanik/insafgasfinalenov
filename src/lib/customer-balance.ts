import type { Customer, SalesOrder, Voucher } from "../types/index.ts";
import { parseRecordTime } from "./date-range.ts";

/** Signed opening for customer AR: receivable +, payable −. Legacy docs without a type keep the stored sign. */
export function customerOpeningSigned(
  c: Pick<Customer, "openingBalance" | "openingBalanceType">,
): number {
  const raw = Number(c.openingBalance) || 0;
  if (c.openingBalanceType === "payable") return -Math.abs(raw);
  if (c.openingBalanceType === "receivable") return Math.abs(raw);
  return raw;
}

export function customerOutstanding(c: Customer, sales: SalesOrder[], vouchers: Voucher[]): number {
  const custSales = sales.filter(
    (s) => s.customerId === c.id && s.status !== "cancelled" && s.status !== "draft",
  );
  const totalInvoiced = custSales.reduce((a, s) => a + (s.total || 0), 0);

  const custVouchers = vouchers.filter(
    (v) => v.partyType === "customer" && v.partyId === c.id && v.type !== "journal",
  );
  let voucherCollections = 0;
  for (const v of custVouchers) {
    if (v.type === "receipt") voucherCollections += v.amount || 0;
    else if (v.type === "payment") voucherCollections -= v.amount || 0;
  }

  let unvoucheredPaid = 0;
  for (const s of custSales) {
    const vouchered = custVouchers
      .filter((v) => v.refType === "sales" && v.refId === s.id && v.type === "receipt")
      .reduce((sum, v) => sum + (v.amount || 0), 0);
    unvoucheredPaid += Math.max(0, (s.paid || 0) - vouchered);
  }

  const totalCollected = voucherCollections + unvoucheredPaid;
  return customerOpeningSigned(c) + totalInvoiced - totalCollected;
}

export type CreditReminderNotice = {
  id: string;
  name: string;
  days: number;
  due: number;
};

export function creditReminderNotice(
  c: Customer,
  sales: SalesOrder[],
  vouchers: Voucher[],
  now = Date.now(),
): CreditReminderNotice | null {
  if (!c.creditReminderEnabled) return null;
  const period = Math.floor(Number(c.creditReminderDays) || 0);
  if (period < 1) return null;
  const due = customerOutstanding(c, sales, vouchers);
  if (due <= 0) return null;

  let oldest: number | null =
    customerOpeningSigned(c) > 0 ? (parseRecordTime(c.createdAt) ?? null) : null;
  for (const s of sales) {
    if (s.customerId !== c.id || s.status === "cancelled" || s.status === "draft") continue;
    if ((s.total || 0) - (s.paid || 0) <= 0) continue;
    const t = parseRecordTime(s.date);
    if (t == null) continue;
    oldest = oldest == null ? t : Math.min(oldest, t);
  }
  if (oldest == null) oldest = parseRecordTime(c.createdAt) ?? now;
  const ageDays = Math.floor((now - oldest) / 86400000);
  if (ageDays < period) return null;
  return { id: c.id, name: c.name, days: ageDays, due };
}
