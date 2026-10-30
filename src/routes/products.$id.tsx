import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { productService } from "@/services/product.service";
import { accountingService } from "@/services/accounting.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/common/ProductImage";
import { formatCurrency } from "@/utils/formatters";
import { useT } from "@/i18n";
import type { CostingMethod } from "@/types";

export const Route = createFileRoute("/products/$id")({
  component: ProductDetail,
});

function ProductDetail() {
  return (
    <DetailOrOutlet>
      <ProductDetailBody />
    </DetailOrOutlet>
  );
}

function ProductDetailBody() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: p,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["products", id],
    queryFn: () => productService.get(id),
  });
  const { data: coa = [] } = useQuery({ queryKey: ["coa"], queryFn: accountingService.listCoa });
  const coaName = (aid?: string) => {
    if (!aid) return "—";
    const a = coa.find((c) => c.id === aid);
    return a ? `${a.code ? `${a.code} · ` : ""}${a.name}` : "—";
  };
  const methodLabel = (m?: CostingMethod) => {
    if (m === "lifo") return t("products.costing.lifo");
    if (m === "average") return t("products.costing.average");
    return t("products.costing.fifo");
  };

  const remove = useMutation({
    mutationFn: () => productService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("products.deleted"));
      navigate({ to: "/products" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !p)
    return <div className="p-6 text-sm text-destructive">{t("products.notFound")}</div>;
  if (!p) return null;

  return (
    <div>
      <PageHeader
        title={p.name}
        description={`${p.category} · ${p.code}`}
        backTo="/products"
        backLabel={t("products.title")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/products/$id/edit" params={{ id }}>
                <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`${t("common.delete")} ${p.name}?`)) remove.mutate();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6 sm:flex-row">
          <ProductImage src={p.image} alt={p.name} size="lg" />
          <div className="grid flex-1 gap-4 md:grid-cols-3 text-sm">
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.salesPrice")}</p>
              <p className="font-medium">{formatCurrency(p.price)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.costPrice")}</p>
              <p className="font-medium">{formatCurrency(p.cost ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.productType")}</p>
              <p className="font-medium">
                {p.productType === "cylinder"
                  ? t("products.type.cylinder")
                  : p.productType === "gas"
                    ? t("products.type.gas")
                    : p.productType === "product"
                      ? t("products.type.product")
                      : (p.productType || (p.uom === "cyl" ? t("products.type.cylinder") : t("products.type.gas")))}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.uom")}</p>
              <p className="font-medium">{p.uom}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.stock")}</p>
              <p className="font-medium">{p.stock}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("products.reorder")}</p>
              <p className="font-medium">{p.reorderLevel}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                {t("products.incomeAccount")}
              </p>
              <p className="font-medium">{coaName(p.incomeAccountId)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                {t("products.expenseAccount")}
              </p>
              <p className="font-medium">{coaName(p.expenseAccountId)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                {t("products.costingMethod")}
              </p>
              <p className="font-medium">{methodLabel(p.costingMethod)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
