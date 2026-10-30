export class AssetValidationError extends Error {}

export type AssetAcquisition = "paid" | "opening" | "credit";
export type CreateAssetInput = {
  requestId: string;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  currentValue: number;
  acquisition: AssetAcquisition;
  postingDate: string;
  paymentAccount?: string;
};
export type AssetCommand =
  | (CreateAssetInput & { action: "create" })
  | { action: "update"; requestId: string; id: string; name: string; category: string }
  | {
      action: "depreciate";
      requestId: string;
      id: string;
      expectedValue: number;
      currentValue: number;
      postingDate: string;
      reason: string;
    }
  | { action: "adopt"; requestId: string; id: string; expectedValue: number; postingDate: string }
  | { action: "remove"; requestId: string; id: string };

export function assetMoney(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.0001
  )
    throw new AssetValidationError("মূল্য শূন্য বা ধনাত্মক এবং সর্বোচ্চ দুই দশমিক ঘরের হতে হবে");
  return Math.round(value * 100) / 100;
}

export function assetDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new AssetValidationError("সঠিক তারিখ দিন");
  return value;
}

export function validateAssetCommand(raw: AssetCommand): AssetCommand {
  if (
    !raw ||
    typeof raw !== "object" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw.requestId || "",
    )
  )
    throw new AssetValidationError("অনুরোধের পরিচয় সঠিক নয়");
  const text = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || value.length > 200)
      throw new AssetValidationError("নাম ও বিবরণ সঠিকভাবে দিন");
    return value.trim();
  };
  const id = () => text((raw as { id?: string }).id);
  let result: AssetCommand;
  switch (raw.action) {
    case "create": {
      if (!["paid", "opening", "credit"].includes(raw.acquisition))
        throw new AssetValidationError("অধিগ্রহণের হিসাব পদ্ধতি নির্বাচন করুন");
      const cost = assetMoney(raw.purchaseCost),
        value = assetMoney(raw.currentValue);
      if (
        cost <= 0 ||
        value > cost ||
        (raw.acquisition !== "opening" && value !== cost) ||
        (raw.acquisition === "opening" && value <= 0)
      )
        throw new AssetValidationError(
          "নতুন ক্রয়ের মূল্য ক্রয়মূল্যের সমান এবং opening value ক্রয়মূল্যের মধ্যে হতে হবে",
        );
      result = {
        action: "create",
        requestId: raw.requestId,
        name: text(raw.name),
        category: text(raw.category),
        purchaseDate: assetDate(raw.purchaseDate),
        purchaseCost: cost,
        currentValue: value,
        acquisition: raw.acquisition,
        postingDate: assetDate(raw.postingDate),
        ...(raw.acquisition === "paid" ? { paymentAccount: text(raw.paymentAccount) } : {}),
      };
      break;
    }
    case "update":
      result = {
        action: "update",
        requestId: raw.requestId,
        id: id(),
        name: text(raw.name),
        category: text(raw.category),
      };
      break;
    case "depreciate":
      result = {
        action: "depreciate",
        requestId: raw.requestId,
        id: id(),
        expectedValue: assetMoney(raw.expectedValue),
        currentValue: assetMoney(raw.currentValue),
        postingDate: assetDate(raw.postingDate),
        reason: text(raw.reason),
      };
      break;
    case "adopt":
      result = {
        action: "adopt",
        requestId: raw.requestId,
        id: id(),
        expectedValue: assetMoney(raw.expectedValue),
        postingDate: assetDate(raw.postingDate),
      };
      break;
    case "remove":
      result = { action: "remove", requestId: raw.requestId, id: id() };
      break;
    default:
      throw new AssetValidationError("সম্পদের action সঠিক নয়");
  }
  // Reject unexpected fields: update cannot silently mutate historic cost/value/payment.
  if (
    Object.keys(raw).some(
      (key) =>
        !(key in result) &&
        !(key === "paymentAccount" && raw.action === "create" && raw.acquisition !== "paid"),
    )
  )
    throw new AssetValidationError("এই action-এ অতিরিক্ত বা ঐতিহাসিক তথ্য পরিবর্তন করা যাবে না");
  return result;
}
