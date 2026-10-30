import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { expenseService } from "@/services/expense.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { Expense } from "@/types";
import { useT } from "@/i18n";

const schema = z.object({
  category: z.string().min(2, "Category required"),
  description: z.string().min(2, "Description required"),
  amount: z.coerce.number().min(1, "Amount required"),
  paymentMethod: z.enum(["cash", "bank"]),
  date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ExpenseList() {
  const t = useT();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["expenses"], queryFn: expenseService.list });
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
    resolver: zodResolver(schema),
    defaultValues: { paymentMethod: "cash", amount: 0 },
  });

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    reset({ paymentMethod: "cash", amount: 0, category: "", description: "", date: "" });
  };

  const startEdit = (row: Expense) => {
    setEditingId(row.id);
    setOpen(true);
    const paymentMethod: FormValues["paymentMethod"] =
      row.paymentMethod === "bank" ? "bank" : "cash";
    reset({
      category: row.category,
      description: row.description,
      amount: row.amount,
      paymentMethod,
      date: row.date.slice(0, 10),
    });
  };

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        category: values.category,
        description: values.description,
        amount: values.amount,
        paymentMethod: values.paymentMethod,
        date: values.date ? new Date(values.date).toISOString() : new Date().toISOString(),
      };
      return editingId ? expenseService.update(editingId, payload) : expenseService.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      toast.success(editingId ? t("expenses.updated") : t("expenses.recorded"));
      closeForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => expenseService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      toast.success(t("expenses.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("expenses.title")}
        description={t("expenses.desc")}
        actions={
          <Button
            onClick={() => {
              if (open) closeForm();
              else {
                setEditingId(null);
                setOpen(true);
                reset({
                  paymentMethod: "cash",
                  amount: 0,
                  category: "",
                  description: "",
                  date: new Date().toISOString().slice(0, 10),
                });
              }
            }}
          >
            {open ? t("common.close") : t("expenses.record")}
          </Button>
        }
      />

      {open && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 text-sm font-semibold">
              {editingId ? t("expenses.edit") : t("expenses.record")}
            </h3>
            <form
              onSubmit={handleSubmit((v) => save.mutate(v))}
              className="grid gap-4 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label>{t("common.category")}</Label>
                <Input {...register("category")} />
                {errors.category && (
                  <p className="text-xs text-destructive">{errors.category.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.amount")}</Label>
                <Input type="number" step="0.01" {...register("amount")} />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("common.description")}</Label>
                <Input {...register("description")} />
                {errors.description && (
                  <p className="text-xs text-destructive">{errors.description.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.date")}</Label>
                <Input type="date" {...register("date")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("expenses.paidFrom")}</Label>
                <Select
                  value={watch("paymentMethod")}
                  onValueChange={(v) => setValue("paymentMethod", v as "cash" | "bank")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("common.cash")}</SelectItem>
                    <SelectItem value="bank">{t("common.bank")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting || save.isPending}>
                  {editingId ? t("common.save") : t("expenses.save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable<Expense>
        rows={data}
        searchKeys={["category", "description"]}
        dateKey="date"
        columns={[
          {
            key: "date",
            header: t("common.date"),
            sortable: true,
            sortValue: (r) => r.date,
            render: (r) => formatDate(r.date),
          },
          {
            key: "category",
            header: t("common.category"),
            sortable: true,
            sortValue: (r) => r.category,
            render: (r) => <span className="font-medium">{r.category}</span>,
          },
          { key: "description", header: t("common.description"), render: (r) => r.description },
          {
            key: "method",
            header: t("common.account"),
            sortable: true,
            sortValue: (r) => r.paymentMethod,
            render: (r) => r.paymentMethod,
          },
          {
            key: "amount",
            header: t("common.amount"),
            sortable: true,
            sortValue: (r) => r.amount,
            className: "text-right",
            render: (r) => formatCurrency(r.amount),
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onEdit={() => startEdit(r)}
                onDelete={() => {
                  if (confirm(t("expenses.deleteConfirm"))) remove.mutate(r.id);
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
