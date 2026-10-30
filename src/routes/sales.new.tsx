import { createFileRoute } from "@tanstack/react-router";
import { SalesOrderForm } from "@/components/sales/SalesOrderForm";

export const Route = createFileRoute("/sales/new")({
  head: () => ({ meta: [{ title: "New Sales Order" }] }),
  component: () => <SalesOrderForm mode="order" />,
});
