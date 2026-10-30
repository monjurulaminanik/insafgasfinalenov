import { createFileRoute } from "@tanstack/react-router";
import { SalesOrderForm } from "@/components/sales/SalesOrderForm";

export const Route = createFileRoute("/sales/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Sales Order" }] }),
  component: SalesEdit,
});

function SalesEdit() {
  const { id } = Route.useParams();
  return <SalesOrderForm id={id} />;
}
