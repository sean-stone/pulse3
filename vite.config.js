import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
    base: "/demos/pulse3/",
    plugins: [react()],
    optimizeDeps: {
        exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "gif.js", "jszip"],
        include: ["react", "react-dom", "react-dom/client"],
        noDiscovery: false,
        force: true
    },
    build: {
        cssCodeSplit: false,
        assetsInlineLimit: 0
    }
});
