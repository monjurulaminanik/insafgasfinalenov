import {
  createProductCategoryFn,
  listProductCategoriesFn,
  removeProductCategoryFn,
  updateProductCategoryFn,
} from "@/lib/product-categories.functions";
import type { ProductCategoryRecord } from "@/types";

export const productCategoryService = {
  list: () => listProductCategoriesFn() as Promise<ProductCategoryRecord[]>,
  create: (name: string) =>
    createProductCategoryFn({ data: { name } }) as Promise<ProductCategoryRecord>,
  update: (id: string, name: string) =>
    updateProductCategoryFn({ data: { id, name } }) as Promise<ProductCategoryRecord>,
  remove: (id: string) => removeProductCategoryFn({ data: { id } }),
};
