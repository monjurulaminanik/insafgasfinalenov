import type {
  CostLayer,
  CostingMethod,
  Cylinder,
  LayerConsumption,
  MovementTypeKind,
  Product,
  StockMovement,
  StockMovementType,
} from "../types/index.ts";
import { cylinderIsFullStock, isCylinderProduct } from "./cylinder-product.ts";

export type StockMeta = {
  refType?: StockMovement["refType"];
  refId?: string;
  notes?: string;
  by?: string;
  movementType?: MovementTypeKind;
  date?: string;
};

export function productMethod(p: Pick<Product, "costingMethod">): CostingMethod {
  return p.costingMethod === "lifo" || p.costingMethod === "average" ? p.costingMethod : "fifo";
}

export function computeWeightedAverageOnReceipt(
  currentStock: number,
  currentCost: number,
  receiptQty: number,
  receiptCost: number,
): number {
  const safeStock = Math.max(0, currentStock);
  const safeCurrentCost =
    Number.isFinite(currentCost) && currentCost >= 0 ? currentCost : receiptCost;
  const totalQty = safeStock + receiptQty;
  if (totalQty <= 0) return receiptCost;
  const totalValue = safeStock * safeCurrentCost + receiptQty * receiptCost;
  return totalValue / totalQty;
}

export function sortLayersForConsumption(layers: CostLayer[], method: CostingMethod): CostLayer[] {
  const copy = [...layers].filter((l) => (l.qtyRemaining || 0) > 0);
  copy.sort((a, b) => {
    const ta = new Date(a.receivedAt).getTime();
    const tb = new Date(b.receivedAt).getTime();
    return method === "lifo" ? tb - ta : ta - tb;
  });
  return copy;
}

export function computeLayerValuation(layers: CostLayer[]): {
  totalQty: number;
  totalValue: number;
  avgCost: number;
} {
  const open = layers.filter((l) => (l.qtyRemaining || 0) > 0);
  const totalQty = open.reduce((sum, l) => sum + (l.qtyRemaining || 0), 0);
  const totalValue = open.reduce((sum, l) => sum + (l.qtyRemaining || 0) * (l.unitCost || 0), 0);
  const avgCost = totalQty > 0 ? totalValue / totalQty : 0;
  return { totalQty, totalValue, avgCost };
}

export type ConsumptionResult = {
  consumptions: LayerConsumption[];
  cogsAmount: number;
  unitCost: number;
  updatedLayers: { id: string; qtyRemaining: number }[];
};

export function consumeCostLayers(
  layers: CostLayer[],
  qty: number,
  method: CostingMethod,
  fallbackUnitCost: number = 0,
): ConsumptionResult {
  if (qty <= 0) {
    return { consumptions: [], cogsAmount: 0, unitCost: 0, updatedLayers: [] };
  }

  const sorted = sortLayersForConsumption(layers, method);
  let remainingNeed = qty;
  const consumptions: LayerConsumption[] = [];
  const updatedLayers: { id: string; qtyRemaining: number }[] = [];

  for (const layer of sorted) {
    if (remainingNeed <= 0) break;
    const availableInLayer = layer.qtyRemaining || 0;
    if (availableInLayer <= 0) continue;

    const take = Math.min(availableInLayer, remainingNeed);
    const newQtyRemaining = availableInLayer - take;
    updatedLayers.push({ id: layer.id, qtyRemaining: newQtyRemaining });
    consumptions.push({
      layerId: layer.id,
      qty: take,
      unitCost: layer.unitCost || 0,
    });
    remainingNeed -= take;
  }

  if (remainingNeed > 0) {
    consumptions.push({
      layerId: "",
      qty: remainingNeed,
      unitCost: fallbackUnitCost,
    });
  }

  let cogsAmount = 0;
  let unitCost = 0;

  if (method === "average") {
    unitCost = fallbackUnitCost;
    cogsAmount = qty * fallbackUnitCost;
  } else {
    cogsAmount = consumptions.reduce((sum, c) => sum + c.qty * c.unitCost, 0);
    unitCost = qty > 0 ? cogsAmount / qty : 0;
  }

  return {
    consumptions,
    cogsAmount,
    unitCost,
    updatedLayers,
  };
}

export type SerialReconciliationItem = {
  productId: string;
  productName: string;
  productCode: string;
  isSerialized: boolean;
  productStock: number;
  warehouseFullSerials: number;
  discrepancy: number;
  reconciled: boolean;
  status: "MATCH" | "DISCREPANCY" | "NOT_SERIALIZED";
};

export function reconcileQuantityWithSerials(
  products: Product[],
  cylinders: Cylinder[],
): SerialReconciliationItem[] {
  return products.map((p) => {
    const isSerialized = isCylinderProduct(p);
    const productStock = p.stock ?? 0;
    const warehouseFullSerials = isSerialized
      ? cylinders.filter(
          (c) => c.productId === p.id && cylinderIsFullStock(c) && c.ownedBy !== "customer",
        ).length
      : 0;

    const discrepancy = isSerialized ? productStock - warehouseFullSerials : 0;
    const reconciled = !isSerialized || discrepancy === 0;

    return {
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      isSerialized,
      productStock,
      warehouseFullSerials,
      discrepancy,
      reconciled,
      status: !isSerialized ? "NOT_SERIALIZED" : reconciled ? "MATCH" : "DISCREPANCY",
    };
  });
}
