import dns from "node:dns";
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
const uri = raw.match(/MONGODB_URI="([^"]+)"/)?.[1];
if (!uri) {
  console.error("MONGODB_URI missing in .env");
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const db = client.db("InsafCorporation");
  const ping = await db.command({ ping: 1 });
  const cols = await db.listCollections().toArray();
  const counts = {};
  for (const c of cols) {
    counts[c.name] = await db.collection(c.name).estimatedDocumentCount();
  }
  console.log(JSON.stringify({ ok: true, ping, db: db.databaseName, counts }, null, 2));
} catch (error) {
  console.error("FAIL", error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
