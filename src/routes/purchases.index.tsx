import { createFileRoute } from "@tanstack/react-router";
import { PurchaseList } from "@/components/purchase/PurchaseList";

export const Route = createFileRoute("/purchases/")({
  head: () => ({ meta: [{ title: "Purchases · Insaf Gas Corp" }] }),
  component: PurchaseList,
});
