import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { accountingService } from "@/services/accounting.service";
import { journalEntrySchema } from "@/utils/validators";
import { toDateInputValue } from "@/lib/date-range";
import { formatCurrency } from "@/utils/formatters";
import type { JournalLine } from "@/types";
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
import { useT } from "@/i18n";

type DraftLine = {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  notes: string;
};

function newLine(): DraftLine {
  return { key: crypto.randomUUID(), accountId: "", debit: "", credit: "", notes: "" };
}

type AccountOpt = { id: string; name: string; label: string };

export function JournalEntryForm({ onPosted }: { onPosted?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: coa = [] } = useQuery({ queryKey: ["coa"], queryFn: accountingService.listCoa });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const opts = useMemo<AccountOpt[]>(() => {
    const core: AccountOpt[] = [
      { id: "cash", name: "cash", label: t("common.cash") },
      { id: "bank", name: "bank", label: t("common.bank") },
      { id: "cheque", name: "cheque", label: t("common.cheque") },
      { id: "mobile", name: "mobile", label: t("common.mobileBanking") },
    ];
    const named = accounts.map((a) => ({ id: a.id, name: a.name, label: a.name }));
    const books = coa.map((c) => ({
      id: c.id,
      name: c.name,
      label: `${c.code ? `${c.code} · ` : ""}${c.name}`,
    }));
    return [...core, ...named, ...books];
  }, [coa, accounts, t]);

  const [date, setDate] = useState(toDateInputValue());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine(), newLine()]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.debit += Number(line.debit) || 0;
        acc.credit += Number(line.credit) || 0;
        return acc;
      },
      { debit: 0, credit: 0 },
    );
  }, [lines]);
  const diff = Math.round((totals.debit - totals.credit) * 100) / 100;
  const balanced = Math.abs(diff) < 0.01 && totals.debit > 0;

  const patch = (key: string, next: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));
  };

  const post = useMutation({
    mutationFn: (payload: { date: string; notes?: string; lines: JournalLine[] }) =>
      accountingService.postJournal(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("accounting.journalPosted"));
      setNotes("");
      setDate(toDateInputValue());
      setLines([newLine(), newLine()]);
      onPosted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    const mapped: JournalLine[] = lines.map((l) => {
      const opt = opts.find((o) => o.id === l.accountId);
      return {
        accountId: l.accountId,
        accountName: opt?.name || l.accountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        notes: l.notes.trim() || undefined,
      };
    });
    const parsed = journalEntrySchema.safeParse({
      date,
      notes: notes.trim() || undefined,
      lines: mapped,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || t("accounting.unbalanced"));
      return;
    }
    post.mutate(parsed.data);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("accounting.journalHint")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("common.date")}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("accounting.narration")}</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("common.notes")}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("common.account")}</th>
              <th className="w-36 px-3 py-2 text-right font-medium">{t("accounting.debit")}</th>
              <th className="w-36 px-3 py-2 text-right font-medium">{t("accounting.credit")}</th>
              <th className="w-40 px-3 py-2 font-medium">{t("common.notes")}</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b last:border-0">
                <td className="px-2 py-2">
                  <Select
                    value={line.accountId || undefined}
                    onValueChange={(v) => patch(line.key, { accountId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("accounting.selectAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="text-right"
                    value={line.debit}
                    onChange={(e) =>
                      patch(line.key, {
                        debit: e.target.value,
                        credit: e.target.value ? "" : line.credit,
                      })
                    }
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="text-right"
                    value={line.credit}
                    onChange={(e) =>
                      patch(line.key, {
                        credit: e.target.value,
                        debit: e.target.value ? "" : line.debit,
                      })
                    }
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    value={line.notes}
                    onChange={(e) => patch(line.key, { notes: e.target.value })}
                  />
                </td>
                <td className="px-1 py-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={lines.length <= 2}
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 font-medium">
              <td className="px-3 py-2">{t("common.total")}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.debit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.credit)}</td>
              <td
                colSpan={2}
                className={`px-3 py-2 text-xs ${balanced ? "text-emerald-600" : "text-destructive"}`}
              >
                {t("accounting.difference")}: {formatCurrency(Math.abs(diff))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines((prev) => [...prev, newLine()])}
        >
          <Plus className="mr-1 h-3 w-3" /> {t("accounting.addLine")}
        </Button>
        <Button type="button" onClick={submit} disabled={!balanced || post.isPending}>
          {t("accounting.postJournal")}
        </Button>
      </div>
    </div>
  );
}
