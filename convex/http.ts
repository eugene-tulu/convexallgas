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
      const eventType = body.type ?? body.eventType ?? "message.received";
      const message = body.message ?? body.data?.message ?? body;

      const inboxId: string | undefined = message.inboxId ?? message.inbox_id;
      const messageId: string | undefined = message.messageId ?? message.message_id;
      const subject: string = (message.subject ?? "").toString();
      const from: string = (message.from ?? "").toString();
      const text: string = (message.text ?? message.extractedText ?? "").toString();

      if (eventType !== "message.received") {
        return new Response("ignored", { status: 200 });
      }

      if (!inboxId || !messageId) {
        return new Response("missing fields", { status: 400 });
      }

      await ctx.runAction(internal.webhookProcessor.processReply, {
        inboxId,
        messageId,
        subject,
        from,
        text,
      });

      return new Response("OK", { status: 200 });
    } catch (e) {
      console.error("webhook error:", e);
      return new Response("error", { status: 500 });
    }
  }),
});

export default http;
