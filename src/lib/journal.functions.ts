import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  date: z.string(),
  notes: z.string().max(2000).optional(),
  requestId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        accountName: z.string().min(1),
        debit: z.number().finite().nonnegative(),
        credit: z.number().finite().nonnegative(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .min(2)
    .max(100),
});

export const postJournalFn = createServerFn({ method: "POST" })
  .inputValidator((data: z.infer<typeof schema>) => schema.parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { assertPermission } = await import("./rbac");
    const { getDb, getMongoClient } = await import("./mongo.server");
    const { executeJournalTransaction } = await import("./journal.server");
    const user = await requireUser();
    assertPermission(user, "accounting.create");
    return executeJournalTransaction(await getDb(), await getMongoClient(), data, user.username);
  });

export const removeJournalFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => z.object({ id: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { assertPermission } = await import("./rbac");
    const { getDb, getMongoClient } = await import("./mongo.server");
    const { removeJournalTransaction } = await import("./journal.server");
    const user = await requireUser();
    assertPermission(user, "accounting.delete");
    return removeJournalTransaction(await getDb(), await getMongoClient(), data.id, user.username);
  });
