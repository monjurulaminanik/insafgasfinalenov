import { createFileRoute } from "@tanstack/react-router";
import { PartyStatement } from "@/components/statement/PartyStatement";

export const Route = createFileRoute("/hr/$id/statement")({
  head: () => ({ meta: [{ title: "Employee Statement · Insaf Gas Corp" }] }),
  component: EmployeeStatementPage,
});

function EmployeeStatementPage() {
  const { id } = Route.useParams();
  return <PartyStatement kind="employee" id={id} />;
}
