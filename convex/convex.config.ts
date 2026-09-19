import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiterComponent from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
  env: {
    OPENAI_API_KEY: v.string(),
    FIRECRAWL_API_KEY: v.string(),
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_DOMAIN: v.optional(v.string()),
    // A dedicated operational inbox sends account-confirmation emails. It is
    // normally not used as a customer-agent inbox. A development-only,
    // verified-user allowlist can opt into it for a controlled demo.
    AUTH_EMAIL_INBOX_ID: v.optional(v.string()),
    AUTH_EMAIL_FROM: v.optional(v.string()),
    // Keep the demo allowlist in deployment configuration rather than source.
    // The value must match a verified Jamanyo account email.
    JAMANYO_DEMO_EMAIL: v.optional(v.string()),
    // Private provisioning remains closed until a provider credential with
    // inbox creation permission has been installed.
    JAMANYO_PRIVATE_INBOXES_ENABLED: v.optional(v.string()),
    // An existing app-level webhook is accepted during migration. New and
    // repaired inboxes always store their own signing secret.
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    // Firecrawl delivers monitor events to this explicit public Convex HTTP
    // endpoint. It is separate from the platform-reserved CONVEX_SITE_URL.
    FIRECRAWL_WEBHOOK_URL: v.optional(v.string()),
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
  },
});

app.use(rateLimiterComponent);
app.use(staticHosting);

export default app;
