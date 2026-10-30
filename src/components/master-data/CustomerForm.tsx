import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { customerService } from "@/services/customer.service";
import { customerSchema } from "@/utils/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n";

type FormValues = z.infer<typeof customerSchema>;

export function CustomerForm({ id }: { id?: string }) {
  const t = useT();
  const mode = id ? "edit" : "create";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: existing, isLoading } = useQuery({
    queryKey: ["customers", id],
    queryFn: () => customerService.get(id!),
    enabled: !!id,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      phone: "",
      whatsapp: "",
      address: "",
      creditLimit: 0,
      openingBalance: 0,
      openingBalanceType: "receivable",
      creditReminderEnabled: false,
      creditReminderDays: 30,
    },
  });

  useEffect(() => {
    if (!existing) return;
    reset({
      name: existing.name || "",
      phone: existing.phone || "",
      whatsapp: existing.whatsapp ?? "",
      address: existing.address || "",
      creditLimit: Number(existing.creditLimit) || 0,
      openingBalance: Math.abs(Number(existing.openingBalance) || 0),
      openingBalanceType:
        existing.openingBalanceType ||
        (Number(existing.openingBalance || 0) < 0 ? "payable" : "receivable"),
      creditReminderEnabled: Boolean(existing.creditReminderEnabled),
      creditReminderDays: Number(existing.creditReminderDays) || 30,
    });
  }, [existing, reset]);

  const reminderOn = watch("creditReminderEnabled");
  const openingType = watch("openingBalanceType") || "receivable";

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name.trim(),
        phone: values.phone.trim(),
        whatsapp: values.whatsapp?.trim() || undefined,
        address: values.address.trim(),
        creditLimit: Number(values.creditLimit) || 0,
        openingBalance: Number(values.openingBalance) || 0,
        openingBalanceType: values.openingBalanceType || "receivable",
        creditReminderEnabled: Boolean(values.creditReminderEnabled),
        creditReminderDays: values.creditReminderEnabled
          ? Math.floor(Number(values.creditReminderDays) || 30)
          : 30,
      };
      return mode === "edit"
        ? customerService.update(id!, payload)
        : customerService.create(payload as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      if (id) qc.invalidateQueries({ queryKey: ["customers", id] });
      toast.success(mode === "edit" ? t("customers.updated") : t("customers.created"));
      navigate({ to: id ? "/customers/$id" : "/customers", params: id ? { id } : undefined });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (id && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (id && !existing)
    return <div className="p-6 text-sm text-destructive">{t("customers.notFound")}</div>;

  return (
    <div>
      <PageHeader
        title={mode === "create" ? t("customers.new") : t("customers.edit")}
        backTo={id ? { to: "/customers/$id", params: { id } } : "/customers"}
      />
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            className="grid gap-4 md:grid-cols-2"
          >
            <Field label={t("common.name")} error={errors.name?.message}>
              <Input {...register("name")} />
            </Field>
            <Field label={t("common.phone")} error={errors.phone?.message}>
              <Input {...register("phone")} />
            </Field>
            <Field label={t("customers.whatsapp")} error={errors.whatsapp?.message}>
              <Input {...register("whatsapp")} />
            </Field>
            <Field label={t("customers.creditLimit")} error={errors.creditLimit?.message}>
              <Input
                type="number"
                step="0.01"
                min={0}
                {...register("creditLimit", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label={t("common.address")}
              error={errors.address?.message}
              className="md:col-span-2"
            >
              <Input {...register("address")} />
            </Field>
            <Field label={t("customers.openingBalance")} error={errors.openingBalance?.message}>
              <Input
                type="number"
                step="0.01"
                min={0}
                {...register("openingBalance", { valueAsNumber: true })}
              />
            </Field>
            <Field label={t("customers.openingType")} error={errors.openingBalanceType?.message}>
              <Select
                value={openingType}
                onValueChange={(v) =>
                  setValue("openingBalanceType", v as FormValues["openingBalanceType"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receivable">{t("customers.receivable")}</SelectItem>
                  <SelectItem value="payable">{t("customers.payable")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("customers.reminder")}>
              <div className="flex h-10 items-center gap-3">
                <Switch
                  checked={reminderOn}
                  onCheckedChange={(v) =>
                    setValue("creditReminderEnabled", v, { shouldDirty: true })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {reminderOn ? t("customers.reminderOn") : t("customers.reminderOff")}
                </span>
              </div>
            </Field>
            {reminderOn && (
              <Field label={t("customers.reminderDays")} error={errors.creditReminderDays?.message}>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  {...register("creditReminderDays", { valueAsNumber: true })}
                />
              </Field>
            )}
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  navigate({
                    to: id ? "/customers/$id" : "/customers",
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

function Field({
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
