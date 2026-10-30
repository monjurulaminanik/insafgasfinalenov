import { createServerFn } from "@tanstack/react-start";
import type { StockAdjustmentInput } from "./stock-adjustment.server";
import { stockAdjustmentSchema } from "./stock-adjustment-input";

export const adjustStockFn = createServerFn({ method: "POST" })
  .inputValidator((input: StockAdjustmentInput) => stockAdjustmentSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { assertPermission } = await import("./rbac");
    const { getDb, getMongoClient } = await import("./mongo.server");
    const { adjustStockInDb } = await import("./stock-adjustment.server");
    const user = await requireUser();
    assertPermission(user, "inventory.adjust");
    const db = await getDb();
    const session = (await getMongoClient()).startSession();
    try {
      return await session.withTransaction(async () => {
        const movement = await adjustStockInDb(db, session, data, user.username);
        return movement;
      });
    } finally {
      await session.endSession();
    }
  });
