import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ChevronDown, ImagePlus, Trash2 } from "lucide-react";
import { productService } from "@/services/product.service";
import { productCategoryService } from "@/services/product-category.service";
import { accountingService } from "@/services/accounting.service";
import { productSchema } from "@/utils/validators";
import { fileToProductImage } from "@/lib/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { ProductImage } from "@/components/common/ProductImage";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CostingMethod } from "@/types";

type FormValues = z.infer<typeof productSchema>;

const NONE = "__none__";

const COSTING: { id: CostingMethod; label: MessageKey; hint: MessageKey }[] = [
  { id: "fifo", label: "products.costing.fifo", hint: "products.costing.fifoHint" },
  { id: "lifo", label: "products.costing.lifo", hint: "products.costing.lifoHint" },
  { id: "average", label: "products.costing.average", hint: "products.costing.averageHint" },
];

export function ProductForm({ id }: { id?: string }) {
  const t = useT();
  const mode = id ? "edit" : "create";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: existing, isLoading } = useQuery({
    queryKey: ["products", id],
    queryFn: () => productService.get(id!),
    enabled: !!id,
  });
  const { data: coa = [] } = useQuery({ queryKey: ["coa"], queryFn: accountingService.listCoa });
  const { data: categoryRows = [] } = useQuery({
    queryKey: ["productCategories"],
    queryFn: productCategoryService.list,
  });
  const incomeAccounts = coa.filter((a) => a.type === "Income");
  const expenseAccounts = coa.filter((a) => a.type === "Expense");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      code: "",
      category: "LPG",
      productType: "gas",
      uom: "kg",
      price: 0,
      cost: 0,
      image: "",
      stock: 0,
      reorderLevel: 0,
      incomeAccountId: "",
      expenseAccountId: "",
      costingMethod: "fifo",
    },
  });

  useEffect(() => {
    if (!existing) return;
    reset({
      code: existing.code || "",
      name: existing.name,
      category: existing.category || "LPG",
      productType: existing.productType || (existing.uom === "cyl" ? "cylinder" : "gas"),
      uom: existing.uom || (existing.productType === "cylinder" ? "cyl" : "kg"),
      price: Number(existing.price) || 0,
      cost: Number(existing.cost) || 0,
      image: existing.image || "",
      stock: Number(existing.stock) || 0,
      reorderLevel: Number(existing.reorderLevel) || 0,
      incomeAccountId: existing.incomeAccountId || "",
      expenseAccountId: existing.expenseAccountId || "",
      costingMethod: existing.costingMethod || "fifo",
    });
  }, [existing, reset]);

  const mutation = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        code: v.code?.trim() || undefined,
        name: v.name,
        category: v.category,
        productType: v.productType,
        uom: v.uom,
        price: Number(v.price) || 0,
        cost: Number(v.cost) || 0,
        image: v.image || undefined,
        incomeAccountId: v.incomeAccountId || undefined,
        expenseAccountId: v.expenseAccountId || undefined,
        costingMethod: v.costingMethod || "fifo",
        reorderLevel: Number(v.reorderLevel) || 0,
        taxRate: 0,
        ...(mode === "create" ? { stock: Number(v.stock) || 0 } : {}),
      };
      if (mode === "edit") {
        if (!id) throw new Error("Missing product id");
        return productService.update(id, payload as never);
      }
      return productService.create(payload as never);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["productCategories"] });
      qc.invalidateQueries({ queryKey: ["cylinderInventory"] });
      qc.invalidateQueries({ queryKey: ["gasInventory"] });
      qc.invalidateQueries({ queryKey: ["productInventory"] });
      qc.invalidateQueries({ queryKey: ["inventorySummary"] });
      if (id) qc.invalidateQueries({ queryKey: ["products", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("common.save"));
      navigate({ to: id ? "/products/$id" : "/products", params: id ? { id } : undefined });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (id && isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (id && !existing)
    return <div className="p-6 text-sm text-destructive">{t("products.notFound")}</div>;

  const costing = watch("costingMethod") || "fifo";
  const image = watch("image") || "";
  const categoryOptions = useMemo(() => {
    const fromRows = categoryRows.map((c) => c.name).filter(Boolean);
    const combined = [...fromRows, "LPG", "Industrial", "Medical", "Other"];
    const names = [...new Set(combined)];
    const existingCat = existing?.category?.trim();
    if (existingCat && !names.some((n) => n.toLowerCase() === existingCat.toLowerCase())) {
      names.unshift(existingCat);
    }
    return names;
  }, [categoryRows, existing?.category]);

  const productTypeOptions = useMemo(() => {
    const base: EditableComboboxOption[] = [
      { value: "gas", label: t("products.type.gas") },
      { value: "cylinder", label: t("products.type.cylinder") },
      { value: "product", label: t("products.type.product") },
    ];
    const existingType = existing?.productType?.trim();
    if (
      existingType &&
      existingType.toLowerCase() !== "gas" &&
      existingType.toLowerCase() !== "cylinder" &&
      existingType.toLowerCase() !== "product"
    ) {
      base.push({ value: existingType, label: existingType });
    }
    return base;
  }, [t, existing?.productType]);

  const onPickImage = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await fileToProductImage(file);
      setValue("image", dataUrl, { shouldDirty: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("products.imageInvalid"));
    }
  };

  return (
    <div>
      <PageHeader
        title={mode === "create" ? t("products.new") : t("products.edit")}
        backTo={id ? { to: "/products/$id", params: { id } } : "/products"}
      />
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSubmit(
              (v) => mutation.mutate(v),
              () => toast.error(t("products.validationFailed")),
            )}
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="md:col-span-2 flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center">
              <ProductImage src={image || undefined} alt={watch("name") || "product"} size="lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Label>{t("products.image")}</Label>
                <p className="text-xs text-muted-foreground">{t("products.imageHint")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      <ImagePlus className="mr-1 h-4 w-4" />
                      {t("products.imageUpload")}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          void onPickImage(file);
                        }}
                      />
                    </label>
                  </Button>
                  {image && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setValue("image", "", { shouldDirty: true })}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t("products.imageRemove")}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <Row label={t("common.name")} error={errors.name?.message}>
              <Input {...register("name")} />
            </Row>
            <Row label={t("common.category")} error={errors.category?.message}>
              <EditableCombobox
                id="product-category"
                value={watch("category") || ""}
                onChange={(v) =>
                  setValue("category", v, { shouldDirty: true, shouldValidate: true })
                }
                options={categoryOptions}
                placeholder={t("common.category")}
              />
            </Row>
            <Row label={t("products.productType")} error={errors.productType?.message}>
              <EditableCombobox
                id="product-productType"
                value={watch("productType") || ""}
                onChange={(v) =>
                  setValue("productType", v, { shouldDirty: true, shouldValidate: true })
                }
                options={productTypeOptions}
                placeholder={t("products.productType")}
              />
            </Row>
            <Row label={t("products.uom")}>
              <Select
                value={watch("uom")}
                onValueChange={(v) => setValue("uom", v as FormValues["uom"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["kg", "cyl", "ltr", "pcs"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={t("products.salesPrice")} error={errors.price?.message}>
              <Input
                type="number"
                step="0.01"
                min={0}
                {...register("price", { valueAsNumber: true })}
              />
            </Row>
            <Row label={t("products.costPrice")} error={errors.cost?.message}>
              <Input
                type="number"
                step="0.01"
                min={0}
                {...register("cost", { valueAsNumber: true })}
              />
            </Row>
            <Row label={t("products.reorder")}>
              <Input type="number" {...register("reorderLevel")} />
            </Row>
            <Row label={t("products.code")} error={errors.code?.message}>
              <Input {...register("code")} placeholder={t("products.code")} />
            </Row>
            {mode === "create" && (
              <Row label={t("products.stock")}>
                <Input type="number" {...register("stock")} />
              </Row>
            )}

            <div className="md:col-span-2 space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <h3 className="font-display text-sm font-semibold">{t("products.accounting")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("products.accountingHint")}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Row label={t("products.incomeAccount")}>
                  <Select
                    value={watch("incomeAccountId") || NONE}
                    onValueChange={(v) => setValue("incomeAccountId", v === NONE ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {incomeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code ? `${a.code} · ` : ""}
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={t("products.expenseAccount")}>
                  <Select
                    value={watch("expenseAccountId") || NONE}
                    onValueChange={(v) => setValue("expenseAccountId", v === NONE ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("common.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {expenseAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code ? `${a.code} · ` : ""}
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
              </div>
              {coa.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("products.coaEmpty")}
                </p>
              )}

              <div>
                <Label>{t("products.costingMethod")}</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {COSTING.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setValue("costingMethod", opt.id)}
                      className={
                        costing === opt.id
                          ? "rounded-lg border border-primary bg-primary/5 p-3 text-left"
                          : "rounded-lg border bg-card p-3 text-left hover:border-primary/40"
                      }
                    >
                      <p className="text-sm font-semibold">{t(opt.label)}</p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {t(opt.hint)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  navigate({
                    to: id ? "/products/$id" : "/products",
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

function Row({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

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
  align = "start",
}: {
  value: string;
  onChange: (val: string) => void;
  options: Array<EditableComboboxOption | string>;
  placeholder?: string;
  className?: string;
  id?: string;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typedText, setTypedText] = useState("");

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: EditableComboboxOption[] = [];
    for (const item of options) {
      const opt = typeof item === "string" ? { value: item, label: item } : item;
      const trimmedVal = opt.value.trim();
      if (!trimmedVal || seen.has(trimmedVal.toLowerCase())) continue;
      seen.add(trimmedVal.toLowerCase());
      list.push({ value: trimmedVal, label: opt.label.trim() || trimmedVal });
    }
    return list;
  }, [options]);

  const selectedOption = useMemo(() => {
    const v = (value || "").trim().toLowerCase();
    return normalizedOptions.find(
      (opt) => opt.value.toLowerCase() === v || opt.label.toLowerCase() === v,
    );
  }, [normalizedOptions, value]);

  const displayValue = isTyping
    ? typedText
    : (selectedOption ? selectedOption.label : value || "");

  const query = isTyping ? typedText.trim().toLowerCase() : "";

  const filteredOptions = useMemo(() => {
    if (!query) return normalizedOptions;
    return normalizedOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.value.toLowerCase().includes(query),
    );
  }, [normalizedOptions, query]);

  const hasExactMatch = useMemo(() => {
    if (!query) return true;
    return normalizedOptions.some(
      (opt) =>
        opt.value.toLowerCase() === query ||
        opt.label.toLowerCase() === query,
    );
  }, [normalizedOptions, query]);

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    const matched = normalizedOptions.find(
      (opt) =>
        opt.label.toLowerCase() === trimmed.toLowerCase() ||
        opt.value.toLowerCase() === trimmed.toLowerCase(),
    );
    const finalVal = matched ? matched.value : trimmed;
    onChange(finalVal);
    setTypedText(matched ? matched.label : trimmed);
    setIsTyping(false);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          if (isTyping) {
            commitValue(typedText);
          }
          setIsTyping(false);
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn("relative flex w-full items-center", className)}>
          <Input
            id={id}
            value={displayValue}
            placeholder={placeholder}
            className="pr-8"
            onChange={(e) => {
              const val = e.target.value;
              setTypedText(val);
              setIsTyping(true);
              setOpen(true);
              const trimmed = val.trim();
              const matched = normalizedOptions.find(
                (opt) =>
                  opt.label.toLowerCase() === trimmed.toLowerCase() ||
                  opt.value.toLowerCase() === trimmed.toLowerCase(),
              );
              onChange(matched ? matched.value : val);
            }}
            onClick={() => {
              if (!open) {
                setTypedText(displayValue);
                setIsTyping(false);
                setOpen(true);
              }
            }}
            onFocus={() => {
              setTypedText(displayValue);
              setIsTyping(false);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                commitValue(isTyping ? typedText : (selectedOption ? selectedOption.value : value));
              } else if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                setTypedText(displayValue);
                setIsTyping(false);
                setOpen(true);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle options"
            className="absolute right-0 top-0 bottom-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              if (!open) {
                setTypedText(displayValue);
              }
              setIsTyping(false);
              setOpen((prev) => !prev);
            }}
          >
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align={align}
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="z-50 w-[var(--radix-popover-anchor-width)] min-w-[var(--radix-popover-anchor-width,10rem)] max-h-56 overflow-auto p-1 text-sm shadow-md"
      >
        <div className="space-y-0.5">
          {query && !hasExactMatch && (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-sm border-b border-border/50 px-2 py-1.5 pb-2 text-left text-xs font-medium text-primary hover:bg-accent cursor-pointer"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitValue(typedText)}
            >
              <span className="truncate">Use &quot;{typedText.trim()}&quot;</span>
              <Check className="ml-2 h-3.5 w-3.5 shrink-0" />
            </button>
          )}

          {filteredOptions.map((opt) => {
            const isSelected =
              opt.value.toLowerCase() === (value || "").trim().toLowerCase() ||
              opt.label.toLowerCase() === (value || "").trim().toLowerCase();
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
                  setTypedText(opt.label);
                  setIsTyping(false);
                  setOpen(false);
                }}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
              </button>
            );
          })}

          {filteredOptions.length === 0 && !query && (
            <div className="px-2 py-2 text-center text-xs text-muted-foreground">
              No options
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
