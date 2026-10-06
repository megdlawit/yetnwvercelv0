import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Builds src/embed-loader.tsx into a single self-contained IIFE at
// public/embed.js — partner sites load it with a plain <script> tag, no
// npm/React/build step on their end. Separate from vite.config.ts (the main
// app's SPA build) because this needs a completely different output shape:
// one dependency-free file, global name `EthiMaps`, not a multi-chunk app.
//
// Run with: npm run build:embed
// Output is checked into public/ so it ships with the normal `vercel deploy`
// of the main app — rerun this whenever embed-loader.tsx or the SDK's
// rendering internals change; it is not rebuilt automatically by `npm run build`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ethi/indoor-core/react": path.resolve(__dirname, "./packages/indoor-core/src/react.tsx"),
      "@ethi/indoor-core": path.resolve(__dirname, "./packages/indoor-core/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "public",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/embed-loader.tsx"),
      name: "EthiMaps",
      formats: ["iife"],
      fileName: () => "embed.js",
    },
    rollupOptions: {
      output: {
        // IIFE builds normally refuse to have unresolved externals; since
        // we deliberately bundle React/ReactDOM in (not externalize them),
        // there are none — this just guards against a future accidental
        // external creeping in and silently breaking the self-contained
        // "no npm needed" promise this file exists for.
      },
    },
  },
});
