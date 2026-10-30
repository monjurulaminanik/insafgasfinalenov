import { createFileRoute } from "@tanstack/react-router";
import { ProductList } from "@/components/master-data/ProductList";

export const Route = createFileRoute("/products/")({
  head: () => ({ meta: [{ title: "Products · Insaf Gas Corp" }] }),
  component: ProductList,
});
