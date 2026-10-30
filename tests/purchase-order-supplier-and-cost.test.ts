import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { purchaseOrderSchema } from "../src/utils/validators.ts";
import { computeTotals, lineAmount } from "../src/utils/helpers.ts";
import type { Supplier, LineItem } from "../src/types/index.ts";

function cleanLeadingZeros(val: string): string {
  if (val === "" || val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s === "") return "";
  if (/^00+\./.test(s)) return s.replace(/^0+/, "0");
  if (/^0\d/.test(s)) return s.replace(/^0+(?=\d)/, "");
  return s;
}

function resolveSupplier(
  typedName: string,
  selectedId: string,
  suppliers: Supplier[],
): { supplierId: string; supplierName: string } {
  const sName = typedName.trim();
  if (!sName) throw new Error("Select a supplier");

  const matched = suppliers.find(
    (s) =>
      s.name.trim().toLowerCase() === sName.toLowerCase() ||
      (selectedId && s.id === selectedId),
  );

  return {
    supplierId: matched ? matched.id : selectedId || sName,
    supplierName: matched ? matched.name : sName,
  };
}

describe("Purchase Order — Supplier Editable & Cost Leading Zeros Tests", () => {
  const mockSuppliers: Supplier[] = [
    {
      id: "sup-1",
      name: "Jamuna Gas Ltd",
      phone: "01711000001",
      address: "Dhaka",
      openingBalance: 0,
    },
    {
      id: "sup-2",
      name: "Bashundhara LP Gas",
      phone: "01711000002",
      address: "Chittagong",
      openingBalance: 0,
    },
    {
      id: "sup-3",
      name: "Omera Petroleum",
      phone: "01711000003",
      address: "Sylhet",
      openingBalance: 0,
    },
  ];

  describe("1. Cost Field Leading Zero Normalization", () => {
    it("removes single leading zero: '0800' -> '800'", () => {
      assert.equal(cleanLeadingZeros("0800"), "800");
    });

    it("removes multiple leading zeros: '00050' -> '50'", () => {
      assert.equal(cleanLeadingZeros("00050"), "50");
    });

    it("removes leading zero from 4-digit numbers: '01200' -> '1200'", () => {
      assert.equal(cleanLeadingZeros("01200"), "1200");
    });

    it("preserves standalone single zero: '0' -> '0'", () => {
      assert.equal(cleanLeadingZeros("0"), "0");
    });

    it("reduces multiple zeros to single zero: '00' -> '0', '000' -> '0'", () => {
      assert.equal(cleanLeadingZeros("00"), "0");
      assert.equal(cleanLeadingZeros("000"), "0");
    });

    it("preserves empty input: '' -> ''", () => {
      assert.equal(cleanLeadingZeros(""), "");
    });

    it("preserves valid decimals starting with zero: '0.50' -> '0.50'", () => {
      assert.equal(cleanLeadingZeros("0.50"), "0.50");
    });

    it("preserves decimal typing in progress: '0.' -> '0.', '0.0' -> '0.0'", () => {
      assert.equal(cleanLeadingZeros("0."), "0.");
      assert.equal(cleanLeadingZeros("0.0"), "0.0");
    });

    it("normalizes multiple zeros before decimal: '00.5' -> '0.5'", () => {
      assert.equal(cleanLeadingZeros("00.5"), "0.5");
    });

    it("leaves standard numbers untouched: '1200' -> '1200', '800' -> '800'", () => {
      assert.equal(cleanLeadingZeros("1200"), "1200");
      assert.equal(cleanLeadingZeros("800"), "800");
    });
  });

  describe("2. Supplier Field Resolution (Select + Type)", () => {
    it("resolves existing supplier by dropdown selection ID and name", () => {
      const res = resolveSupplier("Jamuna Gas Ltd", "sup-1", mockSuppliers);
      assert.equal(res.supplierId, "sup-1");
      assert.equal(res.supplierName, "Jamuna Gas Ltd");
    });

    it("resolves existing supplier if user typed matching name (case-insensitive)", () => {
      const res = resolveSupplier("bashundhara lp gas", "", mockSuppliers);
      assert.equal(res.supplierId, "sup-2");
      assert.equal(res.supplierName, "Bashundhara LP Gas");
    });

    it("resolves custom supplier name that does not exist in master records", () => {
      const res = resolveSupplier("Apex Industrial Gas Ltd", "", mockSuppliers);
      assert.equal(res.supplierId, "Apex Industrial Gas Ltd");
      assert.equal(res.supplierName, "Apex Industrial Gas Ltd");
    });

    it("throws validation error if supplier is empty", () => {
      assert.throws(() => resolveSupplier("", "", mockSuppliers), /Select a supplier/);
      assert.throws(() => resolveSupplier("   ", "", mockSuppliers), /Select a supplier/);
    });

    it("passes purchaseOrderSchema validation for both existing and custom suppliers", () => {
      const lineItems: LineItem[] = [
        {
          productId: "p1",
          productName: "LPG Refill 12kg",
          quantity: 2,
          price: 800,
          itemType: "gas",
        },
      ];

      // Existing supplier
      const existingParsed = purchaseOrderSchema.safeParse({
        supplierId: "sup-1",
        items: lineItems,
      });
      assert.ok(existingParsed.success);

      // Custom supplier
      const customParsed = purchaseOrderSchema.safeParse({
        supplierId: "Global Gas Supply Co.",
        items: lineItems,
      });
      assert.ok(customParsed.success);
    });
  });

  describe("3. Calculations & Line Totals Preservation", () => {
    it("correctly calculates line total and grand total with cleaned cost", () => {
      const costStr = cleanLeadingZeros("0800"); // "800"
      const costNum = Number(costStr); // 800

      const items: LineItem[] = [
        {
          productId: "p1",
          productName: "Product A",
          quantity: 3,
          price: costNum,
        },
        {
          productId: "p2",
          productName: "Product B",
          quantity: 2,
          price: 50, // from cleanLeadingZeros("00050")
        },
      ];

      assert.equal(lineAmount(items[0]), 2400); // 3 * 800
      assert.equal(lineAmount(items[1]), 100); // 2 * 50

      const totals = computeTotals(items);
      assert.equal(totals.subtotal, 2500);
      assert.equal(totals.total, 2500);
    });

    it("handles decimal cost accurately", () => {
      const costStr = cleanLeadingZeros("0.50");
      const costNum = Number(costStr);

      const items: LineItem[] = [
        {
          productId: "p1",
          productName: "Product A",
          quantity: 10,
          price: costNum,
        },
      ];

      assert.equal(lineAmount(items[0]), 5);
      const totals = computeTotals(items);
      assert.equal(totals.total, 5);
    });
  });
});
