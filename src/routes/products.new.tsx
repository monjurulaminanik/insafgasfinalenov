import { createFileRoute } from "@tanstack/react-router";
import { ProductForm } from "@/components/master-data/ProductForm";

export const Route = createFileRoute("/products/new")({
  head: () => ({ meta: [{ title: "New Product" }] }),
  component: ProductForm,
});
