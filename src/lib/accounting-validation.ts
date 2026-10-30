import type { JournalLine } from "../types/index.ts";
import { roundMoney } from "./accounting-engine.ts";

export function validateAccountingJournal(lines: JournalLine[]): boolean {
  if (lines.length < 2) return false;
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (
      !line.accountId ||
      !line.accountName ||
      !Number.isFinite(line.debit) ||
      !Number.isFinite(line.credit) ||
      line.debit < 0 ||
      line.credit < 0 ||
      line.debit > 0 === line.credit > 0 ||
      Math.abs(line.debit - roundMoney(line.debit)) > 1e-8 ||
      Math.abs(line.credit - roundMoney(line.credit)) > 1e-8
    )
      return false;
    debit = roundMoney(debit + line.debit);
    credit = roundMoney(credit + line.credit);
  }
  return debit > 0 && debit === credit;
}

export function validateAccountingAsset(
  name: string,
  date: string,
  cost: number,
  value: number,
): boolean {
  return (
    !!name.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date &&
    Number.isFinite(cost) &&
    Number.isFinite(value) &&
    cost >= 0 &&
    value >= 0
  );
}
