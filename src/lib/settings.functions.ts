import { createServerFn } from "@tanstack/react-start";
import type { PowerMatrix } from "./settings-store";

export type { PowerMatrix };
export type CylinderTrackingMethod = "quantity" | "lot" | "serial";

export const getCylinderTrackingFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<CylinderTrackingMethod> => {
    const { requireUser } = await import("./session.server");
    const { getCylinderTracking } = await import("./settings.server");
    await requireUser();
    return getCylinderTracking();
  },
);

export const saveCylinderTrackingFn = createServerFn({ method: "POST" })
  .inputValidator((d: { method: CylinderTrackingMethod }) => d)
  .handler(async ({ data }): Promise<CylinderTrackingMethod> => {
    const { requireUser } = await import("./session.server");
    const { saveCylinderTracking, roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
    if (!allowed) throw new Error("Not allowed to update settings");
    return saveCylinderTracking(data.method);
  });

export const getPowerMatrixFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<PowerMatrix> => {
    const { requireUser } = await import("./session.server");
    const { getPowerMatrix } = await import("./settings.server");
    await requireUser();
    return getPowerMatrix();
  },
);

export const savePowerMatrixFn = createServerFn({ method: "POST" })
  .inputValidator((d: { matrix: PowerMatrix }) => d)
  .handler(async ({ data }): Promise<PowerMatrix> => {
    const { requireUser } = await import("./session.server");
    const { savePowerMatrixDoc, roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
    if (!allowed) throw new Error("Not allowed to update permissions");
    try {
      return await savePowerMatrixDoc(data.matrix);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not save Power Separator");
    }
  });

export const resetPowerMatrixFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<PowerMatrix> => {
    const { requireUser } = await import("./session.server");
    const { savePowerMatrixDoc } = await import("./settings.server");
    const { defaultMatrix } = await import("./settings-store");
    const user = await requireUser();
    if (user.role !== "Administrator") throw new Error("Only Administrator can reset permissions");
    return savePowerMatrixDoc(defaultMatrix());
  },
);

export interface AppBranding {
  favicon?: string;
  logo?: string;
}

export const getBrandingFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<AppBranding> => {
    const { getBranding } = await import("./settings.server");
    return getBranding();
  },
);

export const saveBrandingFn = createServerFn({ method: "POST" })
  .inputValidator((d: { favicon?: string; logo?: string }) => d)
  .handler(async ({ data }): Promise<AppBranding> => {
    const { requireUser } = await import("./session.server");
    const { saveBranding, roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    const allowed = user.role === "Administrator" || (await roleCanAccess(user.role, "settings"));
    if (!allowed) throw new Error("Not allowed to update settings");
    return saveBranding(data);
  });

