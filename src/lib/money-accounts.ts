import type { Account } from "@/types";

const CORE_CASH = new Set(["cash"]);
const CORE_BANK = new Set(["bank", "cheque", "mobile"]);

export function isCashBookAccount(account: string, named: Account[] = []) {
  if (CORE_CASH.has(account)) return true;
  return named.some((a) => a.type === "cash" && a.name === account);
}

export function isBankBookAccount(account: string, named: Account[] = []) {
  if (CORE_BANK.has(account)) return true;
  return named.some((a) => a.type !== "cash" && a.name === account);
}
