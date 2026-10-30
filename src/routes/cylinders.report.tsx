import { createFileRoute } from "@tanstack/react-router";
import { CylinderLiveReport } from "@/components/cylinder/CylinderLiveReport";

export const Route = createFileRoute("/cylinders/report")({
  head: () => ({ meta: [{ title: "Cylinder Report · Insaf Gas Corp" }] }),
  component: CylinderLiveReport,
});
