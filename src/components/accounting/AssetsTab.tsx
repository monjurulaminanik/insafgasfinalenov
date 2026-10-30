import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit } from "lucide-react";
import { accountingService } from "@/services/accounting.service";
import { DataTable } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { useT } from "@/i18n";
import type { BusinessAsset } from "@/types";

export function AssetsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery({
    queryKey: ["assets"],
    queryFn: accountingService.listAssets,
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessAsset | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState(0);
  const [currentValue, setCurrentValue] = useState(0);

  const handleOpen = (item?: BusinessAsset) => {
    if (item) {
      setEditing(item);
      setName(item.name);
      setCategory(item.category);
      setPurchaseDate(item.purchaseDate.split("T")[0]);
      setPurchaseCost(item.purchaseCost);
      setCurrentValue(item.currentValue);
    } else {
      setEditing(null);
      setName("");
      setCategory("");
      setPurchaseDate(new Date().toISOString().split("T")[0]);
      setPurchaseCost(0);
      setCurrentValue(0);
    }
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!name) throw new Error("Name is required");
      const payload = {
        name,
        category,
        purchaseDate: new Date(purchaseDate).toISOString(),
        purchaseCost,
        currentValue,
      };
      if (editing) {
        return accountingService.updateAsset(editing.id, payload);
      }
      return accountingService.createAsset(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Saved successfully");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => accountingService.removeAsset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => handleOpen()}>
          <Plus className="mr-1 h-4 w-4" /> Add Asset
        </Button>
      </div>
      <DataTable<BusinessAsset>
        rows={assets}
        searchKeys={["name", "category"]}
        columns={[
          {
            key: "name",
            header: "Asset Name",
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => r.name,
          },
          {
            key: "category",
            header: "Category",
            sortable: true,
            sortValue: (r) => r.category,
            render: (r) => r.category,
          },
          {
            key: "date",
            header: "Purchase Date",
            sortable: true,
            sortValue: (r) => r.purchaseDate,
            render: (r) => formatDate(r.purchaseDate),
          },
          {
            key: "cost",
            header: "Purchase Cost",
            sortable: true,
            sortValue: (r) => r.purchaseCost,
            render: (r) => formatCurrency(r.purchaseCost),
            className: "text-right",
          },
          {
            key: "current",
            header: "Current Value",
            sortable: true,
            sortValue: (r) => r.currentValue,
            render: (r) => formatCurrency(r.currentValue),
            className: "text-right",
          },
          {
            key: "actions",
            header: "Actions",
            className: "w-24 text-right",
            render: (r) => (
              <div className="flex justify-end gap-1">
                <Button size="icon" variant="ghost" onClick={() => handleOpen(r)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    if (confirm(t("common.confirmDelete"))) remove.mutate(r.id);
                  }}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Asset" : "Add Asset"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Asset Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Purchase Date</Label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Purchase Cost</Label>
              <Input
                type="number"
                value={purchaseCost}
                onChange={(e) => setPurchaseCost(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Current Value</Label>
              <Input
                type="number"
                value={currentValue}
                onChange={(e) => setCurrentValue(Number(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
