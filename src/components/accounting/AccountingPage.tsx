import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountingService } from "@/services/accounting.service";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { hrService } from "@/services/hr.service";
import { voucherSchema } from "@/utils/validators";
import { PageHeader } from "@/components/common/PageHeader";
import { DataTable } from "@/components/common/DataTable";
import { RowActions, actionsColumnClass } from "@/components/common/RowActions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsTab } from "./AccountsTab";
import { ChartOfAccountsTab } from "./ChartOfAccountsTab";
import { AssetsTab } from "./AssetsTab";
import { JournalEntryForm } from "./JournalEntryForm";
import { isBankBookAccount, isCashBookAccount } from "@/lib/money-accounts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/utils/formatters";
import type { LedgerEntry, Voucher } from "@/types";
import { z } from "zod";
import { useT } from "@/i18n";
import { Printer } from "lucide-react";
import {
  MoneyReceiptPrint,
  voucherToReceipt,
  type MoneyReceiptModel,
} from "@/components/sales/MoneyReceiptPrint";

type FormValues = z.infer<typeof voucherSchema>;

export function AccountingPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data: ledger = [] } = useQuery({
    queryKey: ["ledger"],
    queryFn: accountingService.listLedger,
  });
  const { data: vouchers = [] } = useQuery({
    queryKey: ["vouchers"],
    queryFn: accountingService.listVouchers,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: hrService.listEmployees,
  });
  const [open, setOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(true);
  const [tab, setTab] = useState("journal");
  const [selectedBank, setSelectedBank] = useState<string>("all");
  const [receipt, setReceipt] = useState<MoneyReceiptModel | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(voucherSchema),
    defaultValues: {
      type: "payment",
      account: "cash",
      amount: 0,
      partyType: undefined,
      partyId: "",
      partyName: "",
      drAccount: "",
      crAccount: "",
      notes: "",
    },
  });

  const partyType = watch("partyType");

  const openReceipt = (v: Voucher) => {
    setReceipt(voucherToReceipt(v));
    setReceiptOpen(true);
  };

  const create = useMutation({
    mutationFn: (values: FormValues) => accountingService.createVoucher(values),
    onSuccess: (voucher) => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("accounting.posted"));
      reset({
        type: "payment",
        account: "cash",
        amount: 0,
        partyType: undefined,
        partyId: "",
        partyName: "",
        notes: "",
      });
      setOpen(false);
      if (voucher.type === "receipt") openReceipt(voucher);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeVoucher = useMutation({
    mutationFn: (id: string) => accountingService.removeVoucher(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      toast.success(t("accounting.voided"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cashBook = ledger.filter((e) => isCashBookAccount(e.account, accounts));
  const bankBook = ledger.filter(
    (e) =>
      isBankBookAccount(e.account, accounts) &&
      (selectedBank === "all" || e.account === selectedBank),
  );
  const journals = vouchers.filter((v) => v.type === "journal");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("accounting.title")}
        description={t("accounting.desc")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setTab("journal");
                setJournalOpen((v) => !v);
              }}
            >
              {journalOpen && tab === "journal" ? t("common.close") : t("accounting.postJournal")}
            </Button>
            <Button onClick={() => setOpen((v) => !v)}>
              {open ? t("common.close") : t("accounting.newVoucher")}
            </Button>
          </div>
        }
      />

      {open && (
        <Card>
          <CardContent className="pt-6">
            <form
              onSubmit={handleSubmit((v) => create.mutate(v))}
              className="grid gap-4 md:grid-cols-2"
            >
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
                    <SelectItem value="payment">{t("accounting.paymentVoucher")}</SelectItem>
                    <SelectItem value="receipt">{t("accounting.receiptVoucher")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.account")}</Label>
                <Select
                  value={watch("account")}
                  onValueChange={(v) => setValue("account", v as FormValues["account"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("common.cash")}</SelectItem>
                    <SelectItem value="bank">{t("common.bank")}</SelectItem>
                    <SelectItem value="cheque">{t("common.cheque")}</SelectItem>
                    <SelectItem value="mobile">{t("common.mobileBanking")}</SelectItem>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.name}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("common.amount")}</Label>
                <Input type="number" step="0.01" {...register("amount")} />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("common.party")}</Label>
                <div className="flex gap-2">
                  <Select
                    value={partyType || "other"}
                    onValueChange={(v) => {
                      if (v === "other") {
                        setValue("partyType", undefined);
                        setValue("partyId", "");
                      } else {
                        setValue("partyType", v as "customer" | "supplier" | "employee");
                        setValue("partyId", "");
                        setValue("partyName", "");
                      }
                    }}
                  >
                    <SelectTrigger className="w-1/3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">{t("common.customer")}</SelectItem>
                      <SelectItem value="supplier">{t("common.supplier")}</SelectItem>
                      <SelectItem value="employee">{t("hr.employee")}</SelectItem>
                      <SelectItem value="other">Other / Manual</SelectItem>
                    </SelectContent>
                  </Select>

                  {partyType === "customer" ? (
                    <Select
                      value={watch("partyId")}
                      onValueChange={(v) => {
                        setValue("partyId", v);
                        const c = customers.find((x) => x.id === v);
                        if (c) setValue("partyName", c.name);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : partyType === "supplier" ? (
                    <Select
                      value={watch("partyId")}
                      onValueChange={(v) => {
                        setValue("partyId", v);
                        const s = suppliers.find((x) => x.id === v);
                        if (s) setValue("partyName", s.name);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : partyType === "employee" ? (
                    <Select
                      value={watch("partyId")}
                      onValueChange={(v) => {
                        setValue("partyId", v);
                        const emp = employees.find((x) => x.id === v);
                        if (emp) setValue("partyName", emp.name);
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t("common.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="flex-1"
                      {...register("partyName")}
                      placeholder={t("common.name")}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t("common.notes")}</Label>
                <Input {...register("notes")} />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" disabled={isSubmitting || create.isPending}>
                  {t("accounting.postVoucher")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="journal">{t("accounting.journalEntry")}</TabsTrigger>
          <TabsTrigger value="vouchers">{t("accounting.vouchers")}</TabsTrigger>
          <TabsTrigger value="cash">{t("accounting.cashBook")}</TabsTrigger>
          <TabsTrigger value="bank">{t("accounting.bankBook")}</TabsTrigger>
          <TabsTrigger value="accounts">{t("accounting.accounts")}</TabsTrigger>
          <TabsTrigger value="coa">{t("accounting.coa")}</TabsTrigger>
          <TabsTrigger value="assets">{t("accounting.assets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="journal" className="space-y-4">
          {journalOpen && (
            <Card>
              <CardContent className="pt-6">
                <JournalEntryForm />
              </CardContent>
            </Card>
          )}
          <DataTable<Voucher>
            rows={journals}
            searchKeys={["voucherNo", "notes", "drAccount", "crAccount"]}
            dateKey="date"
            empty={t("accounting.noJournals")}
            columns={[
              {
                key: "no",
                header: t("accounting.voucherNo"),
                sortable: true,
                sortValue: (r) => r.voucherNo,
                render: (r) => <span className="font-mono text-xs">{r.voucherNo}</span>,
              },
              {
                key: "date",
                header: t("common.date"),
                sortable: true,
                sortValue: (r) => r.date,
                render: (r) => formatDate(r.date),
              },
              {
                key: "account",
                header: t("common.account"),
                render: (r) =>
                  r.lines?.length
                    ? r.lines
                        .map((l) => l.accountName)
                        .filter(Boolean)
                        .join(" · ")
                    : `Dr: ${r.drAccount ?? "—"} | Cr: ${r.crAccount ?? "—"}`,
              },
              {
                key: "amount",
                header: t("common.amount"),
                sortable: true,
                sortValue: (r) => r.amount,
                render: (r) => formatCurrency(r.amount),
                className: "text-right",
              },
              { key: "notes", header: t("accounting.narration"), render: (r) => r.notes ?? "—" },
              {
                key: "actions",
                header: t("common.actions"),
                className: actionsColumnClass,
                render: (r) => (
                  <RowActions
                    onDelete={() => {
                      if (confirm(t("accounting.voidConfirm"))) removeVoucher.mutate(r.id);
                    }}
                    deleteDisabled={removeVoucher.isPending}
                  />
                ),
              },
            ]}
            renderSubComponent={(r) => (
              <div className="bg-muted/30 p-4 pl-12">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">{t("common.account")}</th>
                      <th className="pb-2 text-right font-medium">{t("accounting.debit")}</th>
                      <th className="pb-2 text-right font-medium">{t("accounting.credit")}</th>
                      <th className="pb-2 font-medium">{t("common.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(r.lines?.length
                      ? r.lines
                      : [
                          {
                            accountId: "dr",
                            accountName: r.drAccount || "—",
                            debit: r.amount,
                            credit: 0,
                          },
                          {
                            accountId: "cr",
                            accountName: r.crAccount || "—",
                            debit: 0,
                            credit: r.amount,
                          },
                        ]
                    ).map((line, i) => (
                      <tr key={`${r.id}-${i}`} className="border-b last:border-0">
                        <td className="py-2">{line.accountName}</td>
                        <td className="py-2 text-right tabular-nums">
                          {line.debit ? formatCurrency(line.debit) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {line.credit ? formatCurrency(line.credit) : "—"}
                        </td>
                        <td className="py-2 text-muted-foreground">{line.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          />
        </TabsContent>
        <TabsContent value="vouchers">
          <DataTable<Voucher>
            rows={vouchers}
            searchKeys={["voucherNo", "partyName", "notes"]}
            dateKey="date"
            columns={[
              {
                key: "no",
                header: t("accounting.voucherNo"),
                sortable: true,
                sortValue: (r) => r.voucherNo,
                render: (r) => <span className="font-mono text-xs">{r.voucherNo}</span>,
              },
              {
                key: "date",
                header: t("common.date"),
                sortable: true,
                sortValue: (r) => r.date,
                render: (r) => formatDate(r.date),
              },
              {
                key: "type",
                header: t("common.type"),
                sortable: true,
                sortValue: (r) => r.type,
                render: (r) => r.type,
              },
              {
                key: "account",
                header: t("common.account"),
                sortable: true,
                sortValue: (r) => r.account,
                render: (r) =>
                  r.type === "journal"
                    ? r.lines?.length
                      ? r.lines.map((l) => l.accountName).join(" · ")
                      : `Dr: ${r.drAccount ?? "—"} | Cr: ${r.crAccount ?? "—"}`
                    : r.account,
              },
              { key: "party", header: t("common.party"), render: (r) => r.partyName ?? "—" },
              {
                key: "amount",
                header: t("common.amount"),
                sortable: true,
                sortValue: (r) => r.amount,
                render: (r) => formatCurrency(r.amount),
                className: "text-right",
              },
              {
                key: "actions",
                header: t("common.actions"),
                className: actionsColumnClass,
                render: (r) => (
                  <RowActions
                    extras={
                      r.type === "receipt"
                        ? [
                            {
                              label: t("doc.printReceipt"),
                              onClick: () => openReceipt(r),
                              icon: <Printer className="h-3.5 w-3.5" />,
                            },
                          ]
                        : undefined
                    }
                    onDelete={() => {
                      if (confirm(t("accounting.voidConfirm"))) removeVoucher.mutate(r.id);
                    }}
                    deleteDisabled={removeVoucher.isPending}
                  />
                ),
              },
            ]}
          />
        </TabsContent>
        <TabsContent value="cash">
          <LedgerTable rows={cashBook} />
        </TabsContent>
        <TabsContent value="bank">
          <div className="mb-4 w-64">
            <Select value={selectedBank} onValueChange={setSelectedBank}>
              <SelectTrigger>
                <SelectValue placeholder="All Banks & Mobile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Banks & Mobile</SelectItem>
                <SelectItem value="bank">{t("common.bank")}</SelectItem>
                <SelectItem value="cheque">{t("common.cheque")}</SelectItem>
                <SelectItem value="mobile">{t("common.mobileBanking")}</SelectItem>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.name}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <LedgerTable rows={bankBook} />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="coa">
          <ChartOfAccountsTab />
        </TabsContent>
        <TabsContent value="assets">
          <AssetsTab />
        </TabsContent>
      </Tabs>

      <MoneyReceiptPrint receipt={receipt} open={receiptOpen} onOpenChange={setReceiptOpen} />
    </div>
  );
}

function LedgerTable({ rows }: { rows: LedgerEntry[] }) {
  const t = useT();
  return (
    <DataTable<LedgerEntry>
      rows={rows}
      searchKeys={["notes", "category"]}
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
          key: "acc",
          header: t("common.account"),
          sortable: true,
          sortValue: (r) => r.account,
          render: (r) => r.account,
        },
        {
          key: "cat",
          header: t("accounting.category"),
          sortable: true,
          sortValue: (r) => r.category,
          render: (r) => r.category,
        },
        {
          key: "dir",
          header: t("accounting.dir"),
          sortable: true,
          sortValue: (r) => r.direction,
          render: (r) => r.direction,
        },
        {
          key: "amount",
          header: t("common.amount"),
          sortable: true,
          sortValue: (r) => r.amount,
          render: (r) => formatCurrency(r.amount),
          className: "text-right",
        },
        { key: "notes", header: t("common.notes"), render: (r) => r.notes ?? "—" },
      ]}
    />
  );
}
