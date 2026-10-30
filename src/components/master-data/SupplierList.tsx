import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { supplierService } from "@/services/supplier.service";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { formatCurrency, formatOpenedOn } from "@/utils/formatters";
import type { Supplier } from "@/types";
import { useT } from "@/i18n";

export function SupplierList() {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["suppliers"], queryFn: supplierService.list });

  const remove = useMutation({
    mutationFn: (id: string) => supplierService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(t("suppliers.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.desc")}
        actions={
          <>
            <Button asChild>
              <Link to="/suppliers/report">{t("suppliers.report")}</Link>
            </Button>
            <Button asChild>
              <Link to="/suppliers/new">
                <Plus className="mr-1 h-4 w-4" /> {t("suppliers.new")}
              </Link>
            </Button>
          </>
        }
      />
      <DataTable<Supplier>
        rows={data}
        searchKeys={["name", "phone"]}
        dateKey="createdAt"
        onRowClick={(r) => navigate({ to: "/suppliers/$id", params: { id: r.id } })}
        columns={[
          {
            key: "since",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.createdAt,
            render: (r) => (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {formatOpenedOn(r.createdAt)}
              </span>
            ),
          },
          {
            key: "name",
            header: t("common.name"),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => <PartyNameLink kind="supplier" id={r.id} name={r.name} />,
          },
          {
            key: "phone",
            header: t("common.phone"),
            sortable: true,
            sortValue: (r) => r.phone,
            render: (r) => r.phone,
          },
          {
            key: "address",
            header: t("common.address"),
            render: (r) => <span className="text-muted-foreground">{r.address}</span>,
          },
          {
            key: "bal",
            header: t("suppliers.payable"),
            sortable: true,
            sortValue: (r) => r.openingBalance,
            render: (r) => formatCurrency(r.openingBalance),
            className: "text-right",
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/suppliers/$id", params: { id: r.id } })}
                onEdit={() => navigate({ to: "/suppliers/$id/edit", params: { id: r.id } })}
                extras={[
                  {
                    label: t("suppliers.statement"),
                    icon: <FileText className="h-3.5 w-3.5" />,
                    onClick: () =>
                      navigate({ to: "/suppliers/$id/statement", params: { id: r.id } }),
                  },
                ]}
                onDelete={() => {
                  if (confirm(`${t("common.delete")} ${r.name}?`)) remove.mutate(r.id);
                }}
                deleteDisabled={remove.isPending}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
