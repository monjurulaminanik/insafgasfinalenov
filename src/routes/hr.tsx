import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/hr")({
  head: () => ({ meta: [{ title: "HR & Payroll · Insaf Gas Corp" }] }),
  component: () => <Outlet />,
});
