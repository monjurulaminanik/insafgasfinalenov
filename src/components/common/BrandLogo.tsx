import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/branding";

type BrandLogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  alt?: string;
};

const SIZE_CLASS: Record<NonNullable<BrandLogoProps["size"]>, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-16 w-16",
};

export function BrandLogo({ className, size = "md", alt = "Insaf Gas Corp" }: BrandLogoProps) {
  const { logo } = useBranding();
  return (
    <img
      src={logo || "/api/branding/logo"}
      alt={alt}
      draggable={false}
      onError={(e) => {
        const target = e.currentTarget;
        if (!target.src.includes("/favicon.png")) {
          target.src = "/favicon.png?v=4";
        }
      }}
      className={cn("shrink-0 rounded-md object-contain", SIZE_CLASS[size], className)}
    />
  );
}

