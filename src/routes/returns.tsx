import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReturnListPage } from "@/components/returns/ReturnListPage";

const returnsSearchSchema = z.object({
  tab: z.enum(["gas", "cylinder", "product"]).optional().catch("gas"),
});

export const Route = createFileRoute("/returns")({
  validateSearch: (search) => returnsSearchSchema.parse(search),
  head: () => ({ meta: [{ title: "Returns Management · Insaf Gas Corp" }] }),
  component: ReturnListPage,
});
