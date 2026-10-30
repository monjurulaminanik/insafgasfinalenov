import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PayrollValidationError } from "./payroll";

const amount = z
  .number()
  .finite()
  .nonnegative()
  .max(1e12)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001,
    "সর্বোচ্চ দুই দশমিক ঘর ব্যবহার করুন",
  );
const method = z.string().trim().min(1).max(120);
const date = z.string().datetime({ offset: true });
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advances") }),
  z.object({
    action: z.literal("advance"),
    employeeId: z.string().min(1),
    amount: amount.refine((value) => value > 0),
    date,
    paymentMethod: method,
    requestId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("pay"),
    id: z.string().min(1),
    method,
    paymentDate: date,
    advanceRecovery: amount,
    requestId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("save"),
    id: z.string().optional(),
    employeeId: z.string().min(1),
    month: z.string(),
    basic: amount,
    bonus: amount,
    allowance: amount,
    deduction: amount,
  }),
  z.object({ action: z.literal("remove"), id: z.string().min(1) }),
]);

export type PayrollCommand = z.infer<typeof input>;

export const payrollFn = createServerFn({ method: "POST" })
  .inputValidator((value: z.infer<typeof input>) => value)
  .handler(async ({ data: raw }) => {
    const { requireUser } = await import("./session.server");
    const { assertPermission } = await import("./rbac");
    const user = await requireUser();
    const parsed = input.safeParse(raw);
    if (!parsed.success)
      return { validationError: parsed.error.issues.map((issue) => issue.message).join("; ") };
    const data = parsed.data;
    assertPermission(
      user,
      data.action === "advances"
        ? "payroll.read"
        : data.action === "remove"
          ? "payroll.delete"
          : data.action === "pay" || (data.action === "save" && data.id)
            ? "payroll.update"
            : "payroll.create",
    );
    const { getDb, getMongoClient } = await import("./mongo.server");
    const db = await getDb();
    if (data.action === "advances") {
      return (await db.collection("salaryAdvances").find({}).toArray()).map(
        ({ _id, ...row }) => row,
      );
    }
    const { executePayrollTransaction } = await import("./payroll.server");
    try {
      return await executePayrollTransaction(db, await getMongoClient(), data, user);
    } catch (error) {
      // Only known business validation failures are confirmed safe to edit/retry.
      // Driver/network errors remain uncertain; clients must retain their request id.
      if (error instanceof PayrollValidationError) return { validationError: error.message };
      throw error;
    }
  });
