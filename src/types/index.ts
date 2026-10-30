export type ID = string;

export type OpeningBalanceType = "receivable" | "payable";

export interface Customer {
  id: ID;
  name: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  address: string;
  gstin?: string;
  creditLimit?: number;
  openingBalance: number;
  openingBalanceType?: OpeningBalanceType;
  creditReminderEnabled?: boolean;
  creditReminderDays?: number;
  createdAt: string;
}

export interface Supplier {
  id: ID;
  name: string;
  phone: string;
  email?: string;
  address: string;
  gstin?: string;
  openingBalance: number;
  createdAt: string;
}

/** Built-in names used by cylinders; product.category may also be a managed catalog name. */
export type ProductCategory = "LPG" | "Industrial" | "Medical" | "Other";

export interface ProductCategoryRecord {
  id: ID;
  name: string;
  nameKey?: string;
  createdAt: string;
  updatedAt?: string;
}
export type UnitOfMeasure = "kg" | "cyl" | "ltr" | "pcs";
export type ProductType = "gas" | "cylinder" | "product";
export type CostingMethod = "fifo" | "lifo" | "average";

export interface GasInventory {
  id: ID;
  productId: ID;
  productName: string;
  productType: "gas";
  uom: UnitOfMeasure;
  openingStock: number;
  stockIn: number;
  stockOut: number;
  onHand: number;
  unitPrice: number;
  costPrice: number;
  totalValue: number;
  createdAt?: string;
  updatedAt: string;
}

export interface CylinderInventory {
  id: ID;
  productId: ID;
  productName: string;
  productType: "cylinder";
  uom: UnitOfMeasure;
  openingStock: number;
  stockIn: number;
  stockOut: number;
  reserved: number;
  available: number;
  onHand: number;
  unitPrice: number;
  costPrice: number;
  totalValue: number;
  createdAt?: string;
  updatedAt: string;
}

export interface ProductInventory {
  id: ID;
  productId: ID;
  productName: string;
  productType: "product";
  uom: UnitOfMeasure;
  openingStock: number;
  stockIn: number;
  stockOut: number;
  onHand: number;
  unitPrice: number;
  costPrice: number;
  totalValue: number;
  createdAt?: string;
  updatedAt: string;
}

export interface InventorySummary {
  gas: GasInventory[];
  cylinders: CylinderInventory[];
  products: ProductInventory[];
  totals: {
    gasOnHand: number;
    cylinderOnHand: number;
    cylinderReserved: number;
    cylinderAvailable: number;
    productOnHand: number;
    totalValue: number;
  };
}

export interface Product {
  id: ID;
  code: string;
  name: string;
  category: string;
  /** Gas = invoice/revenue. Cylinder = movement unless a sale price is entered. */
  productType?: ProductType | string;
  uom: UnitOfMeasure;
  price: number;
  cost?: number;
  /** Compressed data-URL or remote URL */
  image?: string;
  taxRate?: number;
  stock: number;
  initialStock?: number;
  openingStock?: number;
  reorderLevel: number;
  /** Chart of Accounts — Income (sales revenue) */
  incomeAccountId?: ID;
  /** Chart of Accounts — Expense / COGS */
  expenseAccountId?: ID;
  costingMethod?: CostingMethod;
  createdAt: string;
}

export interface CostLayer {
  id: ID;
  productId: ID;
  qtyRemaining: number;
  unitCost: number;
  receivedAt: string;
  refType?: StockMovement["refType"];
  refId?: ID;
}

export interface LayerConsumption {
  layerId: string;
  qty: number;
  unitCost: number;
}

export type CylinderStatus =
  | "in_stock"
  | "at_customer"
  | "in_transit"
  | "refilling"
  | "damaged"
  | "lost"
  | "scrapped"
  | "written_off"
  | "stock_out";
export type CylinderFillLevel = "full" | "empty";

export interface Cylinder {
  id: ID;
  serialNumber: string;
  productId: ID;
  capacity: number;
  status: CylinderStatus;
  location: string;
  customerId?: ID;
  supplierId?: ID;
  gasCategory?: ProductCategory;
  /** Full vs empty gas contents. Returned empties are empty until refilled. */
  fillLevel?: CylinderFillLevel;
  /** Company-owned unless sold to the customer. */
  ownedBy?: "company" | "customer";
  lotNumber?: string;
  /** Set while an issue is in progress so concurrent requests cannot take the same cylinder. */
  issueLock?: string | null;
  lastMovementAt: string;
  createdAt: string;
}

export type CylinderMovementType =
  | "received"
  | "issued"
  | "returned"
  | "refilled"
  | "transferred"
  | "damaged"
  | "lost"
  | "stock_out"
  | "scrapped"
  | "written_off";

