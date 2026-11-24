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

// 1. Resolve MongoDB connection string
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

const dbName = process.env.MONGODB_DB || "InsafCorporation";

console.log("======================================================================");
console.log("   INSAF GAS CORP ERP — DEMO DATA PURGE & FRESH INITIALIZATION       ");
console.log("======================================================================\n");

if (!uri || !uri.startsWith("mongodb")) {
  console.log("ℹ️  NOTICE: No valid MONGODB_URI found in environment or .env file.");
  console.log("   Codebase demo seeds and fallbacks have already been reset to 0 in src/lib/seed-data.ts.");
  console.log("   When you configure your MongoDB connection string in .env:");
  console.log("   MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?appName=insaf");
  console.log("   Run this script anytime to purge existing demo records from your database:\n");
  console.log("   node scripts/purge-demo-data.mjs\n");
  process.exit(0);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });

// Collections that contain demo/sample data to be purged (in dependency order)
const PURGE_COLLECTIONS = [
  // 1. Transaction records
  "deliveries",
  "sales",
  "purchases",
  "supplierReturns",
  "returns",
  "vouchers",
  "ledger",
  "expenses",
  "payroll",
  // 2. Inventory movements & snapshots
  "stockMovements",
  "movements",
  "costLayers",
  "gasInventory",
  "cylinderInventory",
  "productInventory",
  "cylinders",
  // 3. Entity master records
  "customers",
  "suppliers",
  "products",
  "employees",
  "assets",
  "accounts", // Cleans dummy sample bank accounts like 01711000000
];

// Essential collections that MUST NOT be deleted (Protected)
const PROTECTED_COLLECTIONS = [
  "appUsers",         // Operator, Manager, and staff user logins
  "appSettings",      // RBAC power matrix & system settings
  "branding",         // Company logo, name, contacts
  "chartOfAccounts",  // Standard Chart of Accounts (COA)
  "productCategories" // Base categories (LPG, Industrial, Medical, Other)
];

async function main() {
  try {
    console.log("Connecting to MongoDB Atlas...");
    await client.connect();
    console.log(`✅ Connected successfully to database: [${dbName}]\n`);

    const db = client.db(dbName);

    // 2. Step 1: Inspect database & create automated full backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(process.cwd(), "backups", `backup-${timestamp}`);
    mkdirSync(backupDir, { recursive: true });

    console.log(`📦 Creating safety backup in: ${backupDir}`);
    const existingCollections = await db.listCollections().toArray();
    const existingNames = new Set(existingCollections.map((c) => c.name));

    const initialCounts = {};
    for (const name of existingNames) {
      const coll = db.collection(name);
      const docs = await coll.find({}).toArray();
      initialCounts[name] = docs.length;
      writeFileSync(join(backupDir, `${name}.json`), JSON.stringify(docs, null, 2), "utf8");
    }
    console.log("✅ Backup complete. All existing collections archived.\n");

    console.log("Current document counts before purge:");
    console.table(initialCounts);

    // 3. Step 2: Safely purge demo records in dependency order
    console.log("\n🧹 Purging demo data from transaction and inventory collections...");
    const deletedCounts = {};

    for (const name of PURGE_COLLECTIONS) {
      if (!existingNames.has(name)) {
        deletedCounts[name] = 0;
        continue;
      }
      const coll = db.collection(name);
      const res = await coll.deleteMany({});
      deletedCounts[name] = res.deletedCount;
    }

    // 4. Step 3: Ensure protected collections and essential system data exist
    console.log("\n🔒 Ensuring essential system records and user accounts are protected...");

    // 4.1 Ensure appUsers has default operator/admin user
    const usersColl = db.collection("appUsers");
    const userCount = await usersColl.estimatedDocumentCount();
    if (userCount === 0) {
      const { hashPassword } = await import("../src/lib/password.server.ts");
      const { seedAppUsers } = await import("../src/lib/seed-data.ts");
      await usersColl.insertMany(
        seedAppUsers.map((u) => ({
          ...u,
          password: hashPassword(u.password),
        })),
        { ordered: false }
      );
      console.log("   ✅ Initialized system administrator & staff user accounts (appUsers)");
    } else {
      console.log(`   ✅ Preserved ${userCount} existing system user account(s)`);
    }

    // 4.2 Ensure chartOfAccounts has standard accounting accounts
    const coaColl = db.collection("chartOfAccounts");
    const coaCount = await coaColl.estimatedDocumentCount();
    if (coaCount === 0) {
      const { seedChartOfAccounts } = await import("../src/lib/seed-data.ts");
      await coaColl.insertMany(seedChartOfAccounts, { ordered: false });
      console.log("   ✅ Initialized standard Chart of Accounts (chartOfAccounts)");
    } else {
      console.log(`   ✅ Preserved ${coaCount} Chart of Account definition(s)`);
    }

    // 4.3 Ensure core productCategories exist
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
    console.log("   ✅ Preserved standard product categories (LPG, Industrial, Medical, Other)");

    // 5. Step 4: Verification of post-cleanup state
    console.log("\n📊 Verification of database state after cleanup:");
    const finalCounts = {};
    for (const name of [...PURGE_COLLECTIONS, ...PROTECTED_COLLECTIONS]) {
      if (existingNames.has(name) || (await db.listCollections({ name }).hasNext())) {
        finalCounts[name] = await db.collection(name).estimatedDocumentCount();
      }
    }
    console.table(finalCounts);

    console.log("\n======================================================================");
    console.log("   CLEANUP COMPLETE: SOFTWARE IS CLEAN & READY FOR REAL OPERATIONS    ");
    console.log("   - Total Sales: ৳0                                                  ");
    console.log("   - Total Purchases: ৳0                                              ");
    console.log("   - Total Expenses: ৳0                                               ");
    console.log("   - Net Profit: ৳0                                                   ");
    console.log("   - Active Cylinders: 0                                              ");
    console.log("   - All Lists: Clean empty states ready for business data entry     ");
    console.log("   - System Users & Accounts: Preserved                               ");
    console.log("======================================================================\n");
  } catch (err) {
    console.error("❌ Error during demo data purge:", err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
