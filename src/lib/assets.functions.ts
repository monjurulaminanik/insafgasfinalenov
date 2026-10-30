import { createServerFn } from "@tanstack/react-start";
import { AssetValidationError, type AssetCommand } from "./assets";

export const assetMutationFn = createServerFn({ method: "POST" })
  .inputValidator((data: AssetCommand) => data)
  .handler(async ({ data }) => {
    const { requireUser } = await import("./session.server");
    const { assertPermission } = await import("./rbac");
    const user = await requireUser();
    assertPermission(
      user,
      data.action === "create"
        ? "accounting.create"
        : data.action === "remove"
          ? "accounting.delete"
          : "accounting.update",
    );
    const { getDb, getMongoClient } = await import("./mongo.server");
    const { executeAssetTransaction } = await import("./assets.server");
    try {
      return await executeAssetTransaction(
        await getDb(),
        await getMongoClient(),
        data,
        user.username,
      );
    } catch (error) {
      if (error instanceof AssetValidationError) return { validationError: error.message };
      throw error;
    }
  });
