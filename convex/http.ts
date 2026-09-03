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
      const eventType = body.event_type ?? body.eventType ?? body.type ?? "message.received";
      const eventAllowed = eventType === "message.received";
      if (!eventAllowed) {
        return new Response("ignored event", { status: 200 });
      }

      const message = body.message ?? body.data?.message ?? body;

      const inboxId: string | undefined = message.inboxId ?? message.inbox_id;
      const messageId: string | undefined = message.messageId ?? message.message_id;
      const subject: string = (message.subject ?? "").toString();
      const from: string = (message.from ?? "").toString();
      const text: string = (message.text ?? message.extractedText ?? "").toString();
      const html: string = (message.html ?? message.extractedHtml ?? "").toString();

      if (!inboxId || !messageId) {
        return new Response("missing fields", { status: 400 });
      }

      await ctx.runAction(internal.webhookProcessor.processReply, {
        inboxId,
        messageId,
        subject,
        from,
        text,
        html,
      });

      return new Response("OK", { status: 200 });
    } catch (e) {
      console.error("webhook error:", e);
      return new Response("error", { status: 500 });
    }
  }),
});

export default http;
