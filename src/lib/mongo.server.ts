import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;
let publicDnsApplied = false;

function isSrvLookupFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("querySrv");
}

function usePublicDns() {
  if (publicDnsApplied) return;
  // Windows DNS often refuses MongoDB Atlas SRV lookups (querySrv ECONNREFUSED).
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  publicDnsApplied = true;
}

async function openClient(uri: string): Promise<MongoClient> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 12000,
  });
  await client.connect();
  return client;
}

export function getMongoClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not configured");
    clientPromise = (async () => {
      if (process.platform === "win32" && uri.startsWith("mongodb+srv://")) {
        usePublicDns();
      }
      try {
        return await openClient(uri);
      } catch (err) {
        if (!uri.startsWith("mongodb+srv://") || !isSrvLookupFailure(err)) throw err;
        usePublicDns();
        return openClient(uri);
      }
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB || "InsafCorporation");
}
