/**
 * MASTER DEMO DATA PURGE & INITIALIZATION SCRIPT
 *
 * Targets: insaf_gas_corp AND InsafCorporation
 * 1. Creates full JSON backup of every collection in backups/
 * 2. Purges all demo transactions, entities, inventory, and journals
 * 3. Strictly preserves appUsers, appSettings, branding, chartOfAccounts, productCategories
 * 4. Verifies post-cleanup counts in both databases
 */

import dns from "node:dns";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const uri =
  process.env.MONGODB_URI ||
  "mongodb+srv://anikwitinstitute_db_user:anikwitinstitutegmailcom@d360crm.s0ebokd.mongodb.net/?appName=D360CRM";

const TARGET_DATABASES = ["insaf_gas_corp", "InsafCorporation"];

const PURGE_COLLECTIONS = [
  "customers",
  "suppliers",
  "products",
  "cylinders",
  "movements",
  "sales",
  "deliveries",
  "returns",
  "supplierReturns",
  "expenses",
  "ledger",
  "purchases",
  "stockMovements",
  "vouchers",
  "employees",
  "payroll",
  "assets",
  "costLayers",
  "accounts",
  "gasInventory",
  "cylinderInventory",
  "productInventory",
];

const PROTECTED_COLLECTIONS = [
  "appUsers",
  "appSettings",
  "branding",
  "chartOfAccounts",
  "productCategories",
];

