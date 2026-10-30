import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { supplierReturnService } from "@/services/supplier-return.service";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { SupplierReturn } from "@/types";
import { useT } from "@/i18n";
import { ReceiveSupplierDeliveryDialog } from "./ReceiveSupplierDeliveryDialog";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  confirmed: "default",
  received: "default",
  partial: "secondary",
  draft: "secondary",
  cancelled: "destructive",
};

function isFullyReceived(sr: SupplierReturn): boolean {
  if (sr.status === "received") return true;
  if (!sr.items || sr.items.length === 0) return true;
  return sr.items.every((it) => {
    const ordered = Number(it.quantity) || 0;
    const received = Number(it.receivedQty) || 0;
    return received >= ordered;
  });
}

export function SupplierReturnList() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedForReceive, setSelectedForReceive] = useState<SupplierReturn | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["supplierReturns"],
    queryFn: supplierReturnService.list,
  });

  const remove = useMutation({
    mutationFn: (id: string) => supplierReturnService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplierReturns"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      toast.success(t("supplierReturns.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title={t("supplierReturns.title")}
        description={t("supplierReturns.desc")}
        actions={
          <Button asChild>
            <Link to="/suppliers/returns/new">
              <Plus className="mr-1 h-4 w-4" /> {t("supplierReturns.new")}
            </Link>
          </Button>
        }
      />
      <DataTable<SupplierReturn>
        rows={data}
        searchKeys={["returnNo", "supplierName"]}
        dateKey="date"
        onRowClick={(r) => navigate({ to: "/suppliers/returns/$id", params: { id: r.id } })}
        columns={[
          {
            key: "no",
            header: t("supplierReturns.returnNo"),
            sortable: true,
            sortValue: (r) => r.returnNo,
            render: (r) => <span className="font-mono text-xs">{r.returnNo}</span>,
          },
          {
            key: "date",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.date,
            render: (r) => formatDate(r.date),
          },
          {
            key: "sup",
            header: t("common.supplier"),
            sortable: true,
            sortValue: (r) => r.supplierName,
            render: (r) => (
              <PartyNameLink kind="supplier" id={r.supplierId} name={r.supplierName} />
            ),
          },
          {
            key: "total",
            header: t("common.total"),
            sortable: true,
            sortValue: (r) => r.total,
            render: (r) => formatCurrency(r.total),
            className: "text-right",
          },
          {
            key: "st",
            header: t("common.status"),
            sortable: true,
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge variant={statusVariant[r.status] || "outline"}>
                {t(`status.${r.status}` as any) || r.status}
              </Badge>
            ),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: cn(actionsColumnClass, "min-w-[215px]"),
            render: (r) => {
              const fully = isFullyReceived(r);
              return (
                <RowActions
                  leadingExtras={
                    r.status !== "cancelled"
                      ? [
                          {
                            label: fully
                              ? t("supplierReturns.fullyReceived") || "Fully Received"
                              : t("supplierReturns.receiveDelivery") || "Receive Delivery",
                            icon: <Truck className="h-3.5 w-3.5 text-primary" />,
                            iconOnly: true,
                            disabled: fully,
                            onClick: () => setSelectedForReceive(r),
                          },
                        ]
                      : undefined
                  }
                  onView={() => navigate({ to: "/suppliers/returns/$id", params: { id: r.id } })}
                  onEdit={
                    r.status !== "cancelled" && !fully
                      ? () => navigate({ to: "/suppliers/returns/$id/edit", params: { id: r.id } })
                      : undefined
                  }
                  onDelete={
                    r.status !== "cancelled"
                      ? () => {
                          if (confirm(t("supplierReturns.deleteConfirm"))) remove.mutate(r.id);
                        }
                      : undefined
                  }
                  deleteDisabled={remove.isPending}
                />
              );
            },
          },
        ]}
      />
      <ReceiveSupplierDeliveryDialog
        open={Boolean(selectedForReceive)}
        onOpenChange={(v) => {
          if (!v) setSelectedForReceive(null);
        }}
        supplierReturn={selectedForReceive}
      />
    </div>
  );
}
