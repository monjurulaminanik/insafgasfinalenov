import { createFileRoute } from "@tanstack/react-router";
import { SupplierLiveReport } from "@/components/master-data/SupplierLiveReport";

export const Route = createFileRoute("/suppliers/report")({
  head: () => ({ meta: [{ title: "Suppliers Report · Insaf Gas Corp" }] }),
  component: SupplierLiveReport,
});
