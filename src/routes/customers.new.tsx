import { createFileRoute } from "@tanstack/react-router";
import { CustomerForm } from "@/components/master-data/CustomerForm";

export const Route = createFileRoute("/customers/new")({
  head: () => ({ meta: [{ title: "New Customer" }] }),
  component: () => <CustomerForm />,
});
