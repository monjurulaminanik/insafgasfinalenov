import type { AppRole } from "./settings-store";

export type AppUserDoc = {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: AppRole;
  active: boolean;
  createdAt: string;
};

export type PublicAppUser = Omit<AppUserDoc, "password"> & { hasPassword: boolean };
