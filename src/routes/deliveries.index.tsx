import { createFileRoute } from "@tanstack/react-router";
import { DeliveryList } from "@/components/delivery/DeliveryList";

export const Route = createFileRoute("/deliveries/")({
  head: () => ({ meta: [{ title: "Deliveries · Insaf Gas Corp" }] }),
  component: DeliveryList,
});
