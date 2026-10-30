import { createFileRoute } from "@tanstack/react-router";
import { DamageCylinderPage } from "@/components/cylinder/DamageCylinderPage";

export const Route = createFileRoute("/cylinders/damage")({
  head: () => ({ meta: [{ title: "Damage Cylinder · Insaf Gas Corp" }] }),
  component: DamageCylinderPage,
});
