import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * The dashboard is a single-page app: `vite build` writes static files that FastAPI serves.
 *
 * In development, /api is proxied to a running backend, set with API_TARGET in web/.env.local:
 * a local (or MOCK=1) backend, or your live server, e.g. API_TARGET=http://192.168.0.215:8080.
 * Proxying to the live server means only one copy of the app polls the inverters (they cope badly
 * with two clients). Requests that would change things there (saving rates, location, system cost)
 * are refused unless API_ALLOW_WRITES=1, so trying the UI can't alter the live service by accident.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.API_TARGET || "http://127.0.0.1:8080";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(target);
  const allowWrites = env.API_ALLOW_WRITES ? env.API_ALLOW_WRITES === "1" : local;
  return {
    server: {
      port: Number(env.PORT) || 5174,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/healthz": { target, changeOrigin: true },
      },
    },
    // `vite build` renders the app shell by starting a preview server and fetching "/" from it.
    // Pin it to IPv4 loopback: in Linux containers "localhost" can bind to ::1 while the build
    // connects to 127.0.0.1, which fails the Docker build with ECONNREFUSED.
    preview: { host: "127.0.0.1" },
    resolve: { tsconfigPaths: true },
    plugins: [
      ...(allowWrites ? [] : [readOnlyApi(target)]),
      tailwindcss(),
      tanstackStart({ spa: { enabled: true } }),
      viteReact(),
    ],
  };
});

/** Refuse API writes (except signing in and out) before they reach the proxy. */
function readOnlyApi(target: string): Plugin {
  return {
    name: "wmp-read-only-api",
    configureServer(server) {
      server.config.logger.info(`  API from ${target} (read-only; set API_ALLOW_WRITES=1 to allow saving)`);
      server.middlewares.use((req, res, next) => {
        const write = req.method && !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (!write || !req.url?.startsWith("/api/") || req.url.startsWith("/api/auth/")) return next();
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ detail: "Saving is turned off in development (set API_ALLOW_WRITES=1 to allow it)." }),
        );
      });
    },
  };
}
