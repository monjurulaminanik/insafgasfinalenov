import { createFileRoute } from "@tanstack/react-router";
import { CylinderRegistry } from "@/components/cylinder/CylinderRegistry";

export const Route = createFileRoute("/cylinders/")({
  head: () => ({ meta: [{ title: "Cylinders · Insaf Gas Corp" }] }),
  component: CylinderRegistry,
});
