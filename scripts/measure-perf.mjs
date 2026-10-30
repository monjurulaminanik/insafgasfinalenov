import { getDb } from '../src/lib/mongo.server.ts';
import { reconcileDatabaseInventory } from '../src/lib/inventory.server.ts';

async function benchmark() {
  const db = await getDb();
  console.log('--- STARTING PERFORMANCE MEASUREMENT ---');
  
  // Measure single reconcileDatabaseInventory
  const t0 = performance.now();
  await reconcileDatabaseInventory(db);
  const t1 = performance.now();
  const singleReconcileMs = (t1 - t0).toFixed(1);
  console.log(`Single reconcileDatabaseInventory scan & upsert: ${singleReconcileMs} ms`);

  // Measure 3 parallel reconcileDatabaseInventory calls (simulating concurrent page tab loads)
  const p0 = performance.now();
  await Promise.all([
    reconcileDatabaseInventory(db),
    reconcileDatabaseInventory(db),
    reconcileDatabaseInventory(db),
  ]);
  const p1 = performance.now();
  const parallelReconcileMs = (p1 - p0).toFixed(1);
  console.log(`Three parallel reconcileDatabaseInventory runs: ${parallelReconcileMs} ms`);

  // Measure direct read from separated inventory collections
  const d0 = performance.now();
  const [gasDocs, cylDocs, prodDocs] = await Promise.all([
    db.collection('gasInventory').find({}).toArray(),
    db.collection('cylinderInventory').find({}).toArray(),
    db.collection('productInventory').find({}).toArray(),
  ]);
  const d1 = performance.now();
  const directReadMs = (d1 - d0).toFixed(1);
  console.log(`Direct read from dedicated collections (gas: ${gasDocs.length}, cyl: ${cylDocs.length}, prod: ${prodDocs.length}): ${directReadMs} ms`);

  console.log(`Potential latency reduction: ${(Number(parallelReconcileMs) - Number(directReadMs)).toFixed(1)} ms (${((Number(parallelReconcileMs) - Number(directReadMs)) / Number(parallelReconcileMs) * 100).toFixed(1)}% faster)`);
  process.exit(0);
}

benchmark().catch(e => {
  console.error(e);
  process.exit(1);
});
