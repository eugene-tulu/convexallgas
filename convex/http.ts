import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  method: "POST",
  path: "/webhooks/agentmail",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const inboxId = body.inboxId ?? body.inbox_id;
      const messageId = body.messageId ?? body.message_id;

      if (inboxId && messageId) {
        await ctx.runAction(internal.mail.fetchMessage, {
          inboxId,
          messageId,
        });
      }
    } catch {
      // Ignore parsing errors - just return 200
    }

    return new Response("OK", { status: 200 });
  }),
});

export default http;