async function runCleanup() {
  console.log("======================================================================");
  console.log("      MASTER DEMO DATA PURGE & CLEAN DATABASE INITIALIZATION         ");
  console.log("======================================================================\n");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  console.log("Connected to MongoDB Atlas cluster successfully.\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBaseDir = join(process.cwd(), "backups", `master-backup-${timestamp}`);
  mkdirSync(backupBaseDir, { recursive: true });

  const auditReport = {
    timestamp: new Date().toISOString(),
    databases: {},
  };

  for (const dbName of TARGET_DATABASES) {
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`Processing Database: [${dbName}]`);
    console.log(`----------------------------------------------------------------------`);

    const db = client.db(dbName);
    const dbBackupDir = join(backupBaseDir, dbName);
    mkdirSync(dbBackupDir, { recursive: true });

    // Step 1: Backup all existing collections
    const existingCollections = await db.listCollections().toArray();
    const existingNames = new Set(existingCollections.map((c) => c.name));

    console.log(`1. Archiving collections to: ${dbBackupDir}`);
    const preCounts = {};
    for (const name of existingNames) {
      const docs = await db.collection(name).find({}).toArray();
      preCounts[name] = docs.length;
      writeFileSync(join(dbBackupDir, `${name}.json`), JSON.stringify(docs, null, 2), "utf8");
    }
    console.log("   ✅ Backup completed successfully.");
    console.log("   Initial counts:", JSON.stringify(preCounts));

    // Step 2: Extract preserved master data from insaf_gas_corp if InsafCorporation is empty
    let usersToPreserve = [];
    let settingsToPreserve = [];
    let coaToPreserve = [];
    let brandingToPreserve = [];

    if (existingNames.has("appUsers")) {
      usersToPreserve = await db.collection("appUsers").find({}).toArray();
    }
    if (existingNames.has("appSettings")) {
      settingsToPreserve = await db.collection("appSettings").find({}).toArray();
    }
    if (existingNames.has("chartOfAccounts")) {
      coaToPreserve = await db.collection("chartOfAccounts").find({}).toArray();
    }
    if (existingNames.has("branding")) {
      brandingToPreserve = await db.collection("branding").find({}).toArray();
    }

    // If InsafCorporation is missing master data, pull from insaf_gas_corp
    if (dbName === "InsafCorporation") {
      const sourceDb = client.db("insaf_gas_corp");
      if (usersToPreserve.length === 0 && (await sourceDb.listCollections({ name: "appUsers" }).hasNext())) {
        usersToPreserve = await sourceDb.collection("appUsers").find({}).toArray();
      }
      if (settingsToPreserve.length === 0 && (await sourceDb.listCollections({ name: "appSettings" }).hasNext())) {
        settingsToPreserve = await sourceDb.collection("appSettings").find({}).toArray();
      }
      if (coaToPreserve.length === 0 && (await sourceDb.listCollections({ name: "chartOfAccounts" }).hasNext())) {
        coaToPreserve = await sourceDb.collection("chartOfAccounts").find({}).toArray();
      }
      if (brandingToPreserve.length === 0 && (await sourceDb.listCollections({ name: "branding" }).hasNext())) {
        brandingToPreserve = await sourceDb.collection("branding").find({}).toArray();
      }
    }

    // Step 3: Purge business demo collections
    console.log(`2. Purging confirmed demo collections in [${dbName}]...`);
    const removedCounts = {};
    for (const collName of PURGE_COLLECTIONS) {
      if (existingNames.has(collName)) {
        const result = await db.collection(collName).deleteMany({});
        removedCounts[collName] = result.deletedCount;
      } else {
        removedCounts[collName] = 0;
      }
    }
    console.log("   ✅ Removed records:", JSON.stringify(removedCounts));

    // Step 4: Sync & protect system master collections
    console.log(`3. Synchronizing protected system collections in [${dbName}]...`);

    // App Users
    if (usersToPreserve.length > 0) {
      const usersColl = db.collection("appUsers");
      for (const u of usersToPreserve) {
        const { _id, ...cleanUser } = u;
        await usersColl.updateOne({ id: cleanUser.id }, { $set: cleanUser }, { upsert: true });
      }
      console.log(`   ✅ Preserved ${usersToPreserve.length} user account(s)`);
    }

    // Ensure super admin account exists
    const adminUser = {
      id: "u-admin",
      username: "admin",
      role: "Administrator",
      name: "Super Admin",
      displayName: "Super Admin",
      email: "admin@insafgas.com",
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    await db.collection("appUsers").updateOne({ username: "admin" }, { $setOnInsert: adminUser }, { upsert: true });

    // App Settings
    if (settingsToPreserve.length > 0) {
      const settingsColl = db.collection("appSettings");
      for (const s of settingsToPreserve) {
        const { _id, ...cleanSetting } = s;
        await settingsColl.updateOne({ id: cleanSetting.id || "app-settings" }, { $set: cleanSetting }, { upsert: true });
      }
      console.log(`   ✅ Preserved system settings`);
    } else {
      await db.collection("appSettings").updateOne(
        { id: "app-settings" },
        {
          $setOnInsert: {
            id: "app-settings",
            cylinderTracking: "serial",
            language: "bn",
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
    }

    // Chart of Accounts
    const defaultCoa = [
      { id: "coa1", code: "INC-01", name: "Sales Revenue", type: "Income" },
      { id: "coa2", code: "INC-02", name: "Delivery Charges", type: "Income" },
      { id: "coa3", code: "EXP-01", name: "Salary Expense", type: "Expense" },
      { id: "coa4", code: "EXP-02", name: "Office Rent", type: "Expense" },
      { id: "coa5", code: "EXP-03", name: "Transport Fuel", type: "Expense" },
      { id: "coa6", code: "AST-01", name: "Warehouse Equipment", type: "Asset" },
      { id: "coa7", code: "LIA-01", name: "Bank Loan", type: "Liability" },
    ];
    const finalCoa = coaToPreserve.length > 0 ? coaToPreserve : defaultCoa;
    const coaColl = db.collection("chartOfAccounts");
    for (const a of finalCoa) {
      const { _id, ...cleanCoa } = a;
      await coaColl.updateOne({ id: cleanCoa.id }, { $set: cleanCoa }, { upsert: true });
    }
    console.log(`   ✅ Preserved ${finalCoa.length} Chart of Account definition(s)`);

    // Product Categories
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
    console.log(`   ✅ Initialized standard product categories`);

    // Step 5: Final count verification for this database
    const postCounts = {};
    for (const name of [...PURGE_COLLECTIONS, ...PROTECTED_COLLECTIONS]) {
      postCounts[name] = await db.collection(name).countDocuments();
    }
    console.log(`\n4. Verified Post-Cleanup State in [${dbName}]:`);
    console.table(postCounts);

    auditReport.databases[dbName] = {
      backupDir: dbBackupDir,
      preCounts,
      removedCounts,
      postCounts,
    };
  }

  // Save full audit report
  const reportPath = join(process.cwd(), "backups", `audit-report-${timestamp}.json`);
  writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), "utf8");
  console.log(`\nAudit report saved to: ${reportPath}`);

  await client.close();
  console.log("\n======================================================================");
  console.log("   CLEANUP FINISHED: ALL DEMO DATA PURGED. SYSTEM READY FOR ENTRY.    ");
  console.log("======================================================================\n");
}

runCleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
