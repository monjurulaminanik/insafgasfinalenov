import {
  getReturnsFn,
  getReturnByIdFn,
  getDeliveryReturnSummaryFn,
  processReturnFn,
} from "@/lib/returns.functions";
import type { ProcessReturnPayload, DeliveryReturnSummary } from "@/lib/returns.server";
import type { ReturnRecord } from "@/types";

export const returnService = {
  list: async (classification?: "gas" | "cylinder" | "product"): Promise<ReturnRecord[]> => {
    return (await getReturnsFn({ data: { classification } })) as ReturnRecord[];
  },
  get: async (id: string): Promise<ReturnRecord | null> => {
    return (await getReturnByIdFn({ data: { id } })) as ReturnRecord | null;
  },
  getDeliverySummary: async (deliveryId: string): Promise<DeliveryReturnSummary> => {
    return (await getDeliveryReturnSummaryFn({ data: { deliveryId } })) as DeliveryReturnSummary;
  },
  processReturn: async (payload: ProcessReturnPayload): Promise<ReturnRecord> => {
    return (await processReturnFn({ data: payload })) as ReturnRecord;
  },
};
