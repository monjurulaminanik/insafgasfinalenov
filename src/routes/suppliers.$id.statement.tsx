import { createFileRoute } from "@tanstack/react-router";
import { PartyStatement } from "@/components/statement/PartyStatement";

export const Route = createFileRoute("/suppliers/$id/statement")({
  head: () => ({ meta: [{ title: "Supplier Ledger · Insaf Gas Corp" }] }),
  component: SupplierStatementPage,
});

function SupplierStatementPage() {
  const { id } = Route.useParams();
  return <PartyStatement kind="supplier" id={id} />;
}
