import { createFileRoute } from "@tanstack/react-router";
import { SupplierReturnList } from "@/components/supplier-return/SupplierReturnList";

export const Route = createFileRoute("/suppliers/returns/")({
  head: () => ({ meta: [{ title: "Suppliers Return · Insaf Gas Corp" }] }),
  component: SupplierReturnList,
});
