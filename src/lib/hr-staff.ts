import type { Employee } from "@/types";

export const DELIVERY_MAN = "Deliveryman";

export const DESIGNATION_PRESETS = [
  "Deliveryman",
  "Delivery Man",
  "Driver",
  "Manager",
  "Accounts Officer",
  "Warehouse Supervisor",
];

export function isDeliveryStaff(e: Pick<Employee, "designation" | "department" | "status">) {
  if (e.status && e.status !== "active") return false;
  const des = (e.designation || "").toLowerCase().replace(/\s+/g, "");
  const dept = (e.department || "").toLowerCase();
  return des === "deliveryman" || des === "driver" || dept === "delivery";
}

export function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}
