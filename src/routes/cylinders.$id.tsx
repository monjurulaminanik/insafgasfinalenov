import { createFileRoute } from "@tanstack/react-router";
import { CylinderTracking } from "@/components/cylinder/CylinderTracking";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";

export const Route = createFileRoute("/cylinders/$id")({
  component: CylinderDetail,
});

function CylinderDetail() {
  const { id } = Route.useParams();
  return (
    <DetailOrOutlet>
      <CylinderTracking id={id} />
    </DetailOrOutlet>
  );
}
