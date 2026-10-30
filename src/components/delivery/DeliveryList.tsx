import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { deliveryService } from "@/services/delivery.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { formatDate } from "@/utils/formatters";
import type { Delivery } from "@/types";
import { useT } from "@/i18n";

export function DeliveryList() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["deliveries"], queryFn: deliveryService.list });

  const remove = useMutation({
    mutationFn: (id: string) => deliveryService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      toast.success(t("deliveries.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title={t("deliveries.title")}
        description={t("deliveries.desc")}
        actions={
          <Button asChild>
            <Link to="/deliveries/new">
              <Plus className="mr-1 h-4 w-4" /> {t("deliveries.new")}
            </Link>
          </Button>
        }
      />
      <DataTable<Delivery>
        rows={data}
        searchKeys={["challanNo", "customerName", "vehicleNo", "salesOrderId"]}
        dateKey="date"
        onRowClick={(r) => navigate({ to: "/deliveries/$id", params: { id: r.id } })}
        columns={[
          {
            key: "date",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.date,
            render: (r) => formatDate(r.date),
          },
          {
            key: "no",
            header: t("deliveries.challanNo"),
            sortable: true,
            sortValue: (r) => r.challanNo,
            render: (r) => <span className="font-mono text-xs">{r.challanNo}</span>,
          },
          {
            key: "cust",
            header: t("common.customer"),
            sortable: true,
            sortValue: (r) => r.customerName,
            render: (r) => <span className="font-medium">{r.customerName}</span>,
          },
          {
            key: "drv",
            header: t("deliveries.deliveryman"),
            sortable: true,
            sortValue: (r) => r.driverName,
            render: (r) => r.driverName,
          },
          {
            key: "veh",
            header: t("deliveries.vehicle"),
            sortable: true,
            sortValue: (r) => r.vehicleNo,
            render: (r) => <span className="font-mono text-xs">{r.vehicleNo}</span>,
          },
          {
            key: "st",
            header: t("common.status"),
            sortable: true,
            sortValue: (r) => r.status,
            render: (r) => (
              <Badge
                variant={
                  r.status === "pending"
                    ? "secondary"
                    : r.status === "confirmed"
                      ? "outline"
                      : "default"
                }
              >
                {t(`status.${r.status}` as any)}
              </Badge>
            ),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/deliveries/$id", params: { id: r.id } })}
                onEdit={() => navigate({ to: "/deliveries/$id/edit", params: { id: r.id } })}
                extras={[
                  {
                    label: t("deliveries.return"),
                    icon: <Undo2 className="h-3.5 w-3.5" />,
                    onClick: () => navigate({ to: "/deliveries/$id/return", params: { id: r.id } }),
                  },
                ]}
                onDelete={
                  r.status === "pending"
                    ? () => {
                        if (confirm(t("deliveries.deleteConfirm"))) remove.mutate(r.id);
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
