import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileText, Trash2, Upload, User } from "lucide-react";
import { hrService } from "@/services/hr.service";
import { fileToProfileImage } from "@/lib/image-upload";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { PartyNameLink } from "@/components/common/PartyNameLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/utils/formatters";
import type { Employee, PayrollRun } from "@/types";
import { currentMonthKey, DESIGNATION_PRESETS } from "@/lib/hr-staff";
import { useT } from "@/i18n";

function paySnapshot(emp: Employee, payroll: PayrollRun[]) {
  const month = currentMonthKey();
  const run = payroll
    .filter((p) => p.employeeId === emp.id && p.month === month)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const commission = emp.perDeliveryCommission || 0;
  const bonus = run?.bonus ?? 0;
  const deduction = run?.deduction ?? 0;
  const net = run ? run.net : Math.max(0, (emp.salary || 0) + commission + bonus - deduction);
  const payStatus: "paid" | "pending" = run?.status === "paid" ? "paid" : "pending";
  return { run, commission, bonus, deduction, net, payStatus };
}

export function EmployeeRoster() {
  const t = useT();
  const navigate = useNavigate();
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
  const [emp, setEmp] = useState<Employee | null>(null);
  const [image, setImage] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("0");
  const [commission, setCommission] = useState("0");
  const [bonus, setBonus] = useState("0");
  const [deduction, setDeduction] = useState("0");
  const [payStatus, setPayStatus] = useState<"paid" | "pending">("pending");

  const roles = useMemo(
    () =>
      Array.from(
        new Set([...DESIGNATION_PRESETS, ...employees.map((e) => e.designation).filter(Boolean)]),
      ),
    [employees],
  );

  const startEdit = (row: Employee) => {
    const snap = paySnapshot(row, payroll);
    setEmp(row);
    setImage(row.image || "");
    setName(row.name);
    setRole(row.designation);
    setSalary(String(row.salary || 0));
    setCommission(String(row.perDeliveryCommission || 0));
    setBonus(String(snap.bonus));
    setDeduction(String(snap.deduction));
    setPayStatus(snap.payStatus);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!emp) throw new Error(t("hr.notFound"));
      const basic = Number(salary) || 0;
      const comm = Number(commission) || 0;
      const bon = Number(bonus) || 0;
      const ded = Number(deduction) || 0;
      await hrService.updateEmployee(emp.id, {
        name: name.trim() || emp.name,
        designation: role || emp.designation,
        salary: basic,
        perDeliveryCommission: comm,
        image: image || undefined,
      });
      const month = currentMonthKey();
      const existing = payroll
        .filter((p) => p.employeeId === emp.id && p.month === month)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      if (existing?.status === "paid") return;
      const payload = {
        basic,
        bonus: bon,
        allowance: comm,
        deduction: ded,
      };
      let run = existing;
      if (run && run.status === "draft") {
        run = await hrService.updatePayroll(run.id, payload);
      } else if (!run) {
        run = await hrService.createPayroll({
          ...payload,
          employeeId: emp.id,
          employeeName: name.trim() || emp.name,
          month,
        });
      }
      if (payStatus === "paid" && run.status === "draft") {
        await hrService.payPayroll(run.id, "bank");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("hr.employeeUpdated"));
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DataTable<Employee>
        rows={employees}
        searchKeys={["name", "employeeNo", "designation", "department"]}
        dateKey="createdAt"
        onRowClick={(r) => navigate({ to: "/hr/$id", params: { id: r.id } })}
        columns={[
          {
            key: "image",
            header: t("common.image"),
            className: "w-12 text-center",
            render: (r) => (
              <div className="flex items-center justify-center">
                {r.image ? (
                  <img
                    src={r.image}
                    alt={r.name}
                    className="h-8 w-8 rounded-full border border-border object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "name",
            header: t("common.name"),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => <PartyNameLink kind="employee" id={r.id} name={r.name} />,
          },
          {
            key: "role",
            header: t("hr.role"),
            sortable: true,
            sortValue: (r) => r.designation,
            render: (r) => r.designation,
          },
          {
            key: "sal",
            header: t("hr.basicSalary"),
            sortable: true,
            sortValue: (r) => r.salary,
            render: (r) => formatCurrency(r.salary),
            className: "text-right",
          },
          {
            key: "comm",
            header: t("hr.perDelivery"),
            sortable: true,
            sortValue: (r) => r.perDeliveryCommission || 0,
            render: (r) => formatCurrency(r.perDeliveryCommission || 0),
            className: "text-right",
          },
          {
            key: "bonus",
            header: t("hr.bonus"),
            sortable: true,
            sortValue: (r) => paySnapshot(r, payroll).bonus,
            render: (r) => formatCurrency(paySnapshot(r, payroll).bonus),
            className: "text-right",
          },
          {
            key: "ded",
            header: t("hr.deduction"),
            sortable: true,
            sortValue: (r) => paySnapshot(r, payroll).deduction,
            render: (r) => formatCurrency(paySnapshot(r, payroll).deduction),
            className: "text-right",
          },
          {
            key: "net",
            header: t("hr.net"),
            sortable: true,
            sortValue: (r) => paySnapshot(r, payroll).net,
            render: (r) => formatCurrency(paySnapshot(r, payroll).net),
            className: "text-right",
          },
          {
            key: "pay",
            header: t("hr.payStatus"),
            render: (r) => {
              const paid = paySnapshot(r, payroll).payStatus === "paid";
              return (
                <Badge variant={paid ? "default" : "secondary"}>
                  {paid ? t("status.paid") : t("status.pending")}
                </Badge>
              );
            },
          },
          {
            key: "actions",
            header: t("common.actions"),
            className: actionsColumnClass,
            render: (r) => (
              <RowActions
                onView={() => navigate({ to: "/hr/$id", params: { id: r.id } })}
                onEdit={() => startEdit(r)}
                extras={[
                  {
                    label: t("hr.statement"),
                    icon: <FileText className="h-3.5 w-3.5" />,
                    onClick: () => navigate({ to: "/hr/$id/statement", params: { id: r.id } }),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("hr.editEmployee")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("hr.photo")}</Label>
              <div className="flex items-center gap-3">
                {image ? (
                  <img
                    src={image}
                    alt={name || "Employee"}
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
                    <span>{image ? t("common.edit") : t("hr.uploadPhoto")}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const dataUrl = await fileToProfileImage(file);
                          setImage(dataUrl);
                        } catch (err: any) {
                          toast.error(err.message || "Failed to process image");
                        }
                      }}
                    />
                  </label>
                  {image && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setImage("")}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t("hr.removePhoto")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("common.name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("hr.role")}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("hr.payStatus")}</Label>
              <Select
                value={payStatus}
                onValueChange={(v) => setPayStatus(v as "paid" | "pending")}
                disabled={emp ? paySnapshot(emp, payroll).payStatus === "paid" : false}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{t("status.pending")}</SelectItem>
                  <SelectItem value="paid">{t("status.paid")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("hr.basicSalary")}</Label>
              <Input
                type="number"
                min={0}
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("hr.perDelivery")}</Label>
              <Input
                type="number"
                min={0}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("hr.bonus")}</Label>
              <Input
                type="number"
                min={0}
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
                disabled={emp ? paySnapshot(emp, payroll).payStatus === "paid" : false}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("hr.deduction")}</Label>
              <Input
                type="number"
                min={0}
                value={deduction}
                onChange={(e) => setDeduction(e.target.value)}
                disabled={emp ? paySnapshot(emp, payroll).payStatus === "paid" : false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
