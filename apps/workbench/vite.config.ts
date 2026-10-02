import { defineConfig } from "vite";
export default defineConfig({ base: "/ui/", build: { sourcemap: false }, server: { proxy: { "/api": { target: "http://127.0.0.1:8787", rewrite: path => path.replace(/^\/api/, "") } } } });
