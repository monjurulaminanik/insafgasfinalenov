const inMemoryCounters: Record<string, number> = {};

export async function getNextSequence(
  dbOrNull: any,
  prefix: string,
  year?: number,
): Promise<string> {
  const currentYear = year || new Date().getFullYear();
  const counterKey = `${prefix.toUpperCase()}-${currentYear}`;

  if (dbOrNull && typeof dbOrNull.collection === "function") {
    try {
      const counters = dbOrNull.collection("counters");
      const result = await counters.findOneAndUpdate(
        { _id: counterKey },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      const doc = (result as { value?: { seq: number } } | null)?.value ?? result;
      const seq = doc?.seq || 1;
      return `${prefix.toUpperCase()}-${currentYear}-${String(seq).padStart(6, "0")}`;
    } catch {
      // Fall back to memory counter if db is offline
    }
  }

  inMemoryCounters[counterKey] = (inMemoryCounters[counterKey] || 0) + 1;
  const seq = inMemoryCounters[counterKey];
  return `${prefix.toUpperCase()}-${currentYear}-${String(seq).padStart(6, "0")}`;
}

export function resetSequenceCounter(prefix: string, year?: number): void {
  const currentYear = year || new Date().getFullYear();
  const counterKey = `${prefix.toUpperCase()}-${currentYear}`;
  delete inMemoryCounters[counterKey];
}
