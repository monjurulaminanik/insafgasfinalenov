import { createFileRoute } from "@tanstack/react-router";
import { SupplierList } from "@/components/master-data/SupplierList";

export const Route = createFileRoute("/suppliers/")({
  head: () => ({ meta: [{ title: "Suppliers · Insaf Gas Corp" }] }),
  component: SupplierList,
});
