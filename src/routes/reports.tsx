import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/components/reports/ReportsPage";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports · Insaf Gas Corp" }] }),
  component: ReportsPage,
});
