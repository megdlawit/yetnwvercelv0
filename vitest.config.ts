import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "packages/indoor-core/src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src"), "@ethi/indoor-core/react": path.resolve(__dirname, "./packages/indoor-core/src/react.tsx"), "@ethi/indoor-core": path.resolve(__dirname, "./packages/indoor-core/src") },
  },
});
