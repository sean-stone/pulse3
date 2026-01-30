import react from "@vitejs/plugin-react";
   import { defineConfig } from "vite";

export default defineConfig({
  base: "/demos/pulse3/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "gif.js"],
    include: [],
    noDiscovery: true,
    force: true
  },
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
