import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, isHashedPassword } from "../src/lib/password.server.ts";
import { assertPermission, hasPermission, ForbiddenError } from "../src/lib/rbac.ts";
import { permissionForCrud } from "../src/lib/crud-access.ts";
import { validateSessionSecret } from "../src/lib/session.server.ts";
import { getNextSequence, resetSequenceCounter } from "../src/lib/document-sequence.ts";
import { logAudit, getAuditLogs, clearInMemoryAuditLogs } from "../src/lib/audit.ts";

test("SEC-02: Password Security & Hashing", async (t) => {
  await t.test("hashes passwords securely with scrypt prefix and salt", () => {
    const plain = "SuperSecret123!";
    const hashed = hashPassword(plain);

    assert.ok(isHashedPassword(hashed), "Must be recognized as hashed password");
    assert.ok(hashed.startsWith("scrypt$"), "Must use scrypt prefix");
    assert.notEqual(hashed, plain, "Password must not be stored in plaintext");
    assert.ok(!hashed.includes(plain), "Hash must never contain raw plaintext password");
  });

  await t.test("verifies valid passwords and rejects invalid passwords", () => {
    const plain = "CorrectPassword2026";
    const hashed = hashPassword(plain);

    assert.equal(verifyPassword(plain, hashed), true, "Valid password must verify");
    assert.equal(
      verifyPassword("WrongPassword", hashed),
      false,
      "Invalid password must be rejected",
    );
    assert.equal(verifyPassword("", hashed), false, "Empty password must be rejected");
    assert.equal(
      verifyPassword(plain, "plainTextUnHashed"),
      false,
      "Plaintext stored must not verify without hash",
    );
  });

  await t.test("produces distinct salts and hashes for identical plaintext", () => {
    const plain = "IdenticalPass123";
    const h1 = hashPassword(plain);
    const h2 = hashPassword(plain);

    assert.notEqual(h1, h2, "Unique salts must generate different hashes for same password");
    assert.equal(verifyPassword(plain, h1), true);
    assert.equal(verifyPassword(plain, h2), true);
  });
});

test("SEC-01: Server-Side RBAC & Direct API Protection", async (t) => {
  await t.test("Sales user permissions", () => {
    const salesUser = { username: "sales1", role: "Sales" };

    // Allowed sales operations
    assert.equal(hasPermission(salesUser.role, "sales.read"), true);
    assert.equal(hasPermission(salesUser.role, "sales.create"), true);
    assert.equal(hasPermission(salesUser.role, "sales.update"), true);
    assert.equal(hasPermission(salesUser.role, "customers.read"), true);
    assert.equal(hasPermission(salesUser.role, "customers.write"), true);

    // Forbidden direct API calls
    assert.equal(hasPermission(salesUser.role, "accounting.create"), false);
    assert.equal(hasPermission(salesUser.role, "accounting.delete"), false);
    assert.equal(hasPermission(salesUser.role, "payroll.create"), false);
    assert.equal(hasPermission(salesUser.role, "users.create"), false);
    assert.equal(hasPermission(salesUser.role, "users.delete"), false);
    assert.equal(hasPermission(salesUser.role, "settings.write"), false);

    // Direct assertion throws ForbiddenError (HTTP 403)
    assert.throws(
      () => assertPermission(salesUser, "accounting.create"),
      (err: any) => err instanceof ForbiddenError && err.status === 403,
    );
    assert.throws(
      () => assertPermission(salesUser, "payroll.create"),
      (err: any) => err instanceof ForbiddenError && err.status === 403,
    );
    assert.throws(
      () => assertPermission(salesUser, "users.delete"),
      (err: any) => err instanceof ForbiddenError && err.status === 403,
    );
  });

  await t.test("Accounts user permissions", () => {
    const accountsUser = { username: "accounts", role: "Accounts" };

    assert.equal(hasPermission(accountsUser.role, "accounting.read"), true);
    assert.equal(hasPermission(accountsUser.role, "accounting.create"), true);
    assert.equal(hasPermission(accountsUser.role, "accounting.update"), true);
    assert.equal(hasPermission(accountsUser.role, "accounting.delete"), true);
    assert.equal(hasPermission(accountsUser.role, "sales.read"), true);

    // Forbidden
    assert.equal(hasPermission(accountsUser.role, "payroll.update"), false);
    assert.equal(hasPermission(accountsUser.role, "users.create"), false);
    assert.equal(hasPermission(accountsUser.role, "users.delete"), false);

    assert.throws(
      () => assertPermission(accountsUser, "users.create"),
      (err: any) => err instanceof ForbiddenError && err.status === 403,
    );
  });

  await t.test("HR user permissions", () => {
    const hrUser = { username: "hr1", role: "HR" };

    assert.equal(hasPermission(hrUser.role, "payroll.read"), true);
    assert.equal(hasPermission(hrUser.role, "payroll.create"), true);
    assert.equal(hasPermission(hrUser.role, "payroll.update"), true);

    // Forbidden
    assert.equal(hasPermission(hrUser.role, "accounting.create"), false);
    assert.equal(hasPermission(hrUser.role, "sales.create"), false);
    assert.equal(hasPermission(hrUser.role, "users.create"), false);
  });

  await t.test("Administrator has full privileged access", () => {
    const adminUser = { username: "operator", role: "Administrator" };

    assert.doesNotThrow(() => assertPermission(adminUser, "sales.create"));
    assert.doesNotThrow(() => assertPermission(adminUser, "accounting.create"));
    assert.doesNotThrow(() => assertPermission(adminUser, "payroll.create"));
    assert.doesNotThrow(() => assertPermission(adminUser, "users.create"));
    assert.doesNotThrow(() => assertPermission(adminUser, "settings.write"));
  });

  await t.test("CRUD collection-to-permission mapping", () => {
    assert.equal(permissionForCrud("sales", "create"), "sales.create");
    assert.equal(permissionForCrud("sales", "list"), "sales.read");
    assert.equal(permissionForCrud("ledger", "create"), "accounting.create");
    assert.equal(permissionForCrud("payroll", "create"), "payroll.create");
    assert.equal(permissionForCrud("appUsers", "remove"), "users.delete");
    assert.equal(permissionForCrud("stockMovements", "create"), "inventory.create");
  });
});

