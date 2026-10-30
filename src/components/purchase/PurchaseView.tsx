import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { purchaseService } from "@/services/purchase.service";
import { productService } from "@/services/product.service";
import { supplierService } from "@/services/supplier.service";
import { accountingService } from "@/services/accounting.service";
import { cylinderService } from "@/services/cylinder.service";
import {
  lineReceivedQty,
  lineRemainingQty,
  poCanReceive,
  receivingStatus,
} from "@/lib/purchase-qty";
import { ReceiveCylinderDialog } from "@/components/purchase/ReceiveCylinderDialog";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { lineAmount, paymentStatus } from "@/utils/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { PaymentMethod, Voucher } from "@/types";
import { useT, type MessageKey } from "@/i18n";
import { Printer, Trash2 } from "lucide-react";

type PayChoice = "cash" | "bank" | "credit";

function payStatusLabel(t: (key: MessageKey) => string, total: number, paid: number) {
  const status = paymentStatus(total, paid);
  if (status === "paid") return t("sales.paid");
  if (status === "partial") return t("sales.partial");
  return t("purchases.unpaid");
}

function recvStatusLabel(t: (key: MessageKey) => string, recv: ReturnType<typeof receivingStatus>) {
  if (recv === "received") return t("purchases.recv.full");
  if (recv === "partial") return t("purchases.recv.partial");
  return t("purchases.recv.none");
}

