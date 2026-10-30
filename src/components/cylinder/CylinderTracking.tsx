import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { cylinderService } from "@/services/cylinder.service";
import { customerService } from "@/services/customer.service";
import { productService } from "@/services/product.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { formatDateTime } from "@/utils/formatters";
import type { CylinderMovementType } from "@/types";
import { useT } from "@/i18n";

const types: CylinderMovementType[] = [
  "received",
  "issued",
  "returned",
  "refilled",
  "transferred",
  "damaged",
  "lost",
];

export function CylinderTracking({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const {
    data: cylinder,
    isLoading,
    isFetched,
  } = useQuery({
    queryKey: ["cylinders", id],
    queryFn: () => cylinderService.get(id),
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["cylinders", id, "movements"],
    queryFn: () => cylinderService.getMovements(id),
    enabled: !!cylinder,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: customerService.list,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: productService.list,
  });

  const [type, setType] = useState<CylinderMovementType>("issued");
  const [toLocation, setToLocation] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");

  const addMv = useMutation({
    mutationFn: () => {
      if (type === "issued" && !customerId) throw new Error(t("common.select"));
      return cylinderService.addMovement({
        cylinderId: id,
        type,
        fromLocation: cylinder?.location,
        toLocation: toLocation || undefined,
        customerId: customerId || undefined,
        notes,
        by: "Operator",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["cylinders", id] });
      qc.invalidateQueries({ queryKey: ["cylinders", id, "movements"] });
      toast.success(t("cylinders.recorded"));
      setToLocation("");
      setCustomerId("");
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading)
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  if (isFetched && !cylinder)
    return <div className="p-6 text-sm text-destructive">{t("cylinders.notFound")}</div>;
  if (!cylinder) return null;
  const gasCategory =
    cylinder.gasCategory || products.find((p) => p.id === cylinder.productId)?.category;

  return (
    <div>
      <PageHeader
        title={t("cylinders.tracking", { serial: cylinder.serialNumber })}
        description={t("cylinders.capacityAt", {
          capacity: String(cylinder.capacity),
          location: cylinder.location,
        })}
        backTo="/cylinders"
        backLabel={t("cylinders.title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/cylinders/$id/edit" params={{ id }}>
                <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
              </Link>
            </Button>
            <Badge>{t(`status.${cylinder.status}` as any)}</Badge>
            {gasCategory && <Badge variant="outline">{gasCategory}</Badge>}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("cylinders.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("cylinders.noMovements")}</p>
            ) : (
              <ol className="space-y-3">
                {movements.map((m) => (
                  <li key={m.id} className="flex gap-3 border-l-2 border-primary/40 pl-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{m.type}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(m.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">
                        {m.fromLocation && <span>{m.fromLocation}</span>}
                        {m.toLocation && (
                          <span>
                            {" "}
                            → <b>{m.toLocation}</b>
                          </span>
                        )}
                      </p>
                      {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                      <p className="text-xs text-muted-foreground">
                        {t("cylinders.by", { name: m.by })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("cylinders.record")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("common.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as CylinderMovementType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((mv) => (
                    <SelectItem key={mv} value={mv}>
                      {mv}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("cylinders.toLocation")}</Label>
              <Input value={toLocation} onChange={(e) => setToLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("cylinders.customerIf")}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("common.notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button className="w-full" onClick={() => addMv.mutate()} disabled={addMv.isPending}>
              {t("cylinders.addMovement")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
