import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { hrService } from "@/services/hr.service";
import { salesService } from "@/services/sales.service";
import { purchaseService } from "@/services/purchase.service";
import { supplierReturnService } from "@/services/supplier-return.service";
import { accountingService } from "@/services/accounting.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { EMPTY_DATE_RANGE, formatPeriodLabel, type DateRange } from "@/lib/date-range";
import {
  buildPartyStatement,
  groupStatementByMonth,
  type PartyKind,
  type StatementLine,
} from "@/lib/party-statement";
import {
  buildLedgerExportPayload,
  exportLedgerExcel,
  exportLedgerPdf,
} from "@/lib/statement-export";
import { useI18n, useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

const LINE_LABEL: Record<StatementLine["type"], MessageKey> = {
  opening: "statement.opening",
  invoice: "statement.invoice",
  purchase: "statement.purchase",
  payment: "statement.payment",
  receipt: "statement.receipt",
  salary: "statement.salary",
  adjustment: "statement.adjustment",
  return: "statement.return",
};

export function PartyStatement({ kind, id }: { kind: PartyKind; id: string }) {
  const t = useT();
  const { locale } = useI18n();
  const [range, setRange] = useState<DateRange>(EMPTY_DATE_RANGE);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const customerQuery = useQuery({
    queryKey: ["customers", id],
    queryFn: () => customerService.get(id),
    enabled: kind === "customer",
  });
  const supplierQuery = useQuery({
    queryKey: ["suppliers", id],
    queryFn: () => supplierService.get(id),
    enabled: kind === "supplier",
  });
  const employeeQuery = useQuery({
    queryKey: ["employees", id],
    queryFn: () => hrService.getEmployee(id),
    enabled: kind === "employee",
  });
  const partyQuery =
    kind === "customer" ? customerQuery : kind === "supplier" ? supplierQuery : employeeQuery;
  const { data: sales = [] } = useQuery({
    queryKey: ["sales"],
    queryFn: salesService.list,
    enabled: kind === "customer",
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: purchaseService.list,
    enabled: kind === "supplier",
  });
  const { data: supplierReturns = [] } = useQuery({
    queryKey: ["supplierReturns"],
    queryFn: supplierReturnService.list,
    enabled: kind === "supplier",
  });
  const { data: payroll = [] } = useQuery({
    queryKey: ["payroll"],
    queryFn: hrService.listPayroll,
    enabled: kind === "employee",
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });

  const customer = customerQuery.data;
  const supplier = supplierQuery.data;
  const employee = employeeQuery.data;
  const partyName =
    kind === "customer" ? customer?.name : kind === "supplier" ? supplier?.name : employee?.name;
  const partyPhone =
    kind === "customer" ? customer?.phone : kind === "supplier" ? supplier?.phone : employee?.phone;
  const partyAddress =
    kind === "customer" ? customer?.address : kind === "supplier" ? supplier?.address : undefined;
  const statement = useMemo(() => {
    if (kind === "customer") {
      if (!customer) return null;
      return buildPartyStatement({ kind: "customer", party: customer, sales, vouchers, range });
    }
    if (kind === "supplier") {
      if (!supplier) return null;
      return buildPartyStatement({ kind: "supplier", party: supplier, purchases, supplierReturns, vouchers, range });
    }
    if (!employee) return null;
    return buildPartyStatement({ kind: "employee", party: employee, payroll, vouchers, range });
  }, [kind, customer, supplier, employee, sales, purchases, supplierReturns, payroll, vouchers, range]);

  const monthGroups = useMemo(
    () => (kind === "employee" && statement ? groupStatementByMonth(statement.lines, locale) : []),
    [kind, statement, locale],
  );

  if (partyQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }
  if (partyQuery.isFetched && !partyName) {
    return (
      <div className="p-6 text-sm text-destructive">
        {kind === "customer"
          ? t("customers.notFound")
          : kind === "supplier"
            ? t("suppliers.notFound")
            : t("hr.notFound")}
      </div>
    );
  }
  if (!partyName || !statement) return null;

  const closingLabel =
    kind === "customer"
      ? statement.closingBalance >= 0
        ? t("statement.receivable")
        : t("statement.advance")
      : statement.closingBalance >= 0
        ? t("statement.payable")
        : t("statement.advance");
  const currentLabel =
    kind === "customer" ? t("statement.currentDue") : t("statement.currentPayable");
  const period = formatPeriodLabel(range, t("filter.all"));
  const pageTitle = kind === "employee" ? t("statement.title") : t("statement.ledger");

  const backTo =
    kind === "customer"
      ? { to: "/customers/$id" as const, params: { id } }
      : kind === "supplier"
        ? { to: "/suppliers/$id" as const, params: { id } }
        : { to: "/hr/$id" as const, params: { id } };

  const exportPayload = () =>
    buildLedgerExportPayload({
      company: t("brand.name"),
      title: pageTitle,
      statement,
      period,
      openingLabel: t("statement.opening"),
      totalDebitLabel: t("statement.totalDebit"),
      totalCreditLabel: t("statement.totalCredit"),
      closingLabel: `${t("statement.closing")} · ${closingLabel}`,
      columns: {
        date: t("common.date"),
        type: t("common.type"),
        reference: t("statement.reference"),
        description: t("statement.description"),
        debit: t("statement.debit"),
        credit: t("statement.credit"),
        balance: t("statement.balance"),
      },
      typeLabel: (line) => t(LINE_LABEL[line.type]),
      formatDate,
      balanceSuffix: (line) =>
        kind === "customer"
          ? line.balance >= 0
            ? t("statement.dr")
            : t("statement.cr")
          : line.balance >= 0
            ? t("statement.cr")
            : t("statement.dr"),
    });

  const runExport = async (mode: "excel" | "pdf") => {
    try {
      setExporting(mode);
      const payload = exportPayload();
      if (mode === "excel") await exportLedgerExcel(payload);
      else await exportLedgerPdf(payload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.tryAgain"));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={`${pageTitle} — ${partyName}`}
        description={kind === "employee" ? t("statement.desc") : t("statement.ledgerDesc")}
        backTo={backTo}
        backLabel={partyName}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" /> {t("statement.print")}
            </Button>
            {kind !== "employee" && (
              <>
                <Button
                  variant="outline"
                  disabled={exporting !== null}
                  onClick={() => void runExport("excel")}
                >
                  <FileSpreadsheet className="mr-1 h-4 w-4" /> {t("statement.excel")}
                </Button>
                <Button
                  variant="outline"
                  disabled={exporting !== null}
                  onClick={() => void runExport("pdf")}
                >
                  <FileDown className="mr-1 h-4 w-4" /> {t("statement.pdf")}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="no-print mb-4 rounded-xl border bg-card/60 p-3">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <Card className="print-sheet statement-sheet">
        <CardContent className="space-y-5 pt-6">
          <PrintDocHeader
            title={pageTitle}
            subtitle={`${t("statement.period")}: ${period}`}
            right={
              <div className="text-sm text-right">
                <p className="font-display text-base font-semibold">{partyName}</p>
                <p className="text-muted-foreground">{partyPhone}</p>
                {partyAddress && <p className="max-w-xs text-muted-foreground">{partyAddress}</p>}
              </div>
            }
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              label={t("statement.opening")}
              value={formatCurrency(Math.abs(statement.openingBalance))}
            />
            <SummaryTile
              label={t("statement.totalDebit")}
              value={formatCurrency(statement.totalDebit)}
            />
            <SummaryTile
              label={t("statement.totalCredit")}
              value={formatCurrency(statement.totalCredit)}
            />
            <SummaryTile
              label={`${currentLabel} · ${closingLabel}`}
              value={formatCurrency(Math.abs(statement.closingBalance))}
              emphasize
            />
          </div>

          {kind !== "employee" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kind === "customer" ? (
                <SummaryTile
                  label={t("statement.totalSales")}
                  value={formatCurrency(statement.periodSales)}
                />
              ) : (
                <SummaryTile
                  label={t("statement.totalPurchases")}
                  value={formatCurrency(statement.periodPurchases)}
                />
              )}
              <SummaryTile
                label={
                  kind === "customer"
                    ? t("statement.totalCollections")
                    : t("statement.totalPayments")
                }
                value={formatCurrency(
                  kind === "customer" ? statement.periodCollections : statement.periodPayments,
                )}
              />
              {statement.periodReturns > 0 && (
                <SummaryTile
                  label={t("statement.returns")}
                  value={formatCurrency(statement.periodReturns)}
                />
              )}
              {statement.periodAdjustments > 0 && (
                <SummaryTile
                  label={t("statement.adjustments")}
                  value={formatCurrency(statement.periodAdjustments)}
                />
              )}
            </div>
          )}

          {kind === "employee" ? (
            <div className="space-y-2">
              <OpeningStrip line={statement.lines[0]} kind={kind} t={t} />
              {monthGroups.map((group, index) => (
                <details
                  key={group.key}
                  className="statement-month overflow-hidden rounded-lg border bg-card"
                  defaultOpen={index === monthGroups.length - 1}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="statement-month-chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("statement.totalPayable")}
                      </p>
                      <p className="font-display text-base font-semibold tabular-nums">
                        {formatCurrency(group.payable)}
                      </p>
                    </div>
                    <p className="shrink-0 font-display text-base font-semibold sm:text-lg">
                      {group.label}
                    </p>
                  </summary>
                  <div className="statement-month-body border-t">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-28">{t("common.date")}</TableHead>
                            <TableHead>{t("common.type")}</TableHead>
                            <TableHead>{t("statement.particulars")}</TableHead>
                            <TableHead className="text-right">{t("statement.debit")}</TableHead>
                            <TableHead className="text-right">{t("statement.credit")}</TableHead>
                            <TableHead className="text-right">{t("statement.balance")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.lines.map((line) => (
                            <StatementLineRow
                              key={line.id}
                              line={line}
                              kind={kind}
                              t={t}
                              detailed={false}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </details>
              ))}
              {monthGroups.length === 0 && (
                <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
                  {t("statement.empty")}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm font-semibold">
                <span>{t("statement.closing")}</span>
                <div className="flex flex-wrap gap-4 tabular-nums">
                  <span>{formatCurrency(statement.totalDebit)}</span>
                  <span>{formatCurrency(statement.totalCredit)}</span>
                  <span>
                    {formatCurrency(Math.abs(statement.closingBalance))}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {closingLabel}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t("common.date")}</TableHead>
                    <TableHead>{t("common.type")}</TableHead>
                    <TableHead>{t("statement.reference")}</TableHead>
                    <TableHead>{t("statement.description")}</TableHead>
                    <TableHead className="text-right">{t("statement.debit")}</TableHead>
                    <TableHead className="text-right">{t("statement.credit")}</TableHead>
                    <TableHead className="text-right">{t("statement.balance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.lines.map((line) => (
                    <StatementLineRow key={line.id} line={line} kind={kind} t={t} detailed />
                  ))}
                  {statement.lines.length <= 1 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {t("statement.empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="font-semibold">
                      {t("statement.closing")}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(statement.totalDebit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(statement.totalCredit)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(Math.abs(statement.closingBalance))}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {closingLabel}
                      </span>
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/30 p-3",
        emphasize && "border-primary/30 bg-primary/5",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-semibold">{value}</p>
    </div>
  );
}

function OpeningStrip({
  line,
  kind,
  t,
}: {
  line?: StatementLine;
  kind: PartyKind;
  t: (key: MessageKey) => string;
}) {
  if (!line || line.type !== "opening") return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("statement.opening")}
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(line.date)}</p>
      </div>
      <p className="tabular-nums font-medium">
        {formatCurrency(Math.abs(line.balance))}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          {kind === "customer"
            ? line.balance >= 0
              ? t("statement.dr")
              : t("statement.cr")
            : line.balance >= 0
              ? t("statement.cr")
              : t("statement.dr")}
        </span>
      </p>
    </div>
  );
}

function StatementLineRow({
  line,
  kind,
  t,
  detailed,
}: {
  line: StatementLine;
  kind: PartyKind;
  t: (key: MessageKey) => string;
  detailed: boolean;
}) {
  const ref = line.reference || line.particulars;
  const desc = line.description || (line.type === "opening" ? t(LINE_LABEL[line.type]) : "");
  return (
    <TableRow className={line.type === "opening" ? "bg-muted/40 font-medium" : undefined}>
      <TableCell className="whitespace-nowrap text-xs">{formatDate(line.date)}</TableCell>
      <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
        {t(LINE_LABEL[line.type])}
      </TableCell>
      {detailed ? (
        <>
          <TableCell>
            {line.href && ref ? (
              <Link
                to={line.href.to}
                params={line.href.params}
                className="font-mono text-xs text-primary hover:underline"
              >
                {ref}
              </Link>
            ) : (
              <span className="font-mono text-xs">{ref || "—"}</span>
            )}
          </TableCell>
          <TableCell className="text-sm text-muted-foreground">{desc || "—"}</TableCell>
        </>
      ) : (
        <TableCell>
          {line.href ? (
            <Link
              to={line.href.to}
              params={line.href.params}
              className="font-mono text-xs text-primary hover:underline"
            >
              {line.particulars}
            </Link>
          ) : (
            <span className="text-sm">{line.particulars || t(LINE_LABEL[line.type])}</span>
          )}
        </TableCell>
      )}
      <TableCell className="text-right tabular-nums">
        {line.debit ? formatCurrency(line.debit) : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {line.credit ? formatCurrency(line.credit) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums font-medium",
          line.balance < 0 && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {formatCurrency(Math.abs(line.balance))}
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          {kind === "customer"
            ? line.balance >= 0
              ? t("statement.dr")
              : t("statement.cr")
            : line.balance >= 0
              ? t("statement.cr")
              : t("statement.dr")}
        </span>
      </TableCell>
    </TableRow>
  );
}
