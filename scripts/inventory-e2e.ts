/**
 * Live Atlas inventory verification. Tagged docs only; cleaned up in finally.
 * npx vite-node scripts/inventory-e2e.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { executePurchaseReceive, issueStockInDb } from "../src/lib/purchase.functions";
import { getDb, getMongoClient } from "../src/lib/mongo.server";
import { buildProductInventory } from "../src/lib/cylinder-inventory";
import { suggestSerials } from "../src/lib/cylinder-product";
import type { Product, Cylinder, SalesOrder, Delivery, StockMovement } from "../src/types";

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function stockOf(db: Awaited<ReturnType<typeof getDb>>, id: string) {
  const p = await db.collection("products").findOne({ id });
  return Number(p?.stock) || 0;
}

async function poState(db: Awaited<ReturnType<typeof getDb>>, poId: string) {
  const po = await db.collection("purchases").findOne({ id: poId });
  const it = po?.items?.[0];
  return {
    status: po?.status,
    received: Number(it?.receivedQty) || 0,
    ordered: Number(it?.quantity) || 0,
    remaining: Math.max(0, (Number(it?.quantity) || 0) - (Number(it?.receivedQty) || 0)),
    grns: (po?.grns || []) as Array<{ id: string; grnNo: string }>,
  };
}

async function outCount(db: Awaited<ReturnType<typeof getDb>>, refType: string, refId: string) {
  return db.collection("stockMovements").countDocuments({ refType, refId, type: "out" });
}

async function inQty(
  db: Awaited<ReturnType<typeof getDb>>,
  productId: string,
  refType: string,
  refId: string,
) {
  const rows = await db
    .collection("stockMovements")
    .find({ productId, refType, refId, type: "in" })
    .toArray();
  return rows.reduce((a, m) => a + (Number(m.quantity) || 0), 0);
}

function availableOf(
  products: Product[],
  cylinders: Cylinder[],
  sales: SalesOrder[],
  deliveries: Delivery[],
  movements: StockMovement[],
  productId: string,
) {
  const rows = buildProductInventory(products, cylinders, sales, deliveries, movements);
  return rows.find((r) => r.productId === productId)?.available ?? 0;
}

async function main() {
  loadEnv();
  const tag = `e2e-${Date.now()}`;
  const productId = `p-${tag}`;
  const cylId = `c-${tag}`;
  const supplierId = `s-${tag}`;
  const poId = `po-${tag}`;
  const poCylId = `poc-${tag}`;
  const soId = `so-${tag}`;
  const delivId = `d-${tag}`;
  const client = await getMongoClient();
  const db = await getDb();
  const now = new Date().toISOString();
  const refs: Record<string, string> = { tag, productId, poId, soId, delivId, poCylId, cylId };

  try {
    await db.collection("suppliers").insertOne({
      id: supplierId,
      name: `E2E Supplier ${tag}`,
      phone: "N/A",
      address: "E2E",
      openingBalance: 0,
      createdAt: now,
    });
    await db.collection("products").insertOne({
      id: productId,
      code: `E2E-${tag.slice(-6)}`,
      name: `E2E Gas ${tag}`,
      category: "Other",
      productType: "gas",
      uom: "kg",
      price: 10,
      cost: 8,
      stock: 100,
      reorderLevel: 0,
      costingMethod: "fifo",
      createdAt: now,
    });
    await db.collection("products").insertOne({
      id: cylId,
      code: `CYL-${tag.slice(-6)}`,
      name: `E2E Cyl ${tag}`,
      category: "LPG",
      productType: "cylinder",
      uom: "cyl",
      price: 0,
      cost: 5,
      stock: 0,
      reorderLevel: 0,
      costingMethod: "fifo",
      createdAt: now,
    });

    must((await stockOf(db, productId)) === 100, "opening gas stock 100");

    await db.collection("purchases").insertOne({
      id: poId,
      orderNo: `PO-${tag}`,
      supplierId,
      supplierName: `E2E Supplier ${tag}`,
      date: now,
      items: [
        {
          productId,
          productName: `E2E Gas ${tag}`,
          quantity: 200,
          price: 8,
          taxRate: 0,
          receivedQty: 0,
        },
      ],
      subtotal: 1600,
      tax: 0,
      total: 1600,
      paid: 0,
      status: "ordered",
      createdAt: now,
    });
    must((await stockOf(db, productId)) === 100, "PO create must not change stock");

    const k1 = `${tag}-grn1`;
    const po1 = await executePurchaseReceive(
      db,
      null,
      poId,
      { qtyByItem: [50], requestId: k1 },
      "quantity",
    );
    refs.grn1 = po1.grns?.at(-1)?.grnNo || "";
    let s = await stockOf(db, productId);
    let st = await poState(db, poId);
    must(
      s === 150 && st.received === 50 && st.remaining === 150,
      `GRN1 got stock=${s} rec=${st.received} rem=${st.remaining}`,
    );

    await executePurchaseReceive(db, null, poId, { qtyByItem: [50], requestId: k1 }, "quantity");
    must((await stockOf(db, productId)) === 150, "duplicate GRN1 must not post");
    must((await poState(db, poId)).received === 50, "duplicate GRN1 received stays 50");

    const po2 = await executePurchaseReceive(
      db,
      null,
      poId,
      { qtyByItem: [100], requestId: `${tag}-grn2` },
      "quantity",
    );
    refs.grn2 = po2.grns?.at(-1)?.grnNo || "";
    s = await stockOf(db, productId);
    st = await poState(db, poId);
    must(
      s === 250 && st.received === 150 && st.remaining === 50,
      `GRN2 got stock=${s} rec=${st.received}`,
    );

    const po3 = await executePurchaseReceive(
      db,
      null,
      poId,
      { qtyByItem: [50], requestId: `${tag}-grn3` },
      "quantity",
    );
    refs.grn3 = po3.grns?.at(-1)?.grnNo || "";
    s = await stockOf(db, productId);
    st = await poState(db, poId);
    must(
      s === 300 && st.received === 200 && st.remaining === 0 && st.status === "received",
      `GRN3 got stock=${s} status=${st.status}`,
    );

    const ins = await db
      .collection("stockMovements")
      .find({ productId, refType: "purchase", type: "in" })
      .toArray();
    const inTotal = ins.reduce((a, m) => a + (Number(m.quantity) || 0), 0);
    must(inTotal === 200, `purchase IN total ${inTotal}`);

    const zeroProd = await db.collection("products").findOne({ id: productId });
    const availBeforeSo = availableOf([zeroProd as Product], [], [], [], [], productId);
    must(availBeforeSo >= 30, "need stock for sufficient SO");
    const insuffOk =
      10 > availableOf([{ ...(zeroProd as Product), stock: 0 }], [], [], [], [], productId);
    must(insuffOk, "qty 10 vs stock 0 must be insufficient");

    const stockBeforeSo = await stockOf(db, productId);
    await db.collection("sales").insertOne({
      id: soId,
      orderNo: `SO-${tag}`,
      customerId: "e2e",
      customerName: "E2E",
      date: now,
      items: [{ productId, productName: `E2E Gas ${tag}`, quantity: 30, price: 10 }],
      subtotal: 300,
      tax: 0,
      total: 300,
      paid: 0,
      status: "confirmed",
      createdAt: now,
    });
    await db.collection("deliveries").insertOne({
      id: delivId,
      challanNo: `DC-${tag}`,
      salesOrderId: soId,
      customerId: "e2e",
      customerName: "E2E",
      driverName: "",
      vehicleNo: "",
      items: [{ productId, productName: `E2E Gas ${tag}`, quantity: 30, price: 10 }],
      status: "pending",
      date: now,
    });
    must(
      (await stockOf(db, productId)) === stockBeforeSo,
      "SO complete / pending DC must not change stock",
    );
    must((await outCount(db, "sales", soId)) === 0, "SO complete must not create sales OUT");
    must((await outCount(db, "delivery", delivId)) === 0, "pending delivery must not create OUT");

    await issueStockInDb(db, null, productId, 30, {
      refType: "delivery",
      refId: delivId,
      notes: `DC-${tag}`,
      by: "E2E",
    });
    s = await stockOf(db, productId);
    must(s === 270, `delivery OUT expected 270 got ${s}`);
    must((await outCount(db, "delivery", delivId)) === 1, "exactly one delivery OUT");

    await issueStockInDb(db, null, productId, 30, {
      refType: "delivery",
      refId: delivId,
      notes: `DC-${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === 270, "duplicate delivery OUT blocked");
    must((await outCount(db, "delivery", delivId)) === 1, "still one OUT");

    await db.collection("products").updateOne({ id: productId }, { $inc: { stock: 30 } });
    await db.collection("stockMovements").insertOne({
      id: `rev-${tag}`,
      date: new Date().toISOString(),
      productId,
      productName: `E2E Gas ${tag}`,
      type: "in",
      quantity: 30,
      balanceAfter: 300,
      refType: "delivery",
      refId: delivId,
      notes: `Reverse DC-${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === 300, "unfulfill 270+30=300");
    must((await inQty(db, productId, "delivery", delivId)) === 30, "one reverse IN");

    const deliv2 = `${delivId}-2`;
    await issueStockInDb(db, null, productId, 30, {
      refType: "delivery",
      refId: deliv2,
      notes: `DC2-${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === 270, "re-fulfill 300-30=270");
    must((await outCount(db, "delivery", deliv2)) === 1, "re-fulfill one OUT");

    const adjPlus = `adj-plus-${tag}`;
    const beforeAdj = await stockOf(db, productId);
    await db.collection("products").updateOne({ id: productId }, { $inc: { stock: 10 } });
    await db.collection("stockMovements").insertOne({
      id: adjPlus,
      date: new Date().toISOString(),
      productId,
      productName: `E2E Gas ${tag}`,
      type: "in",
      quantity: 10,
      balanceAfter: beforeAdj + 10,
      refType: "adjustment",
      refId: adjPlus,
      notes: `ADJ +10 ${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === beforeAdj + 10, "adj +10");
    const adjMinus = `adj-minus-${tag}`;
    await issueStockInDb(db, null, productId, 10, {
      refType: "adjustment",
      refId: adjMinus,
      notes: `ADJ -10 ${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === beforeAdj, "adj -10 back");
    await issueStockInDb(db, null, productId, 10, {
      refType: "adjustment",
      refId: adjMinus,
      notes: `ADJ -10 ${tag}`,
      by: "E2E",
    });
    must((await stockOf(db, productId)) === beforeAdj, "duplicate adj -10 blocked");

    const finalGas = await stockOf(db, productId);
    const expected = 100 + 200 - 30;
    must(finalGas === expected, `reconcile expected ${expected} got ${finalGas}`);

    await db.collection("purchases").insertOne({
      id: poCylId,
      orderNo: `POC-${tag}`,
      supplierId,
      supplierName: `E2E Supplier ${tag}`,
      date: now,
      items: [
        {
          productId: cylId,
          productName: `E2E Cyl ${tag}`,
          quantity: 5,
          price: 5,
          taxRate: 0,
          receivedQty: 0,
        },
      ],
      subtotal: 25,
      tax: 0,
      total: 25,
      paid: 0,
      status: "ordered",
      createdAt: now,
    });
    const serials1 = suggestSerials(`CYL-${tag.slice(-6)}`, 2);
    await executePurchaseReceive(
      db,
      null,
      poCylId,
      { qtyByItem: [2], serialsByItem: [serials1], requestId: `${tag}-c1` },
      "serial",
    );
    const serials2 = suggestSerials(`CYL-${tag.slice(-6)}`, 2, serials1);
    await executePurchaseReceive(
      db,
      null,
      poCylId,
      { qtyByItem: [2], serialsByItem: [serials2], requestId: `${tag}-c2` },
      "serial",
    );
    const serials3 = suggestSerials(`CYL-${tag.slice(-6)}`, 1, [...serials1, ...serials2]);
    await executePurchaseReceive(
      db,
      null,
      poCylId,
      { qtyByItem: [1], serialsByItem: [serials3], requestId: `${tag}-c3` },
      "serial",
    );
    const cyls = await db.collection("cylinders").find({ productId: cylId }).toArray();
    must(cyls.length === 5, `expected 5 serials got ${cyls.length}`);
    const keys = new Set(cyls.map((c) => String(c.serialNumber).toLowerCase()));
    must(keys.size === 5, "serials unique");
    must(
      cyls.every((c) => c.status === "in_stock" && c.location === "Warehouse"),
      "cylinders in warehouse",
    );
    const cylPo = await poState(db, poCylId);
    must(cylPo.received === 5 && cylPo.remaining === 0, "cylinder PO fully received");
    const cylProduct = await db.collection("products").findOne({ id: cylId });
    const availCyl = availableOf([cylProduct as Product], cyls as Cylinder[], [], [], [], cylId);
    must(availCyl === 5, `cylinder available ${availCyl}`);
    const issued = cyls[0];
    await db
      .collection("cylinders")
      .updateOne({ id: issued.id }, { $set: { status: "at_customer" } });
    const cylsAfter = await db.collection("cylinders").find({ productId: cylId }).toArray();
    const availAfterIssue = availableOf(
      [cylProduct as Product],
      cylsAfter as Cylinder[],
      [],
      [],
      [],
      cylId,
    );
    must(availAfterIssue === 4, `issued serial not available, got ${availAfterIssue}`);

    const poCylLoose = `pol-${tag}`;
    const stockCylBeforeLoose =
      Number((await db.collection("products").findOne({ id: cylId }))?.stock) || 0;
    const cylCountBeforeLoose = await db
      .collection("cylinders")
      .countDocuments({ productId: cylId });
    await db.collection("purchases").insertOne({
      id: poCylLoose,
      orderNo: `POL-${tag}`,
      supplierId,
      supplierName: `E2E Supplier ${tag}`,
      date: now,
      items: [
        {
          productId: cylId,
          productName: `E2E Cyl ${tag}`,
          quantity: 2,
          price: 5,
          taxRate: 0,
          receivedQty: 0,
        },
      ],
      subtotal: 10,
      tax: 0,
      total: 10,
      paid: 0,
      status: "ordered",
      createdAt: now,
    });
    refs.poCylLoose = poCylLoose;
    await executePurchaseReceive(
      db,
      null,
      poCylLoose,
      { qtyByItem: [2], serialsByItem: [[]], requestId: `${tag}-c-loose` },
      "serial",
    );
    const cylCountAfterLoose = await db
      .collection("cylinders")
      .countDocuments({ productId: cylId });
    must(
      cylCountAfterLoose === cylCountBeforeLoose,
      "serial-less GRN must not create fake cylinders",
    );
    const loosePo = await poState(db, poCylLoose);
    must(
      loosePo.received === 2 && loosePo.remaining === 0,
      "serial-less GRN must post received qty",
    );
    const stockCylAfterLoose =
      Number((await db.collection("products").findOne({ id: cylId }))?.stock) || 0;
    must(
      stockCylAfterLoose === stockCylBeforeLoose + 2,
      "serial-less GRN must Inventory IN receive qty only",
    );
    const fakeSerials = await db
      .collection("cylinders")
      .find({ productId: cylId, serialNumber: /placeholder|fake|TEMP|QTY-/i })
      .toArray();
    must(fakeSerials.length === 0, "no placeholder serials");

    console.log("LIVE E2E PASS");
    console.log(
      JSON.stringify(
        {
          refs,
          gas: {
            opening: 100,
            afterPoCreate: 100,
            afterGrn50: 150,
            afterGrn100: 250,
            afterGrn50b: 300,
            afterSoComplete: 300,
            afterDelivery30: 270,
            afterUnfulfill: 300,
            afterRefulfill: 270,
            afterAdjNet: finalGas,
            expected,
          },
          cylinder: { serials: 5, availableFull: 5, afterOneIssued: 4 },
        },
        null,
        2,
      ),
    );
  } finally {
    await db.collection("stockMovements").deleteMany({ productId: { $in: [productId, cylId] } });
    await db.collection("costLayers").deleteMany({ productId: { $in: [productId, cylId] } });
    await db.collection("cylinders").deleteMany({ productId: cylId });
    await db.collection("movements").deleteMany({ notes: new RegExp(tag) });
    await db.collection("purchases").deleteMany({ id: { $in: [poId, poCylId, `pol-${tag}`] } });
    await db.collection("sales").deleteOne({ id: soId });
    await db.collection("deliveries").deleteMany({ id: { $in: [delivId, `${delivId}-2`] } });
    await db.collection("products").deleteMany({ id: { $in: [productId, cylId] } });
    await db.collection("suppliers").deleteOne({ id: supplierId });
    await client.close();
  }
}

main().catch((e) => {
  console.error("LIVE E2E FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
