import { createFileRoute } from "@tanstack/react-router";
import { SupplierForm } from "@/components/master-data/SupplierForm";

export const Route = createFileRoute("/suppliers/new")({
  head: () => ({ meta: [{ title: "New Supplier" }] }),
  component: SupplierForm,
});
