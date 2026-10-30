import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supplierService } from "@/services/supplier.service";
import { supplierSchema } from "@/utils/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { useT } from "@/i18n";

type FormValues = z.infer<typeof supplierSchema>;

export function SupplierForm({ id }: { id?: string }) {
  const t = useT();
  const mode = id ? "edit" : "create";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: existing, isLoading } = useQuery({
    queryKey: ["suppliers", id],
    queryFn: () => supplierService.get(id!),
    enabled: !!id,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(supplierSchema),
    values: existing
      ? {
          name: existing.name,
          phone: existing.phone,
          email: existing.email ?? "",
          address: existing.address,
          gstin: existing.gstin ?? "",
          openingBalance: existing.openingBalance,
        }
      : undefined,
    defaultValues: { openingBalance: 0, email: "", gstin: "" },
  });

  const mutation = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        name: v.name,
        phone: v.phone,
        email: v.email || undefined,
        address: v.address,
        openingBalance: Number(v.openingBalance) || 0,
      };
      return mode === "edit"
        ? supplierService.update(id!, payload)
        : supplierService.create(payload as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      if (id) qc.invalidateQueries({ queryKey: ["suppliers", id] });
      toast.success(mode === "edit" ? t("suppliers.updated") : t("suppliers.created"));
      navigate({ to: id ? "/suppliers/$id" : "/suppliers", params: id ? { id } : undefined });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (id && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (id && !existing)
    return <div className="p-6 text-sm text-destructive">{t("suppliers.notFound")}</div>;

  return (
    <div>
      <PageHeader
        title={mode === "create" ? t("suppliers.new") : t("suppliers.edit")}
        backTo={id ? { to: "/suppliers/$id", params: { id } } : "/suppliers"}
      />
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            className="grid gap-4 md:grid-cols-2"
          >
            <Row label={t("common.name")} error={errors.name?.message}>
              <Input {...register("name")} />
            </Row>
            <Row label={t("common.phone")} error={errors.phone?.message}>
              <Input {...register("phone")} />
            </Row>
            <Row label={t("common.email")} error={errors.email?.message}>
              <Input type="email" {...register("email")} />
            </Row>
            <Row
              label={t("common.address")}
              error={errors.address?.message}
              className="md:col-span-2"
            >
              <Input {...register("address")} />
            </Row>
            <Row label={t("suppliers.payable")} error={errors.openingBalance?.message}>
              <Input
                type="number"
                step="0.01"
                {...register("openingBalance", { valueAsNumber: true })}
              />
            </Row>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  navigate({
                    to: id ? "/suppliers/$id" : "/suppliers",
                    params: id ? { id } : undefined,
                  })
                }
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  error,
  children,
  className = "",
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