export interface CylinderMovement {
  id: ID;
  cylinderId: ID;
  type: CylinderMovementType;
  fromLocation?: string;
  toLocation?: string;
  customerId?: ID;
  supplierId?: ID;
  notes?: string;
  timestamp: string;
  by: string;
  /** True when the cylinder was sold (ownership transfer), not loaned. */
  sold?: boolean;
  expectedReturnAt?: string;
  purpose?:
    | "sent"
    | "return"
    | "refill_sent"
    | "refill_return"
    | "exchange_out"
    | "exchange_in"
    | "loan"
    | "loan_return"
    | "lost"
    | "damaged"
    | "repair"
    | "scrap"
    | "writeoff"
    | "sale"
    | "stock_out";
  reason?: string;
  penaltyAmount?: number;
  accountingTreatment?: "charge" | "writeoff" | "none";
  lotNumber?: string;
}

export interface LineItem {
  productId: ID;
  productName: string;
  quantity: number;
  price: number;
  taxRate?: number;
  cylinderIds?: string[];
  /** Cumulative GRN qty. Omitted on historical rows (inferred from PO status). */
  receivedQty?: number;
  /** Cylinder line billed as an ownership sale (not movement-only). */
  sellCylinder?: boolean;
  /** Sales-line classification. Omitted on historical rows (inferred from the product). */
  itemType?: "gas" | "cylinder" | "product";
  /** Snapshot of category on this sales line. Does not update Product master. */
  category?: string;
}

export type SalesStatus = "draft" | "confirmed" | "invoiced" | "paid" | "cancelled";

export interface SalesOrder {
  id: ID;
  orderNo: string;
  customerId: ID;
  customerName: string;
  date: string;
  items: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  status: SalesStatus;
  notes?: string;
  createdAt?: string;
  /** Assigned deliveryman name when set on the sales order */
  driverName?: string;
  receiverName?: string;
  customerPhone?: string;
  customerAddress?: string;
  sellGasOnly?: boolean;
}

export interface Delivery {
  id: ID;
  challanNo: string;
  salesOrderId?: ID;
  customerId: ID;
  customerName: string;
  driverName: string;
  vehicleNo: string;
  items: LineItem[];
  status: "pending" | "confirmed" | "delivered" | "in_transit" | "returned";
  date: string;
  confirmedAt?: string;
  expectedReturnAt?: string;
  receiverName?: string;
  emptyReturned?: number;
  notes?: string;
  customerPhone?: string;
  customerAddress?: string;
}

export type PurchaseStatus =
  "draft" | "ordered" | "partial" | "received" | "billed" | "paid" | "cancelled";

export type PurchaseGrn = {
  id: string;
  grnNo: string;
  receivedAt: string;
  items: Array<{ productId: ID; quantity: number }>;
};

export interface PurchaseOrder {
  id: ID;
  orderNo: string;
  supplierId: ID;
  supplierName: string;
  date: string;
  items: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  status: PurchaseStatus;
  grnNo?: string;
  receivedAt?: string;
  notes?: string;
  /** Completed GRN events. Inventory posts against each grnNo, not the PO ordered qty. */
  grns?: PurchaseGrn[];
}

export type SupplierReturnStatus = "confirmed" | "draft" | "cancelled" | "partial" | "received";

export type SupplierReturnDelivery = {
  id: string;
  receiptNo: string;
  date: string;
  receivedAt: string;
  items: Array<{
    productId: ID;
    productName?: string;
    quantity: number;
  }>;
  notes?: string;
  by?: string;
};

export interface SupplierReturn {
  id: ID;
  returnNo: string;
  supplierId: ID;
  supplierName: string;
  date: string;
  items: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: SupplierReturnStatus;
  receivingStatus?: "none" | "partial" | "received";
  deliveries?: SupplierReturnDelivery[];
  notes?: string;
  purchaseOrderId?: ID;
  purchaseOrderNo?: string;
  createdAt: string;
  updatedAt?: string;
}

export type StockMovementType = "in" | "out" | "adjust" | "return";