export function PurchaseView({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    data: po,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["purchases", id],
    queryFn: () => purchaseService.get(id),
  });
  const { data: supplier } = useQuery({
    queryKey: ["suppliers", po?.supplierId],
    queryFn: () => supplierService.get(po!.supplierId),
    enabled: !!po?.supplierId,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayChoice>("cash");
  const [bankAccount, setBankAccount] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["purchases", id] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stockMovements"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["cylinders"] });
    qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["vouchers"] });
  };

  const receive = useMutation({
    mutationFn: (payload?: {
      serialsByItem?: string[][];
      lotNumber?: string;
      qtyByItem?: number[];
      requestId?: string;
    }) => purchaseService.receive(id, payload),
    onSuccess: () => {
      setReceiveOpen(false);
      invalidate();
      toast.success(t("purchases.received"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: (n: number) =>
      purchaseService.recordPayment(
        id,
        n,
        method as PaymentMethod,
        method === "bank" ? bankAccount || "bank" : undefined,
      ),
    onSuccess: () => {
      invalidate();
      toast.success(t("purchases.paymentRecorded"));
      setAmount("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: () => purchaseService.setStatus(id, "cancelled"),
    onSuccess: () => {
      invalidate();
      toast.success(t("purchases.cancelled"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => purchaseService.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("purchases.deleted"));
      navigate({ to: "/purchases" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !po)
    return <div className="p-6 text-sm text-destructive">{t("purchases.notFound")}</div>;
  if (!po) return null;

  const due = po.total - po.paid;
  const busy = receive.isPending || pay.isPending || cancel.isPending || remove.isPending;
  const canDelete = po.status === "draft" || po.status === "cancelled";
  const recv = receivingStatus(po.items, po);
  const canReceive = poCanReceive(po.items, po);
  const startReceive = () => {
    if (busy) return;
    setReceiveOpen(true);
  };
  const serialsOf = (ids?: string[]) =>
    (ids || []).map((cid) => cylinders.find((c) => c.id === cid)?.serialNumber || cid).join(", ") ||
    "—";
  const bankAccounts = accounts.filter((a) => a.type === "bank" || a.type === "mobile");
  const voucherPays = vouchers
    .filter((v) => v.refType === "purchase" && v.refId === po.id && v.type === "payment")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const covered = voucherPays.reduce((sum, v) => sum + (v.amount || 0), 0);
  const leftover = (po.paid || 0) - covered;
  const payments: Array<Voucher & { synthetic?: boolean }> =
    leftover > 0.009
      ? [
          {
            id: `prior-${po.id}`,
            voucherNo: po.orderNo,
            type: "payment",
            date: po.date,
            account: "cash",
            amount: leftover,
            notes: t("purchases.priorPayment"),
            createdAt: po.date,
            synthetic: true,
          },
          ...voucherPays,
        ]
      : voucherPays;
  let runningPaid = 0;
  const history = payments.map((p) => {
    runningPaid += p.amount || 0;
    return {
      ...p,
      runningPaid,
      runningDue: Math.max(0, (po.total || 0) - runningPaid),
    };
  });
  const creditMode = method === "credit";
  const payLocked = due <= 0 || po.status === "cancelled" || pay.isPending || creditMode;

  return (
    <div>
      <PageHeader
        title={`${t("purchases.title")} ${po.orderNo}`}
        description={`${po.supplierName} · ${formatDate(po.date)}`}
        backTo="/purchases"
        backLabel={t("purchases.title")}
        actions={
          <div className="flex items-center gap-2">
            {po.status !== "cancelled" && (
              <Button variant="outline" asChild>
                <Link to="/purchases/$id/edit" params={{ id: po.id }}>
                  {t("common.edit")}
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/suppliers/$id/statement" params={{ id: po.supplierId }}>
                {t("suppliers.statement")}
              </Link>
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              {t("common.print")}
            </Button>
            {canDelete && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("purchases.deleteConfirm"))) remove.mutate();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t("common.delete")}
              </Button>
            )}
            <Badge>{t(`status.${po.status}` as any)}</Badge>
          </div>
        }
      />
      <div className="print-layout grid gap-4 lg:grid-cols-3">
        <Card className="print-sheet lg:col-span-2">
          <CardContent className="space-y-4 pt-6">
            <PrintDocHeader
              title={t("purchases.title")}
              subtitle={`${po.orderNo}${po.grnNo ? ` · GRN ${po.grnNo}` : ""} · ${formatDate(po.date)}`}
              right={
                <div className="text-right">
                  <p className="text-lg font-bold uppercase tracking-wide">
                    {t("purchases.title")}
                  </p>
                  <p className="font-mono text-sm">{po.orderNo}</p>
                  <Badge className="no-print mt-2">{t(`status.${po.status}` as any)}</Badge>
                </div>
              }
            />
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div className="print-avoid-break space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("common.supplier")}
                </p>
                <p className="font-medium">
                  <PartyNameLink kind="supplier" id={po.supplierId} name={po.supplierName} />
                </p>
                {supplier?.phone && <p className="text-muted-foreground">{supplier.phone}</p>}
              </div>
              <PrintMeta
                className="lg:grid-cols-2"
                items={[
                  {
                    label: t("purchases.poNo"),
                    value: <span className="font-mono">{po.orderNo}</span>,
                  },
                  { label: t("common.date"), value: formatDate(po.date) },
                  { label: t("common.paid"), value: formatCurrency(po.paid) },
                  { label: t("common.due"), value: formatCurrency(due) },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{t("sales.item")}</TableHead>
                    <TableHead>{t("products.code")}</TableHead>
                    <TableHead className="no-print">{t("cylinders.serial")}</TableHead>
                    <TableHead className="text-right">{t("common.quantity")}</TableHead>
                    <TableHead className="text-right">{t("purchases.cost")}</TableHead>
                    <TableHead className="text-right">{t("common.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{it.productName}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {products.find((p) => p.id === it.productId)?.code || "—"}
                      </TableCell>
                      <TableCell className="no-print font-mono text-xs">
                        {serialsOf(it.cylinderIds)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{it.quantity}</div>
                        <div className="no-print text-[10px] text-muted-foreground">
                          {t("purchases.receivedQty")} {lineReceivedQty(it, po)} ·{" "}
                          {t("purchases.remainingQty")} {lineRemainingQty(it, po)}
                        </div>
                      </TableCell>
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
              rows={[
                { label: t("common.total"), value: formatCurrency(po.total), bold: true },
                { label: t("common.paid"), value: formatCurrency(po.paid) },
                { label: t("common.due"), value: formatCurrency(due), bold: true },
                { label: t("sales.paymentStatus"), value: payStatusLabel(t, po.total, po.paid) },
                { label: t("purchases.receivingStatus"), value: recvStatusLabel(t, recv) },
              ]}
            />
            {po.notes && (
              <div className="print-avoid-break space-y-1 border-t pt-3 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("common.notes")}
                </p>
                <p>{po.notes}</p>
              </div>
            )}
            <PrintSignatures left={t("doc.authorizedSign")} right={t("doc.receivedBy")} />
            <p className="text-center text-[10px] text-muted-foreground">{t("doc.pageFooter")}</p>
          </CardContent>
        </Card>

        <div className="space-y-4 no-print">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <h3 className="font-semibold">{t("sales.workflow")}</h3>
              {canReceive && (
                <Button className="w-full" disabled={busy} onClick={startReceive}>
                  {t("purchases.receive")}
                </Button>
              )}
              {(po.status === "ordered" || po.status === "draft") && (
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => cancel.mutate()}
                >
                  {t("purchases.cancel")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("purchases.receiveHint")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-3">
              <h3 className="font-semibold">{t("purchases.supplierPayment")}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("common.total")}</p>
                  <p className="font-medium">{formatCurrency(po.total)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("common.paid")}</p>
                  <p className="font-medium">{formatCurrency(po.paid)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">{t("common.due")}</p>
                  <p className="font-medium">{formatCurrency(due)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">
                    {t("sales.paymentStatus")}
                  </p>
                  <p className="font-medium">{payStatusLabel(t, po.total, po.paid)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">
                    {t("purchases.receivingStatus")}
                  </p>
                  <p className="font-medium">{recvStatusLabel(t, recv)}</p>
                </div>
              </div>
              {history.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.date")}</TableHead>
                        <TableHead>{t("purchases.paidFrom")}</TableHead>
                        <TableHead>{t("doc.reference")}</TableHead>
                        <TableHead className="text-right">{t("common.amount")}</TableHead>
                        <TableHead className="text-right">{t("common.paid")}</TableHead>
                        <TableHead className="text-right">{t("common.due")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((p) => (
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
                          <TableCell className="font-mono text-xs">{p.voucherNo}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(p.amount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(p.runningPaid)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(p.runningDue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t("purchases.paidFrom")}</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as PayChoice)}
                  disabled={due <= 0 || po.status === "cancelled" || pay.isPending}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("common.cash")}</SelectItem>
                    <SelectItem value="bank">{t("common.bank")}</SelectItem>
                    <SelectItem value="credit">{t("purchases.credit")}</SelectItem>
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
              {!creditMode && (
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
              )}
              {creditMode ? (
                <p className="text-xs text-muted-foreground">{t("purchases.creditHint")}</p>
              ) : (
                <>
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
                      : history.length > 0
                        ? t("sales.addPayment")
                        : t("sales.recordPayment")}
                  </Button>
                  <p className="text-xs text-muted-foreground">{t("purchases.paymentHint")}</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <ReceiveCylinderDialog
        po={po}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        pending={receive.isPending}
        onReceive={(payload) => {
          if (receive.isPending) return;
          receive.mutate(payload);
        }}
      />
    </div>
  );
}
