import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { productService } from "@/services/product.service";
import { inventoryService } from "@/services/inventory.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/utils/formatters";
import type { Product, StockMovement } from "@/types";
import { useT } from "@/i18n";

function isCylinderProduct(p: Product): boolean {
  if (p.productType === "cylinder") return true;
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return true;
  const cat = String(p.category || "").toLowerCase();
  if (cat.includes("cylinder")) return true;
  return false;
}

export function DamageCylinderPage() {
  const t = useT();
  const qc = useQueryClient();

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });

  const { data: stockMovements = [], isLoading } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });

  const cylinderProducts = products.filter(isCylinderProduct);

  const damageRecords = stockMovements
    .filter((m) => m.movementType === "DAMAGE")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const mutation = useMutation({
    mutationFn: async () => {
      if (!productId) throw new Error(t("damage.selectProduct") || "Please select a cylinder product");
      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        throw new Error("Quantity must be a positive number greater than 0");
      }
      return inventoryService.markDamaged(productId, qty, notes.trim() || undefined, date);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["cylinderMovements"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(t("damage.success") || "Damage recorded successfully");
      setQuantity("1");
      setNotes("");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("damage.title")}
        description={t("damage.desc")}
        backTo="/cylinders"
        backLabel={t("cylinders.title")}
      />

      {/* Manual Entry Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {t("damage.submit")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="damage-product">{t("damage.selectProduct")}</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger id="damage-product">
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {cylinderProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.stock != null ? `(${p.stock} available)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="damage-qty">{t("damage.qty")}</Label>
                <Input
                  id="damage-qty"
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="damage-date">{t("damage.date")}</Label>
                <Input
                  id="damage-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="damage-reason">{t("damage.reason")}</Label>
              <Input
                id="damage-reason"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Valve leak, physical dent, collar damage, expired body"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="destructive"
                disabled={mutation.isPending || !productId}
              >
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                {mutation.isPending ? t("damage.saving") : t("damage.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Damage History / Records List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("damage.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<StockMovement>
            rows={damageRecords}
            searchKeys={["productName", "refId", "notes"]}
            dateKey="date"
            columns={[
              {
                key: "refId",
                header: t("damage.refId"),
                sortable: true,
                sortValue: (r) => r.refId || r.id,
                render: (r) => (
                  <span className="font-mono text-xs">{r.refId || r.id}</span>
                ),
              },
              {
                key: "date",
                header: t("damage.date"),
                sortable: true,
                sortValue: (r) => r.date,
                render: (r) => formatDate(r.date),
              },
              {
                key: "productName",
                header: t("common.product"),
                sortable: true,
                sortValue: (r) => r.productName,
                render: (r) => <span className="font-medium">{r.productName}</span>,
              },
              {
                key: "quantity",
                header: t("damage.qty"),
                sortable: true,
                sortValue: (r) => r.quantity,
                render: (r) => (
                  <span className="font-semibold text-destructive">{r.quantity}</span>
                ),
                className: "text-right tabular-nums",
              },
              {
                key: "notes",
                header: t("damage.reason"),
                render: (r) => r.notes || "—",
              },
              {
                key: "by",
                header: t("damage.recordedBy"),
                render: (r) => <span className="text-xs text-muted-foreground">{r.by || "—"}</span>,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
