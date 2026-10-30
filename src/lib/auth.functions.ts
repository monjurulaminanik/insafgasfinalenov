import { createServerFn } from "@tanstack/react-start";
import { getAuthCredentials, isDemoLoginEnabled, useAppSession } from "./session.server";
import type { AuthUser } from "@/types";

export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: AuthUser } | null> => {
    const session = await useAppSession();
    return session.data.user ? { user: session.data.user } : null;
  },
);

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; password: string }) => d)
  .handler(
    async ({ data }): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> => {
      const username = data.username.trim().toLowerCase();
      const password = data.password;

      // Prefer app user directory (editable from Settings).
      try {
        const { findUserByCredentials } = await import("./users.server");
        const found = await findUserByCredentials(username, password);
        if (found) {
          const user: AuthUser = {
            username: found.username,
            displayName: found.displayName,
            role: found.role,
          };
          const session = await useAppSession();
          await session.update({ user });
          return { ok: true, user };
        }
      } catch {
        // Fall through to env credentials if Mongo is unavailable.
      }

      // Env fallback for bootstrap / emergency access (no silent production defaults).
      const creds = getAuthCredentials();
      if (creds && username === creds.username.toLowerCase() && password === creds.password) {
        const user: AuthUser = {
          username: creds.username,
          displayName: creds.displayName,
          role: "Administrator",
        };
        const session = await useAppSession();
        await session.update({ user });
        return { ok: true, user };
      }

      return { ok: false, error: "Invalid username or password" };
    },
  );

export const demoLoginEnabledFn = createServerFn({ method: "GET" }).handler(async () => {
  return { enabled: isDemoLoginEnabled() };
});

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useAppSession();
  await session.clear();
  return { ok: true as const };
});
