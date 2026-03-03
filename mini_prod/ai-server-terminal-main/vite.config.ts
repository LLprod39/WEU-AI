import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_DJANGO_URL || "http://127.0.0.1:9000",
        changeOrigin: true,
      },
      "/servers/api": {
        target: process.env.VITE_DJANGO_URL || "http://127.0.0.1:9000",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_DJANGO_URL || "http://127.0.0.1:9000",
        changeOrigin: false,
        ws: true,
        configure: (proxy) => {
          // http-proxy does not always forward Cookie on WS upgrade — do it explicitly
          proxy.on("proxyReqWs", (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader("cookie", req.headers.cookie);
            }
          });
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
