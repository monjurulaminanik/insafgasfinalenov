import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RotateCcw, Search } from "lucide-react";
import { cylinderService } from "@/services/cylinder.service";
import { productService } from "@/services/product.service";
import { customerService } from "@/services/customer.service";
import { supplierService } from "@/services/supplier.service";
import { inventoryService } from "@/services/inventory.service";
import {
  buildCylinderLedger,
  type CylinderHeadKind,
  type CylinderHeadReport,
} from "@/lib/cylinder-ledger";
import { formatDate } from "@/utils/formatters";
import type { DateRange } from "@/lib/date-range";
import { useT, type MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
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
import { PartyNameLink } from "@/components/common/PartyNameLink";

const KIND_ORDER: CylinderHeadKind[] = ["warehouse", "customer", "supplier"];
const KIND_LABEL: Record<CylinderHeadKind, MessageKey> = {
  warehouse: "cylinders.head.warehouse",
  customer: "cylinders.head.customer",
  supplier: "cylinders.head.supplier",
};

const ALL = "all";

type LedgerFilter = {
  kind: CylinderHeadKind | typeof ALL;
  headId: string;
  productId: string;
  q: string;
};

const EMPTY_FILTER: LedgerFilter = { kind: ALL, headId: ALL, productId: ALL, q: "" };

export function CylinderLedger({ range }: { range: DateRange }) {
  const t = useT();
  const [draft, setDraft] = useState<LedgerFilter>(EMPTY_FILTER);
  const [applied, setApplied] = useState<LedgerFilter>(EMPTY_FILTER);

  const { data: cylinders = [], isLoading: l1 } = useQuery({
    queryKey: ["cylinders"],
    queryFn: cylinderService.list,
  });
  const { data: movements = [], isLoading: l2 } = useQuery({
    queryKey: ["cylinderMovements"],
    queryFn: cylinderService.listMovements,
  });
  const { data: stockMovements = [] } = useQuery({
    queryKey: ["stockMovements"],
    queryFn: inventoryService.listMovements,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });

  const allHeads = useMemo(
    () =>
      buildCylinderLedger({
        cylinders,
        movements,
        products,
        customers,
        suppliers,
        range,
        stockMovements,
      }),
    [cylinders, movements, products, customers, suppliers, range, stockMovements],
  );

  const productFiltered = useMemo(
    () =>
      buildCylinderLedger({
        cylinders,
        movements,
        products,
        customers,
        suppliers,
        range,
        productId: applied.productId === ALL ? undefined : applied.productId,
        stockMovements,
      }),
    [cylinders, movements, products, customers, suppliers, range, applied.productId, stockMovements],
  );

  const partyOptions = useMemo(() => {
    const list = draft.kind === ALL ? allHeads : allHeads.filter((h) => h.kind === draft.kind);
    return list.map((h) => ({ id: h.id, name: h.name, kind: h.kind }));
  }, [allHeads, draft.kind]);

  const cylinderProducts = useMemo(() => {
    return products.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);

  const heads = useMemo(() => {
    let list = productFiltered;
    if (applied.kind !== ALL) list = list.filter((h) => h.kind === applied.kind);
    if (applied.headId !== ALL) list = list.filter((h) => h.id === applied.headId);
    const q = applied.q.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.lines.some(
            (line) =>
              line.productName.toLowerCase().includes(q) ||
              (line.serial || "").toLowerCase().includes(q),
          ),
      );
    }
    return list;
  }, [productFiltered, applied]);

  const grouped = useMemo(() => {
    const map = new Map<CylinderHeadKind, CylinderHeadReport[]>();
    for (const k of KIND_ORDER) map.set(k, []);
    for (const h of heads) map.get(h.kind)?.push(h);
    return KIND_ORDER.filter((k) => (map.get(k)?.length ?? 0) > 0).map((k) => ({
      kind: k,
      items: map.get(k)!,
    }));
  }, [heads]);

  const setKind = (kind: LedgerFilter["kind"]) => {
    setDraft((prev) => {
      const stillValid =
        prev.headId === ALL ||
        allHeads.some((h) => h.id === prev.headId && (kind === ALL || h.kind === kind));
      return { ...prev, kind, headId: stillValid ? prev.headId : ALL };
    });
  };

  const applyFilter = () => setApplied({ ...draft, q: draft.q.trim() });
  const resetFilter = () => {
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
  };

  if (l1 || l2) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (allHeads.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("cylinders.ledgerEmpty")}</p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="no-print text-xs text-muted-foreground">{t("cylinders.ledgerHint")}</p>

      <form
        className="no-print space-y-3 rounded-xl border bg-card/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilter();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("cylinders.filterHead")}</Label>
            <Select value={draft.kind} onValueChange={(v) => setKind(v as LedgerFilter["kind"])}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filter.all")}</SelectItem>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(KIND_LABEL[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("cylinders.filterParty")}</Label>
            <Select
              value={draft.headId}
              onValueChange={(headId) => setDraft((p) => ({ ...p, headId }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("cylinders.allParties")}</SelectItem>
                {partyOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("common.product")}</Label>
            <Select
              value={draft.productId}
              onValueChange={(productId) => setDraft((p) => ({ ...p, productId }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("cylinders.allProducts")}</SelectItem>
                {cylinderProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            value={draft.q}
            onChange={(e) => setDraft((p) => ({ ...p, q: e.target.value }))}
            placeholder={t("cylinders.searchPlaceholder")}
            className="h-9 min-w-[12rem] flex-1"
          />
          <Button type="submit" size="sm" className="h-9">
            <Search className="mr-1 h-4 w-4" />
            {t("cylinders.searchReport")}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={resetFilter}>
            <RotateCcw className="mr-1 h-4 w-4" />
            {t("cylinders.resetFilter")}
          </Button>
        </div>
      </form>

      {heads.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("cylinders.noMatch")}</p>
      ) : (
        grouped.map((g) => (
          <div key={g.kind} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t(KIND_LABEL[g.kind])}
            </h3>
            {g.items.map((head) => (
              <details
                key={head.id}
                className="fold-panel overflow-hidden rounded-xl border"
                defaultOpen={heads.length === 1}
              >
                <summary className="grid cursor-pointer grid-cols-2 gap-3 bg-muted/40 p-3 sm:grid-cols-[auto_minmax(0,1.2fr)_repeat(3,minmax(0,0.7fr))] sm:items-center">
                  <ChevronRight className="fold-panel-chevron hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:block" />
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="font-semibold">
                      {head.kind === "customer" && head.id.startsWith("c:") ? (
                        <PartyNameLink kind="customer" id={head.id.slice(2)} name={head.name} />
                      ) : head.kind === "supplier" && head.id.startsWith("s:") ? (
                        <PartyNameLink kind="supplier" id={head.id.slice(2)} name={head.name} />
                      ) : (
                        head.name
                      )}
                    </p>
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      {t(KIND_LABEL[head.kind])}
                    </Badge>
                  </div>
                  <Stat label={t("cylinders.delivered")} value={String(head.delivered)} />
                  <Stat label={t("cylinders.received")} value={String(head.received)} />
                  <Stat label={t("inventory.balance")} value={String(head.balance)} emphasize />
                </summary>
                <div className="fold-panel-body overflow-x-auto border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-card text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">{t("common.date")}</th>
                        <th className="px-3 py-2 font-medium">{t("common.product")}</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("cylinders.delivered")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("cylinders.received")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t("inventory.balance")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {head.lines.map((line) => (
                        <tr key={line.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap px-3 py-2 text-xs">
                            {formatDate(line.date)}
                          </td>
                          <td className="px-3 py-2">
                            {line.productName === "Opening"
                              ? t("statement.opening")
                              : line.productName}
                            {line.serial && (
                              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                                {line.serial}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {line.delivered || "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {line.received || "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {line.balance}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={emphasize ? "font-display text-sm font-semibold" : "text-sm font-medium"}>
        {value}
      </p>
    </div>
  );
}
