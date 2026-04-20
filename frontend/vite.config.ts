import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  server: { port: 5173 },
  resolve: {
    alias: {
      // Allow frontend to import from parent convex/ directory.
      // This resolves "../../convex/_generated/api" to the actual path.
      "@convex": resolve(__dirname, "../convex"),
    },
  },
});
