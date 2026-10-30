import { z } from "zod";

export const stockAdjustmentSchema = z
  .object({
    productId: z.string().trim().min(1).max(150),
    quantity: z.number().finite().nonnegative().max(1e9),
    type: z.enum(["in", "out", "adjust"]),
    notes: z.string().trim().min(1, "Stock adjustment reason is required").max(2000),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (value) =>
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value,
        "A valid adjustment date is required",
      ),
    requestId: z.string().regex(/^[\w-]{8,100}$/),
  })
  .strict()
  .refine((value) => value.type === "adjust" || value.quantity > 0, "Quantity must be positive");

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
