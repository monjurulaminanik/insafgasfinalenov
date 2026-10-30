import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { EmployeeRoster } from "@/components/hr/EmployeeRoster";
import { useT } from "@/i18n";

export const Route = createFileRoute("/hr/employees")({
  head: () => ({ meta: [{ title: "Employees · Insaf Gas Corp" }] }),
  component: EmployeesPage,
});

function EmployeesPage() {
  const t = useT();
  return (
    <div>
      <PageHeader
        title={t("nav.employees")}
        description={t("hr.employeesDesc")}
        actions={
          <Button asChild>
            <Link to="/hr">{t("hr.addEmployee")}</Link>
          </Button>
        }
      />
      <EmployeeRoster />
    </div>
  );
}
