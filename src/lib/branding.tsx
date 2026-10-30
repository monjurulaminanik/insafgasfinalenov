import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBrandingFn, saveBrandingFn, type AppBranding } from "@/lib/settings.functions";

const STORAGE_FAVICON_KEY = "insaf-custom-favicon";
const STORAGE_LOGO_KEY = "insaf-custom-logo";

const DEFAULT_FAVICON = "/api/branding/favicon";
const DEFAULT_LOGO = "/api/branding/logo";

export type BrandingContextValue = {
  favicon: string;
  logo: string;
  customFavicon: string;
  customLogo: string;
  isLoading: boolean;
  isSaving: boolean;
  setCustomFavicon: (favicon: string) => Promise<void>;
  setCustomLogo: (logo: string) => Promise<void>;
  saveBranding: (branding: { favicon?: string; logo?: string }) => Promise<void>;
};

const BrandingContext = createContext<BrandingContextValue | null>(null);

function readLocalBranding() {
  if (typeof window === "undefined") return { favicon: "", logo: "" };
  try {
    const favicon = localStorage.getItem(STORAGE_FAVICON_KEY) || "";
    const logo = localStorage.getItem(STORAGE_LOGO_KEY) || "";
    return { favicon, logo };
  } catch {
    return { favicon: "", logo: "" };
  }
}

function applyFaviconToDom(faviconUrl: string) {
  if (typeof document === "undefined") return;
  const href = faviconUrl || DEFAULT_FAVICON;

  // Remove existing links to force browser refresh
  const existingIcons = document.querySelectorAll<HTMLLinkElement>(
    "link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='shortcut icon']",
  );
  existingIcons.forEach((el) => el.remove());

  const newIcon = document.createElement("link");
  newIcon.rel = "icon";
  newIcon.href = href;
  document.head.appendChild(newIcon);

  const newApple = document.createElement("link");
  newApple.rel = "apple-touch-icon";
  newApple.href = href;
  document.head.appendChild(newApple);
}

function applyOgToDom(logoUrl: string) {
  if (typeof document === "undefined") return;
  const href = logoUrl
    ? logoUrl.startsWith("data:")
      ? `${window.location.origin}/api/branding/og-image?t=${Date.now()}`
      : logoUrl
    : `${window.location.origin}/api/branding/og-image`;

  const ogImg = document.querySelector<HTMLMetaElement>("meta[property='og:image']");
  if (ogImg) ogImg.content = href;

  const ogSecImg = document.querySelector<HTMLMetaElement>("meta[property='og:image:secure_url']");
  if (ogSecImg) ogSecImg.content = href;

  const twImg = document.querySelector<HTMLMetaElement>("meta[name='twitter:image']");
  if (twImg) twImg.content = href;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState(() => readLocalBranding());

  const { data: serverBranding, isLoading } = useQuery({
    queryKey: ["branding"],
    queryFn: () => getBrandingFn(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Apply initial cached branding immediately to avoid flashing
  useEffect(() => {
    const initial = readLocalBranding();
    if (initial.favicon) applyFaviconToDom(initial.favicon);
    if (initial.logo) applyOgToDom(initial.logo);
  }, []);

  // Sync server branding with local storage and DOM without wiping existing valid values
  useEffect(() => {
    if (serverBranding) {
      setLocal((prev) => {
        const nextFavicon =
          typeof serverBranding.favicon === "string" && serverBranding.favicon
            ? serverBranding.favicon
            : prev.favicon;
        const nextLogo =
          typeof serverBranding.logo === "string" && serverBranding.logo
            ? serverBranding.logo
            : prev.logo;

        try {
          if (nextFavicon) localStorage.setItem(STORAGE_FAVICON_KEY, nextFavicon);
          else if (serverBranding.favicon === "") localStorage.removeItem(STORAGE_FAVICON_KEY);

          if (nextLogo) localStorage.setItem(STORAGE_LOGO_KEY, nextLogo);
          else if (serverBranding.logo === "") localStorage.removeItem(STORAGE_LOGO_KEY);
        } catch {}

        if (nextFavicon) applyFaviconToDom(nextFavicon);
        if (nextLogo) applyOgToDom(nextLogo);

        return { favicon: nextFavicon || "", logo: nextLogo || "" };
      });
    }
  }, [serverBranding]);

  const saveMutation = useMutation({
    mutationFn: (data: { favicon?: string; logo?: string }) => saveBrandingFn({ data }),
    onSuccess: (saved: AppBranding) => {
      setLocal((prev) => {
        const nextFavicon = saved.favicon !== undefined ? (saved.favicon ?? "") : prev.favicon;
        const nextLogo = saved.logo !== undefined ? (saved.logo ?? "") : prev.logo;

        try {
          if (nextFavicon) localStorage.setItem(STORAGE_FAVICON_KEY, nextFavicon);
          else localStorage.removeItem(STORAGE_FAVICON_KEY);

          if (nextLogo) localStorage.setItem(STORAGE_LOGO_KEY, nextLogo);
          else localStorage.removeItem(STORAGE_LOGO_KEY);
        } catch {}

        if (nextFavicon) applyFaviconToDom(nextFavicon);
        if (nextLogo) applyOgToDom(nextLogo);
        return { favicon: nextFavicon, logo: nextLogo };
      });
      qc.setQueryData(["branding"], saved);
    },
  });

  const saveBranding = useCallback(
    async (branding: { favicon?: string; logo?: string }) => {
      setLocal((prev) => {
        const nextFavicon = branding.favicon !== undefined ? branding.favicon : prev.favicon;
        const nextLogo = branding.logo !== undefined ? branding.logo : prev.logo;
        try {
          if (nextFavicon) localStorage.setItem(STORAGE_FAVICON_KEY, nextFavicon);
          if (nextLogo) localStorage.setItem(STORAGE_LOGO_KEY, nextLogo);
        } catch {}
        if (nextFavicon) applyFaviconToDom(nextFavicon);
        if (nextLogo) applyOgToDom(nextLogo);
        return { favicon: nextFavicon || "", logo: nextLogo || "" };
      });
      await saveMutation.mutateAsync(branding);
    },
    [saveMutation],
  );

  const setCustomFavicon = useCallback(
    async (favicon: string) => {
      await saveBranding({ favicon });
    },
    [saveBranding],
  );

  const setCustomLogo = useCallback(
    async (logo: string) => {
      await saveBranding({ logo });
    },
    [saveBranding],
  );

  const value = useMemo<BrandingContextValue>(
    () => ({
      favicon: local.favicon || local.logo || DEFAULT_FAVICON,
      logo: local.logo || DEFAULT_LOGO,
      customFavicon: local.favicon,
      customLogo: local.logo,
      isLoading,
      isSaving: saveMutation.isPending,
      setCustomFavicon,
      setCustomLogo,
      saveBranding,
    }),
    [local, isLoading, saveMutation.isPending, setCustomFavicon, setCustomLogo, saveBranding],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    const local = readLocalBranding();
    return {
      favicon: local.favicon || local.logo || DEFAULT_FAVICON,
      logo: local.logo || DEFAULT_LOGO,
      customFavicon: local.favicon,
      customLogo: local.logo,
      isLoading: false,
      isSaving: false,
      setCustomFavicon: async () => {},
      setCustomLogo: async () => {},
      saveBranding: async () => {},
    };
  }
  return ctx;
}
