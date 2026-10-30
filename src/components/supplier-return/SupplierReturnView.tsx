import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Printer, Pencil, Truck } from "lucide-react";
import { supplierReturnService } from "@/services/supplier-return.service";
import { supplierService } from "@/services/supplier.service";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { isSupplierReturnFullyReceived, lineAmount } from "@/utils/helpers";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useT } from "@/i18n";
import { ReceiveSupplierDeliveryDialog } from "./ReceiveSupplierDeliveryDialog";

export function SupplierReturnView({ id }: { id: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [receiveOpen, setReceiveOpen] = useState(false);

  const {
    data: ret,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["supplierReturns", id],
    queryFn: () => supplierReturnService.get(id),
  });

  const { data: supplier } = useQuery({
    queryKey: ["suppliers", ret?.supplierId],
    queryFn: () => supplierService.get(ret!.supplierId),
    enabled: !!ret?.supplierId,
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !ret)
    return <div className="p-6 text-sm text-destructive">{t("supplierReturns.notFound")}</div>;
  if (!ret) return null;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={ret.returnNo}
          description={`${formatDate(ret.date)} · ${ret.supplierName}`}
          backTo="/suppliers/returns"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" /> {t("common.print")}
              </Button>
              {ret.status !== "cancelled" && !isSupplierReturnFullyReceived(ret) && (
                <Button size="sm" onClick={() => setReceiveOpen(true)}>
                  <Truck className="mr-1 h-4 w-4" /> {t("supplierReturns.receiveDelivery")}
                </Button>
              )}
              {ret.status !== "cancelled" && !isSupplierReturnFullyReceived(ret) && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/suppliers/returns/$id/edit" params={{ id: ret.id }}>
                    <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
                  </Link>
                </Button>
              )}
            </div>
          }
        />
      </div>

      <Card className="print:shadow-none print:border-none">
        <CardContent className="pt-6 space-y-6">
          <PrintDocHeader
            title={t("supplierReturns.title")}
            subtitle={`${ret.returnNo} · ${formatDate(ret.date)}`}
            right={
              <div className="text-right">
                <p className="text-lg font-bold uppercase tracking-wide">
                  {t("supplierReturns.title")}
                </p>
                <p className="font-mono text-sm">{ret.returnNo}</p>
                <Badge className="no-print mt-2" variant={ret.status === "confirmed" ? "default" : "destructive"}>
                  {t(`status.${ret.status}` as any) || ret.status}
                </Badge>
              </div>
            }
          />

          <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 text-sm">
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider block">
                {t("common.supplier")}
              </span>
              <div className="font-semibold text-base mt-0.5">
                <PartyNameLink kind="supplier" id={ret.supplierId} name={ret.supplierName} />
              </div>
              {supplier?.phone && (
                <div className="text-muted-foreground text-xs mt-1">
                  {t("common.phone")}: {supplier.phone}
                </div>
              )}
              {supplier?.address && (
                <div className="text-muted-foreground text-xs">
                  {t("common.address")}: {supplier.address}
                </div>
              )}
            </div>
            <div className="sm:text-right space-y-1">
              <PrintMeta
                items={[
                  {
                    label: t("supplierReturns.returnNo"),
                    value: <span className="font-mono">{ret.returnNo}</span>,
                  },
                  { label: t("common.date"), value: formatDate(ret.date) },
                  { label: t("common.total"), value: formatCurrency(ret.total) },
                ]}
              />
              {ret.notes && (
                <div className="text-xs text-muted-foreground mt-2">
                  <span className="font-medium">{t("common.notes")}:</span> {ret.notes}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t("common.product")}</TableHead>
                  <TableHead className="w-32">{t("common.type")}</TableHead>
                  <TableHead className="w-24 text-right">{t("common.quantity")}</TableHead>
                  <TableHead className="w-32 text-right">{t("supplierReturns.cost")}</TableHead>
                  <TableHead className="w-32 text-right">{t("common.lineTotal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ret.items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{it.productName}</TableCell>
                    <TableCell className="capitalize text-muted-foreground text-xs">
                      {it.itemType || "product"}
                    </TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(it.price)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(lineAmount(it))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <PrintTotals
              rows={[
                { label: t("common.subtotal"), value: formatCurrency(ret.subtotal) },
                { label: t("common.total"), value: formatCurrency(ret.total), bold: true },
              ]}
            />
          </div>

          <PrintSignatures
            left={t("doc.authorizedSign")}
            right={t("doc.receivedBy")}
          />
        </CardContent>
      </Card>
      <ReceiveSupplierDeliveryDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        supplierReturn={ret}
      />
    </div>
  );
}
