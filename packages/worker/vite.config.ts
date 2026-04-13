import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [cloudflare({ remoteBindings: false }), react(), tailwindcss()],
  optimizeDeps: {
    // Avoid Worker runner deadlocks caused by hot-swapped prebundles.
    exclude: ["workers-ai-provider", "@ai-sdk/openai"]
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../frontend/src")
    }
  }
});
