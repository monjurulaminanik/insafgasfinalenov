import { createFileRoute } from "@tanstack/react-router";
import { CylinderForm } from "@/components/cylinder/CylinderForm";

export const Route = createFileRoute("/cylinders/new")({
  head: () => ({ meta: [{ title: "Register Cylinder" }] }),
  component: CylinderForm,
});
