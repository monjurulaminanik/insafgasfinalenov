import { createFileRoute } from "@tanstack/react-router";
import { PurchaseForm } from "@/components/purchase/PurchaseForm";

export const Route = createFileRoute("/purchases/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Purchase · Insaf Gas Corp" }] }),
  component: PurchaseEdit,
});

function PurchaseEdit() {
  const { id } = Route.useParams();
  return <PurchaseForm id={id} />;
}