test("SEC-02: Session Secret & Startup Validation", async (t) => {
  await t.test("fails in production when SESSION_SECRET is missing or short", () => {
    assert.throws(
      () => validateSessionSecret(undefined, true),
      /SESSION_SECRET is required in production/,
    );
    assert.throws(
      () => validateSessionSecret("short-secret-12345", true),
      /SESSION_SECRET is required in production/,
    );
  });

  await t.test("accepts strong SESSION_SECRET (>= 32 chars) in production", () => {
    const strongSecret = "a".repeat(32);
    const result = validateSessionSecret(strongSecret, true);
    assert.equal(result, strongSecret);
  });

  await t.test("allows dev fallback secret in development runtime", () => {
    const result = validateSessionSecret(undefined, false);
    assert.ok(result.length >= 32);
  });
});

test("ACC-11: Collision-Safe Document Sequence Numbering", async (t) => {
  await t.test("generates monotonic formatted sequence numbers", async () => {
    resetSequenceCounter("SO", 2026);
    const n1 = await getNextSequence(null, "SO", 2026);
    const n2 = await getNextSequence(null, "SO", 2026);
    const n3 = await getNextSequence(null, "SO", 2026);

    assert.equal(n1, "SO-2026-000001");
    assert.equal(n2, "SO-2026-000002");
    assert.equal(n3, "SO-2026-000003");
  });

  await t.test("concurrent sequence generation produces zero duplicates", async () => {
    resetSequenceCounter("PO", 2026);
    const count = 100;
    const promises = Array.from({ length: count }, () => getNextSequence(null, "PO", 2026));
    const results = await Promise.all(promises);

    const unique = new Set(results);
    assert.equal(
      unique.size,
      count,
      "All concurrently generated PO numbers must be strictly unique",
    );
    assert.ok(results.includes("PO-2026-000001"));
    assert.ok(results.includes("PO-2026-000100"));
  });
});

test("AUD-01: Audit Logging", async (t) => {
  await t.test("logs important mutations with before/after state", async () => {
    clearInMemoryAuditLogs();

    const record = await logAudit(null, {
      userId: "sales1",
      username: "sales1",
      action: "CREATE",
      entityType: "sales",
      entityId: "so-101",
      after: { orderNo: "SO-2026-000001", total: 15000 },
      details: "Created sales order SO-2026-000001",
    });

    assert.ok(record.id.startsWith("aud-"));
    assert.equal(record.action, "CREATE");
    assert.equal(record.entityType, "sales");
    assert.equal(record.userId, "sales1");
    assert.ok(record.timestamp);

    const logs = await getAuditLogs(null, { entityType: "sales" });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].entityId, "so-101");
  });
});
