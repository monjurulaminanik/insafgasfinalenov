import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { productSchema } from "../src/utils/validators.ts";

describe("Product Add/Edit — Category & Product Type Custom Input Tests", () => {
  const baseValidProduct = {
    name: "Standard LPG 12kg",
    category: "LPG",
    productType: "gas",
    uom: "kg" as const,
    price: 1450,
    cost: 1200,
    costingMethod: "fifo" as const,
  };

  it("1. Accepts standard existing Category options (LPG, Industrial, Medical, Other)", () => {
    for (const cat of ["LPG", "Industrial", "Medical", "Other"]) {
      const res = productSchema.safeParse({ ...baseValidProduct, category: cat });
      assert.equal(res.success, true, `Failed for category: ${cat}`);
      if (res.success) {
        assert.equal(res.data.category, cat);
      }
    }
  });

  it("2. Accepts custom manually typed Category values", () => {
    const customCategories = [
      "Specialty Gas",
      "Commercial Propane",
      "Refrigerant",
      "Auto Gas",
      "Hardware & Accessories",
    ];
    for (const cat of customCategories) {
      const res = productSchema.safeParse({ ...baseValidProduct, category: cat });
      assert.equal(res.success, true, `Failed for custom category: ${cat}`);
      if (res.success) {
        assert.equal(res.data.category, cat);
      }
    }
  });

  it("3. Rejects empty or whitespace-only Category", () => {
    const invalidCats = ["", "   ", "\t"];
    for (const cat of invalidCats) {
      const res = productSchema.safeParse({ ...baseValidProduct, category: cat });
      assert.equal(res.success, false, `Should fail for invalid category: '${cat}'`);
    }
  });

  it("4. Accepts standard existing Product Type options (gas, cylinder, product)", () => {
    for (const type of ["gas", "cylinder", "product"]) {
      const res = productSchema.safeParse({ ...baseValidProduct, productType: type });
      assert.equal(res.success, true, `Failed for productType: ${type}`);
      if (res.success) {
        assert.equal(res.data.productType, type);
      }
    }
  });

  it("5. Accepts custom manually typed Product Type values", () => {
    const customTypes = [
      "Bulk Gas",
      "Composite Cylinder",
      "Spare Parts",
      "Welding Equipment",
      "Chemical Reagent",
    ];
    for (const type of customTypes) {
      const res = productSchema.safeParse({ ...baseValidProduct, productType: type });
      assert.equal(res.success, true, `Failed for custom productType: ${type}`);
      if (res.success) {
        assert.equal(res.data.productType, type);
      }
    }
  });

  it("6. Rejects empty or whitespace-only Product Type", () => {
    const invalidTypes = ["", "   ", "\t"];
    for (const type of invalidTypes) {
      const res = productSchema.safeParse({ ...baseValidProduct, productType: type });
      assert.equal(res.success, false, `Should fail for invalid productType: '${type}'`);
    }
  });

  it("7. Supports custom Category and custom Product Type simultaneously", () => {
    const res = productSchema.safeParse({
      ...baseValidProduct,
      category: "Special Bio-Fuel",
      productType: "Bio Energy",
    });
    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.category, "Special Bio-Fuel");
      assert.equal(res.data.productType, "Bio Energy");
    }
  });
});
