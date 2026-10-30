import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { getPowerMatrixFn } from "@/lib/settings.functions";
import { canRoleAccess, pathToModule, urlToModule, type AppModule } from "@/lib/access";

export function usePowerMatrix() {
  return useQuery({
    queryKey: ["powerMatrix"],
    queryFn: () => getPowerMatrixFn(),
    retry: 1,
    staleTime: 0,
  });
}

export function useModuleAccess() {
  const { user } = useRouteContext({ from: "__root__" });
  const { data: matrix, isPending, isError, isFetched } = usePowerMatrix();
  const role = user?.role;
  const isLoading = isPending || !isFetched;

  const canAccess = (moduleId: AppModule) => {
    if (isError && role !== "Administrator") return false;
    return canRoleAccess(isError ? undefined : matrix, role, moduleId);
  };
  const canAccessPath = (pathname: string) => {
    const mod = pathToModule(pathname);
    if (!mod) return true;
    return canAccess(mod);
  };
  const canAccessUrl = (url: string) => canAccess(urlToModule(url));

  return {
    role,
    matrix,
    isLoading,
    isError,
    canAccess,
    canAccessPath,
    canAccessUrl,
    isAdmin: role === "Administrator",
  };
}
