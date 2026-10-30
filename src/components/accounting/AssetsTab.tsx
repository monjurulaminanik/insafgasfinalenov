import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit } from "lucide-react";
import { accountingService } from "@/services/accounting.service";
import { DataTable } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/utils/formatters";
import { toDateInputValue } from "@/lib/date-range";
import {
  AssetValidationError,
  validateAssetCommand,
  type AssetCommand,
  type AssetAcquisition,
} from "@/lib/assets";
import type { BusinessAsset } from "@/types";

type Mode = AssetCommand["action"];
const titles: Record<Mode, string> = {
  create: "সম্পদ অধিগ্রহণ",
  update: "সম্পদের বিবরণ সম্পাদনা",
  depreciate: "অবচয় পোস্ট করুন",
  adopt: "প্রারম্ভিক মূলধনে অন্তর্ভুক্তি",
  remove: "পুরোনো রেজিস্টার এন্ট্রি মুছুন",
};

export function AssetsTab() {
  const qc = useQueryClient();
  const { data: assets = [] } = useQuery({
    queryKey: ["assets"],
    queryFn: accountingService.listAssets,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: accountingService.listAccounts,
  });
  const [editor, setEditor] = useState<{ mode: Mode; asset?: BusinessAsset } | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [postingDate, setPostingDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState(0);
  const [currentValue, setCurrentValue] = useState(0);
  const [acquisition, setAcquisition] = useState<AssetAcquisition | "">("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [reason, setReason] = useState("");
  const [issue, setIssue] = useState("");
  // A transport failure is uncertain: retry the same immutable command and key.
  const prepared = useRef<AssetCommand | null>(null);
  const open = (mode: Mode, asset?: BusinessAsset) => {
    if (prepared.current) return;
    setEditor({ mode, asset });
    setIssue("");
    setName(asset?.name || "");
    setCategory(asset?.category || "");
    setPurchaseDate(asset?.purchaseDate.slice(0, 10) || toDateInputValue());
    setPostingDate(toDateInputValue());
    setPurchaseCost(asset?.purchaseCost || 0);
    setCurrentValue(asset?.currentValue || 0);
    setAcquisition("");
    setPaymentAccount("");
    setReason("");
  };
  const save = useMutation({
    retry: false,
    mutationFn: async (command: AssetCommand) => {
      switch (command.action) {
        case "create": {
          const { action, ...input } = command;
          return accountingService.createAsset(input);
        }
        case "update":
          return accountingService.updateAsset(command.id, {
            name: command.name,
            category: command.category,
            requestId: command.requestId,
          });
        case "depreciate": {
          const { action, ...input } = command;
          return accountingService.depreciateAsset(input);
        }
        case "adopt": {
          const { action, ...input } = command;
          return accountingService.adoptAsset(input);
        }
        case "remove":
          return accountingService.removeAsset(command.id, command.requestId);
      }
    },
    onSuccess: () => {
      prepared.current = null;
      setEditor(null);
      setIssue("");
      for (const key of ["assets", "vouchers", "ledger", "coa", "dashboard", "reports"])
        qc.invalidateQueries({ queryKey: [key] });
      toast.success("সম্পদ ও সংশ্লিষ্ট হিসাব একসঙ্গে সংরক্ষিত হয়েছে");
    },
    onError: (error: Error) => {
      if (error instanceof AssetValidationError) prepared.current = null;
      setIssue(error.message);
      toast.error(error.message);
    },
  });
  const submit = () => {
    if (!editor || save.isPending) return;
    if (prepared.current) {
      save.mutate(prepared.current);
      return;
    }
    try {
      const requestId = crypto.randomUUID();
      const asset = editor.asset;
      let command: AssetCommand;
      if (editor.mode === "create") {
        if (!acquisition) throw new AssetValidationError("অধিগ্রহণের হিসাব পদ্ধতি নির্বাচন করুন");
        command = {
          action: "create",
          requestId,
          name,
          category,
          purchaseDate,
          postingDate,
          purchaseCost,
          currentValue: acquisition === "opening" ? currentValue : purchaseCost,
          acquisition,
          ...(acquisition === "paid" ? { paymentAccount } : {}),
        };
      } else if (editor.mode === "update")
        command = { action: "update", requestId, id: asset!.id, name, category };
      else if (editor.mode === "depreciate")
        command = {
          action: "depreciate",
          requestId,
          id: asset!.id,
          expectedValue: asset!.currentValue,
          currentValue,
          postingDate,
          reason,
        };
      else if (editor.mode === "adopt")
        command = {
          action: "adopt",
          requestId,
          id: asset!.id,
          expectedValue: asset!.currentValue,
          postingDate,
        };
      else command = { action: "remove", requestId, id: asset!.id };
      prepared.current = validateAssetCommand(command);
      setIssue("");
      save.mutate(prepared.current);
    } catch (error) {
      prepared.current = null;
      setIssue((error as Error).message);
    }
  };
  const locked = save.isPending || !!prepared.current;
  const mode = editor?.mode;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        সম্পদ অধিগ্রহণ ও অবচয়ের সঙ্গে balanced journal এবং প্রয়োজনীয় cash/bank হিসাব একইসঙ্গে পোস্ট
        হবে। পুরোনো রেজিস্টার এন্ট্রির জন্য কোনো ঐতিহাসিক payment অনুমান করা হবে না।
      </p>
      <div className="flex justify-end">
        <Button onClick={() => open("create")} disabled={locked}>
          <Plus className="mr-1 h-4 w-4" />
          সম্পদ যোগ করুন
        </Button>
      </div>
      <DataTable<BusinessAsset>
        rows={assets}
        searchKeys={["name", "category"]}
        columns={[
          {
            key: "name",
            header: "সম্পদের নাম",
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => r.name,
          },
          { key: "category", header: "ধরন", render: (r) => r.category },
          { key: "date", header: "ক্রয়ের তারিখ", render: (r) => formatDate(r.purchaseDate) },
          {
            key: "cost",
            header: "ক্রয়মূল্য",
            render: (r) => formatCurrency(r.purchaseCost),
            className: "text-right",
          },
          {
            key: "current",
            header: "বর্তমান মূল্য",
            render: (r) => formatCurrency(r.currentValue),
            className: "text-right",
          },
          {
            key: "posting",
            header: "হিসাব",
            render: (r) =>
              r.accountingStatus === "posted"
                ? "জার্নাল পোস্ট করা"
                : "পুরোনো রেজিস্টার; opening প্রয়োজন",
          },
          {
            key: "actions",
            header: "পদক্ষেপ",
            render: (r) => (
              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="সম্পদের বিবরণ সম্পাদনা"
                  disabled={locked}
                  onClick={() => open("update", r)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                {r.accountingStatus === "posted" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={locked || r.currentValue <= 0}
                    onClick={() => open("depreciate", r)}
                  >
                    অবচয়
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked || r.currentValue <= 0}
                      onClick={() => open("adopt", r)}
                    >
                      Opening
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="পুরোনো রেজিস্টার এন্ট্রি মুছুন"
                      disabled={locked}
                      onClick={() => open("remove", r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      <Dialog
        open={!!editor}
        onOpenChange={(value) => {
          if (!value && !locked) {
            setEditor(null);
            setIssue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode ? titles[mode] : "সম্পদ"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2">
              {(mode === "create" || mode === "update") && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="asset-name">সম্পদের নাম</Label>
                    <Input
                      id="asset-name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="asset-category">ধরন</Label>
                    <Input
                      id="asset-category"
                      required
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    />
                  </div>
                </>
              )}
              {mode === "create" && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="asset-date">ক্রয়ের তারিখ</Label>
                    <Input
                      id="asset-date"
                      type="date"
                      required
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="asset-cost">ক্রয়মূল্য</Label>
                    <Input
                      id="asset-cost"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={purchaseCost}
                      onChange={(e) => setPurchaseCost(Number(e.target.value))}
                    />
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label htmlFor="asset-acquisition">অধিগ্রহণের হিসাব পদ্ধতি</Label>
                    <select
                      id="asset-acquisition"
                      required
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={acquisition}
                      onChange={(e) => setAcquisition(e.target.value as AssetAcquisition)}
                    >
                      <option value="">পদ্ধতি নির্বাচন করুন</option>
                      <option value="paid">Cash/bank দিয়ে ক্রয়</option>
                      <option value="credit">বাকিতে ক্রয় — Asset Purchase Payable</option>
                      <option value="opening">প্রারম্ভিক সম্পদ — Owner Capital</option>
                    </select>
                  </div>
                  {acquisition === "paid" && (
                    <div className="grid gap-2 md:col-span-2">
                      <Label htmlFor="asset-payment">পরিশোধের account</Label>
                      <select
                        id="asset-payment"
                        required
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={paymentAccount}
                        onChange={(e) => setPaymentAccount(e.target.value)}
                      >
                        <option value="">Account নির্বাচন করুন</option>
                        <option value="cash">Cash</option>
                        <option value="bank">Bank</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
              {(mode === "create" || mode === "depreciate" || mode === "adopt") && (
                <div className="grid gap-2">
                  <Label htmlFor="asset-posting">হিসাবে পোস্টের তারিখ</Label>
                  <Input
                    id="asset-posting"
                    type="date"
                    required
                    value={postingDate}
                    onChange={(e) => setPostingDate(e.target.value)}
                  />
                </div>
              )}
              {((mode === "create" && acquisition === "opening") || mode === "depreciate") && (
                <div className="grid gap-2">
                  <Label htmlFor="asset-value">
                    {mode === "depreciate"
                      ? "অবচয়ের পর বর্তমান মূল্য"
                      : "প্রারম্ভিক carrying value"}
                  </Label>
                  <Input
                    id="asset-value"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={currentValue}
                    onChange={(e) => setCurrentValue(Number(e.target.value))}
                  />
                </div>
              )}
              {mode === "depreciate" && (
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor="asset-reason">অবচয়ের বিবরণ</Label>
                  <Input
                    id="asset-reason"
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    আগের মূল্য {formatCurrency(editor?.asset?.currentValue || 0)}। হ্রাসের পরিমাণ
                    Depreciation Expense-এ যাবে; cash/bank বদলাবে না।
                  </p>
                </div>
              )}
            </fieldset>
            {mode === "update" && (
              <p className="text-sm text-muted-foreground">
                শুধু নাম ও ধরন পরিবর্তন হবে। ক্রয়মূল্য, payment ও carrying value পরিবর্তিত হবে না।
              </p>
            )}
            {mode === "create" && acquisition === "credit" && (
              <p className="text-sm text-muted-foreground">
                দায় Asset Purchase Payable হিসাবে থাকবে; supplier invoice বা payment তৈরি হবে না।
              </p>
            )}
            {mode === "adopt" && (
              <p className="text-sm">
                {editor?.asset?.name}: বর্তমান মূল্য{" "}
                {formatCurrency(editor?.asset?.currentValue || 0)}-এর বিপরীতে Owner Capital পোস্ট
                হবে। এটি প্রারম্ভিক হিসাব; পুরোনো cash/bank payment তৈরি হবে না।
              </p>
            )}
            {mode === "remove" && (
              <p className="text-sm">
                {editor?.asset?.name}-এর শুধু unposted register entry মুছবেন? সংশ্লিষ্ট journal
                থাকলে server এ অনুরোধ গ্রহণ করবে না।
              </p>
            )}
            {issue && (
              <p role="alert" className="text-sm text-destructive">
                {issue}
                {prepared.current
                  ? " ফলাফল অনিশ্চিত; একই অনুরোধ পুনরায় পাঠান। তথ্য পরিবর্তন করবেন না।"
                  : ""}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => setEditor(null)}
              >
                বাতিল
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending
                  ? "সংরক্ষণ হচ্ছে…"
                  : prepared.current
                    ? "একই অনুরোধ পুনরায় পাঠান"
                    : mode === "update"
                      ? "বিবরণ সংরক্ষণ"
                      : mode === "remove"
                        ? "এন্ট্রি মুছুন"
                        : "হিসাবসহ পোস্ট করুন"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
