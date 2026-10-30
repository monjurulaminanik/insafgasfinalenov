import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Printer, Trash2, Undo2 } from "lucide-react";
import { deliveryService } from "@/services/delivery.service";
import { salesService } from "@/services/sales.service";
import { productService } from "@/services/product.service";
import { cylinderService } from "@/services/cylinder.service";
import { customerService } from "@/services/customer.service";
import { hrService } from "@/services/hr.service";
import { isCylinderTrackedLine } from "@/lib/cylinder-product";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { isDeliveryStaff } from "@/lib/hr-staff";
import { DeliveryCylinderDialog } from "@/components/delivery/DeliveryCylinderDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { PrintDocHeader } from "@/components/common/PrintDocHeader";
import { PrintMeta, PrintSignatures } from "@/components/common/PrintParts";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatDate, formatDateTime } from "@/utils/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n";

export function DeliveryChallan({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = useState(false);
  const {
    data: d,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["deliveries", id],
    queryFn: () => deliveryService.get(id),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: customer } = useQuery({
    queryKey: ["customers", d?.customerId],
    queryFn: () => customerService.get(d!.customerId),
    enabled: !!d?.customerId,
  });
  const { data: salesOrder } = useQuery({
    queryKey: ["sales", d?.salesOrderId],
    queryFn: () => salesService.get(d!.salesOrderId!),
    enabled: !!d?.salesOrderId,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: hrService.listEmployees,
  });
  const { data: tracking = "serial" } = useQuery({
    queryKey: ["cylinderTracking"],
    queryFn: () => getCylinderTrackingFn(),
  });

  const confirm = useMutation({
    mutationFn: (payload?: {
      issuedIdsByItem?: string[][];
      returnedIds?: string[];
      lotNumber?: string;
      expectedReturnAt?: string;
      skipCylinders?: boolean;
      asExchange?: boolean;
    }) => deliveryService.confirm(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveries", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylAccountability"] });
      setAssignOpen(false);
      toast.success(t("deliveries.confirmed") || "Delivery confirmed successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignDriver = useMutation({
    mutationFn: (name: string) => deliveryService.update(id, { driverName: name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      qc.invalidateQueries({ queryKey: ["deliveries", id] });
      toast.success(t("deliveries.assigned"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deliveryService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      toast.success(t("deliveries.deleted"));
      navigate({ to: "/deliveries" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const needsCylinders = (d?.items || []).some((it) =>
    isCylinderTrackedLine(
      it,
      products.find((p) => p.id === it.productId),
    ),
  );
  const canConfirm = d && (d.status === "pending" || d.status === "in_transit");
  const canDelete = d?.status === "pending";
  const startConfirm = () => {
    if (needsCylinders) setAssignOpen(true);
    else confirm.mutate({ skipCylinders: true });
  };
  const serialsOf = (ids?: string[]) =>
    (ids || []).map((cid) => cylinders.find((c) => c.id === cid)?.serialNumber || cid).join(", ") ||
    "—";

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !d)
    return <div className="p-6 text-sm text-destructive">{t("deliveries.notFound")}</div>;
  if (!d) return null;

  const soNo = salesOrder?.orderNo || "—";
  const dispatchDate = d.confirmedAt ? formatDateTime(d.confirmedAt) : formatDate(d.date);
  const busy = confirm.isPending || remove.isPending || assignDriver.isPending;
  const deliveryStaff = employees.filter(isDeliveryStaff);

  return (
    <div>
      <PageHeader
        title={`${t("deliveries.challanNo")} ${d.challanNo}`}
        description={`${t("common.customer")}: ${d.customerName}`}
        backTo="/deliveries"
        backLabel={t("deliveries.title")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/deliveries/$id/edit" params={{ id: d.id }}>
                {t("common.edit")}
              </Link>
            </Button>
            {(d.status === "delivered" || d.status === "confirmed") && (
              <Button variant="outline" asChild>
                <Link to="/deliveries/$id/return" params={{ id: d.id }}>
                  <Undo2 className="mr-1 h-4 w-4" />
                  {t("deliveries.return")}
                </Link>
              </Button>
            )}
            {canConfirm && (
              <>
                <Button disabled={busy} data-testid="delivery-confirm" onClick={startConfirm}>
                  {t("deliveries.confirm")}
                </Button>
                {needsCylinders && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    data-testid="delivery-confirm-gas-only"
                    onClick={() => confirm.mutate({ skipCylinders: true })}
                  >
                    {t("deliveries.sellGasOnly")}
                  </Button>
                )}
              </>
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
                  if (window.confirm(t("deliveries.deleteConfirm"))) remove.mutate();
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t("common.delete")}
              </Button>
            )}
            <Badge className="no-print">{t(`status.${d.status}` as any)}</Badge>
          </div>
        }
      />
      <Card className="print-sheet">
        <CardContent className="space-y-5 pt-6">
          <PrintDocHeader
            title={t("doc.deliveryNote")}
            subtitle={`${t("deliveries.challanNo")}: ${d.challanNo}`}
            right={
              <div className="text-right">
                <p className="text-lg font-bold uppercase tracking-wide">{t("doc.deliveryNote")}</p>
                <p className="font-mono text-sm">{d.challanNo}</p>
                <Badge className="no-print mt-2">{t(`status.${d.status}` as any)}</Badge>
              </div>
            }
          />

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="print-avoid-break space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("doc.deliverTo")}
              </p>
              <p className="font-medium">
                <PartyNameLink kind="customer" id={d.customerId} name={d.customerName} />
              </p>
              {customer?.phone && <p className="text-muted-foreground">{customer.phone}</p>}
              {customer?.address && (
                <p className="max-w-sm text-muted-foreground">{customer.address}</p>
              )}
            </div>
            <PrintMeta
              className="lg:grid-cols-2"
              items={[
                {
                  label: t("doc.soNo"),
                  value: d.salesOrderId ? (
                    <Link
                      className="font-mono text-primary underline-offset-2 hover:underline"
                      to="/sales/$id"
                      params={{ id: d.salesOrderId }}
                    >
                      {soNo}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: t("deliveries.deliveryman"), value: d.driverName },
                { label: t("deliveries.vehicle"), value: d.vehicleNo },
                {
                  label: t("deliveries.receiver"),
                  value: d.receiverName || salesOrder?.receiverName || "—",
                },
                { label: t("deliveries.emptyReceived"), value: String(d.emptyReturned ?? 0) },
                { label: t("doc.dispatchDate"), value: dispatchDate },
                ...(d.expectedReturnAt
                  ? [{ label: t("inventory.expectedReturn"), value: formatDate(d.expectedReturnAt) }]
                  : []),
              ]}
            />
          </div>
          {d.status === "pending" && deliveryStaff.length > 0 && (
            <div className="no-print max-w-sm space-y-1.5">
              <Label>{t("deliveries.deliveryman")}</Label>
              <Select
                value={d.driverName}
                onValueChange={(v) => assignDriver.mutate(v)}
                disabled={assignDriver.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("common.select")} />
                </SelectTrigger>
                <SelectContent>
                  {deliveryStaff.map((e) => (
                    <SelectItem key={e.id} value={e.name}>
                      {e.name} · {e.designation}
                    </SelectItem>
                  ))}
                  {d.driverName && !deliveryStaff.some((e) => e.name === d.driverName) && (
                    <SelectItem value={d.driverName}>{d.driverName}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>{t("sales.item")}</TableHead>
                  <TableHead>{t("cylinders.serial")}</TableHead>
                  <TableHead className="text-right">{t("common.quantity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.items.map((it, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>{it.productName}</TableCell>
                    <TableCell className="font-mono text-xs">{serialsOf(it.cylinderIds)}</TableCell>
                    <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PrintSignatures left={t("doc.authorizedSign")} right={t("doc.receivedBy")} />
          <p className="text-center text-[10px] text-muted-foreground">{t("doc.pageFooter")}</p>

          <div className="no-print flex justify-end">
            <Button
              onClick={startConfirm}
              disabled={!canConfirm || confirm.isPending}
              data-testid="delivery-confirm"
            >
              {canConfirm ? t("deliveries.confirm") : t(`status.${d.status}` as any)}
            </Button>
          </div>
        </CardContent>
      </Card>
      {d && (
        <DeliveryCylinderDialog
          delivery={d}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          pending={confirm.isPending}
          onConfirm={(payload) => confirm.mutate(payload)}
        />
      )}
    </div>
  );
}
