import { createFileRoute } from "@tanstack/react-router";
import { ProductForm } from "@/components/master-data/ProductForm";

export const Route = createFileRoute("/products/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Product" }] }),
  component: ProductEdit,
});

function ProductEdit() {
  const { id } = Route.useParams();
  return <ProductForm id={id} />;
}
