const BDT = "৳";
export const formatCurrency = (n: number) =>
  `${BDT}${new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(Math.round(n || 0))}`;

export const formatNumber = (n: number) => new Intl.NumberFormat("en-BD").format(n);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const formatOpenedOn = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\b(am|pm)\b/gi, (m) => m.toUpperCase());
};

export const formatCompactCurrency = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "৳0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}৳${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}৳${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${sign}৳${(abs / 1_000).toFixed(0)}k`;
  }
  return `${sign}৳${Math.round(abs)}`;
};
