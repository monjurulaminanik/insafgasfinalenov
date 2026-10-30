import { getDb } from "./mongo.server";
import {
  APP_MODULES,
  APP_ROLES,
  closedMatrix,
  type AppModule,
  type AppRole,
  type PowerMatrix,
} from "./settings-store";

export type { PowerMatrix };

const DOC_ID = "power-matrix";

function sanitizeMatrix(raw: unknown): PowerMatrix {
  const base = closedMatrix();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, Record<string, boolean>>;
  for (const role of APP_ROLES) {
    const row = input[role];
    base[role] = Object.fromEntries(APP_MODULES.map((m) => [m.id, Boolean(row?.[m.id])])) as Record<
      AppModule,
      boolean
    >;
    if (role === "Administrator") {
      base[role] = Object.fromEntries(APP_MODULES.map((m) => [m.id, true])) as Record<
        AppModule,
        boolean
      >;
    }
  }
  return base;
}

let settingsIndexCreated = false;
async function ensureSettingsColl() {
  const db = await getDb();
  const coll = db.collection("appSettings");
  if (!settingsIndexCreated) {
    try {
      await coll.createIndex({ id: 1 }, { unique: true });
      settingsIndexCreated = true;
    } catch {}
  }
  return coll;
}

export async function getPowerMatrix(): Promise<PowerMatrix> {
  const coll = await ensureSettingsColl();
  const doc = await coll.findOne({ id: DOC_ID });
  if (!doc?.matrix) return closedMatrix();
  return sanitizeMatrix(doc.matrix);
}

export async function savePowerMatrixDoc(matrix: PowerMatrix): Promise<PowerMatrix> {
  const sanitized = sanitizeMatrix(matrix);
  const coll = await ensureSettingsColl();
  await coll.updateOne(
    { id: DOC_ID },
    {
      $set: {
        id: DOC_ID,
        matrix: sanitized,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  return sanitized;
}

export type CylinderTrackingMethod = "quantity" | "lot" | "serial";
const TRACK_ID = "cylinder-tracking";

export async function getCylinderTracking(): Promise<CylinderTrackingMethod> {
  try {
    const coll = await ensureSettingsColl();
    const doc = await coll.findOne({ id: TRACK_ID });
    const method = doc?.method;
    if (method === "quantity" || method === "lot" || method === "serial") return method;
  } catch {}
  return "serial";
}

export async function saveCylinderTracking(
  method: CylinderTrackingMethod,
): Promise<CylinderTrackingMethod> {
  const next = method === "quantity" || method === "lot" || method === "serial" ? method : "serial";
  const coll = await ensureSettingsColl();
  await coll.updateOne(
    { id: TRACK_ID },
    { $set: { id: TRACK_ID, method: next, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
  return next;
}

export async function roleCanAccess(
  role: string | undefined,
  moduleId: AppModule,
): Promise<boolean> {
  if (!role) return false;
  if (role === "Administrator") return true;
  if (!APP_ROLES.includes(role as AppRole)) return false;
  const matrix = await getPowerMatrix();
  return Boolean(matrix[role as AppRole]?.[moduleId]);
}

export interface AppBranding {
  favicon?: string;
  logo?: string;
  updatedAt?: string;
}

const BRANDING_ID = "branding";

export async function getBranding(): Promise<AppBranding> {
  try {
    const coll = await ensureSettingsColl();
    const doc = await coll.findOne({ id: BRANDING_ID });
    if (doc) {
      return {
        favicon: typeof doc.favicon === "string" ? doc.favicon : undefined,
        logo: typeof doc.logo === "string" ? doc.logo : undefined,
        updatedAt: doc.updatedAt,
      };
    }
  } catch {}
  return {};
}

export async function saveBranding(branding: {
  favicon?: string;
  logo?: string;
}): Promise<AppBranding> {
  const coll = await ensureSettingsColl();
  const updateData: Record<string, any> = {
    id: BRANDING_ID,
    updatedAt: new Date().toISOString(),
  };
  if ("favicon" in branding) updateData.favicon = branding.favicon ?? "";
  if ("logo" in branding) updateData.logo = branding.logo ?? "";

  await coll.updateOne(
    { id: BRANDING_ID },
    { $set: updateData },
    { upsert: true },
  );
  return getBranding();
}

