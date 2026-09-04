import { v } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

export const optInHandler = httpAction(async (ctx, req) => {
  const token = extractToken(req);
  if (!token) {
    return new Response("missing token", { status: 400 });
  }
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "POST {name, roles, location, consent} to this URL to opt in",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const body = (await req.json()) as {
    name?: string;
    roles?: string[];
    location?: string;
    consent?: boolean;
  };
  if (!body.name || !Array.isArray(body.roles) || typeof body.consent !== "boolean") {
    return new Response("invalid body", { status: 400 });
  }
  const result = await ctx.runMutation(internal.optIn.consumeToken, {
    token,
    name: body.name,
    roles: body.roles,
    location: body.location ?? "",
    consent: body.consent,
  });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
