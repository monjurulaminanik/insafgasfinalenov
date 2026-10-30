import { it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import type { Db, MongoClient } from "mongodb";
import { MemoryDb } from "./helpers/memory-db.ts";
import { executeAssetTransaction } from "../src/lib/assets.server.ts";
import {
  AssetValidationError,
  type AssetCommand,
  type CreateAssetInput,
} from "../src/lib/assets.ts";
import {
  computeBalanceSheet,
  computeProfitAndLoss,
  computeCashFlow,
} from "../src/lib/accounting-engine.ts";

function fixture(extra: Record<string, any[]> = {}) {
  const memory = new MemoryDb({
    ledger: [
      {
        id: "opening",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 500,
        category: "opening",
      },
      {
        id: "equity",
        date: "2026-01-01",
        account: "Owner Capital",
        direction: "out",
        amount: 500,
        category: "journal",
      },
    ],
    ...extra,
  });
  let queue = Promise.resolve();
  let active: unknown;
  let failure = "";
  let failAfter = 1;
  let ended = 0;
  const client = {
    startSession() {
      const base = memory.client.startSession();
      const session = {
        async withTransaction<T>(work: () => Promise<T>) {
          const previous = queue;
          let release!: () => void;
          queue = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          active = session;
          try {
            return await base.withTransaction(work);
          } finally {
            active = undefined;
            release();
          }
        },
        async endSession() {
          ended++;
        },
      };
      return session;
    },
  };
  const db = {
    collection(name: string) {
      const collection = memory.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          const method = target[property as keyof typeof target];
          if (typeof method !== "function") return method;
          return (...args: any[]) => {
            const optionIndex = ["updateOne", "findOneAndUpdate"].includes(String(property))
              ? 2
              : 1;
            assert.ok(active, "every database operation must be inside the transaction");
            assert.equal(
              args[optionIndex]?.session,
              active,
              "every operation must use the same session",
            );
            if (name === failure && property === "insertOne" && --failAfter === 0)
              throw new Error("injected write failure");
            return (method as Function).apply(target, args);
          };
        },
      });
    },
  };
  return {
    memory,
    run: (command: AssetCommand) =>
      executeAssetTransaction(
        db as unknown as Db,
        client as unknown as MongoClient,
        command,
        "tester",
      ),
    fail: (name: string, after = 1) => {
      failure = name;
      failAfter = after;
    },
    ended: () => ended,
    bs: () =>
      computeBalanceSheet({
        ledger: memory.rows("ledger") as any,
        products: [],
        customers: [],
        suppliers: [],
        sales: [],
        purchases: [],
        assets: memory.rows("assets") as any,
        stockMovements: [],
        expenses: [],
        vouchers: memory.rows("vouchers") as any,
        chartOfAccounts: memory.rows("chartOfAccounts") as any,
      }),
  };
}
const create = (extra: Partial<CreateAssetInput> = {}): AssetCommand => ({
  action: "create",
  requestId: randomUUID(),
  name: "Van",
  category: "Vehicles",
  purchaseDate: "2026-01-01",
  postingDate: "2026-01-01",
  purchaseCost: 100,
  currentValue: 100,
  acquisition: "paid",
  paymentAccount: "cash",
  ...extra,
});

it("paid acquisition persists asset, balanced journal, one cash credit, audit and replay atomically", async () => {
  const f = fixture();
  const input = create();
  const first = await f.run(input);
  assert.equal(first.asset?.accountingStatus, "posted");
  assert.equal(f.memory.rows("assets").length, 1);
  assert.equal(f.memory.rows("vouchers").length, 1);
  const voucher = f.memory.rows("vouchers")[0];
  assert.equal(voucher.lines[0].assetId, first.asset!.id);
  assert.equal(voucher.lines[0].notes, `[asset:${first.asset!.id}]`);
  assert.equal(voucher.lines[0].debit, voucher.lines[1].credit);
  assert.equal(
    f.memory.rows("ledger").filter((l) => l.refId === voucher.id && l.account === "cash").length,
    1,
  );
  assert.equal(f.bs().cash, 400);
  assert.equal(f.bs().fixedAssets, 100);
  assert.equal(f.bs().isBalanced, true);
  const snapshot = f.memory.snapshot();
  assert.deepEqual(await f.run(input), first);
  assert.deepEqual(f.memory.snapshot(), snapshot);
  await assert.rejects(
    () => f.run({ ...input, name: "Changed" } as AssetCommand),
    AssetValidationError,
  );
  assert.deepEqual(f.memory.snapshot(), snapshot);
  assert.equal(f.ended(), 3);
});

