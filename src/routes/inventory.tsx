import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { InventoryPage } from "@/components/inventory/InventoryPage";

const inventorySearchSchema = z.object({
  tab: z.enum(["gas", "cylinder", "product", "summary"]).optional().catch("gas"),
});

export const Route = createFileRoute("/inventory")({
  validateSearch: (search) => inventorySearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Inventory · Insaf Gas Corp" }] }),
  component: InventoryPage,
});
