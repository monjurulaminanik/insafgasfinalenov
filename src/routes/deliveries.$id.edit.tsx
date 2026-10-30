import { createFileRoute } from "@tanstack/react-router";
import { ChallanForm } from "@/components/delivery/ChallanForm";

export const Route = createFileRoute("/deliveries/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Delivery · Insaf Gas Corp" }] }),
  component: DeliveryEdit,
});

function DeliveryEdit() {
  const { id } = Route.useParams();
  return <ChallanForm id={id} />;
}
