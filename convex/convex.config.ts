import { defineApp } from "convex/server";
import { v } from "convex/values";
import rag from "@convex-dev/rag/convex.config.js";

const app = defineApp({
  env: {
    OPENAI_API_KEY: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_DOMAIN: v.optional(v.string()),
  },
});

app.use(rag);

export default app;
