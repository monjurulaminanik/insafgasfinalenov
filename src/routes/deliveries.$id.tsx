import { createFileRoute } from "@tanstack/react-router";
import { DeliveryChallan } from "@/components/delivery/DeliveryChallan";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";

export const Route = createFileRoute("/deliveries/$id")({
  component: DeliveryDetail,
});

function DeliveryDetail() {
  const { id } = Route.useParams();
  return (
    <DetailOrOutlet>
      <DeliveryChallan id={id} />
    </DetailOrOutlet>
  );
}
