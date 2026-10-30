import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PrintMeta, PrintSignatures } from "@/components/common/PrintParts";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { PaymentMethod, Voucher } from "@/types";
import { useT, type MessageKey } from "@/i18n";
import { Printer } from "lucide-react";

const METHOD_KEY: Record<string, MessageKey> = {
  cash: "common.cash",
  bank: "common.bank",
  cheque: "common.cheque",
  mobile: "common.mobileBanking",
};

export type MoneyReceiptModel = {
  receiptNo: string;
  date: string;
  partyName: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
};

export function voucherToReceipt(v: Voucher): MoneyReceiptModel {
  return {
    receiptNo: v.voucherNo,
    date: v.date,
    partyName: v.partyName || "—",
    amount: v.amount,
    method: v.account,
    reference: v.refNo || undefined,
    notes: v.notes,
  };
}

export function MoneyReceiptPrint({
  receipt,
  open,
  onOpenChange,
}: {
  receipt: MoneyReceiptModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  if (!receipt) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="print-sheet max-w-2xl sm:max-w-2xl print:m-0 print:max-w-none print:border-none print:p-0 print:shadow-none">
        <DialogHeader className="no-print flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{t("doc.moneyReceipt")}</DialogTitle>
          <Button variant="outline" size="sm" className="mr-4" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            {t("common.print")}
          </Button>
        </DialogHeader>

        <div className="space-y-6 bg-white p-6 text-black print:p-0">
          <PrintDocHeader
            title={t("doc.moneyReceipt")}
            subtitle={`${t("doc.receiptNo")}: ${receipt.receiptNo}`}
            right={
              <div className="text-right text-sm">
                <p className="text-xl font-bold uppercase tracking-wider">
                  {t("doc.moneyReceipt")}
                </p>
                <p className="mt-1 font-mono">{receipt.receiptNo}</p>
              </div>
            }
          />

          <PrintMeta
            items={[
              { label: t("common.date"), value: formatDate(receipt.date) },
              { label: t("doc.receivedFrom"), value: receipt.partyName },
              {
                label: t("doc.method"),
                value: METHOD_KEY[receipt.method] ? t(METHOD_KEY[receipt.method]) : receipt.method,
              },
              { label: t("doc.reference"), value: receipt.reference || "—" },
              { label: t("doc.paymentFor"), value: receipt.notes || "—" },
            ]}
          />

          <div className="print-avoid-break rounded-lg border-2 border-foreground/20 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("doc.amountInWords")}
            </p>
            <p className="mt-1 font-display text-3xl font-bold tabular-nums">
              {formatCurrency(receipt.amount)}
            </p>
          </div>

          <p className="text-sm text-muted-foreground">{t("doc.thankYou")}</p>
          <PrintSignatures left={t("doc.authorizedSign")} right={t("doc.customerSign")} />
          <p className="pt-4 text-center text-[10px] text-muted-foreground">
            {t("doc.pageFooter")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
