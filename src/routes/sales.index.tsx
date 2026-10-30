import { createFileRoute } from "@tanstack/react-router";
import { SalesOrderList } from "@/components/sales/SalesOrderList";

export const Route = createFileRoute("/sales/")({
  head: () => ({ meta: [{ title: "Sales Orders · Insaf Gas Corp" }] }),
  component: SalesOrderList,
});
