export function assertFinancialCrudWrite(
  collection: string,
  operation: string,
  payload?: { refType?: string; type?: string; category?: string },
  existing?: Record<string, unknown> | null,
) {
  if (operation === "list" || operation === "get") return;
  if (collection === "payroll") throw new Error("বেতন পরিবর্তনের জন্য HR & Payroll ব্যবহার করুন");
  if (collection === "assets") throw new Error("সম্পদ পরিবর্তনের জন্য Assets module ব্যবহার করুন");
  if (
    (collection === "ledger" || collection === "vouchers") &&
    [payload?.refType, existing?.refType].some(
      (ref) => ref === "payroll" || ref === "salaryAdvance",
    )
  ) {
    throw new Error("বেতন ও অগ্রিমের হিসাব সরাসরি পরিবর্তন করা যাবে না");
  }
  if (
    (collection === "vouchers" && [payload?.type, existing?.type].includes("journal")) ||
    (collection === "ledger" && [payload?.category, existing?.category].includes("journal"))
  ) {
    throw new Error("জার্নাল পরিবর্তনের জন্য dedicated journal posting ব্যবহার করুন");
  }
}
