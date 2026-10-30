import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductImage({
  src,
  alt,
  className,
  size = "md",
}: {
  src?: string;
  alt: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const box =
    size === "sm" ? "h-10 w-10" : size === "lg" ? "h-28 w-28 sm:h-36 sm:w-36" : "h-14 w-14";
  if (!src) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground",
          box,
          className,
        )}
      >
        <Package className={size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={cn("shrink-0 rounded-lg border bg-muted object-cover", box, className)}
    />
  );
}
