import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { productService } from "@/services/product.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n";

export function StockAlerts() {
  const t = useT();
  const { data = [] } = useQuery({
    queryKey: ["stock-alerts"],
    queryFn: productService.stockAlerts,
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <Link to="/inventory" className="hover:text-primary hover:underline underline-offset-2">
            {t("dash.stockAlerts")}
          </Link>
        </CardTitle>
        <Badge variant="secondary">{data.length}</Badge>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dash.noAlerts")}</p>
        ) : (
          <ul className="space-y-2">
            {data.map((a) => (
              <li key={a.productId}>
                <Link
                  to="/products/$id"
                  params={{ id: a.productId }}
                  className="flex items-center justify-between rounded-md border p-2 transition hover:border-primary/40 hover:bg-muted/40"
                >
                  <div>
                    <p className="text-sm font-medium">{a.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("products.reorder")}: {a.reorderLevel}
                    </p>
                  </div>
                  <Badge variant={a.stock === 0 ? "destructive" : "outline"}>
                    {a.stock} {t("products.stock")}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
