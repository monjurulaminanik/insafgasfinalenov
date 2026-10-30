import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { productCategoryService } from "@/services/product-category.service";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductCategoryRecord } from "@/types";
import { useT } from "@/i18n";

const schema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
});

type FormValues = z.infer<typeof schema>;

export function CategoryList() {
  const t = useT();
  const qc = useQueryClient();
  const {
    data = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["productCategories"],
    queryFn: productCategoryService.list,
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    reset({ name: "" });
  };

  const startEdit = (row: ProductCategoryRecord) => {
    setEditingId(row.id);
    setOpen(true);
    reset({ name: row.name });
  };

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editingId
        ? productCategoryService.update(editingId, values.name)
        : productCategoryService.create(values.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["productCategories"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(editingId ? t("categories.updated") : t("categories.created"));
      closeForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => productCategoryService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["productCategories"] });
      toast.success(t("categories.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("categories.title")}
        description={t("categories.desc")}
        actions={
          <Button
            onClick={() => {
              if (open) closeForm();
              else {
                setEditingId(null);
                setOpen(true);
                reset({ name: "" });
              }
            }}
          >
            {open ? t("common.close") : t("categories.new")}
          </Button>
        }
      />

      {open && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 text-sm font-semibold">
              {editingId ? t("categories.edit") : t("categories.new")}
            </h3>
            <form
              onSubmit={handleSubmit((v) => save.mutate(v))}
              className="grid gap-4 md:grid-cols-2"
            >
              <div className="space-y-1.5">
                <Label>{t("common.name")}</Label>
                <Input {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={save.isPending}>
                  {t("common.save")}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : t("error.title")}
        </p>
      )}

      <DataTable<ProductCategoryRecord>
        rows={data}
        searchKeys={["name"]}
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
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onEdit={() => startEdit(r)}
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
