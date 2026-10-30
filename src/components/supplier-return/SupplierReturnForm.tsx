import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Trash2, Plus, Check, ChevronDown } from "lucide-react";
import { supplierService } from "@/services/supplier.service";
import { productService } from "@/services/product.service";
import { supplierReturnService } from "@/services/supplier-return.service";
import { inventoryService } from "@/services/inventory.service";
import { purchaseService } from "@/services/purchase.service";
import { computeTotals, lineAmount } from "@/utils/helpers";
import { formatCurrency } from "@/utils/formatters";
import { supplierReturnSchema } from "@/utils/validators";
import type { LineItem, Product } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface EditableComboboxOption {
  value: string;
  label: string;
}

function EditableCombobox({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  id,
}: {
  value: string;
  onChange: (val: string) => void;
  options: Array<EditableComboboxOption | string>;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: EditableComboboxOption[] = [];
    for (const item of options) {
      const opt = typeof item === "string" ? { value: item, label: item } : item;
      const trimmedVal = opt.value.trim();
      if (!trimmedVal || seen.has(trimmedVal)) continue;
      seen.add(trimmedVal);
      list.push({ value: trimmedVal, label: opt.label.trim() || trimmedVal });
    }
    return list;
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!isTyping || !value.trim()) return normalizedOptions;
    const q = value.trim().toLowerCase();
    return normalizedOptions.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q),
    );
  }, [normalizedOptions, isTyping, value]);

  const hasExactMatch = useMemo(() => {
    const trimmed = value.trim().toLowerCase();
    return normalizedOptions.some((opt) => opt.value.toLowerCase() === trimmed);
  }, [normalizedOptions, value]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setIsTyping(false);
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn("relative flex w-full items-center", className)}>
          <Input
            id={id}
            value={value}
            placeholder={placeholder}
            className="pr-8"
            onChange={(e) => {
              onChange(e.target.value);
              setIsTyping(true);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onFocus={() => {
              setIsTyping(false);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                setIsTyping(false);
              } else if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle options"
            className="absolute right-0 flex h-full w-8 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              setOpen((prev) => !prev);
              setIsTyping(false);
            }}
          >
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {isTyping && value.trim() && !hasExactMatch && (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-sm border-b border-border/50 px-2 py-1.5 pb-2 text-left text-xs font-medium text-primary hover:bg-accent cursor-pointer"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setIsTyping(false);
              }}
            >
              <span className="truncate">Use &quot;{value.trim()}&quot;</span>
              <Check className="ml-2 h-3.5 w-3.5 shrink-0" />
            </button>
          )}

          {filteredOptions.map((opt) => {
            const isSelected = opt.value.toLowerCase() === value.trim().toLowerCase();
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                  isSelected && "bg-accent font-medium",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setIsTyping(false);
                }}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
              </button>
            );
          })}

          {filteredOptions.length === 0 && !value.trim() && (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">
              No options
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function cleanLeadingZeros(val: string): string {
  if (val === "" || val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s === "") return "";
  if (/^00+\./.test(s)) return s.replace(/^0+/, "0");
  if (/^0\d/.test(s)) return s.replace(/^0+(?=\d)/, "");
  return s;
}

function CostInput({
  value,
  onChange,
  className,
  id,
}: {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (inputRef.current && !isFocusedRef.current) {
      const currentVal = inputRef.current.value;
      if (currentVal === "" && (value === 0 || value === undefined)) {
        // preserve
      } else if (Number(currentVal) !== value) {
        inputRef.current.value = value != null ? String(value) : "";
      }
    }
  }, [value]);

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const raw = e.currentTarget.value;
    const cleaned = cleanLeadingZeros(raw);
    if (cleaned !== raw) {
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      e.currentTarget.value = cleaned;
      if (start != null && end != null) {
        const offset = raw.length - cleaned.length;
        e.currentTarget.setSelectionRange(Math.max(0, start - offset), Math.max(0, end - offset));
      }
    }
    const num = cleaned === "" ? 0 : Number(cleaned);
    onChange(Number.isFinite(num) ? num : 0);
  };

  return (
    <Input
      ref={inputRef}
      id={id}
      type="number"
      min={0}
      step="any"
      defaultValue={value != null && value !== 0 ? value : ""}
      className={className}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        if (inputRef.current) {
          const cleaned = cleanLeadingZeros(inputRef.current.value);
          inputRef.current.value = cleaned;
          onChange(cleaned === "" ? 0 : Number(cleaned) || 0);
        }
      }}
      onInput={handleInput}
    />
  );
}

interface ReturnItemOption {
  id: string;
  name: string;
  productType: "gas" | "cylinder" | "product";
  cost: number;
  stock: number;
}

