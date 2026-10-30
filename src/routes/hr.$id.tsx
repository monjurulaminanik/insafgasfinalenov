import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Pencil, Trash2, Upload, User } from "lucide-react";
import { z } from "zod";
import { hrService } from "@/services/hr.service";
import { employeeSchema } from "@/utils/validators";
import { fileToProfileImage } from "@/lib/image-upload";
import { PageHeader } from "@/components/common/PageHeader";
import { DetailOrOutlet } from "@/components/common/DetailOrOutlet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { useT } from "@/i18n";

type EmpForm = z.infer<typeof employeeSchema>;

export const Route = createFileRoute("/hr/$id")({
  head: () => ({ meta: [{ title: "Employee · Insaf Gas Corp" }] }),
  component: EmployeeDetail,
});

function EmployeeDetail() {
  return (
    <DetailOrOutlet>
      <EmployeeDetailBody />
    </DetailOrOutlet>
  );
}

function EmployeeDetailBody() {
  const t = useT();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const {
    data: e,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["employees", id],
    queryFn: () => hrService.getEmployee(id),
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EmpForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      image: "",
    },
  });

  const photo = watch("image");

  useEffect(() => {
    if (!e) return;
    setStatus(e.status);
    reset({
      name: e.name,
      phone: e.phone,
      designation: e.designation,
      department: e.department,
      joiningDate: e.joiningDate.slice(0, 10),
      salary: e.salary,
      image: e.image || "",
    });
  }, [e, reset]);

  const save = useMutation({
    mutationFn: (values: EmpForm) =>
      hrService.updateEmployee(id, {
        ...values,
        image: values.image || undefined,
        joiningDate: new Date(values.joiningDate).toISOString(),
        status,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees", id] });
      toast.success(t("hr.employeeUpdated"));
      setEditing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => hrService.removeEmployee(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(t("hr.deleted"));
      navigate({ to: "/hr" });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !e)
    return <div className="p-6 text-sm text-destructive">{t("hr.notFound")}</div>;
  if (!e) return null;

  return (
    <div>
      <PageHeader
        title={e.name}
        description={`${e.employeeNo} · ${e.designation}`}
        backTo="/hr"
        backLabel={t("hr.title")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing((v) => !v)}>
              <Pencil className="mr-1 h-4 w-4" /> {editing ? t("common.close") : t("common.edit")}
            </Button>
            <Button asChild>
              <Link to="/hr/$id/statement" params={{ id }}>
                <FileText className="mr-1 h-4 w-4" /> {t("hr.statement")}
              </Link>
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(t("hr.deleteConfirm"))) remove.mutate();
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
            </Button>
          </div>
        }
      />

      {editing && (
        <Card className="mb-4">
          <CardContent className="pt-6">
            <h3 className="mb-4 text-sm font-semibold">{t("hr.editEmployee")}</h3>
            <form
              onSubmit={handleSubmit((v) => save.mutate(v))}
              className="grid gap-4 md:grid-cols-2"
            >
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("hr.photo")}</Label>
                <div className="flex items-center gap-3">
                  {photo ? (
                    <img
                      src={photo}
                      alt="Employee photo"
                      className="h-12 w-12 rounded-full border border-border object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground shrink-0">
                      <User className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{photo ? t("common.edit") : t("hr.uploadPhoto")}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const dataUrl = await fileToProfileImage(file);
                            setValue("image", dataUrl, { shouldValidate: true });
                          } catch (err: any) {
                            toast.error(err.message || "Failed to process image");
                          }
                        }}
                      />
                    </label>
                    {photo && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setValue("image", "", { shouldValidate: true })}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t("hr.removePhoto")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.name")}</Label>
                <Input {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.phone")}</Label>
                <Input {...register("phone")} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.designation")}</Label>
                <Input {...register("designation")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.department")}</Label>
                <Input {...register("department")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.joiningDate")}</Label>
                <Input type="date" {...register("joiningDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.basicSalary")}</Label>
                <Input type="number" {...register("salary")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.status")}</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("common.active")}</SelectItem>
                    <SelectItem value="inactive">{t("common.inactive")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting || save.isPending}>
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6 text-sm">
          <div className="flex items-center gap-4 border-b pb-4">
            {e.image ? (
              <img
                src={e.image}
                alt={e.name}
                className="h-16 w-16 rounded-full border border-border object-cover shadow-sm shrink-0"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground shrink-0">
                <User className="h-8 w-8" />
              </div>
            )}
            <div>
              <h3 className="font-display text-lg font-semibold">{e.name}</h3>
              <p className="text-xs text-muted-foreground">{e.employeeNo} · {e.designation}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Info label={t("hr.employeeId")} value={e.employeeNo} />
            <Info label={t("common.phone")} value={e.phone} />
            <Info label={t("hr.designation")} value={e.designation} />
            <Info label={t("hr.department")} value={e.department} />
            <Info label={t("hr.joiningDate")} value={formatDate(e.joiningDate)} />
            <Info label={t("hr.basicSalary")} value={formatCurrency(e.salary)} />
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t("common.status")}</p>
              <Badge variant={e.status === "active" ? "default" : "secondary"} className="mt-1">
                {e.status === "active" ? t("common.active") : t("common.inactive")}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
