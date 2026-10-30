import { createFileRoute } from "@tanstack/react-router";
import { CategoryList } from "@/components/master-data/CategoryList";

export const Route = createFileRoute("/products/categories")({
  head: () => ({ meta: [{ title: "Product Categories · Insaf Gas Corp" }] }),
  component: CategoryList,
});
