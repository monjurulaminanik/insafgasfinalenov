import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT, type MessageKey } from "@/i18n";
import { BG_THEMES, useThemeSettings } from "@/lib/theme";
import { useBranding } from "@/lib/branding";
import { fileToFavicon, fileToCompanyLogo } from "@/lib/image-upload";
import {
  APP_MODULES,
  APP_ROLES,
  defaultMatrix,
  type AppModule,
  type AppRole,
} from "@/lib/settings-store";
import {
  getCylinderTrackingFn,
  resetPowerMatrixFn,
  saveCylinderTrackingFn,
  savePowerMatrixFn,
  type CylinderTrackingMethod,
  type PowerMatrix,
} from "@/lib/settings.functions";
import { usePowerMatrix } from "@/hooks/useModuleAccess";
import {
  listAppUsersFn,
  removeAppUserFn,
  upsertAppUserFn,
  type PublicAppUser,
} from "@/lib/users.functions";
import { savePowerMatrix as cachePowerMatrix } from "@/lib/settings-store";
import { cn } from "@/lib/utils";

function matricesEqual(a: PowerMatrix, b: PowerMatrix) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsPage() {
  const t = useT();
  const theme = useThemeSettings();
  const branding = useBranding();
  const qc = useQueryClient();
  const [faviconPreview, setFaviconPreview] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["appUsers"],
    queryFn: () => listAppUsersFn(),
  });
  const { data: serverMatrix, isLoading: matrixLoading } = usePowerMatrix();
  const { data: tracking = "serial" } = useQuery({
    queryKey: ["cylinderTracking"],
    queryFn: () => getCylinderTrackingFn(),
  });
  const saveTracking = useMutation({
    mutationFn: (method: CylinderTrackingMethod) => saveCylinderTrackingFn({ data: { method } }),
    onSuccess: (method) => {
      qc.setQueryData(["cylinderTracking"], method);
      toast.success(t("settings.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [matrix, setMatrix] = useState<PowerMatrix>(() => defaultMatrix());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("Sales");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (serverMatrix) {
      setMatrix(serverMatrix);
      cachePowerMatrix(serverMatrix);
    }
  }, [serverMatrix]);

  const savedBaseline = useMemo(() => serverMatrix ?? defaultMatrix(), [serverMatrix]);
  const dirty = useMemo(() => !matricesEqual(matrix, savedBaseline), [matrix, savedBaseline]);

  const saveMatrix = useMutation({
    mutationFn: () => savePowerMatrixFn({ data: { matrix } }),
    onSuccess: (saved) => {
      setMatrix(saved);
      cachePowerMatrix(saved);
      qc.setQueryData(["powerMatrix"], saved);
      toast.success(t("settings.roleUpdated"));
    },
    onError: (e: Error) => toast.error(e.message || t("error.hint")),
  });

  const resetMatrix = useMutation({
    mutationFn: () => resetPowerMatrixFn(),
    onSuccess: (saved) => {
      setMatrix(saved);
      cachePowerMatrix(saved);
      qc.setQueryData(["powerMatrix"], saved);
      toast.success(t("settings.matrixReset"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => {
    setEditingId(null);
    setUsername("");
    setDisplayName("");
    setPassword("");
    setRole("Sales");
    setActive(true);
  };

  const startEdit = (u: PublicAppUser) => {
    setEditingId(u.id);
    setUsername(u.username);
    setDisplayName(u.displayName);
    setPassword("");
    setRole(u.role);
    setActive(u.active);
  };

  const saveUser = useMutation({
    mutationFn: () =>
      upsertAppUserFn({
        data: {
          id: editingId ?? undefined,
          username,
          displayName,
          role,
          password: password.trim() || undefined,
          active,
        },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["appUsers"], (old: PublicAppUser[] | undefined) => {
        const list = old ?? [];
        const idx = list.findIndex((u) => u.id === saved.id);
        if (idx >= 0) return list.map((u) => (u.id === saved.id ? saved : u));
        return [...list, saved];
      });
      qc.invalidateQueries({ queryKey: ["appUsers"] });
      toast.success(editingId ? t("settings.userUpdated") : t("settings.userAdded"));
      resetForm();
    },
    onError: (e: Error) => {
      const raw = e.message || "Could not save user";
      const cleaned = raw.replace(/^Server Error \(specific \s*\d+\)[:\s]*/i, "").trim();
      toast.error(cleaned || raw);
    },
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => removeAppUserFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appUsers"] });
      toast.success(t("settings.userRemoved"));
      if (editingId) resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAccess = (r: AppRole, mod: AppModule) => {
    if (r === "Administrator") return;
    setMatrix((prev) => {
      const fallback = defaultMatrix()[r];
      const row = prev[r] ?? fallback;
      return {
        ...prev,
        [r]: { ...row, [mod]: !row[mod] },
      };
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("settings.title")} description={t("settings.desc")} />

      <Tabs defaultValue="appearance">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="appearance">{t("settings.tab.appearance")}</TabsTrigger>
          <TabsTrigger value="users">{t("settings.tab.users")}</TabsTrigger>
          <TabsTrigger value="power">{t("settings.tab.power")}</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h3 className="font-display text-base font-semibold">{t("settings.bgTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("settings.bgHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {BG_THEMES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      theme.setBgTheme(item.id);
                      toast.success(t("settings.saved"));
                    }}
                    className={cn(
                      "overflow-hidden rounded-xl border text-left transition",
                      theme.bgTheme === item.id
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className={cn("h-16 bg-gradient-to-br", item.preview)} />
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm font-medium">{t(item.labelKey as MessageKey)}</span>
                      {theme.bgTheme === item.id && <Badge>{t("common.active")}</Badge>}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 md:grid-cols-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">{t("settings.motion")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">{t("settings.motionHint")}</p>
                  </div>
                  <Switch
                    checked={theme.motionEnabled}
                    onCheckedChange={(v) => {
                      theme.setMotionEnabled(v);
                      toast.success(t("settings.saved"));
                    }}
                  />
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label className="text-sm font-semibold">{t("settings.transparent")}</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("settings.transparentHint")}
                    </p>
                  </div>
                  <Switch
                    checked={theme.transparentPanels}
                    onCheckedChange={(v) => {
                      theme.setTransparentPanels(v);
                      toast.success(t("settings.saved"));
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    theme.resetTheme();
                    toast.success(t("settings.saved"));
                  }}
                >
                  {t("settings.reset")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-2">
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      {t("settings.cylTracking")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("settings.cylTrackingHint")}
                    </p>
                  </div>
                  <Select
                    value={tracking}
                    onValueChange={(v) => saveTracking.mutate(v as CylinderTrackingMethod)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quantity">{t("settings.track.quantity")}</SelectItem>
                      <SelectItem value="lot">{t("settings.track.lot")}</SelectItem>
                      <SelectItem value="serial">{t("settings.track.serial")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      {t("settings.favicon")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("settings.faviconHint")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40 p-1.5 shadow-sm">
                      <img
                        src={faviconPreview || branding.favicon}
                        alt="Favicon preview"
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{t("settings.uploadFavicon")}</span>
                        <input
                          type="file"
                          accept=".ico,.png,.svg,.jpg,.jpeg,.webp,image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const dataUrl = await fileToFavicon(file);
                              setFaviconPreview(dataUrl);
                              await branding.setCustomFavicon(dataUrl);
                              toast.success(t("settings.faviconSaved"));
                            } catch (err: any) {
                              toast.error(err.message || "Failed to process favicon");
                            }
                          }}
                        />
                      </label>
                      {branding.customFavicon && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={async () => {
                            setFaviconPreview("");
                            await branding.setCustomFavicon("");
                            toast.success(t("settings.faviconSaved"));
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          {t("settings.removeFavicon")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      {t("settings.logo")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("settings.logoHint")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40 p-1.5 shadow-sm">
                      <img
                        src={logoPreview || branding.logo}
                        alt="Company logo preview"
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-accent hover:text-accent-foreground">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{t("settings.uploadLogo")}</span>
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,.svg,.webp,image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              const dataUrl = await fileToCompanyLogo(file);
                              setLogoPreview(dataUrl);
                              await branding.setCustomLogo(dataUrl);
                              toast.success(t("settings.logoSaved"));
                            } catch (err: any) {
                              toast.error(err.message || "Failed to process logo");
                            }
                          }}
                        />
                      </label>
                      {branding.customLogo && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={async () => {
                            setLogoPreview("");
                            await branding.setCustomLogo("");
                            toast.success(t("settings.logoSaved"));
                          }}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          {t("settings.removeLogo")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold">
                    {editingId ? t("settings.editUser") : t("settings.usersTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("settings.usersHint")}</p>
                </div>
                {editingId && (
                  <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                    <X className="mr-1 h-4 w-4" /> {t("common.cancel")}
                  </Button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t("settings.username")}</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.displayName")}</Label>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("settings.role")}</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APP_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    {t("settings.password")}
                    {editingId ? ` (${t("settings.passwordKeep")})` : ""}
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editingId ? "••••••••" : ""}
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={active} onCheckedChange={setActive} id="user-active" />
                    <Label htmlFor="user-active">
                      {active ? t("common.active") : t("common.inactive")}
                    </Label>
                  </div>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={saveUser.isPending}
                    onClick={() => {
                      if (saveUser.isPending) return;
                      if (!username.trim() || !displayName.trim()) {
                        toast.error(t("common.name"));
                        return;
                      }
                      if (!editingId && !password.trim()) {
                        toast.error(t("settings.passwordRequired"));
                        return;
                      }
                      saveUser.mutate();
                    }}
                  >
                    {editingId ? t("common.save") : t("settings.addUser")}
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.username")}</TableHead>
                      <TableHead>{t("settings.displayName")}</TableHead>
                      <TableHead>{t("settings.role")}</TableHead>
                      <TableHead>{t("common.status")}</TableHead>
                      <TableHead className="text-right">{t("common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          {t("common.loading")}
                        </TableCell>
                      </TableRow>
                    ) : users.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          {t("common.noRecords")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((u) => (
                        <TableRow
                          key={u.id}
                          className={editingId === u.id ? "bg-primary/5" : undefined}
                        >
                          <TableCell className="font-mono text-xs">{u.username}</TableCell>
                          <TableCell className="font-medium">{u.displayName}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.active ? "default" : "outline"}>
                              {u.active ? t("common.active") : t("common.inactive")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 border-primary/40 bg-primary/5 text-primary"
                                onClick={() => startEdit(u)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{t("common.edit")}</span>
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-8 px-2"
                                disabled={u.username === "operator" || removeUser.isPending}
                                onClick={() => {
                                  if (!confirm(t("common.confirmDelete"))) return;
                                  removeUser.mutate(u.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="power" className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-display text-base font-semibold">
                    {t("settings.powerTitle")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t("settings.powerHint")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resetMatrix.isPending || matrixLoading || saveMatrix.isPending}
                    onClick={() => {
                      if (resetMatrix.isPending || saveMatrix.isPending) return;
                      if (!confirm(t("settings.matrixResetConfirm"))) return;
                      resetMatrix.mutate();
                    }}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {t("settings.reset")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!dirty || saveMatrix.isPending || matrixLoading}
                    onClick={() => {
                      if (saveMatrix.isPending || !dirty) return;
                      saveMatrix.mutate();
                    }}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {t("settings.saveMatrix")}
                  </Button>
                </div>
              </div>

              {matrixLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("common.loading")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 z-10 bg-card min-w-36">
                          {t("settings.module")}
                        </TableHead>
                        {APP_ROLES.map((r) => (
                          <TableHead key={r} className="min-w-24 text-center text-[11px]">
                            {r}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {APP_MODULES.map((mod) => (
                        <TableRow key={mod.id}>
                          <TableCell className="sticky left-0 z-10 bg-card font-medium">
                            {mod.label}
                          </TableCell>
                          {APP_ROLES.map((r) => (
                            <TableCell key={r} className="text-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={Boolean(matrix[r]?.[mod.id])}
                                disabled={r === "Administrator"}
                                onChange={() => toggleAccess(r, mod.id)}
                                aria-label={`${r} ${mod.label}`}
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {dirty && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t("settings.matrixDirty")}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
