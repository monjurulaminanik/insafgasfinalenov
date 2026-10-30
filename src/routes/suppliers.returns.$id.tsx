import { createFileRoute } from "@tanstack/react-router";
import { SupplierReturnView } from "@/components/supplier-return/SupplierReturnView";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";

export const Route = createFileRoute("/suppliers/returns/$id")({
  head: () => ({ meta: [{ title: "Supplier Return · Insaf Gas Corp" }] }),
  component: SupplierReturnDetail,
});

function SupplierReturnDetail() {
  const { id } = Route.useParams();
  return (
    <DetailOrOutlet>
      <SupplierReturnView id={id} />
    </DetailOrOutlet>
  );
}
