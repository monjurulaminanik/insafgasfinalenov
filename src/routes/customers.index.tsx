import { createFileRoute } from "@tanstack/react-router";
import { CustomerList } from "@/components/master-data/CustomerList";

export const Route = createFileRoute("/customers/")({
  head: () => ({ meta: [{ title: "Customers · Insaf Gas Corp" }] }),
  component: CustomerList,
});
