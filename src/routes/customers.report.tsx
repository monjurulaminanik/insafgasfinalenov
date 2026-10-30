import { createFileRoute } from "@tanstack/react-router";
import { CustomerLiveReport } from "@/components/master-data/CustomerLiveReport";

export const Route = createFileRoute("/customers/report")({
  head: () => ({ meta: [{ title: "Customer Report · Insaf Gas Corp" }] }),
  component: CustomerLiveReport,
});
