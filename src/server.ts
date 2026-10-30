import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Handle separated inventory REST API endpoints
      if (pathname === "/api/inventory/gas" && request.method === "GET") {
        const { getDb } = await import("./lib/mongo.server");
        const { reconcileDatabaseInventory } = await import("./lib/inventory.server");
        const db = await getDb();
        const summary = await reconcileDatabaseInventory(db);
        return new Response(JSON.stringify(summary.gas), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      if (pathname === "/api/inventory/cylinders" && request.method === "GET") {
        const { getDb } = await import("./lib/mongo.server");
        const { reconcileDatabaseInventory } = await import("./lib/inventory.server");
        const db = await getDb();
        const summary = await reconcileDatabaseInventory(db);
        return new Response(JSON.stringify(summary.cylinders), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      if (pathname === "/api/inventory/products" && request.method === "GET") {
        const { getDb } = await import("./lib/mongo.server");
        const { reconcileDatabaseInventory } = await import("./lib/inventory.server");
        const db = await getDb();
        const summary = await reconcileDatabaseInventory(db);
        return new Response(JSON.stringify(summary.products), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      if (pathname === "/api/inventory/summary" && request.method === "GET") {
        const { getDb } = await import("./lib/mongo.server");
        const { reconcileDatabaseInventory } = await import("./lib/inventory.server");
        const db = await getDb();
        const summary = await reconcileDatabaseInventory(db);
        return new Response(JSON.stringify(summary), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      if (pathname === "/api/inventory/reconcile" && request.method === "POST") {
        const { getDb } = await import("./lib/mongo.server");
        const { reconcileDatabaseInventory } = await import("./lib/inventory.server");
        const db = await getDb();
        const summary = await reconcileDatabaseInventory(db);
        return new Response(JSON.stringify({ ok: true, summary }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      // Public branding endpoints for Open Graph and Logo/Favicon requests
      if (
        (pathname === "/api/branding/og-image" ||
          pathname === "/api/branding/logo" ||
          pathname === "/api/branding/favicon") &&
        request.method === "GET"
      ) {
        try {
          const { getBranding } = await import("./lib/settings.server");
          const branding = await getBranding();
          const target =
            pathname === "/api/branding/favicon"
              ? (branding.favicon || branding.logo)
              : (branding.logo || branding.favicon);

          if (target && target.startsWith("data:")) {
            const match = target.match(/^data:([^;]+);base64,(.*)$/);
            if (match) {
              const mime = match[1];
              const buffer = Buffer.from(match[2], "base64");
              return new Response(buffer, {
                status: 200,
                headers: {
                  "content-type": mime,
                  "cache-control": "public, max-age=60, stale-while-revalidate=86400",
                },
              });
            }
          } else if (target && (target.startsWith("http://") || target.startsWith("https://"))) {
            return Response.redirect(target, 302);
          }
        } catch {}
        return Response.redirect(new URL("/favicon.png?v=4", request.url).toString(), 302);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
