import { createFileRoute } from "@tanstack/react-router";
import { ExpenseList } from "@/components/expenses/ExpenseList";

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses" }] }),
  component: ExpenseList,
});
