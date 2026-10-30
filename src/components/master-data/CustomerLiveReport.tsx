import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customerService } from "@/services/customer.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatOpenedOn } from "@/utils/formatters";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { EMPTY_DATE_RANGE, createTodayDateRange } from "@/lib/date-range";
import { buildPartyStatement } from "@/lib/party-statement";
import { salesService } from "@/services/sales.service";
import { accountingService } from "@/services/accounting.service";
import { useT } from "@/i18n";

export function CustomerLiveReport() {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ["customers"], queryFn: customerService.list });

  const [range, setRange] = useState(createTodayDateRange);
  const { data: transactions = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const rows = useMemo(
    () =>
      data.map((party) => {
        const inputs = { kind: "customer" as const, party, sales: transactions, vouchers };
        const period = buildPartyStatement({ ...inputs, range });
        const lifetime = buildPartyStatement({ ...inputs, range: EMPTY_DATE_RANGE });
        return {
          ...party,
          currentBalance: lifetime.closingBalance,
          periodAmount: period.periodSales,
          periodPayments: period.periodCollections,
        };
      }),
    [data, transactions, vouchers, range],
  );

  return (
    <div>
      <PageHeader
        title={t("customers.report")}
        description={t("customers.reportDesc")}
        backTo="/customers"
        backLabel={t("customers.title")}
      />
      <PrintDocHeader title={t("customers.report")} />
      <p className="my-3 text-xs text-muted-foreground">{t("reports.balanceScope")}</p>
      <div className="no-print mb-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <DataTable<(typeof rows)[number]>
        rows={rows}
        searchKeys={["name", "phone", "whatsapp"]}
        columns={[
          {
            key: "periodAmount",
            header: t("statement.totalSales"),
            render: (r) => formatCurrency(r.periodAmount),
            className: "text-right",
          },
          {
            key: "periodPayments",
            header: t("statement.totalCollections"),
            render: (r) => formatCurrency(r.periodPayments),
            className: "text-right",
          },
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
            sortValue: (r) => r.currentBalance,
            render: (r) => formatCurrency(r.currentBalance),
            className: "text-right",
          },
        ]}
      />
    </div>
  );
}
