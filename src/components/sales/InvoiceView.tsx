import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { salesService } from "@/services/sales.service";
import { customerService } from "@/services/customer.service";
import { productService } from "@/services/product.service";
import { isCylinderMovementOnly } from "@/lib/cylinder-product";
import { accountingService } from "@/services/accounting.service";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { lineAmount, paymentStatus } from "@/utils/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PrintMeta, PrintSignatures, PrintTotals } from "@/components/common/PrintParts";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import {
  MoneyReceiptPrint,
  voucherToReceipt,
  type MoneyReceiptModel,
} from "@/components/sales/MoneyReceiptPrint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PaymentMethod, SalesStatus, Voucher } from "@/types";
import { useT } from "@/i18n";
import { Printer, Trash2 } from "lucide-react";

export function InvoiceView({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    data: order,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["sales", id],
    queryFn: () => salesService.get(id),
  });
  const { data: customer } = useQuery({
    queryKey: ["customers", order?.customerId],
    queryFn: () => customerService.get(order!.customerId),
    enabled: !!order?.customerId,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [bankAccount, setBankAccount] = useState<string>("");
  const [receipt, setReceipt] = useState<MoneyReceiptModel | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["sales", id] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
  };

  const pay = useMutation({
    mutationFn: (n: number) =>
      salesService.recordPayment(
        id,
        n,
        method,
        method === "bank" ? bankAccount || "bank" : undefined,
      ),
    onSuccess: (result: { order: unknown; receipt: Voucher }) => {
      invalidate();
      toast.success(t("sales.paymentReceiptReady"));
      setAmount("");
      setReceipt(voucherToReceipt(result.receipt));
      setReceiptOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: SalesStatus) => salesService.setStatus(id, status),
    onSuccess: (_, status) => {
      invalidate();
      toast.success(t("sales.statusChanged", { status: t(`status.${status}` as any) }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: () => salesService.convertQuotation(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("sales.converted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => salesService.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("sales.deleted"));
      navigate({ to: "/sales" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !order)
    return <div className="p-6 text-sm text-destructive">{t("sales.notFound")}</div>;
  if (!order) return null;

  const isQuote = order.status === "draft" || order.orderNo.startsWith("QT");
  const due = order.total - order.paid;
  const busy = pay.isPending || setStatus.isPending || convert.isPending || remove.isPending;
  const canDelete = order.status !== "paid";
  const docTitle = isQuote ? t("doc.estimate") : t("sales.invoice");
  const docNoLabel = isQuote ? t("sales.quotationNo") : t("sales.invoiceNo");
  const bankAccounts = accounts.filter((a) => a.type === "bank" || a.type === "mobile");
  const payments = vouchers
    .filter((v) => v.refType === "sales" && v.refId === order.id && v.type === "receipt")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const payLocked = due <= 0 || order.status === "cancelled" || pay.isPending;

  const validityDate = (() => {
    const d = new Date(order.date);
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + 15);
    return formatDate(d.toISOString());
  })();

  return (
    <div className="invoice-print-root">
      <PageHeader
        title={`${isQuote ? t("sales.quotationLabel") : t("sales.invoice")} ${order.orderNo}`}
        description={t("sales.issuedTo", {
          customer: order.customerName,
          date: formatDate(order.date),
        })}
        backTo="/sales"
        backLabel={t("sales.title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {order.status !== "cancelled" && (
              <Button variant="outline" asChild>
                <Link to="/sales/$id/edit" params={{ id: order.id }}>
                  {t("common.edit")}
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/customers/$id/statement" params={{ id: order.customerId }}>
                {t("customers.statement")}
              </Link>
            </Button>
            {!isQuote && (
              <Button variant="outline" asChild>
                <Link to="/deliveries/new" search={{ salesOrderId: order.id }}>
                  {t("sales.createDelivery")}
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              {t("common.print")}
            </Button>
            {canDelete && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("sales.deleteConfirm"))) remove.mutate();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t("common.delete")}
              </Button>
            )}
          </div>
        }
      />
      <div className="print-layout grid gap-4 lg:grid-cols-3">
        <Card className="print-sheet lg:col-span-2">
          <CardContent className="space-y-5 pt-6 print:space-y-2 print:pt-2">
            <PrintDocHeader
              title={docTitle}
              subtitle={`${docNoLabel}: ${order.orderNo} · ${formatDate(order.date)}`}
              right={
                <div className="text-right">
                  <p className="text-lg font-bold uppercase tracking-wide">{docTitle}</p>
                  <p className="font-mono text-sm">{order.orderNo}</p>
                  <Badge className="no-print mt-2">{t(`status.${order.status}` as any)}</Badge>
                </div>
              }
            />

            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div className="print-avoid-break space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {isQuote ? t("common.customer") : t("sales.billTo")}
                </p>
                <p className="font-medium">
                  <PartyNameLink kind="customer" id={order.customerId} name={order.customerName} />
                </p>
                {customer?.phone && <p className="text-muted-foreground">{customer.phone}</p>}
                {customer?.address && (
                  <p className="max-w-sm text-muted-foreground">{customer.address}</p>
                )}
              </div>
              <PrintMeta
                className="lg:grid-cols-2"
                items={[
                  { label: docNoLabel, value: <span className="font-mono">{order.orderNo}</span> },
                  { label: t("common.date"), value: formatDate(order.date) },
                  { label: t("sales.orderStatus"), value: t(`status.${order.status}` as any) },
                  {
                    label: t("sales.paymentStatus"),
                    value: t(`sales.${paymentStatus(order.total, order.paid)}`),
                  },
                  ...(order.receiverName
                    ? [{ label: t("sales.receiver"), value: order.receiverName }]
                    : []),
                  ...(isQuote
                    ? [
                        {
                          label: t("sales.validity"),
                          value: validityDate || t("sales.validityDays"),
                        },
                      ]
                    : [
                        { label: t("common.paid"), value: formatCurrency(order.paid) },
                        { label: t("common.due"), value: formatCurrency(due) },
                      ]),
                ]}
              />
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{t("sales.item")}</TableHead>
                    <TableHead className="text-right">{t("common.quantity")}</TableHead>
                    <TableHead className="text-right">{t("common.price")}</TableHead>
                    <TableHead className="text-right">{t("common.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items
                    .filter(
                      (it) =>
                        !isCylinderMovementOnly(
                          it,
                          products.find((p) => p.id === it.productId),
                        ),
                    )
                    .map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>{it.productName}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(it.price)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(lineAmount(it))}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>

            <PrintTotals
              rows={
                isQuote
                  ? [
                      { label: t("common.subtotal"), value: formatCurrency(order.subtotal) },
                      {
                        label: t("sales.grandTotal"),
                        value: formatCurrency(order.total),
                        bold: true,
                      },
                    ]
                  : [
                      { label: t("common.total"), value: formatCurrency(order.total), bold: true },
                      { label: t("common.paid"), value: formatCurrency(order.paid) },
                      { label: t("common.due"), value: formatCurrency(due), bold: true },
                      {
                        label: t("sales.paymentStatus"),
                        value: t(`sales.${paymentStatus(order.total, order.paid)}`),
                      },
                    ]
              }
            />

            {isQuote && (
              <div className="print-avoid-break space-y-1 border-t pt-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">
                  {t("sales.validity")}: {t("sales.validityDays")}
                </p>
                <p>{t("sales.quoteTerms")}</p>
              </div>
            )}

            {order.notes && (
              <div className="print-avoid-break space-y-1 border-t pt-3 text-sm print:pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("sales.notes")}
                </p>
                <p>{order.notes}</p>
              </div>
            )}

            {!isQuote && (
              <div className="invoice-money-receipt border-t pt-2">
                <p className="mb-2 text-center text-sm font-bold uppercase tracking-wide">
                  {t("doc.moneyReceipt")}
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("doc.receivedFrom")}
                    </p>
                    <p className="font-medium">{order.customerName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("doc.reference")}
                    </p>
                    <p className="font-mono">{order.orderNo}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("common.paid")}
                    </p>
                    <p className="font-medium tabular-nums">{formatCurrency(order.paid)}</p>
                  </div>
                </div>
              </div>
            )}

            <PrintSignatures
              left={t("doc.authorizedSign")}
              right={isQuote ? t("doc.customerSign") : t("doc.receivedBy")}
            />
            {!isQuote && (
              <div className="print-signatures mt-4 flex justify-end print:mt-3">
                <div className="w-40 border-t border-foreground/40 pt-2 text-center text-xs">
                  {t("doc.customerSign")}
                </div>
              </div>
            )}
            <p className="text-center text-[10px] text-muted-foreground">{t("doc.pageFooter")}</p>
          </CardContent>
        </Card>

        <div className="space-y-4 no-print">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h3 className="font-semibold">{t("sales.workflow")}</h3>
              {order.status === "draft" && (
                <Button className="w-full" disabled={busy} onClick={() => convert.mutate()}>
                  {t("sales.convert")}
                </Button>
              )}
              {order.status === "confirmed" && (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => setStatus.mutate("invoiced")}
                >
                  {t("sales.markInvoiced")}
                </Button>
              )}
              {(order.status === "confirmed" || order.status === "invoiced") && (
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setStatus.mutate("cancelled")}
                >
                  {t("sales.cancelOrder")}
                </Button>
              )}
              {order.status === "draft" && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setStatus.mutate("cancelled")}
                >
                  {t("sales.cancelQuotation")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("sales.stockNote")}</p>
            </CardContent>
          </Card>

          {!isQuote && (
            <Card>
              <CardContent className="space-y-3 pt-6">
                <h3 className="font-semibold">{t("sales.recordPayment")}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">
                      {t("common.total")}
                    </p>
                    <p className="font-medium">{formatCurrency(order.total)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">
                      {t("common.paid")}
                    </p>
                    <p className="font-medium">{formatCurrency(order.paid)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">{t("common.due")}</p>
                    <p className="font-medium">{formatCurrency(due)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">
                      {t("sales.paymentStatus")}
                    </p>
                    <p className="font-medium">
                      {t(`sales.${paymentStatus(order.total, order.paid)}`)}
                    </p>
                  </div>
                </div>
                {payments.length > 0 && (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.date")}</TableHead>
                          <TableHead>{t("sales.paidInto")}</TableHead>
                          <TableHead className="text-right">{t("common.amount")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {formatDate(p.date)}
                            </TableCell>
                            <TableCell className="text-xs">
                              {p.account === "cash"
                                ? t("common.cash")
                                : p.account === "bank"
                                  ? t("common.bank")
                                  : p.account}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatCurrency(p.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t("common.amount")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={payLocked}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("sales.paidInto")}</Label>
                  <Select
                    value={method}
                    onValueChange={(v) => setMethod(v as PaymentMethod)}
                    disabled={payLocked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t("common.cash")}</SelectItem>
                      <SelectItem value="bank">{t("common.bank")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {method === "bank" && bankAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>{t("sales.bankAccount")}</Label>
                    <Select value={bankAccount} onValueChange={setBankAccount} disabled={payLocked}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.name}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={
                    payLocked ||
                    !amount ||
                    Number(amount) <= 0 ||
                    Number(amount) > due + 0.009 ||
                    (method === "bank" && bankAccounts.length > 0 && !bankAccount)
                  }
                  onClick={() => {
                    if (pay.isPending) return;
                    const n = Number(amount);
                    if (!Number.isFinite(n) || n <= 0) return;
                    pay.mutate(n);
                  }}
                >
                  {due <= 0
                    ? t("sales.fullyPaid")
                    : payments.length > 0
                      ? t("sales.addPayment")
                      : t("sales.recordPayment")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("sales.paymentHint")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <MoneyReceiptPrint receipt={receipt} open={receiptOpen} onOpenChange={setReceiptOpen} />
    </div>
  );
}
