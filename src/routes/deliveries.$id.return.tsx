import { createFileRoute } from "@tanstack/react-router";
import { ReturnForm } from "@/components/delivery/ReturnForm";

export const Route = createFileRoute("/deliveries/$id/return")({
  head: () => ({ meta: [{ title: "Process Return · Insaf Gas Corp" }] }),
  component: DeliveryReturnRoute,
});

function DeliveryReturnRoute() {
  const { id } = Route.useParams();
  return <ReturnForm deliveryId={id} />;
}
