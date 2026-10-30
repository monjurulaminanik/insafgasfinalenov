import { z } from "zod";

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

const phoneSchema = z
  .string()
  .min(6, "Phone required")
  .refine((value) => {
    const digits = phoneDigits(value);
    return digits.length >= 6 && digits.length <= 15;
  }, "Enter a valid phone number");

export const customerSchema = z
  .object({
    name: z.string().min(2, "Name required"),
    phone: phoneSchema,
    whatsapp: z.string().optional(),
    address: z.string().min(2, "Address required"),
    creditLimit: z.coerce.number().min(0, "Cannot be negative"),
    openingBalance: z.coerce.number().min(0),
    openingBalanceType: z.enum(["receivable", "payable"]),
    creditReminderEnabled: z.boolean(),
    creditReminderDays: z.coerce.number().optional(),
  })
  .superRefine((val, ctx) => {
    const whatsapp = (val.whatsapp || "").trim();
    if (whatsapp) {
      const digits = phoneDigits(whatsapp);
      if (digits.length < 6 || digits.length > 15) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid WhatsApp number",
          path: ["whatsapp"],
        });
      }
    }
    if ((Number(val.openingBalance) || 0) > 0 && !val.openingBalanceType) {
      ctx.addIssue({
        code: "custom",
        message: "Select opening balance type",
        path: ["openingBalanceType"],
      });
    }
    if (val.creditReminderEnabled) {
      const days = Number(val.creditReminderDays);
      if (!Number.isInteger(days) || days < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a positive number of days",
          path: ["creditReminderDays"],
        });
      }
    }
  });

export const supplierSchema = z.object({
  name: z.string().min(2, "Name required"),
  phone: z.string().min(6, "Phone required"),
  email: z.union([z.literal(""), z.string().email()]).optional(),
  address: z.string().min(2, "Address required"),
  gstin: z.union([z.literal(""), z.string()]).optional(),
  openingBalance: z.coerce.number(),
});

export const productSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(2, "Name required"),
  category: z.string().trim().min(1, "Category required"),
  productType: z.string().trim().min(1, "Product type required"),
  uom: z.enum(["kg", "cyl", "ltr", "pcs"]),
  price: z.coerce.number().min(0),
  cost: z.coerce.number().min(0).optional(),
  image: z.string().nullish(),
  taxRate: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().min(0).optional(),
  reorderLevel: z.coerce.number().min(0).optional(),
  incomeAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(),
  costingMethod: z.enum(["fifo", "lifo", "average"]),
});

export const cylinderSchema = z.object({
  serialNumber: z.string().min(1),
  productId: z.string().min(1),
  capacity: z.coerce.number().min(0),
  status: z.enum([
    "in_stock",
    "at_customer",
    "in_transit",
    "refilling",
    "damaged",
    "lost",
    "scrapped",
    "written_off",
    "stock_out",
  ]),
  location: z.string().min(1),
  gasCategory: z.enum(["LPG", "Industrial", "Medical", "Other"]).optional(),
  customerId: z.string().optional(),
});

export const lineItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  taxRate: z.coerce.number().min(0).optional(),
  cylinderIds: z.array(z.string()).optional(),
  sellCylinder: z.boolean().optional(),
  itemType: z.enum(["gas", "cylinder", "product"]).optional(),
  category: z.string().optional(),
});

export const salesOrderSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().min(2, "Customer name required"),
  notes: z.string().optional(),
  driverName: z.string().optional(),
  receiverName: z.string().optional(),
  items: z.array(lineItemSchema).min(1, "Add at least one item"),
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, "Select a supplier"),
  notes: z.string().optional(),
  items: z.array(lineItemSchema).min(1, "Add at least one item"),
});

export const supplierReturnSchema = z.object({
  supplierId: z.string().optional(),
  supplierName: z.string().min(1, "Select or enter a supplier"),
  notes: z.string().optional(),
  items: z.array(lineItemSchema).min(1, "Add at least one item"),
});

export const deliverySchema = z.object({
  customerId: z.string().min(1, "Select a customer"),
  salesOrderId: z.string().optional(),
  driverName: z.string().min(2, "Driver name required"),
  receiverName: z.string().optional(),
  vehicleNo: z.string().min(2, "Vehicle number required"),
  items: z.array(lineItemSchema).min(1, "Add at least one item"),
});

export const employeeSchema = z.object({
  name: z.string().min(2, "Name required"),
  phone: z.string().min(6, "Phone required"),
  designation: z.string().min(2, "Designation required"),
  department: z.string().min(2, "Department required"),
  joiningDate: z.string().min(1, "Joining date required"),
  salary: z.coerce.number().min(0),
  perDeliveryCommission: z.coerce.number().min(0).optional(),
  image: z.string().nullish(),
});

export const voucherSchema = z.object({
  type: z.enum(["payment", "receipt", "journal"]),
  account: z.string().min(1),
  amount: z.coerce.number().min(1),
  partyType: z.enum(["customer", "supplier", "employee"]).optional(),
  partyId: z.string().optional(),
  partyName: z.string().optional(),
  drAccount: z.string().optional(),
  crAccount: z.string().optional(),
  notes: z.string().optional(),
});

export const journalLineSchema = z.object({
  accountId: z.string().min(1, "Select an account"),
  accountName: z.string().min(1, "Select an account"),
  debit: z.coerce.number().min(0),
  credit: z.coerce.number().min(0),
  notes: z.string().optional(),
});

export const journalEntrySchema = z
  .object({
    date: z.string().min(1, "Date required"),
    notes: z.string().optional(),
    lines: z.array(journalLineSchema).min(2, "Add at least two lines"),
  })
  .superRefine((val, ctx) => {
    let debit = 0;
    let credit = 0;
    val.lines.forEach((line, i) => {
      if (line.debit > 0 && line.credit > 0) {
        ctx.addIssue({
          code: "custom",
          message: "Enter debit or credit, not both",
          path: ["lines", i, "debit"],
        });
      }
      if (line.debit <= 0 && line.credit <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a debit or credit",
          path: ["lines", i, "debit"],
        });
      }
      debit += line.debit;
      credit += line.credit;
    });
    if (debit <= 0) {
      ctx.addIssue({ code: "custom", message: "Amount must be positive", path: ["lines"] });
    }
    if (Math.abs(debit - credit) > 0.009) {
      ctx.addIssue({ code: "custom", message: "Debit and credit must be equal", path: ["lines"] });
    }
  });
