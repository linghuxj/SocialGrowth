import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function loopbackPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d{1,5}$/.test(raw)) throw new Error(`${name} must be a decimal loopback port`);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be between 1024 and 65535`);
  }
  return port;
}

const webPort = loopbackPort("SG_PRODUCT_WEB_PORT", 3100);
const backendPort = loopbackPort("SG_PRODUCT_BACKEND_PORT", 4320);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        xfwd: true,
      },
    },
  },
});
