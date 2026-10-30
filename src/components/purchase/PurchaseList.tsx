import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { purchaseService } from "@/services/purchase.service";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { PurchaseOrder, PurchaseStatus } from "@/types";
import { paymentStatus } from "@/utils/helpers";
import { receivingStatus } from "@/lib/purchase-qty";
import { useT } from "@/i18n";

const statusVariant: Record<PurchaseStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  ordered: "outline",
  partial: "outline",
  received: "default",
  billed: "default",
  paid: "default",
  cancelled: "destructive",
};

export function PurchaseList() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["purchases"], queryFn: purchaseService.list });

  const remove = useMutation({
    mutationFn: (id: string) => purchaseService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      toast.success(t("purchases.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title={t("purchases.title")}
        description={t("purchases.desc")}
        actions={
          <Button asChild>
            <Link to="/purchases/new">
              <Plus className="mr-1 h-4 w-4" /> {t("purchases.new")}
            </Link>
          </Button>
        }
      />
      <DataTable<PurchaseOrder>
        rows={data}
        searchKeys={["orderNo", "supplierName"]}
        dateKey="date"
        onRowClick={(r) => navigate({ to: "/purchases/$id", params: { id: r.id } })}
        columns={[
          {
            key: "no",
            header: t("purchases.poNo"),
            sortable: true,
            sortValue: (r) => r.orderNo,
            render: (r) => <span className="font-mono text-xs">{r.orderNo}</span>,
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
            key: "paid",
            header: t("common.paid"),
            sortable: true,
            sortValue: (r) => r.paid,
            render: (r) => formatCurrency(r.paid),
            className: "text-right",
          },
          {
            key: "due",
            header: t("common.due"),
            sortable: true,
            sortValue: (r) => r.total - r.paid,
            render: (r) => formatCurrency(r.total - r.paid),
            className: "text-right",
          },
          {
            key: "pay",
            header: t("sales.paymentStatus"),
            sortable: true,
            sortValue: (r) => paymentStatus(r.total, r.paid),
            render: (r) => t(`sales.${paymentStatus(r.total, r.paid)}`),
          },
          {
            key: "recv",
            header: t("purchases.receivingStatus"),
            sortable: true,
            sortValue: (r) => receivingStatus(r.items, r),
            render: (r) => {
              const recv = receivingStatus(r.items, r);
              return t(
                recv === "received"
                  ? "purchases.recv.full"
                  : recv === "partial"
                    ? "purchases.recv.partial"
                    : "purchases.recv.none",
              );
            },
          },
          {
            key: "st",
            header: t("common.status"),
            sortable: true,
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge variant={statusVariant[r.status]}>{t(`status.${r.status}` as any)}</Badge>
            ),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: cn(actionsColumnClass, "min-w-[170px]"),
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/purchases/$id", params: { id: r.id } })}
                onEdit={
                  r.status !== "cancelled"
                    ? () => navigate({ to: "/purchases/$id/edit", params: { id: r.id } })
                    : undefined
                }
                extras={
                  r.status !== "cancelled"
                    ? [
                        {
                          label: t("purchases.returnAction") || "Return",
                          icon: <RotateCcw className="h-3.5 w-3.5" />,
                          iconOnly: true,
                          onClick: () =>
                            navigate({
                              to: "/suppliers/returns/new",
                              search: { purchaseId: r.id },
                            }),
                        },
                      ]
                    : undefined
                }
                onDelete={
                  r.status === "draft" || r.status === "cancelled"
                    ? () => {
                        if (confirm(t("purchases.deleteConfirm"))) remove.mutate(r.id);
                      }
                    : undefined
                }
                deleteDisabled={remove.isPending}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
