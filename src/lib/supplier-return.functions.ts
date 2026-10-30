import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "./session.server";
import { getDb } from "./mongo.server";
import {
  listSupplierReturnsInDb,
  getSupplierReturnByIdInDb,
  createSupplierReturnInDb,
  updateSupplierReturnInDb,
  removeSupplierReturnInDb,
  receiveSupplierReturnDeliveryInDb,
  type CreateSupplierReturnPayload,
  type ReceiveSupplierReturnPayload,
} from "./supplier-return.server";
import type { SupplierReturn } from "@/types";
import { assertPermission } from "./rbac";

export const listSupplierReturnsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SupplierReturn[]> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.read");
    const db = await getDb();
    const list = await listSupplierReturnsInDb(db);
    return JSON.parse(JSON.stringify(list)) as SupplierReturn[];
  },
);

export const getSupplierReturnByIdFn = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<SupplierReturn | null> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.read");
    const db = await getDb();
    const item = await getSupplierReturnByIdInDb(db, data.id);
    return item ? (JSON.parse(JSON.stringify(item)) as SupplierReturn) : null;
  });

export const createSupplierReturnFn = createServerFn({ method: "POST" })
  .validator((d: CreateSupplierReturnPayload) => d)
  .handler(async ({ data }): Promise<SupplierReturn> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.write");
    const db = await getDb();
    const result = await createSupplierReturnInDb(db, data, user);
    return JSON.parse(JSON.stringify(result)) as SupplierReturn;
  });

export const updateSupplierReturnFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; payload: Partial<CreateSupplierReturnPayload> }) => d)
  .handler(async ({ data }): Promise<SupplierReturn> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.write");
    const db = await getDb();
    const result = await updateSupplierReturnInDb(db, data.id, data.payload, user);
    return JSON.parse(JSON.stringify(result)) as SupplierReturn;
  });

export const removeSupplierReturnFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.write");
    const db = await getDb();
    return await removeSupplierReturnInDb(db, data.id, user);
  });

export const receiveSupplierReturnDeliveryFn = createServerFn({ method: "POST" })
  .validator((d: ReceiveSupplierReturnPayload) => d)
  .handler(async ({ data }): Promise<SupplierReturn> => {
    const user = await requireUser();
    assertPermission(user, "suppliers.write");
    const db = await getDb();
    const result = await receiveSupplierReturnDeliveryInDb(db, data, user);
    return JSON.parse(JSON.stringify(result)) as SupplierReturn;
  });
