import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supplierService } from "@/services/supplier.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatOpenedOn } from "@/utils/formatters";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { EMPTY_DATE_RANGE, createTodayDateRange } from "@/lib/date-range";
import { buildPartyStatement } from "@/lib/party-statement";
import { purchaseService } from "@/services/purchase.service";
import { supplierReturnService } from "@/services/supplier-return.service";
import { accountingService } from "@/services/accounting.service";
import { useT } from "@/i18n";

export function SupplierLiveReport() {
  const t = useT();
  const { data = [] } = useQuery({ queryKey: ["suppliers"], queryFn: supplierService.list });

  const [range, setRange] = useState(createTodayDateRange);
  const { data: transactions = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const { data: supplierReturns = [] } = useQuery({
    queryKey: ["supplierReturns"],
    queryFn: supplierReturnService.list,
  });
  const rows = useMemo(
    () =>
      data.map((party) => {
        const inputs = {
          kind: "supplier" as const,
          party,
          purchases: transactions,
          supplierReturns,
          vouchers,
        };
        const period = buildPartyStatement({ ...inputs, range });
        const lifetime = buildPartyStatement({ ...inputs, range: EMPTY_DATE_RANGE });
        return {
          ...party,
          currentBalance: lifetime.closingBalance,
          periodAmount: period.periodPurchases,
          periodPayments: period.periodPayments,
        };
      }),
    [data, transactions, supplierReturns, vouchers, range],
  );

  return (
    <div>
      <PageHeader
        title={t("suppliers.report")}
        description={t("suppliers.reportDesc")}
        backTo="/suppliers"
        backLabel={t("suppliers.title")}
      />
      <PrintDocHeader title={t("suppliers.report")} />
      <p className="my-3 text-xs text-muted-foreground">{t("reports.balanceScope")}</p>
      <div className="no-print mb-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <DataTable<(typeof rows)[number]>
        rows={rows}
        searchKeys={["name", "phone"]}
        columns={[
          {
            key: "periodAmount",
            header: t("statement.totalPurchases"),
            render: (r) => formatCurrency(r.periodAmount),
            className: "text-right",
          },
          {
            key: "periodPayments",
            header: t("statement.totalPayments"),
            render: (r) => formatCurrency(r.periodPayments),
            className: "text-right",
          },
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
            sortValue: (r) => r.currentBalance,
            render: (r) => formatCurrency(r.currentBalance),
            className: "text-right",
          },
        ]}
      />
    </div>
  );
}
