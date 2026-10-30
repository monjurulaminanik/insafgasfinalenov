import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrService } from "@/services/hr.service";
import { employeeSchema } from "@/utils/validators";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Employee } from "@/types";
import { z } from "zod";
import { useT } from "@/i18n";
import { Trash2, Upload, User } from "lucide-react";
import { MonthlyPayroll } from "./MonthlyPayroll";
import { EmployeeRoster } from "@/components/hr/EmployeeRoster";
import { DELIVERY_MAN, DESIGNATION_PRESETS } from "@/lib/hr-staff";
import { fileToProfileImage } from "@/lib/image-upload";

type EmpForm = z.infer<typeof employeeSchema>;

export function HrPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: hrService.listEmployees,
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "inactive">("active");
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
      joiningDate: new Date().toISOString().slice(0, 10),
      salary: 20000,
      perDeliveryCommission: 0,
      image: "",
    },
  });

  const photo = watch("image");

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    setStatus("active");
    reset({
      name: "",
      phone: "",
      designation: "",
      department: "",
      joiningDate: new Date().toISOString().slice(0, 10),
      salary: 20000,
      perDeliveryCommission: 0,
      image: "",
    });
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setStatus(emp.status);
    setOpen(true);
    reset({
      name: emp.name,
      phone: emp.phone,
      designation: emp.designation,
      department: emp.department,
      joiningDate: emp.joiningDate.slice(0, 10),
      salary: emp.salary,
      perDeliveryCommission: emp.perDeliveryCommission || 0,
      image: emp.image || "",
    });
  };

  const saveEmp = useMutation({
    mutationFn: (values: EmpForm) => {
      const payload = {
        ...values,
        image: values.image || undefined,
        joiningDate: new Date(values.joiningDate).toISOString(),
        status,
      };
      return editingId
        ? hrService.updateEmployee(editingId, payload)
        : hrService.createEmployee({ ...payload, status: "active" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(editingId ? t("hr.employeeUpdated") : t("hr.employeeAdded"));
      closeForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeEmp = useMutation({
    mutationFn: (id: string) => hrService.removeEmployee(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(t("hr.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("hr.title")}
        description={t("hr.desc")}
        actions={
          <Button
            onClick={() => {
              if (open) closeForm();
              else {
                setEditingId(null);
                setOpen(true);
              }
            }}
          >
            {open ? t("common.close") : t("hr.addEmployee")}
          </Button>
        }
      />

      {open && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 text-sm font-semibold">
              {editingId ? t("hr.editEmployee") : t("hr.addEmployee")}
            </h3>
            <form
              onSubmit={handleSubmit((v) => saveEmp.mutate(v))}
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
                          } catch (err: unknown) {
                            toast.error(
                              err instanceof Error ? err.message : "ছবি প্রক্রিয়া করা যায়নি",
                            );
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
                <Select
                  value={watch("designation") || undefined}
                  onValueChange={(v) => setValue("designation", v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      new Set(
                        [
                          ...DESIGNATION_PRESETS,
                          ...employees.map((e) => e.designation).filter(Boolean),
                          watch("designation") || "",
                        ].filter(Boolean),
                      ),
                    ).map((d) => (
                      <SelectItem key={d} value={d}>
                        {d === DELIVERY_MAN || d === "Deliveryman" ? t("hr.deliveryMan") : d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.designation && (
                  <p className="text-xs text-destructive">{errors.designation.message}</p>
                )}
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
                <Label>{t("hr.perDelivery")}</Label>
                <Input type="number" {...register("perDeliveryCommission")} />
              </div>
              {editingId && (
                <div className="space-y-1.5">
                  <Label>{t("common.status")}</Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as "active" | "inactive")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{t("common.active")}</SelectItem>
                      <SelectItem value="inactive">{t("common.inactive")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting || saveEmp.isPending}>
                  {editingId ? t("common.save") : t("hr.saveEmployee")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="payroll">
        <TabsList>
          <TabsTrigger value="payroll">{t("hr.payroll")}</TabsTrigger>
          <TabsTrigger value="employees">{t("hr.employees")}</TabsTrigger>
        </TabsList>
        <TabsContent value="employees">
          <EmployeeRoster />
        </TabsContent>
        <TabsContent value="payroll" className="space-y-4">
          <MonthlyPayroll employees={employees} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