function getProductType(p: Product): "gas" | "cylinder" | "product" {
  if (p.productType === "cylinder" || p.productType === "gas" || p.productType === "product") {
    return p.productType;
  }
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return "cylinder";
  if (uom === "pcs") return "product";
  if (uom === "kg" || uom === "ltr") return "gas";
  const cat = String(p.category || "").toLowerCase();
  if (cat.includes("cylinder") || cat === "cylinder") return "cylinder";
  return "gas";
}

export function SupplierReturnForm({ id, purchaseId }: { id?: string; purchaseId?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editing = Boolean(id);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: supplierService.list,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });
  const { data: existing, isLoading } = useQuery({
    queryKey: ["supplierReturns", id],
    queryFn: () => supplierReturnService.get(id!),
    enabled: editing,
  });
  const { data: sourcePo, isFetched: isPoFetched } = useQuery({
    queryKey: ["purchases", "prefill", purchaseId],
    queryFn: async () => {
      if (!purchaseId) return null;
      try {
        const direct = await purchaseService.get(purchaseId);
        if (direct) return direct;
      } catch {
        // continue to list lookup
      }
      try {
        const all = await purchaseService.list();
        return all.find((p) => p.id === purchaseId || p.orderNo === purchaseId) || null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(purchaseId) && !editing,
  });

  const availableProducts = useMemo<ReturnItemOption[]>(() => {
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      productType: getProductType(p),
      cost: p.cost ?? p.price ?? 0,
      stock: p.stock ?? 0,
    }));
  }, [products]);

  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [hydrated, setHydrated] = useState(!editing && !purchaseId);

  const supplierOptions = useMemo(() => {
    return suppliers.map((s) => ({
      value: s.name,
      label: s.name,
    }));
  }, [suppliers]);

  const onSupplierChange = (val: string) => {
    setSupplierName(val);
    const matched = suppliers.find(
      (s) => s.name.trim().toLowerCase() === val.trim().toLowerCase(),
    );
    if (matched) {
      setSupplierId(matched.id);
    } else {
      setSupplierId("");
    }
  };

  useEffect(() => {
    if (sourcePo && !existing && !hydrated) {
      setSupplierId(sourcePo.supplierId || "");
      setSupplierName(sourcePo.supplierName || "");
      setNotes((prev) => prev || `Return against PO #${sourcePo.orderNo}`);
      if (sourcePo.items && sourcePo.items.length > 0) {
        setItems(
          sourcePo.items.map((it) => {
            const p = availableProducts.find((x) => x.id === it.productId);
            return {
              productId: it.productId,
              productName: it.productName,
              itemType: it.itemType || p?.productType || "gas",
              quantity: it.quantity,
              price: it.price || p?.cost || 0,
              taxRate: 0,
            };
          }),
        );
      }
      setHydrated(true);
      return;
    }

    if (purchaseId && isPoFetched && !hydrated) {
      if (availableProducts.length > 0 && items.length === 0) {
        const p = availableProducts[0];
        setItems([
          {
            productId: p.id,
            productName: p.name,
            itemType: p.productType,
            quantity: 1,
            price: p.cost,
            taxRate: 0,
          },
        ]);
      }
      setHydrated(true);
      return;
    }

    if (!existing) {
      if (availableProducts.length > 0 && items.length === 0 && !purchaseId) {
        const p = availableProducts[0];
        setItems([
          {
            productId: p.id,
            productName: p.name,
            itemType: p.productType,
            quantity: 1,
            price: p.cost,
            taxRate: 0,
          },
        ]);
      }
      return;
    }
    setSupplierId(existing.supplierId || "");
    setSupplierName(
      existing.supplierName ||
        suppliers.find((s) => s.id === existing.supplierId)?.name ||
        "",
    );
    setNotes(existing.notes ?? "");
    setItems(
      existing.items.map((it) => {
        const p = availableProducts.find((x) => x.id === it.productId);
        return {
          ...it,
          itemType: it.itemType || p?.productType || "gas",
        };
      }),
    );
    setHydrated(true);
  }, [existing, sourcePo, availableProducts, suppliers, hydrated, purchaseId]);

  const addItem = () => {
    const p = availableProducts[0];
    if (!p) return;
    setItems((prev) => [
      ...prev,
      {
        productId: p.id,
        productName: p.name,
        itemType: p.productType,
        quantity: 1,
        price: p.cost,
        taxRate: 0,
      },
    ]);
  };

  const update = (idx: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const onSelectProduct = (idx: number, pid: string) => {
    const p = availableProducts.find((x) => x.id === pid);
    if (!p) return;
    update(idx, {
      productId: p.id,
      productName: p.name,
      price: p.cost,
      itemType: p.productType,
    });
  };

  const setLineType = (idx: number, type: "gas" | "cylinder" | "product") => {
    const current = items[idx];
    const match = availableProducts.find((p) => p.productType === type);
    if (match) {
      update(idx, {
        itemType: type,
        productId: match.id,
        productName: match.name,
        price: match.cost,
      });
    } else {
      update(idx, { itemType: type });
    }
  };

  const totals = useMemo(() => computeTotals(items), [items]);

  const mutation = useMutation({
    mutationFn: async () => {
      const finalSupplierName = supplierName.trim();
      if (!finalSupplierName) {
        throw new Error("Select or enter a supplier");
      }
      const matched = suppliers.find(
        (s) => s.name.trim().toLowerCase() === finalSupplierName.toLowerCase(),
      );
      const finalSupplierId = matched ? matched.id : supplierId;

      supplierReturnSchema.parse({
        supplierId: finalSupplierId,
        supplierName: finalSupplierName,
        items,
        notes,
      });

      if (editing && id) {
        return supplierReturnService.update(id, {
          supplierId: finalSupplierId,
          supplierName: finalSupplierName,
          items: items.map((it) => ({ ...it, taxRate: 0 })),
          notes,
          purchaseOrderId: existing?.purchaseOrderId || purchaseId || undefined,
          purchaseOrderNo: existing?.purchaseOrderNo || sourcePo?.orderNo || undefined,
        });
      }

      return supplierReturnService.create({
        supplierId: finalSupplierId,
        supplierName: finalSupplierName,
        date: new Date().toISOString(),
        items: items.map((it) => ({ ...it, taxRate: 0 })),
        notes,
        purchaseOrderId: purchaseId || undefined,
        purchaseOrderNo: sourcePo?.orderNo || undefined,
      });
    },
    onSuccess: (ret) => {
      qc.invalidateQueries({ queryKey: ["supplierReturns"] });
      qc.invalidateQueries({ queryKey: ["supplierReturns", ret.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["stockMovements"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      toast.success(editing ? t("supplierReturns.updated") : t("supplierReturns.created"));
      navigate({ to: "/suppliers/returns/$id", params: { id: ret.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (editing && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (editing && !existing)
    return <div className="p-6 text-sm text-destructive">{t("supplierReturns.notFound")}</div>;
  if (editing && existing && existing.status === "cancelled") {
    return <div className="p-6 text-sm text-destructive">{t("supplierReturns.cannotEdit")}</div>;
  }
  if (!hydrated)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div>
      <PageHeader
        title={editing ? t("supplierReturns.editTitle") : t("supplierReturns.newTitle")}
        description={sourcePo ? `Return against Purchase Order #${sourcePo.orderNo}` : undefined}
        backTo={editing ? { to: "/suppliers/returns/$id", params: { id: id! } } : "/suppliers/returns"}
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-return-supplier">{t("common.supplier")}</Label>
              <EditableCombobox
                id="supplier-return-supplier"
                value={supplierName}
                onChange={onSupplierChange}
                options={supplierOptions}
                placeholder={t("common.select")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.notes")}</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("common.optionalNotes")}
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("sales.item")}</h3>
              <Button type="button" size="sm" variant="outline" onClick={addItem}>
                <Plus className="mr-1 h-3 w-3" /> {t("common.addItem")}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.product")}</TableHead>
                    <TableHead className="w-36">{t("common.type")}</TableHead>
                    <TableHead className="w-24 text-right">{t("common.quantity")}</TableHead>
                    <TableHead className="w-32 text-right">{t("supplierReturns.cost")}</TableHead>
                    <TableHead className="w-32 text-right">{t("common.lineTotal")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {t("common.noItems")}
                      </TableCell>
                    </TableRow>
                  )}
                  {items.map((it, idx) => {
                    const selectedProduct = availableProducts.find((x) => x.id === it.productId);
                    const rowType =
                      it.itemType || selectedProduct?.productType || "gas";
                    const filteredProducts = availableProducts.filter(
                      (p) => p.productType === rowType,
                    );

                    return (
                      <TableRow key={idx}>
                        <TableCell className="min-w-[12rem]">
                          <Select
                            value={it.productId}
                            onValueChange={(v) => onSelectProduct(idx, v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("common.select")} />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredProducts.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} (Stock: {p.stock})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="w-36">
                          <Select
                            value={rowType}
                            onValueChange={(v) =>
                              setLineType(idx, v as "gas" | "cylinder" | "product")
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gas">Gas</SelectItem>
                              <SelectItem value="cylinder">Cylinder</SelectItem>
                              <SelectItem value="product">Product</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            className="text-right"
                            min={1}
                            value={it.quantity}
                            onChange={(e) =>
                              update(idx, { quantity: Number(e.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <CostInput
                            className="text-right"
                            value={it.price}
                            onChange={(price) => update(idx, { price })}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(lineAmount(it))}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex justify-end text-sm">
              <div className="w-56 space-y-1">
                <div className="flex justify-between">
                  <span>{t("common.subtotal")}</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>{t("common.total")}</span>
                  <span>{formatCurrency(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/suppliers/returns" })}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {editing ? t("common.save") : t("supplierReturns.create")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
