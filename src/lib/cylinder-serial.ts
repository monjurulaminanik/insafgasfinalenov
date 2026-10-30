import type { CylinderTrackingMethod } from "./settings.functions";

export function normalizeSerialKey(serial: string | undefined | null): string {
  return String(serial || "")
    .trim()
    .toLowerCase();
}

export function trackingEnforcesSerialUnique(method: CylinderTrackingMethod): boolean {
  return method === "serial";
}
