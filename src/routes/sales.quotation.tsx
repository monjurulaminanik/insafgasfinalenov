import { createFileRoute } from "@tanstack/react-router";
import { SalesOrderForm } from "@/components/sales/SalesOrderForm";

export const Route = createFileRoute("/sales/quotation")({
  head: () => ({ meta: [{ title: "New Quotation" }] }),
  component: () => <SalesOrderForm mode="quotation" />,
});
