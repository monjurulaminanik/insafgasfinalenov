import { assetMutationFn } from "./assets.functions";
import { AssetValidationError, type AssetCommand } from "./assets";
import type { AssetResult } from "./assets.server";

export async function mutateAsset(data: AssetCommand): Promise<AssetResult> {
  const result = await assetMutationFn({ data });
  if (result && "validationError" in result) throw new AssetValidationError(result.validationError);
  return result as AssetResult;
}
