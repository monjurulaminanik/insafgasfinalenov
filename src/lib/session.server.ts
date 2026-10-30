import { useSession } from "@tanstack/react-start/server";
import type { AuthUser } from "@/types";

type SessionData = {
  user?: AuthUser;
};

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

/** On-screen demo roles and the operator/insaf123 fallback. Off unless explicitly enabled. */
export function isDemoLoginEnabled() {
  return process.env.DEMO_LOGIN === "true";
}

export function validateSessionSecret(secret: string | undefined, isProd: boolean): string {
  if (secret && secret.length >= 32) return secret;
  if (isProd) {
    throw new Error(
      "SESSION_SECRET is required in production and must be at least 32 characters long.",
    );
  }
  return "insaf-gas-corp-dev-session-secret-32chars";
}

export function sessionPassword() {
  return validateSessionSecret(process.env.SESSION_SECRET, isProductionRuntime());
}

export function useAppSession() {
  return useSession<SessionData>({
    name: "insaf-session",
    password: sessionPassword(),
    maxAge: 60 * 60 * 24 * 7,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  });
}

export async function requireUser(): Promise<AuthUser> {
  const session = await useAppSession();
  const user = session.data.user;
  if (!user) throw new Error("Unauthorized");
  return user;
}

/** Explicit AUTH_* only. Production never falls back to operator/insaf123. */
export function getAuthCredentials(): {
  username: string;
  password: string;
  displayName: string;
} | null {
  const username = process.env.AUTH_USER?.trim();
  const password = process.env.AUTH_PASSWORD;
  if (username && password) {
    return {
      username,
      password,
      displayName: process.env.AUTH_DISPLAY_NAME?.trim() || "Operator",
    };
  }
  if (isDemoLoginEnabled()) {
    return {
      username: "operator",
      password: "insaf123",
      displayName: process.env.AUTH_DISPLAY_NAME?.trim() || "Operator",
    };
  }
  return null;
}
