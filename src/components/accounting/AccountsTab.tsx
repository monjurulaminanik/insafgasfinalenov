import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountingService } from "@/services/accounting.service";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { Card, CardContent } from "@/components/ui/card";
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
import type { Account } from "@/types";
import { useT } from "@/i18n";
import { formatDate } from "@/utils/formatters";

const accountSchema = z.object({
  name: z.string().min(2, "Name required"),
  type: z.enum(["bank", "mobile", "cash"]),
  accountNo: z.string().optional(),
  bankName: z.string().optional(),
});

type FormValues = z.infer<typeof accountSchema>;

export function AccountsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { type: "bank" },
  });

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    reset({ name: "", type: "bank", accountNo: "", bankName: "" });
  };

  const startEdit = (acc: Account) => {
    setEditingId(acc.id);
    setOpen(true);
    reset({
      name: acc.name,
      type: acc.type,
      accountNo: acc.accountNo || "",
      bankName: acc.bankName || "",
    });
  };

  const saveAccount = useMutation({
    mutationFn: (values: FormValues) => {
      if (editingId) {
        return accountingService.updateAccount(editingId, values);
      }
      return accountingService.createAccount(values);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(editingId ? "Account updated" : "Account created");
      closeForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAccount = useMutation({
    mutationFn: (id: string) => accountingService.removeAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            if (open) closeForm();
            else {
              setEditingId(null);
              setOpen(true);
            }
          }}
        >
          {open ? t("common.close") : "Add Account"}
        </Button>
      </div>

      {open && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 text-sm font-semibold">
              {editingId ? "Edit Account" : "New Account"}
            </h3>
            <form
              onSubmit={handleSubmit((v) => saveAccount.mutate(v))}
              className="grid gap-4 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label>{t("common.name")}</Label>
                <Input {...register("name")} placeholder="e.g. Bkash - 017XXXXXX" />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.type")}</Label>
                <Select
                  value={watch("type")}
                  onValueChange={(v) => setValue("type", v as FormValues["type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">{t("common.bank")}</SelectItem>
                    <SelectItem value="mobile">{t("common.mobileBanking")}</SelectItem>
                    <SelectItem value="cash">{t("common.cash")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Account No</Label>
                <Input {...register("accountNo")} />
              </div>
              <div className="space-y-1.5">
                <Label>Bank / Operator Name</Label>
                <Input {...register("bankName")} />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting || saveAccount.isPending}>
                  {editingId ? t("common.save") : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable<Account>
        rows={accounts}
        searchKeys={["name", "bankName", "accountNo"]}
        dateKey="createdAt"
        columns={[
          {
            key: "name",
            header: t("common.name"),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => <span className="font-medium">{r.name}</span>,
          },
          {
            key: "type",
            header: t("common.type"),
            sortable: true,
            sortValue: (r) => r.type,
            render: (r) => t(`common.${r.type}` as any) || r.type,
          },
          { key: "bank", header: "Bank / Operator", render: (r) => r.bankName || "—" },
          { key: "acc", header: "Account No", render: (r) => r.accountNo || "—" },
          {
            key: "date",
            header: "Created",
            sortable: true,
            sortValue: (r) => r.createdAt,
            render: (r) => formatDate(r.createdAt),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onEdit={() => startEdit(r)}
                onDelete={() => {
                  if (confirm("Delete this account?")) removeAccount.mutate(r.id);
                }}
                deleteDisabled={removeAccount.isPending}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
