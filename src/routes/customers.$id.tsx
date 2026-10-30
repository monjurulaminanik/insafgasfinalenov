import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { customerService } from "@/services/customer.service";
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
import { formatCurrency, formatDate, formatOpenedOn } from "@/utils/formatters";
import { customerOpeningSigned } from "@/lib/customer-balance";
import { customerCylinderHistory } from "@/lib/customer-cylinders";
import { getCylinderAccountabilityFn } from "@/lib/cylinder.functions";
import { useT } from "@/i18n";

export const Route = createFileRoute("/customers/$id")({
  component: CustomerDetail,
});

function CustomerDetail() {
  return (
    <DetailOrOutlet>
      <CustomerDetailBody />
    </DetailOrOutlet>
  );
}

function CustomerDetailBody() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: c,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["customers", id],
    queryFn: () => customerService.get(id),
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
    queryKey: ["cylAccountability", "customer", id],
    queryFn: () => getCylinderAccountabilityFn({ data: { kind: "customer", partyId: id } }),
  });

  const remove = useMutation({
    mutationFn: () => customerService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      toast.success(t("customers.deleted"));
      navigate({ to: "/customers" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !c)
    return <div className="p-6 text-sm text-destructive">{t("customers.notFound")}</div>;
  if (!c) return null;

  const cylBal = cylAcc?.parties[0] ?? {
    sent: 0,
    returned: 0,
    remaining: 0,
    overdue: 0,
    lost: 0,
    damaged: 0,
    missingMoves: 0,
  };
  const cylHist = customerCylinderHistory(id, cylinders, movements, products);

  return (
    <div>
      <PageHeader
        title={c.name}
        description={c.address}
        backTo="/customers"
        backLabel={t("customers.title")}
        actions={
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/customers/$id/statement" params={{ id }}>
                <FileText className="mr-1 h-4 w-4" /> {t("customers.statement")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/customers/$id/edit" params={{ id }}>
                <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`${t("common.delete")} ${c.name}?`)) remove.mutate();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6 grid gap-4 md:grid-cols-2 text-sm">
          <Info label={t("common.phone")} value={c.phone} />
          <Info label={t("customers.whatsapp")} value={c.whatsapp || "—"} />
          <Info label={t("common.address")} value={c.address} />
          <Info label={t("customers.creditLimit")} value={formatCurrency(c.creditLimit || 0)} />
          <Info
            label={t("customers.openingBalance")}
            value={formatCurrency(Math.abs(c.openingBalance || 0))}
          />
          <Info
            label={t("customers.openingType")}
            value={
              (c.openingBalanceType ??
                (customerOpeningSigned(c) < 0 ? "payable" : "receivable")) === "payable"
                ? t("customers.payable")
                : t("customers.receivable")
            }
          />
          <Info
            label={t("customers.reminder")}
            value={
              c.creditReminderEnabled
                ? `${t("customers.reminderOn")} · ${c.creditReminderDays || 0} ${t("customers.reminderDaysUnit")}`
                : t("customers.reminderOff")
            }
          />
          <Info label={t("customers.since")} value={formatOpenedOn(c.createdAt)} />
          <p className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("customers.cylBalanceTitle")}
          </p>
          <Info label={t("customers.cylSent")} value={String(cylBal.sent)} />
          <Info label={t("customers.cylReturned")} value={String(cylBal.returned)} />
          <Info label={t("customers.cylBalance")} value={String(cylBal.remaining)} />
          <Info label={t("customers.cylOverdue")} value={String(cylBal.overdue)} />
          <Info label={t("customers.cylLost")} value={String(cylBal.lost)} />
          <Info label={t("customers.cylDamaged")} value={String(cylBal.damaged)} />
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
                    <TableHead className="text-right">{t("customers.cylBalance")}</TableHead>
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
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
