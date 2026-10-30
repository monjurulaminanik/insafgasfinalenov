import { createFileRoute } from "@tanstack/react-router";
import { CustomerForm } from "@/components/master-data/CustomerForm";

export const Route = createFileRoute("/customers/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Customer" }] }),
  component: CustomerEdit,
});

function CustomerEdit() {
  const { id } = Route.useParams();
  return <CustomerForm id={id} />;
}
