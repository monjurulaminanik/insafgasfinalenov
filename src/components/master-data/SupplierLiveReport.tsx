import { useQuery } from "@tanstack/react-query";
import { supplierService } from "@/services/supplier.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatOpenedOn } from "@/utils/formatters";
import type { Supplier } from "@/types";
import { useT } from "@/i18n";

export function SupplierLiveReport() {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ["suppliers"], queryFn: supplierService.list });

  return (
    <div>
      <PageHeader
        title={t("suppliers.report")}
        description={t("suppliers.reportDesc")}
        backTo="/suppliers"
        backLabel={t("suppliers.title")}
      />
      <PrintDocHeader title={t("suppliers.report")} />
      <DataTable<Supplier>
        rows={data}
        searchKeys={["name", "phone"]}
        dateKey="createdAt"
        columns={[
          {
            key: "since",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.createdAt,
            render: (r) => (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {formatOpenedOn(r.createdAt)}
              </span>
            ),
          },
          {
            key: "name",
            header: t("common.name"),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => <PartyNameLink kind="supplier" id={r.id} name={r.name} />,
          },
          {
            key: "phone",
            header: t("common.phone"),
            sortable: true,
            sortValue: (r) => r.phone,
            render: (r) => r.phone,
          },
          {
            key: "address",
            header: t("common.address"),
            render: (r) => <span className="text-muted-foreground">{r.address}</span>,
          },
          {
            key: "bal",
            header: t("suppliers.payable"),
            sortable: true,
            sortValue: (r) => r.openingBalance,
            render: (r) => formatCurrency(r.openingBalance),
            className: "text-right",
          },
        ]}
      />
    </div>
  );
}