export type MovementTypeKind =
  | "RECEIPT"
  | "PURCHASE_RECEIVED"
  | "SALE_ISSUE"
  | "SALE_COMPLETED"
  | "RETURN"
  | "SALES_RETURN"
  | "PURCHASE_RETURN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "DAMAGE"
  | "LOSS"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export interface StockMovement {
  id: ID;
  movementId?: string;
  date: string;
  refillDate?: string;
  productId: ID;
  productName: string;
  productType?: ProductType;
  type: StockMovementType;
  movementType?: MovementTypeKind;
  direction?: "in" | "out";
  quantity: number;
  previousBalance?: number;
  balanceAfter: number;
  newBalance?: number;
  unitCost?: number;
  totalCost?: number;
  cogsAmount?: number;
  costingMethod?: CostingMethod;
  consumptions?: LayerConsumption[];
  refType?: "sales" | "purchase" | "delivery" | "adjustment" | "refill";
  refId?: string;
  sourceType?: string;
  sourceId?: string;
  sourceLineId?: string;
  notes?: string;
  by: string;
}

export type PaymentMethod = "cash" | "bank" | "cheque" | "mobile" | (string & {});

export interface Account {
  id: ID;
  name: string;
  type: "bank" | "mobile" | "cash";
  accountNo?: string;
  bankName?: string;
  createdAt: string;
}

export type CoaType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export interface ChartOfAccount {
  id: ID;
  name: string;
  type: CoaType;
  code?: string;
  createdAt: string;
}

export interface BusinessAsset {
  id: ID;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: number;
  currentValue: number;
  notes?: string;
  createdAt: string;
}

export interface Expense {
  id: ID;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
}

export type LedgerCategory =
  | "opening"
  | "collection"
  | "expense"
  | "adjustment"
  | "purchase"
  | "receipt"
  | "payment"
  | "journal";

export interface LedgerEntry {
  id: ID;
  date: string;
  account: PaymentMethod;
  direction: "in" | "out";
  amount: number;
  category: LedgerCategory;
  refType?: "sales" | "expense" | "purchase" | "voucher" | "payroll" | "equity";
  refId?: string;
  notes?: string;
}

export type VoucherType = "payment" | "receipt" | "journal";

export interface JournalLine {
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
  notes?: string;
}

export interface Voucher {
  id: ID;
  voucherNo: string;
  type: VoucherType;
  date: string;
  account: PaymentMethod;
  amount: number;
  partyType?: "customer" | "supplier" | "employee";
  partyId?: string;
  partyName?: string;
  drAccount?: string;
  crAccount?: string;
  lines?: JournalLine[];
  notes?: string;
  /** Link to sales/purchase when receipt was created from a document payment */
  refType?: "sales" | "purchase" | "expense" | "payroll";
  refId?: string;
  refNo?: string;
  createdAt: string;
}

export interface Employee {
  id: ID;
  employeeNo: string;
  name: string;
  phone: string;
  designation: string;
  department: string;
  joiningDate: string;
  salary: number;
  /** Commission earned per delivery, if applicable */
  perDeliveryCommission?: number;
  /** Profile photo data-URL or remote URL */
  image?: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface PayrollRun {
  id: ID;
  employeeId: ID;
  employeeName: string;
  month: string;
  basic: number;
  bonus: number;
  allowance: number;
  deduction: number;
  net: number;
  status: "draft" | "paid";
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  createdAt: string;
}

export interface DashboardStats {
  todaySales: number;
  todayCollection: number;
  todayExpense: number;
  customerDue: number;
  supplierPayable: number;
  cashBalance: number;
  bankBalance: number;
  availableStock: number;
  cylindersInWarehouse: number;
  cylindersWithCustomers: number;
  cylindersUnderRefill: number;
  damagedCylinders: number;
  lostCylinders: number;
  monthlySales: number;
}

export interface AuthUser {
  username: string;
  displayName: string;
  role?: string;
}

export interface StockAlert {
  productId: ID;
  productName: string;
  stock: number;
  reorderLevel: number;
}

export type ReturnItemType = "gas" | "cylinder" | "product";
export type CylinderReturnCondition = "empty" | "full" | "damaged";

export interface ReturnItem {
  productId: ID;
  productName: string;
  category?: string;
  itemType: ReturnItemType;
  deliveredQuantity: number;
  previouslyReturnedQuantity: number;
  returnQuantity: number;
  price: number;
  subtotal: number;
  cylinderCondition?: CylinderReturnCondition;
  cylinderIds?: string[];
  unit?: UnitOfMeasure;
}

export interface ReturnRecord {
  id: ID;
  returnNo: string;
  deliveryId: ID;
  challanNo: string;
  salesOrderId?: ID;
  orderNo?: string;
  customerId: ID;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  driverName?: string;
  receiverName?: string;
  vehicleNo?: string;
  returnDate: string;
  items: ReturnItem[];
  itemClassification: "gas" | "cylinder" | "product" | "mixed";
  totalQuantity: number;
  totalAmount: number;
  reason?: string;
  notes?: string;
  status: "completed" | "pending" | "cancelled";
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  movementIds?: string[];
}
