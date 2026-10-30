export interface AuditRecord {
  id: string;
  userId: string;
  username: string;
  action:
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "ADJUST"
    | "RECEIVE"
    | "ISSUE"
    | "PAYMENT"
    | "PAYROLL"
    | "ROLE_CHANGE"
    | "LOGIN"
    | "LOGOUT";
  entityType:
    | "sales"
    | "purchases"
    | "payments"
    | "inventory"
    | "stockMovements"
    | "ledger"
    | "payroll"
    | "users"
    | "cylinders"
    | "expenses"
    | "settings"
    | "vouchers";
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  timestamp: string;
  details?: string;
}

let inMemoryAuditLogs: AuditRecord[] = [];

export async function logAudit(
  dbOrNull: any,
  entry: Omit<AuditRecord, "id" | "timestamp"> & { id?: string; timestamp?: string },
): Promise<AuditRecord> {
  const record: AuditRecord = {
    id: entry.id || `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: entry.userId || "system",
    username: entry.username || "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    timestamp: entry.timestamp || new Date().toISOString(),
    details: entry.details,
  };

  if (dbOrNull && typeof dbOrNull.collection === "function") {
    try {
      await dbOrNull.collection("auditLogs").insertOne({ ...record });
    } catch {
      inMemoryAuditLogs.push(record);
    }
  } else {
    inMemoryAuditLogs.push(record);
  }

  return record;
}

export async function getAuditLogs(
  dbOrNull: any,
  filter?: { entityType?: string; entityId?: string; userId?: string; limit?: number },
): Promise<AuditRecord[]> {
  const limit = filter?.limit || 100;
  if (dbOrNull && typeof dbOrNull.collection === "function") {
    try {
      const q: Record<string, unknown> = {};
      if (filter?.entityType) q.entityType = filter.entityType;
      if (filter?.entityId) q.entityId = filter.entityId;
      if (filter?.userId) q.userId = filter.userId;
      const docs = await dbOrNull
        .collection("auditLogs")
        .find(q)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      return docs.map((d: any) => {
        const { _id, ...rest } = d;
        return rest as AuditRecord;
      });
    } catch {
      return inMemoryAuditLogs.slice(-limit).reverse();
    }
  }
  return inMemoryAuditLogs.slice(-limit).reverse();
}

export function clearInMemoryAuditLogs(): void {
  inMemoryAuditLogs = [];
}
