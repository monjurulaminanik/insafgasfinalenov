import { createFileRoute } from "@tanstack/react-router";
import { CylinderForm } from "@/components/cylinder/CylinderForm";

export const Route = createFileRoute("/cylinders/$id/edit")({
  head: () => ({ meta: [{ title: "Edit Cylinder" }] }),
  component: CylinderEdit,
});

function CylinderEdit() {
  const { id } = Route.useParams();
  return <CylinderForm id={id} />;
}
