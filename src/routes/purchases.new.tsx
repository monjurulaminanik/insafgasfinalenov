import { createFileRoute } from "@tanstack/react-router";
import { PurchaseForm } from "@/components/purchase/PurchaseForm";

export const Route = createFileRoute("/purchases/new")({
  head: () => ({ meta: [{ title: "New Purchase · Insaf Gas Corp" }] }),
  component: PurchaseForm,
});
