import {
  listSupplierReturnsFn,
  getSupplierReturnByIdFn,
  createSupplierReturnFn,
  updateSupplierReturnFn,
  removeSupplierReturnFn,
  receiveSupplierReturnDeliveryFn,
} from "@/lib/supplier-return.functions";
import type {
  CreateSupplierReturnPayload,
  ReceiveSupplierReturnPayload,
} from "@/lib/supplier-return.server";
import type { SupplierReturn } from "@/types";

export const supplierReturnService = {
  list: async (): Promise<SupplierReturn[]> => {
    return (await listSupplierReturnsFn()) as SupplierReturn[];
  },
  get: async (id: string): Promise<SupplierReturn | null> => {
    return (await getSupplierReturnByIdFn({ data: { id } })) as SupplierReturn | null;
  },
  create: async (payload: CreateSupplierReturnPayload): Promise<SupplierReturn> => {
    return (await createSupplierReturnFn({ data: payload })) as SupplierReturn;
  },
  update: async (
    id: string,
    payload: Partial<CreateSupplierReturnPayload>,
  ): Promise<SupplierReturn> => {
    return (await updateSupplierReturnFn({ data: { id, payload } })) as SupplierReturn;
  },
  remove: async (id: string): Promise<{ ok: true }> => {
    return (await removeSupplierReturnFn({ data: { id } })) as { ok: true };
  },
  receiveDelivery: async (payload: ReceiveSupplierReturnPayload): Promise<SupplierReturn> => {
    return (await receiveSupplierReturnDeliveryFn({ data: payload })) as SupplierReturn;
  },
};
