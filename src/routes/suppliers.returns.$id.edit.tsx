import { createFileRoute } from "@tanstack/react-router";
import { SupplierReturnForm } from "@/components/supplier-return/SupplierReturnForm";

export const Route = createFileRoute("/suppliers/returns/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Suppliers Return · Insaf Gas Corp" }] }),
  component: SupplierReturnEdit,
});

function SupplierReturnEdit() {
  const { id } = Route.useParams();
  return <SupplierReturnForm id={id} />;
}
