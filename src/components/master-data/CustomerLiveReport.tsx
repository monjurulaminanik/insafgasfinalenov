import { useQuery } from "@tanstack/react-query";
import { customerService } from "@/services/customer.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatOpenedOn } from "@/utils/formatters";
import { customerOpeningSigned } from "@/lib/customer-balance";
import type { Customer } from "@/types";
import { useT } from "@/i18n";

export function CustomerLiveReport() {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ["customers"], queryFn: customerService.list });

  return (
    <div>
      <PageHeader
        title={t("customers.report")}
        description={t("customers.reportDesc")}
        backTo="/customers"
        backLabel={t("customers.title")}
      />
      <PrintDocHeader title={t("customers.report")} />
      <DataTable<Customer>
        rows={data}
        searchKeys={["name", "phone", "whatsapp"]}
        dateKey="createdAt"
        columns={[
          {
            key: "since",
            header: t("customers.since"),
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
            render: (r) => <PartyNameLink kind="customer" id={r.id} name={r.name} />,
          },
          {
            key: "phone",
            header: t("common.phone"),
            sortable: true,
            sortValue: (r) => r.phone,
            render: (r) => r.phone,
          },
          { key: "whatsapp", header: t("customers.whatsapp"), render: (r) => r.whatsapp || "—" },
          {
            key: "address",
            header: t("common.address"),
            render: (r) => <span className="text-muted-foreground">{r.address}</span>,
          },
          {
            key: "bal",
            header: t("customers.receivable"),
            sortable: true,
            sortValue: (r) => customerOpeningSigned(r),
            render: (r) => formatCurrency(customerOpeningSigned(r)),
            className: "text-right",
          },
        ]}
      />
    </div>
  );
}
