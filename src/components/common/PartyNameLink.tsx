import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type Props = {
  kind: "customer" | "supplier" | "employee";
  id: string;
  name: string;
  className?: string;
};

export function PartyNameLink({ kind, id, name, className }: Props) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  const classNames = cn("font-medium text-primary hover:underline underline-offset-2", className);
  if (kind === "customer") {
    return (
      <Link to="/customers/$id/statement" params={{ id }} onClick={stop} className={classNames}>
        {name}
      </Link>
    );
  }
  if (kind === "supplier") {
    return (
      <Link to="/suppliers/$id/statement" params={{ id }} onClick={stop} className={classNames}>
        {name}
      </Link>
    );
  }
  return (
    <Link to="/hr/$id/statement" params={{ id }} onClick={stop} className={classNames}>
      {name}
    </Link>
  );
}