it("opening and credit acquisition post capital/payable without inventing a cash payment", async () => {
  for (const acquisition of ["opening", "credit"] as const) {
    const f = fixture();
    await f.run(create({ acquisition, currentValue: acquisition === "opening" ? 80 : 100 }));
    assert.equal(f.bs().cash, 500);
    assert.equal(f.bs().fixedAssets, acquisition === "opening" ? 80 : 100);
    assert.equal(f.bs().isBalanced, true);
    assert.equal(f.memory.rows("ledger").filter((l) => l.account === "cash").length, 1);
    if (acquisition === "credit") assert.equal(f.bs().journalLiabilities, 100);
    else assert.equal(f.bs().ownerCapital, 580);
  }
});

it("named bank account resolves server-side and acquisition cash flow is investing", async () => {
  const f = fixture({
    accounts: [{ id: "b", name: "Business Bank", type: "bank" }],
    ledger: [
      {
        id: "opening",
        date: "2026-01-01",
        account: "Business Bank",
        direction: "in",
        amount: 500,
        category: "opening",
      },
    ],
  });
  await f.run(create({ paymentAccount: "b" }));
  const cf = computeCashFlow({
    ledger: f.memory.rows("ledger") as any,
    accounts: f.memory.rows("accounts") as any,
  });
  assert.equal(cf.assetPurchases, 100);
  assert.equal(cf.closingCash, 400);
  assert.equal(cf.reconcilesWithLedger, true);
});

it("depreciation updates carrying value and expense exactly once without cash movement", async () => {
  const f = fixture();
  const asset = (await f.run(create())).asset!;
  const command: AssetCommand = {
    action: "depreciate",
    requestId: randomUUID(),
    id: asset.id,
    expectedValue: 100,
    currentValue: 70,
    postingDate: "2026-02-01",
    reason: "Monthly depreciation",
  };
  await f.run(command);
  const snapshot = f.memory.snapshot();
  await f.run(command);
  assert.deepEqual(f.memory.snapshot(), snapshot);
  const pnl = computeProfitAndLoss({
    sales: [],
    stockMovements: [],
    expenses: [],
    vouchers: f.memory.rows("vouchers") as any,
    chartOfAccounts: f.memory.rows("chartOfAccounts") as any,
  });
  assert.equal(pnl.totalExpenses, 30);
  assert.equal(f.bs().cash, 400);
  assert.equal(f.bs().fixedAssets, 70);
  assert.equal(f.bs().isBalanced, true);
  const lines = f.memory.rows("vouchers")[1].lines;
  assert.equal(lines[1].credit, 30);
  assert.equal(lines[1].assetId, asset.id);
  assert.equal(lines[1].notes, `[asset:${asset.id}]`);
  await assert.rejects(
    () => f.run({ ...command, requestId: randomUUID(), currentValue: 50 }),
    /অন্য অনুরোধে/,
  );
  assert.deepEqual(f.memory.snapshot(), snapshot);
});

it("legacy metadata edit does not invent history; explicit opening adoption enables later depreciation", async () => {
  const f = fixture({
    assets: [
      {
        id: "legacy",
        name: "Old van",
        category: "Vehicles",
        purchaseDate: "2020-01-01",
        purchaseCost: 120,
        currentValue: 80,
        createdAt: "2020-01-01",
      },
    ],
  });
  await f.run({
    action: "update",
    requestId: randomUUID(),
    id: "legacy",
    name: "Renamed",
    category: "Vehicles",
  });
  assert.equal(f.memory.rows("vouchers").length, 0);
  assert.equal(f.bs().cash, 500);
  await assert.rejects(
    () =>
      f.run({
        action: "depreciate",
        requestId: randomUUID(),
        id: "legacy",
        expectedValue: 80,
        currentValue: 60,
        postingDate: "2026-02-01",
        reason: "Depreciation",
      }),
    /opening capital/,
  );
  await f.run({
    action: "adopt",
    requestId: randomUUID(),
    id: "legacy",
    expectedValue: 80,
    postingDate: "2026-01-01",
  });
  assert.equal(f.bs().ownerCapital, 580);
  assert.equal(f.bs().isBalanced, true);
  assert.equal(f.bs().cash, 500);
  await f.run({
    action: "depreciate",
    requestId: randomUUID(),
    id: "legacy",
    expectedValue: 80,
    currentValue: 60,
    postingDate: "2026-02-01",
    reason: "Depreciation",
  });
  assert.equal(f.bs().fixedAssets, 60);
  assert.equal(f.bs().isBalanced, true);
});

it("failure on second ledger write or audit rolls back asset, journal, chart and request receipt", async () => {
  for (const [collection, count] of [
    ["ledger", 2],
    ["auditLogs", 1],
  ] as const) {
    const f = fixture();
    const input = create();
    const before = f.memory.snapshot();
    f.fail(collection, count);
    await assert.rejects(() => f.run(input), /injected/);
    assert.deepEqual(f.memory.snapshot(), before);
    assert.equal(f.ended(), 1);
    f.fail("");
    await f.run(input);
    assert.equal(f.bs().isBalanced, true);
  }
});

