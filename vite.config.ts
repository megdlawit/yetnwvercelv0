import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// The old approach here was a static Vite `proxy` target pointed at a single
// hardcoded mirror (overpass.kumi.systems). That meant local dev and the
// deployed Vercel function (api/overpass.ts) were two *different*
// implementations: `vite dev` never actually runs api/overpass.ts at all,
// so any mirror-racing/fallback logic added there silently never applied
// locally — you'd see this exact failure (single mirror times out, no
// fallback, dev proxy just surfaces the abort) even after fixing the real
// handler, because the real handler was never in the loop.
//
// Importing and running the actual handler as dev middleware instead means
// `npm run dev` and the Vercel deployment are guaranteed to behave the same
// way, so a fix to api/overpass.ts can't accidentally only take effect in
// one of the two.
function overpassDevMiddleware(): Plugin {
  return {
    name: 'overpass-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/overpass', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule('/api/overpass.ts');
        await handler(req, res);
      });
    },
  };
}

// Same reasoning as overpassDevMiddleware above, for api/osrm.ts (used for
// long-distance street routing — see src/lib/geo/StreetRouting.ts).
function osrmDevMiddleware(): Plugin {
  return {
    name: 'osrm-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/osrm', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule('/api/osrm.ts');
        await handler(req, res);
      });
    },
  };
}

// Same reasoning again, for api/dxf-import.ts (FloorEditor's "Import CAD"
// button — src/pages/FloorEditor.tsx). Without this, `npm run dev` has no
// route matching POST /api/dxf-import at all, Vite falls through to its SPA
// catch-all, and the browser gets an HTML 404 page back where it expected
// JSON — which is exactly the "404 Not Found" + "Unexpected end of JSON
// input" pair this was missing.
function dxfImportDevMiddleware(): Plugin {
  return {
    name: 'dxf-import-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/dxf-import', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule('/api/dxf-import.ts');
        await handler(req, res);
      });
    },
  };
}

// Same again, for api/dwg-convert.ts (the DWG→DXF conversion step the
// import dialog calls automatically when you pick a .dwg file).
function dwgConvertDevMiddleware(): Plugin {
  return {
    name: 'dwg-convert-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/dwg-convert', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule('/api/dwg-convert.ts');
        await handler(req, res);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    overpassDevMiddleware(),
    osrmDevMiddleware(),
    dxfImportDevMiddleware(),
    dwgConvertDevMiddleware(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ethi/indoor-core/react": path.resolve(__dirname, "./packages/indoor-core/src/react.tsx"),
      "@ethi/indoor-core": path.resolve(__dirname, "./packages/indoor-core/src"),
      "react": path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
}));