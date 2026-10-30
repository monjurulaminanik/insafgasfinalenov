import { createFileRoute } from "@tanstack/react-router";
import { SupplierForm } from "@/components/master-data/SupplierForm";

export const Route = createFileRoute("/suppliers/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Supplier" }] }),
  component: SupplierEdit,
});

function SupplierEdit() {
  const { id } = Route.useParams();
  return <SupplierForm id={id} />;
}