it("duplicate concurrent requests replay and competing depreciation snapshots cannot double-depreciate", async () => {
  const f = fixture();
  const input = create();
  const [a, b] = await Promise.all([f.run(input), f.run(input)]);
  assert.deepEqual(a, b);
  const command: AssetCommand = {
    action: "depreciate",
    requestId: randomUUID(),
    id: a.asset!.id,
    expectedValue: 100,
    currentValue: 80,
    postingDate: "2026-02-01",
    reason: "Depreciation",
  };
  const results = await Promise.allSettled([
    f.run(command),
    f.run({ ...command, requestId: randomUUID() }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.memory.rows("vouchers").length, 2);
  assert.equal(f.bs().fixedAssets, 80);
});

it("server rejects invalid/retroactive inputs, historic value edits and deletion of posted assets", async () => {
  const f = fixture();
  const empty = f.memory.snapshot();
  for (const input of [
    create({ acquisition: "" as any }),
    create({ purchaseCost: NaN }),
    create({ purchaseDate: "2026-02-30" }),
    create({ paymentAccount: "missing" }),
    create({ currentValue: 99 }),
    create({ purchaseCost: 100.001 }),
    create({ postingDate: "2999-01-01" }),
  ]) {
    await assert.rejects(() => f.run(input), AssetValidationError);
    assert.deepEqual(f.memory.snapshot(), empty);
  }
  const asset = (await f.run(create())).asset!;
  const snapshot = f.memory.snapshot();
  await assert.rejects(
    () => f.run({ action: "remove", requestId: randomUUID(), id: asset.id }),
    /disposal/,
  );
  await assert.rejects(
    () =>
      f.run({
        action: "update",
        requestId: randomUUID(),
        id: asset.id,
        name: "New",
        category: "Vehicles",
        currentValue: 0,
      } as any),
    /অতিরিক্ত/,
  );
  await assert.rejects(
    () =>
      f.run({
        action: "depreciate",
        requestId: randomUUID(),
        id: asset.id,
        expectedValue: 100,
        currentValue: 50,
        postingDate: "2025-01-01",
        reason: "Depreciation",
      }),
    /পূর্বে/,
  );
  assert.deepEqual(f.memory.snapshot(), snapshot);
});

it("unposted legacy removal is atomic but linked legacy journals prevent deletion/adoption", async () => {
  const seed = {
    assets: [
      {
        id: "legacy",
        name: "Old",
        category: "Vehicles",
        purchaseDate: "2020-01-01",
        purchaseCost: 80,
        currentValue: 80,
        createdAt: "2020-01-01",
      },
    ],
  };
  const f = fixture(seed);
  const command: AssetCommand = { action: "remove", id: "legacy", requestId: randomUUID() };
  await f.run(command);
  await f.run(command);
  assert.equal(f.memory.rows("assets").length, 0);
  const linked = fixture({
    ...seed,
    vouchers: [
      { id: "existing", type: "journal", lines: [{ notes: "[asset:legacy]", debit: 80 }] },
    ],
  });
  const before = linked.memory.snapshot();
  await assert.rejects(() => linked.run({ ...command, requestId: randomUUID() }), /disposal/);
  await assert.rejects(
    () =>
      linked.run({
        action: "adopt",
        id: "legacy",
        requestId: randomUUID(),
        expectedValue: 80,
        postingDate: "2026-01-01",
      }),
    /ইতিমধ্যে/,
  );
  assert.deepEqual(linked.memory.snapshot(), before);
});

it("actual _services asset methods use the dedicated transaction transport and never generic CRUD", async () => {
  const f = fixture({ assets: [{ id: "legacy", name: "Old", category: "Vehicles", purchaseDate: "2020-01-01", purchaseCost: 50, currentValue: 50, createdAt: "2020-01-01" }] });
  const commands: AssetCommand[] = [];
  const source = readFileSync(new URL("../src/services/_services.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as any };
  const require = (name: string) => {
    if (name === "@/lib/asset-service") return { mutateAsset: async (command: AssetCommand) => { commands.push(command); return f.run(command); } };
    return { crudFn: () => { throw new Error("Generic CRUD must not receive asset writes"); } };
  };
  runInThisContext(`(function(require,module,exports){${js}\n})`)(require, module, module.exports);
  const service = module.exports.accountingService;
  const { action, ...input } = create() as Extract<AssetCommand, { action: "create" }>;
  const asset = await service.createAsset(input);
  assert.equal(asset.accountingStatus, "posted");
  await service.updateAsset(asset.id, { name: "Updated", category: "Vehicles", requestId: randomUUID() });
  await service.depreciateAsset({ id: asset.id, expectedValue: 100, currentValue: 90, postingDate: "2026-02-01", reason: "Depreciation", requestId: randomUUID() });
  await service.removeAsset("legacy", randomUUID());
  assert.deepEqual(commands.map((c) => c.action), ["create", "update", "depreciate", "remove"]);
  assert.equal(f.memory.rows("assets").length, 1);
  assert.equal(f.memory.rows("assets")[0].currentValue, 90);
  assert.equal(f.bs().isBalanced, true);
});
