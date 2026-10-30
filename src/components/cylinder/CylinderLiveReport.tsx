import { useQuery } from "@tanstack/react-query";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/utils/formatters";
import type { Cylinder, CylinderStatus } from "@/types";
import { useT } from "@/i18n";

const statusVariant: Record<CylinderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  in_stock: "default",
  at_customer: "secondary",
  in_transit: "outline",
  refilling: "outline",
  damaged: "destructive",
  lost: "destructive",
  scrapped: "destructive",
  written_off: "destructive",
  stock_out: "outline",
};

export function CylinderLiveReport() {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ["cylinders"], queryFn: cylinderService.list });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const gasCategoryOf = (c: Cylinder) =>
    c.gasCategory || products.find((p) => p.id === c.productId)?.category || "—";

  return (
    <div>
      <PageHeader
        title={t("cylinders.report")}
        description={t("cylinders.reportDesc")}
        backTo="/cylinders"
        backLabel={t("cylinders.title")}
      />
      <PrintDocHeader title={t("cylinders.report")} />
      <DataTable<Cylinder>
        rows={data}
        searchKeys={["serialNumber", "location"]}
        dateKey="lastMovementAt"
        columns={[
          {
            key: "sn",
            header: t("cylinders.serial"),
            sortable: true,
            sortValue: (r) => r.serialNumber,
            render: (r) => <span className="font-mono">{r.serialNumber}</span>,
          },
          {
            key: "cat",
            header: t("cylinders.gasCategory"),
            sortable: true,
            sortValue: (r) => gasCategoryOf(r),
            render: (r) => gasCategoryOf(r),
          },
          {
            key: "cap",
            header: t("cylinders.capacity"),
            sortable: true,
            sortValue: (r) => r.capacity,
            render: (r) => `${r.capacity}`,
          },
          {
            key: "st",
            header: t("common.status"),
            sortable: true,
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge variant={statusVariant[r.status]}>{t(`status.${r.status}` as any)}</Badge>
            ),
          },
          {
            key: "loc",
            header: t("cylinders.location"),
            sortable: true,
            sortValue: (r) => r.location,
            render: (r) => r.location,
          },
          {
            key: "mv",
            header: t("cylinders.lastMovement"),
            sortable: true,
            sortValue: (r) => r.lastMovementAt,
            render: (r) => (
              <span className="text-xs text-muted-foreground">
                {formatDateTime(r.lastMovementAt)}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
