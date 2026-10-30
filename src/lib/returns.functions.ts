import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "./session.server";
import { getDb, getMongoClient } from "./mongo.server";
import {
  getDeliveryReturnSummaryInDb,
  processReturnInDb,
  listReturnsInDb,
  getReturnByIdInDb,
  type DeliveryReturnSummary,
  type ProcessReturnPayload,
} from "./returns.server";
import type { ReturnRecord } from "@/types";

function asError(e: unknown, fallback: string): Error {
  if (e instanceof Error && e.message) return e;
  return new Error(fallback);
}

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

export const getReturnsFn = createServerFn({ method: "GET" })
  .validator((d?: { classification?: "gas" | "cylinder" | "product" }) => d)
  .handler(async ({ data }): Promise<ReturnRecord[]> => {
    await requireUser();
    const db = await getDb();
    const list = await listReturnsInDb(db, data?.classification);
    return JSON.parse(JSON.stringify(list)) as ReturnRecord[];
  });

export const getReturnByIdFn = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<ReturnRecord | null> => {
    await requireUser();
    const db = await getDb();
    const item = await getReturnByIdInDb(db, data.id);
    return item ? (JSON.parse(JSON.stringify(item)) as ReturnRecord) : null;
  });

export const getDeliveryReturnSummaryFn = createServerFn({ method: "GET" })
  .validator((d: { deliveryId: string }) => d)
  .handler(async ({ data }): Promise<DeliveryReturnSummary> => {
    await requireUser();
    const db = await getDb();
    const summary = await getDeliveryReturnSummaryInDb(db, data.deliveryId);
    return JSON.parse(JSON.stringify(summary)) as DeliveryReturnSummary;
  });

export const processReturnFn = createServerFn({ method: "POST" })
  .validator((payload: ProcessReturnPayload) => payload)
  .handler(async ({ data }): Promise<ReturnRecord> => {
    const user = await requireUser();
    const client = await getMongoClient();
    const db = await getDb();

    const session = client.startSession();
    try {
      let result: ReturnRecord | undefined;
      const run = async (tx: unknown) => {
        result = await processReturnInDb(db, tx, data, user);
      };

      try {
        await session.withTransaction(async () => {
          await run(session);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /Transaction numbers are only allowed|replica set member|Transactions are not supported/i.test(
            msg,
          )
        ) {
          await run(null);
        } else {
          console.error("[processReturnFn] Transaction error:", msg);
          throw asError(e, "Could not process return transaction.");
        }
      }

      if (!result) throw new Error("Could not process return transaction.");
      const plainResult = clean<ReturnRecord>(result);
      delete (plainResult as any)._id;
      return JSON.parse(JSON.stringify(plainResult)) as ReturnRecord;
    } catch (e) {
      console.error("[processReturnFn] Handler error:", e);
      throw asError(e, "Could not process return transaction.");
    } finally {
      await session.endSession();
    }
  });
