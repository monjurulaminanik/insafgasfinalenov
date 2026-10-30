import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt";

export function hashPassword(plain: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 32).toString("hex");
  return `${PREFIX}$${salt}$${hash}`;
}

export function isHashedPassword(stored: string | undefined | null): boolean {
  return Boolean(stored && stored.startsWith(`${PREFIX}$`));
}

export function verifyPassword(plain: string, stored: string) {
  if (!plain || !isHashedPassword(stored)) return false;
  const parts = stored.split("$");
  const salt = parts[1];
  const hash = parts[2];
  if (!salt || !hash) return false;
  const next = scryptSync(plain, salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}
