// Deliberately limited Mongo adapter: unknown operators fail instead of silently matching.
// No Mongo client, connection string, network access or production fallback exists here.
type Row = Record<string, any>;
const copy = <T>(value: T): T => structuredClone(value);
function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((q: Row) => matches(row, q));
    if (key === "$and") return value.every((q: Row) => matches(row, q));
    const actual = row[key];
    if (value instanceof RegExp) return value.test(actual ?? "");
    if (value && typeof value === "object") return Object.entries(value).every(([op, operand]: [string, any]) => {
      switch (op) {
        case "$ne": return actual !== operand;
        case "$gt": return actual > operand;
        case "$gte": return actual >= operand;
        case "$lt": return actual < operand;
        case "$lte": return actual <= operand;
        case "$in": return operand.includes(actual);
        case "$nin": return !operand.includes(actual);
        case "$exists": return (actual !== undefined) === operand;
        case "$regex": return new RegExp(operand).test(actual ?? "");
        default: throw new Error(`Unsupported memory query: ${op}`);
      }
    });
    return actual === value;
  });
}

export class MemoryDb {
  private tables: Record<string, Row[]>;
  private sequence = 0;
  constructor(seed: Record<string, Row[]> = {}) { this.tables = copy(seed); }
  // Reading a missing collection is observationally the same as an empty one.
  snapshot() { return copy(Object.fromEntries(Object.entries(this.tables).filter(([, rows]) => rows.length > 0))); }
  rows(name: string): Row[] { return copy(this.tables[name] ?? []); }
  collection(name: string) {
    const rows = () => this.tables[name] ??= [];
    const apply = (row: Row, update: Row, inserted = false) => {
      for (const [op, values] of Object.entries(update)) {
        switch (op) {
          case "$set": Object.assign(row, copy(values)); break;
          case "$setOnInsert": if (inserted) Object.assign(row, copy(values)); break;
          case "$inc": for (const [key, amount] of Object.entries(values)) row[key] = (row[key] ?? 0) + Number(amount); break;
          case "$unset": for (const key of Object.keys(values)) delete row[key]; break;
          default: throw new Error(`Unsupported memory update: ${op}`);
        }
      }
    };
    const collection = {
      find: (query: Row = {}, _options?: Row) => {
        let result = rows().filter(row => matches(row, query)).map(copy);
        const cursor = {
          sort: (order: Row) => { result.sort((a, b) => {
            for (const [key, direction] of Object.entries(order)) {
              if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * Number(direction);
            }
            return 0;
          }); return cursor; },
          toArray: async () => copy(result),
        };
        return cursor;
      },
      findOne: async (query: Row = {}, _options?: Row) => copy(rows().find(row => matches(row, query)) ?? null),
      insertOne: async (doc: Row, _options?: Row) => {
        if (doc.id && rows().some(row => row.id === doc.id)) throw Object.assign(new Error("duplicate id"), { code: 11000 });
        rows().push(copy(doc));
        return { acknowledged: true, insertedId: doc.id };
      },
      insertMany: async (docs: Row[], options?: Row) => { for (const doc of docs) await collection.insertOne(doc, options); return { acknowledged: true }; },
      updateOne: async (query: Row, update: Row, options: Row = {}) => {
        let row = rows().find(row => matches(row, query));
        const inserted = !row && !!options.upsert;
        if (inserted) {
          row = Object.fromEntries(Object.entries(query).filter(([key, value]) => !key.startsWith("$") && (value === null || typeof value !== "object")));
          rows().push(row!);
        }
        if (row) apply(row, update, inserted);
        return { acknowledged: true, matchedCount: row && !inserted ? 1 : 0, modifiedCount: row ? 1 : 0, upsertedCount: inserted ? 1 : 0 };
      },
      findOneAndUpdate: async (query: Row, update: Row, options: Row = {}) => {
        const before = await collection.findOne(query);
        await collection.updateOne(query, update, options);
        return options.returnDocument === "after" ? collection.findOne(query) : before;
      },
      deleteMany: async (query: Row = {}, _options?: Row) => {
        const before = rows().length;
        this.tables[name] = rows().filter(row => !matches(row, query));
        return { acknowledged: true, deletedCount: before - rows().length };
      },
      deleteOne: async (query: Row, _options?: Row) => {
        const index = rows().findIndex(row => matches(row, query));
        if (index >= 0) rows().splice(index, 1);
        return { acknowledged: true, deletedCount: index >= 0 ? 1 : 0 };
      },
    };
    return collection;
  }
  // Sequential rollback only; does not simulate Mongo locking/conflict retries.
  client = { startSession: () => ({
    withTransaction: async <T>(run: () => Promise<T>): Promise<T> => {
      const before = this.snapshot();
      try { return await run(); } catch (error) { this.tables = before; throw error; }
    },
    endSession: async () => {},
  }) };
  crud = async ({ data }: { data: { op: string; coll: string; id?: string; payload?: Row } }) => {
    const { op, coll, id, payload } = data;
    const collection = this.collection(coll);
    switch (op) {
      case "list": return collection.find().toArray();
      case "get": return collection.findOne({ id });
      case "create": {
        const row = { ...payload, id: payload?.id ?? `memory-${++this.sequence}` };
        await collection.insertOne(row); return copy(row);
      }
      case "update": await collection.updateOne({ id }, { $set: payload }); return collection.findOne({ id });
      case "remove": return collection.deleteOne({ id });
      default: throw new Error(`Unsupported memory CRUD: ${op}`);
    }
  };
}
