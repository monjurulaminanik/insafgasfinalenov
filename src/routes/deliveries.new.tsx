import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ChallanForm } from "@/components/delivery/ChallanForm";

const searchSchema = z.object({
  salesOrderId: z.string().optional(),
});

export const Route = createFileRoute("/deliveries/new")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "New Delivery Challan" }] }),
  component: NewDeliveryPage,
});

function NewDeliveryPage() {
  const { salesOrderId } = Route.useSearch();
  return <ChallanForm salesOrderId={salesOrderId} />;
}
