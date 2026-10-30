import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { supplierService } from "@/services/supplier.service";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { supplierCylinderHistory } from "@/lib/customer-cylinders";
import { getCylinderAccountabilityFn } from "@/lib/cylinder.functions";
import { useT } from "@/i18n";

export const Route = createFileRoute("/suppliers/$id")({
  component: SupplierDetail,
});

function SupplierDetail() {
  return (
    <DetailOrOutlet>
      <SupplierDetailBody />
    </DetailOrOutlet>
  );
}

function SupplierDetailBody() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["suppliers", id],
    queryFn: () => supplierService.get(id),
  });
  const { data: cylinders = [] } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["cylinderMovements"],
    queryFn: cylinderService.listMovements,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: cylAcc } = useQuery({
    queryKey: ["cylAccountability", "supplier", id],
    queryFn: () => getCylinderAccountabilityFn({ data: { kind: "supplier", partyId: id } }),
  });

  const remove = useMutation({
    mutationFn: () => supplierService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(t("suppliers.deleted"));
      navigate({ to: "/suppliers" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !s)
    return <div className="p-6 text-sm text-destructive">{t("suppliers.notFound")}</div>;
  if (!s) return null;

  const cylBal = cylAcc?.parties[0] ?? {
    sent: 0,
    returned: 0,
    remaining: 0,
    overdue: 0,
    lost: 0,
    damaged: 0,
    missingMoves: 0,
  };
  const cylHist = supplierCylinderHistory(id, cylinders, movements, products);

  return (
    <div>
      <PageHeader
        title={s.name}
        description={s.address}
        backTo="/suppliers"
        backLabel={t("suppliers.title")}
        actions={
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/suppliers/$id/statement" params={{ id }}>
                <FileText className="mr-1 h-4 w-4" /> {t("suppliers.statement")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/suppliers/$id/edit" params={{ id }}>
                <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`${t("common.delete")} ${s.name}?`)) remove.mutate();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6 grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("common.phone")}</p>
            <p className="font-medium">{s.phone}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("suppliers.payable")}</p>
            <p className="font-medium">{formatCurrency(s.openingBalance)}</p>
          </div>
          <p className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("customers.cylBalanceTitle")}
          </p>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylSent")}</p>
            <p className="font-medium">{cylBal.sent}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylReturned")}</p>
            <p className="font-medium">{cylBal.returned}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylRemaining")}</p>
            <p className="font-medium">{cylBal.remaining}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylOverdue")}</p>
            <p className="font-medium">{cylBal.overdue}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylLost")}</p>
            <p className="font-medium">{cylBal.lost}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">{t("customers.cylDamaged")}</p>
            <p className="font-medium">{cylBal.damaged}</p>
          </div>
          <p className="md:col-span-2 text-xs text-muted-foreground">
            {t("customers.cylRemainingHint")}
          </p>
          {(cylBal.missingMoves || 0) > 0 && (
            <p className="md:col-span-2 text-xs text-amber-700 dark:text-amber-400">
              {t("customers.cylMissingMoves")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <p className="mb-3 text-xs uppercase text-muted-foreground">
            {t("customers.cylHistory")}
          </p>
          {cylHist.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.noItems")}</p>
          ) : (
            <div className="overflow-auto max-h-[calc(100dvh-18rem)] min-h-[240px]">
              <Table containerClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>{t("common.date")}</TableHead>
                    <TableHead>{t("common.type")}</TableHead>
                    <TableHead className="text-right">{t("customers.cylSent")}</TableHead>
                    <TableHead className="text-right">{t("customers.cylReturned")}</TableHead>
                    <TableHead className="text-right">{t("customers.cylLost")}</TableHead>
                    <TableHead className="text-right">{t("customers.cylRemaining")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cylHist.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.date)}
                      </TableCell>
                      <TableCell>
                        {t(row.typeKey)}
                        {row.serial ? (
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {row.serial}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.sent || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.returned || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.lost || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {row.remaining}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
