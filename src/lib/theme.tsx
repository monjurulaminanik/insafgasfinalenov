import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type BgThemeId =
  | "industrial-gas"
  | "mesh-soft"
  | "midnight-plant"
  | "steel-slate"
  | "amber-yard"
  | "clean-minimal";

export type AppThemeSettings = {
  bgTheme: BgThemeId;
  motionEnabled: boolean;
  transparentPanels: boolean;
};

const STORAGE_KEY = "insaf-theme-settings";

export const BG_THEMES: { id: BgThemeId; labelKey: string; preview: string }[] = [
  {
    id: "industrial-gas",
    labelKey: "settings.theme.industrial",
    preview: "from-slate-800 via-cyan-900 to-amber-800",
  },
  {
    id: "mesh-soft",
    labelKey: "settings.theme.mesh",
    preview: "from-slate-100 via-blue-100 to-amber-50",
  },
  {
    id: "midnight-plant",
    labelKey: "settings.theme.midnight",
    preview: "from-slate-950 via-indigo-950 to-slate-900",
  },
  {
    id: "steel-slate",
    labelKey: "settings.theme.steel",
    preview: "from-zinc-200 via-slate-300 to-zinc-100",
  },
  {
    id: "amber-yard",
    labelKey: "settings.theme.amber",
    preview: "from-amber-100 via-orange-50 to-slate-200",
  },
  {
    id: "clean-minimal",
    labelKey: "settings.theme.clean",
    preview: "from-white via-slate-50 to-white",
  },
];

const DEFAULTS: AppThemeSettings = {
  bgTheme: "industrial-gas",
  motionEnabled: true,
  transparentPanels: true,
};

type ThemeContextValue = AppThemeSettings & {
  setBgTheme: (id: BgThemeId) => void;
  setMotionEnabled: (v: boolean) => void;
  setTransparentPanels: (v: boolean) => void;
  resetTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readSettings(): AppThemeSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AppThemeSettings>;
    const bgTheme = BG_THEMES.some((t) => t.id === parsed.bgTheme)
      ? (parsed.bgTheme as BgThemeId)
      : DEFAULTS.bgTheme;
    return {
      bgTheme,
      motionEnabled: parsed.motionEnabled ?? DEFAULTS.motionEnabled,
      transparentPanels: parsed.transparentPanels ?? DEFAULTS.transparentPanels,
    };
  } catch {
    return DEFAULTS;
  }
}

function applyDom(settings: AppThemeSettings) {
  const root = document.documentElement;
  root.dataset.bgTheme = settings.bgTheme;
  root.dataset.motion = settings.motionEnabled ? "on" : "off";
  root.dataset.panels = settings.transparentPanels ? "glass" : "solid";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppThemeSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readSettings();
    setSettings(next);
    applyDom(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applyDom(settings);
  }, [settings, ready]);

  const setBgTheme = useCallback((bgTheme: BgThemeId) => {
    setSettings((s) => ({ ...s, bgTheme }));
  }, []);

  const setMotionEnabled = useCallback((motionEnabled: boolean) => {
    setSettings((s) => ({ ...s, motionEnabled }));
  }, []);

  const setTransparentPanels = useCallback((transparentPanels: boolean) => {
    setSettings((s) => ({ ...s, transparentPanels }));
  }, []);

  const resetTheme = useCallback(() => setSettings(DEFAULTS), []);

  const value = useMemo(
    () => ({ ...settings, setBgTheme, setMotionEnabled, setTransparentPanels, resetTheme }),
    [settings, setBgTheme, setMotionEnabled, setTransparentPanels, resetTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeSettings() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeSettings must be used within ThemeProvider");
  return ctx;
}
