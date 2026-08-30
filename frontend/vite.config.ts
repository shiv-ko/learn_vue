import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    global: "globalThis",
  },
  server: {
    proxy: {
      "/todos": {
        target: "https://gctpao66n5.execute-api.ap-northeast-3.amazonaws.com",
        changeOrigin: true,
        rewrite: (requestPath) => `/prod${requestPath}`,
      },
    },
  },
});
