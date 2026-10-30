import { createFileRoute } from "@tanstack/react-router";
import { InvoiceView } from "@/components/sales/InvoiceView";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";

export const Route = createFileRoute("/sales/$id")({
  component: SalesDetail,
});

function SalesDetail() {
  const { id } = Route.useParams();
  return (
    <DetailOrOutlet>
      <InvoiceView id={id} />
    </DetailOrOutlet>
  );
}
