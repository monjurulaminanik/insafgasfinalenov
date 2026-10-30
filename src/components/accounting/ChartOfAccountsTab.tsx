import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit } from "lucide-react";
import { accountingService } from "@/services/accounting.service";
import { DataTable } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import type { ChartOfAccount, CoaType } from "@/types";

export function ChartOfAccountsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data: coa = [] } = useQuery({ queryKey: ["coa"], queryFn: accountingService.listCoa });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<CoaType>("Expense");
  const [code, setCode] = useState("");

  const handleOpen = (item?: ChartOfAccount) => {
    if (item) {
      setEditing(item);
      setName(item.name);
      setType(item.type);
      setCode(item.code || "");
    } else {
      setEditing(null);
      setName("");
      setType("Expense");
      setCode("");
    }
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!name) throw new Error("Name is required");
      if (editing) {
        return accountingService.updateCoa(editing.id, { name, type, code });
      }
      return accountingService.createCoa({ name, type, code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coa"] });
      toast.success("Saved successfully");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => accountingService.removeCoa(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coa"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => handleOpen()}>
          <Plus className="mr-1 h-4 w-4" /> Add Account
        </Button>
      </div>
      <DataTable<ChartOfAccount>
        rows={coa}
        searchKeys={["name", "type", "code"]}
        columns={[
          {
            key: "code",
            header: "Code",
            render: (r) => <span className="font-mono">{r.code || "—"}</span>,
          },
          {
            key: "name",
            header: "Account Name",
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => r.name,
          },
          {
            key: "type",
            header: "Type",
            sortable: true,
            sortValue: (r) => r.type,
            render: (r) => r.type,
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
            <DialogTitle>{editing ? "Edit Account" : "Add Chart of Account"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Account Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CoaType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Income">Income</SelectItem>
                  <SelectItem value="Expense">Expense</SelectItem>
                  <SelectItem value="Asset">Asset</SelectItem>
                  <SelectItem value="Liability">Liability</SelectItem>
                  <SelectItem value="Equity">Equity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Account Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Code (Optional)</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
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
