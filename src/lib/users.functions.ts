import { createServerFn } from "@tanstack/react-start";
import type { AppRole } from "./settings-store";
import type { PublicAppUser } from "./users.types";
import { assertPermission } from "./rbac";

export type { AppUserDoc, PublicAppUser } from "./users.types";

export const listAppUsersFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<PublicAppUser[]> => {
    const { requireUser } = await import("./session.server");
    const { listAppUsers } = await import("./users.server");
    const user = await requireUser();
    assertPermission(user, "users.read");
    return listAppUsers();
  },
);

export const listLoginDirectoryFn = createServerFn({ method: "GET" }).handler(async () => {
  const { requireUser } = await import("./session.server");
  const { listLoginDirectory } = await import("./users.server");
  const user = await requireUser();
  assertPermission(user, "users.read");
  return listLoginDirectory();
});

export const upsertAppUserFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id?: string;
      username: string;
      displayName: string;
      role: AppRole;
      password?: string;
      active?: boolean;
    }) => d,
  )
  .handler(async ({ data }): Promise<PublicAppUser> => {
    const { requireUser } = await import("./session.server");
    const { upsertAppUser } = await import("./users.server");
    const { logAudit } = await import("./audit");
    const { getDb } = await import("./mongo.server");
    const user = await requireUser();
    assertPermission(user, data.id ? "users.update" : "users.create");

    try {
      const res = await upsertAppUser(data);
      try {
        const db = await getDb();
        await logAudit(db, {
          userId: user.username,
          username: user.username,
          action: data.id ? "UPDATE" : "CREATE",
          entityType: "users",
          entityId: res.id,
          after: { id: res.id, username: res.username, role: res.role, active: res.active },
          details: `${data.id ? "Updated" : "Created"} user ${res.username} (${res.role})`,
        });
      } catch {}
      return res;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not save user");
    }
  });

export const removeAppUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { removeAppUser } = await import("./users.server");
    const { logAudit } = await import("./audit");
    const { getDb } = await import("./mongo.server");
    const user = await requireUser();
    assertPermission(user, "users.delete");

    const res = await removeAppUser(data.id);
    try {
      const db = await getDb();
      await logAudit(db, {
        userId: user.username,
        username: user.username,
        action: "DELETE",
        entityType: "users",
        entityId: data.id,
        details: `Deleted user ${data.id}`,
      });
    } catch {}
    return res;
  });
