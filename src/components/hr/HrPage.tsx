import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrService } from "@/services/hr.service";
import { employeeSchema } from "@/utils/validators";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { Employee, PayrollRun } from "@/types";
import { z } from "zod";
import { useT } from "@/i18n";
import { Printer, Trash2, Upload, User } from "lucide-react";
import { PayslipPrint } from "./PayslipPrint";
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
  const { data: payroll = [] } = useQuery({
    queryKey: ["payroll"],
    queryFn: hrService.listPayroll,
  });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [payEmpId, setPayEmpId] = useState("");
  const [basic, setBasic] = useState("0");
  const [bonus, setBonus] = useState("0");
  const [allowance, setAllowance] = useState("0");
  const [deduction, setDeduction] = useState("0");
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const [printRun, setPrintRun] = useState<PayrollRun | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const startEditPay = (run: PayrollRun) => {
    setEditingPayId(run.id);
    setPayEmpId(run.employeeId);
    setBasic(run.basic.toString());
    setBonus(run.bonus.toString());
    setAllowance(run.allowance.toString());
    setDeduction(run.deduction.toString());
  };

  const cancelEditPay = () => {
    setEditingPayId(null);
    setPayEmpId("");
    setBasic("0");
    setBonus("0");
    setAllowance("0");
    setDeduction("0");
  };

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

  const savePay = useMutation({
    mutationFn: async () => {
      const emp = employees.find((e) => e.id === payEmpId);
      if (!emp) throw new Error(t("common.select"));

      const payload = {
        basic: Number(basic) || emp.salary,
        bonus: Number(bonus) || 0,
        allowance: Number(allowance) || 0,
        deduction: Number(deduction) || 0,
      };

      if (editingPayId) {
        return hrService.updatePayroll(editingPayId, payload);
      } else {
        const month = new Date().toISOString().slice(0, 7);
        return hrService.createPayroll({
          ...payload,
          employeeId: emp.id,
          employeeName: emp.name,
          month,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.success(editingPayId ? "Payslip updated" : t("hr.payslipCreated"));
      cancelEditPay();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payRun = useMutation({
    mutationFn: (id: string) => hrService.payPayroll(id, "bank"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("hr.salaryPaid"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePay = useMutation({
    mutationFn: (id: string) => hrService.removePayroll(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.success(t("hr.payslipDeleted"));
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
          <Card>
            <CardContent className="grid gap-3 pt-6 md:grid-cols-6">
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("hr.employee")}</Label>
                <select
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={payEmpId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPayEmpId(id);
                    const emp = employees.find((x) => x.id === id);
                    if (emp && !editingPayId) setBasic(String(emp.salary ?? 0));
                  }}
                >
                  <option value="">{t("common.select")}</option>
                  {employees
                    .filter((e) => e.status === "active")
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.basicSalary")}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={basic}
                  onChange={(e) => setBasic(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.bonus")}</Label>
                <Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.allowance")}</Label>
                <Input
                  type="number"
                  value={allowance}
                  onChange={(e) => setAllowance(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hr.deduction")}</Label>
                <Input
                  type="number"
                  value={deduction}
                  onChange={(e) => setDeduction(e.target.value)}
                />
              </div>
              <div className="md:col-span-6 flex justify-end gap-2">
                {editingPayId && (
                  <Button variant="ghost" onClick={cancelEditPay}>
                    {t("common.cancel")}
                  </Button>
                )}
                <Button disabled={!payEmpId || savePay.isPending} onClick={() => savePay.mutate()}>
                  {editingPayId ? t("common.save") : t("hr.createPayslip")}
                </Button>
              </div>
            </CardContent>
          </Card>
          <DataTable<PayrollRun>
            rows={payroll}
            searchKeys={["employeeName", "month"]}
            dateKey={(r) => r.paidAt ?? `${r.month}-01`}
            columns={[
              {
                key: "month",
                header: t("hr.month"),
                sortable: true,
                sortValue: (r) => r.month,
                render: (r) => r.month,
              },
              {
                key: "name",
                header: t("hr.employee"),
                sortable: true,
                sortValue: (r) => r.employeeName,
                render: (r) => (
                  <PartyNameLink kind="employee" id={r.employeeId} name={r.employeeName} />
                ),
              },
              {
                key: "basic",
                header: t("hr.basicSalary"),
                sortable: true,
                sortValue: (r) => r.basic,
                render: (r) => formatCurrency(r.basic),
                className: "text-right",
              },
              {
                key: "net",
                header: t("hr.net"),
                sortable: true,
                sortValue: (r) => r.net,
                render: (r) => formatCurrency(r.net),
                className: "text-right",
              },
              {
                key: "st",
                header: t("common.status"),
                render: (r) => (
                  <Badge variant={r.status === "paid" ? "default" : "secondary"}>
                    {t(`status.${r.status}` as any)}
                  </Badge>
                ),
              },
              {
                key: "actions",
                header: t("common.actions"),
                className: actionsColumnClass,
                render: (r) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {r.status === "draft" ? (
                      <>
                        <Button
                          size="sm"
                          disabled={payRun.isPending}
                          onClick={() => payRun.mutate(r.id)}
                        >
                          {t("hr.pay")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => startEditPay(r)}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={removePay.isPending}
                          onClick={() => {
                            if (confirm(t("hr.payslipDeleteConfirm"))) removePay.mutate(r.id);
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground px-2">
                        {r.paidAt ? formatDate(r.paidAt) : "—"}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPrintRun(r);
                        setPrintOpen(true);
                      }}
                      className="ml-2"
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </TabsContent>
      </Tabs>

      <PayslipPrint run={printRun} open={printOpen} onOpenChange={setPrintOpen} />
    </div>
  );
}
