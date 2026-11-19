import { defineConfig, type ProxyOptions } from "vite"
import react from "@vitejs/plugin-react"

// Cloudflare rejects requests whose Referer points at localhost. The dev and
// preview servers forward local API and image requests with an allowed Referer
// so the gallery can load while running on a developer machine.
function articProxy(target: string, referer: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.removeHeader("origin")
        proxyReq.removeHeader("referer")
        proxyReq.setHeader("referer", referer)
      })
    },
  }
}

const artProxies: Record<string, ProxyOptions> = {
  "/aic-api": {
    ...articProxy("https://api.artic.edu", "https://api.artic.edu/"),
    rewrite: (path) => path.replace(/^\/aic-api/, ""),
  },
  "/aic-iiif": {
    ...articProxy("https://www.artic.edu", "https://www.artic.edu/"),
    rewrite: (path) => path.replace(/^\/aic-iiif/, ""),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: artProxies },
  preview: { proxy: artProxies },
})
