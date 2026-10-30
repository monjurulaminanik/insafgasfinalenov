import { createFileRoute } from "@tanstack/react-router";
import { AccountingPage } from "@/components/accounting/AccountingPage";

export const Route = createFileRoute("/accounting")({
  head: () => ({ meta: [{ title: "Accounting · Insaf Gas Corp" }] }),
  component: AccountingPage,
});
