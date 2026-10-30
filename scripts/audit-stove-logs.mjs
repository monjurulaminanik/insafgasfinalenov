import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const logs = await db.collection("auditLogs").find({
    $or: [
      { details: /rose|stove|3eing5fd/i },
      { "before.name": /rose|stove/i },
      { "after.name": /rose|stove/i }
    ]
  }).toArray();
  for (const l of logs) {
    console.log(l.timestamp, l.action, l.details, "before stock:", l.before?.stock, "after stock:", l.after?.stock);
  }

  await client.close();
}

main().catch(console.error);
