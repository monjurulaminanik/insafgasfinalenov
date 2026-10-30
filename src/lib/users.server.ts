import { getDb } from "./mongo.server";
import { isDemoLoginEnabled } from "./session.server";
import { seedAppUsers } from "./seed-data";
import { APP_ROLES, type AppRole } from "./settings-store";
import type { AppUserDoc, PublicAppUser } from "./users.types";
import { hashPassword, isHashedPassword, verifyPassword } from "./password.server";

export type { AppUserDoc, PublicAppUser } from "./users.types";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

async function ensureUsers() {
  const db = await getDb();
  const coll = db.collection("appUsers");
  try {
    await coll.createIndex({ id: 1 }, { unique: true });
  } catch {}
  try {
    await coll.createIndex({ username: 1 }, { unique: true });
  } catch {}
  const count = await coll.estimatedDocumentCount();
  if (count === 0 && isDemoLoginEnabled()) {
    try {
      await coll.insertMany(
        seedAppUsers.map((u) => ({
          ...u,
          password: isHashedPassword(u.password) ? u.password : hashPassword(u.password),
        })),
        { ordered: false },
      );
    } catch {}
  }
}

function toPublic(u: AppUserDoc | null | undefined): PublicAppUser {
  if (!u) throw new Error("User not found");
  return {
    id: String(u.id),
    username: String(u.username),
    displayName: String(u.displayName),
    role: u.role,
    active: Boolean(u.active),
    createdAt: String(u.createdAt || ""),
    hasPassword: Boolean(u.password),
  };
}

function mongoErrorMessage(e: unknown) {
  const err = e as { code?: number; message?: string };
  if (err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "")) {
    return "Username already exists";
  }
  if (e instanceof Error && e.message) return e.message;
  return "Could not save user";
}

export async function findUserByCredentials(
  username: string,
  password: string,
): Promise<AppUserDoc | null> {
  await ensureUsers();
  const db = await getDb();
  const doc = await db.collection("appUsers").findOne({
    username: username.trim().toLowerCase(),
    active: true,
  });
  if (!doc) return null;
  const user = clean<AppUserDoc>(doc);
  if (isHashedPassword(user.password)) {
    if (!verifyPassword(password, user.password)) return null;
    return user;
  }
  // One-time upgrade of a legacy plaintext row. Never log the secret.
  if (!user.password || user.password !== password) return null;
  const hashed = hashPassword(password);
  await db.collection("appUsers").updateOne({ id: user.id }, { $set: { password: hashed } });
  return { ...user, password: hashed };
}

export async function listLoginDirectory(): Promise<
  Array<{
    username: string;
    displayName: string;
    role: AppRole;
  }>
> {
  await ensureUsers();
  const db = await getDb();
  const docs = await db.collection("appUsers").find({ active: true }).sort({ role: 1 }).toArray();
  return docs.map((d) => {
    const u = clean<AppUserDoc>(d);
    return { username: u.username, displayName: u.displayName, role: u.role };
  });
}

export async function listAppUsers(): Promise<PublicAppUser[]> {
  await ensureUsers();
  const db = await getDb();
  const docs = await db.collection("appUsers").find({}).sort({ createdAt: 1 }).toArray();
  return docs.map((d) => toPublic(clean<AppUserDoc>(d)));
}

export async function upsertAppUser(data: {
  id?: string;
  username: string;
  displayName: string;
  role: AppRole;
  password?: string;
  active?: boolean;
}): Promise<PublicAppUser> {
  try {
    await ensureUsers();
    const db = await getDb();
    const username = data.username.trim().toLowerCase();
    if (!username || !data.displayName.trim())
      throw new Error("Username and display name required");
    if (!APP_ROLES.includes(data.role)) throw new Error("Invalid role");

    if (data.id) {
      const existing = await db.collection("appUsers").findOne({ id: data.id });
      if (!existing) throw new Error("User not found");
      const clash = await db.collection("appUsers").findOne({ username, id: { $ne: data.id } });
      if (clash) throw new Error("Username already exists");
      const patch: Record<string, unknown> = {
        username,
        displayName: data.displayName.trim(),
        role: data.role,
        active: data.active ?? existing.active ?? true,
      };
      if (data.password && data.password.trim())
        patch.password = hashPassword(data.password.trim());
      await db.collection("appUsers").updateOne({ id: data.id }, { $set: patch });
      const doc = await db.collection("appUsers").findOne({ id: data.id });
      return toPublic(clean<AppUserDoc>(doc));
    }

    const clash = await db.collection("appUsers").findOne({ username });
    if (clash) throw new Error("Username already exists");
    if (!data.password?.trim()) throw new Error("Password required");
    const id = Math.random().toString(36).slice(2, 10);
    const doc: AppUserDoc = {
      id,
      username,
      password: hashPassword(data.password.trim()),
      displayName: data.displayName.trim(),
      role: data.role,
      active: data.active ?? true,
      createdAt: new Date().toISOString(),
    };
    await db.collection("appUsers").insertOne({ ...doc });
    const saved = await db.collection("appUsers").findOne({ id });
    return toPublic(clean<AppUserDoc>(saved));
  } catch (e) {
    throw new Error(mongoErrorMessage(e));
  }
}

export async function removeAppUser(id: string) {
  await ensureUsers();
  const db = await getDb();
  const existing = await db.collection("appUsers").findOne({ id });
  if (!existing) throw new Error("User not found");
  if (clean<AppUserDoc>(existing).username === "operator") {
    throw new Error("Cannot delete the primary operator account");
  }
  await db.collection("appUsers").deleteOne({ id });
  return { ok: true as const };
}
