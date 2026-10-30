import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { salesService } from "@/services/sales.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { paymentStatus } from "@/utils/helpers";
import type { SalesOrder, SalesStatus } from "@/types";
import { useT } from "@/i18n";

const statusVariant: Record<SalesStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  confirmed: "outline",
  invoiced: "default",
  paid: "default",
  cancelled: "destructive",
};

export function SalesOrderList() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["sales"], queryFn: salesService.list });

  const remove = useMutation({
    mutationFn: (id: string) => salesService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      toast.success(t("sales.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canEdit = (r: SalesOrder) => r.status !== "cancelled";
  const canDelete = (r: SalesOrder) => r.status !== "paid";

  return (
    <div>
      <PageHeader
        title={t("sales.title")}
        description={t("sales.desc")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/sales/quotation">{t("sales.quotation")}</Link>
            </Button>
            <Button asChild>
              <Link to="/sales/new">
                <Plus className="mr-1 h-4 w-4" /> {t("sales.new")}
              </Link>
            </Button>
          </div>
        }
      />
      <DataTable<SalesOrder>
        rows={data}
        searchKeys={["orderNo", "customerName"]}
        dateKey={(r) => r.createdAt || r.date}
        onRowClick={(r) => navigate({ to: "/sales/$id", params: { id: r.id } })}
        columns={[
          {
            key: "no",
            header: t("sales.orderNo"),
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
            key: "cust",
            header: t("common.customer"),
            sortable: true,
            sortValue: (r) => r.customerName,
            render: (r) => (
              <PartyNameLink kind="customer" id={r.customerId} name={r.customerName} />
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
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/sales/$id", params: { id: r.id } })}
                onEdit={
                  canEdit(r)
                    ? () => navigate({ to: "/sales/$id/edit", params: { id: r.id } })
                    : undefined
                }
                onDelete={
                  canDelete(r)
                    ? () => {
                        if (confirm(t("sales.deleteConfirm"))) remove.mutate(r.id);
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
