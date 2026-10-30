import { createFileRoute } from "@tanstack/react-router";
import { PurchaseView } from "@/components/purchase/PurchaseView";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";

export const Route = createFileRoute("/purchases/$id")({
  head: () => ({ meta: [{ title: "Purchase Order · Insaf Gas Corp" }] }),
  component: PurchaseDetail,
});

function PurchaseDetail() {
  const { id } = Route.useParams();
  return (
    <DetailOrOutlet>
      <PurchaseView id={id} />
    </DetailOrOutlet>
  );
}
