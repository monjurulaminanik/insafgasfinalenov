import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SupplierReturnForm } from "@/components/supplier-return/SupplierReturnForm";

const searchSchema = z.object({
  purchaseId: z.string().optional(),
});

export const Route = createFileRoute("/suppliers/returns/new")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "New Suppliers Return · Insaf Gas Corp" }] }),
  component: NewSupplierReturnPage,
});

function NewSupplierReturnPage() {
  const search = Route.useSearch();
  return <SupplierReturnForm purchaseId={search.purchaseId} />;
}

