/**
 * Insaf Gas Corp ERP — Complete Demo Data Removal & Fresh Database Initialization
 *
 * This script safely and cleanly purges all demo / dummy / sample records from MongoDB
 * while strictly preserving:
 * - Admin, Operator, and Staff accounts (appUsers)
 * - System settings, RBAC power matrix, and cylinder tracking config (appSettings)
 * - Company branding, logos, contact details (branding)
 * - Standard Chart of Accounts (chartOfAccounts)
 * - Core product categories (productCategories)
 *
 * It creates an automated timestamped backup in backups/ prior to any deletion.
 */

import dns from "node:dns";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

let uri = process.env.MONGODB_URI;
if (!uri && existsSync(".env")) {
  try {
    const raw = readFileSync(".env", "utf8");
    const match = raw.match(/MONGODB_URI=(?:["']?)([^"'\r\n]+)/);
    if (match && match[1]?.trim()) {
      uri = match[1].trim();
    }
  } catch {}
}
if (!uri) {
  uri = "mongodb+srv://anikwitinstitute_db_user:anikwitinstitutegmailcom@d360crm.s0ebokd.mongodb.net/?appName=D360CRM";
}

const TARGET_DATABASES = ["insaf_gas_corp", "InsafCorporation"];

const PURGE_COLLECTIONS = [
  "deliveries",
  "sales",
  "purchases",
  "supplierReturns",
  "returns",
  "vouchers",
  "ledger",
  "expenses",
  "payroll",
  "stockMovements",
  "movements",
  "costLayers",
  "gasInventory",
  "cylinderInventory",
  "productInventory",
  "cylinders",
  "customers",
  "suppliers",
  "products",
  "employees",
  "assets",
  "accounts",
];

const PROTECTED_COLLECTIONS = [
  "appUsers",
  "appSettings",
  "branding",
  "chartOfAccounts",
  "productCategories",
];

async function main() {
  console.log("======================================================================");
  console.log("   INSAF GAS CORP ERP — DEMO DATA PURGE & FRESH INITIALIZATION       ");
  console.log("======================================================================\n");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  console.log("Connected to MongoDB Atlas cluster.\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBaseDir = join(process.cwd(), "backups", `backup-${timestamp}`);
  mkdirSync(backupBaseDir, { recursive: true });

  for (const dbName of TARGET_DATABASES) {
    console.log(`Processing Database: [${dbName}]`);
    const db = client.db(dbName);
    const dbBackupDir = join(backupBaseDir, dbName);
    mkdirSync(dbBackupDir, { recursive: true });

    const existingCollections = await db.listCollections().toArray();
    const existingNames = new Set(existingCollections.map((c) => c.name));

    for (const name of existingNames) {
      const docs = await db.collection(name).find({}).toArray();
      writeFileSync(join(dbBackupDir, `${name}.json`), JSON.stringify(docs, null, 2), "utf8");
    }

    for (const collName of PURGE_COLLECTIONS) {
      if (existingNames.has(collName)) {
        await db.collection(collName).deleteMany({});
      }
    }

    // Ensure standard categories exist
    const catColl = db.collection("productCategories");
    const now = new Date().toISOString();
    for (const name of ["LPG", "Industrial", "Medical", "Other"]) {
      const nameKey = name.toLowerCase();
      await catColl.updateOne(
        { nameKey },
        { $setOnInsert: { id: `cat-${nameKey}`, name, nameKey, createdAt: now, updatedAt: now } },
        { upsert: true }
      );
    }
  }

  console.log("Backup and purge completed successfully.\n");
  await client.close();
}

main().catch(console.error);
