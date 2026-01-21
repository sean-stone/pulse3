import react from "@vitejs/plugin-react";
   import { defineConfig } from "vite";

export default defineConfig({
  base: "/demos/pulse3/",
  plugins: [react()],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true
      }
    }
  }
});
