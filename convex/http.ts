import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { optInHandler } from "./optInHttp";

const http = httpRouter();

http.route({
  method: "POST",
  path: "/webhooks/agentmail",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const eventType =
        (body.event_type as string | undefined) ??
        (body.eventType as string | undefined) ??
        (body.type as string | undefined) ??
        "message.received";
      if (eventType !== "message.received") {
        return new Response("ignored event", { status: 200 });
      }
      const message =
        (body.message as Record<string, unknown> | undefined) ??
        ((body.data as Record<string, unknown> | undefined)?.message as
          | Record<string, unknown>
          | undefined) ??
        body;
      const inboxId = (message.inboxId as string | undefined) ?? (message.inbox_id as string | undefined);
      const messageId = (message.messageId as string | undefined) ?? (message.message_id as string | undefined);
      const subject = ((message.subject as string | undefined) ?? "").toString();
      const from = ((message.from as string | undefined) ?? "").toString();
      const text = ((message.text as string | undefined) ?? (message.extractedText as string | undefined) ?? "").toString();
      const html = ((message.html as string | undefined) ?? (message.extractedHtml as string | undefined) ?? "").toString();
      if (!inboxId || !messageId) {
        return new Response("missing fields", { status: 400 });
      }
      await ctx.runAction(internal.replies.processBroadcastReply, {
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

http.route({
  method: "GET",
  path: "/opt-in",
  handler: optInHandler,
});
http.route({
  method: "POST",
  path: "/opt-in",
  handler: optInHandler,
});

export default http;
