import { v } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function extractToken(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

const optInPage = (token: string, message: string = "") => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opt in to Proxy shifts</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 0; }
    .card { max-width: 480px; margin: 40px auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 4px; font-size: 20px; }
    p.lede { margin: 0 0 20px; color: #6b7280; font-size: 14px; }
    label { display: block; font-size: 12px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 12px; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; margin-top: 4px; }
    .row { display: flex; gap: 8px; margin-top: 20px; }
    button { flex: 1; padding: 10px 14px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .yes { background: #16a34a; color: white; }
    .no  { background: #e5e7eb; color: #111827; }
    .msg { margin-top: 12px; padding: 10px; background: #f3f4f6; border-radius: 6px; font-size: 13px; color: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Want more shifts like that one?</h1>
    <p class="lede">A nearby business just sent you a call-out. Opt in once and we'll let you know about other shifts before they go wide.</p>
    ${message ? `<div class="msg">${message}</div>` : ""}
    <form method="POST" action="/opt-in?token=${encodeURIComponent(token)}">
      <label for="name">Your name</label>
      <input id="name" name="name" required maxlength="120" />
      <label for="roles">Roles (comma-separated, e.g. "barista, cashier")</label>
      <input id="roles" name="roles" required />
      <label for="location">Rough location (e.g. "Merced, CA")</label>
      <input id="location" name="location" />
      <input type="hidden" name="consent" value="true" />
      <div class="row">
        <button class="yes" type="submit">Opt in</button>
      </div>
    </form>
    <form method="POST" action="/opt-in?token=${encodeURIComponent(token)}" style="margin-top: 8px;">
      <input type="hidden" name="consent" value="false" />
      <input type="hidden" name="name" value="" />
      <input type="hidden" name="roles" value="[]" />
      <div class="row">
        <button class="no" type="submit">No thanks</button>
      </div>
    </form>
  </div>
</body>
</html>`;

export const optInHandler = httpAction(async (ctx, req) => {
  const token = extractToken(req);
  if (!token) {
    return new Response("missing token", { status: 400 });
  }
  if (req.method === "GET") {
    return new Response(optInPage(token), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  // Accept form-encoded or JSON
  const ct = req.headers.get("content-type") ?? "";
  let name: string;
  let roles: string[];
  let location: string;
  let consent: boolean;
  if (ct.includes("application/json")) {
    const body = (await req.json()) as {
      name?: string;
      roles?: string[] | string;
      location?: string;
      consent?: boolean;
    };
    name = body.name ?? "";
    roles = Array.isArray(body.roles)
      ? body.roles
      : (body.roles ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    location = body.location ?? "";
    consent = !!body.consent;
  } else {
    const form = await req.formData();
    name = String(form.get("name") ?? "");
    const rolesField = form.get("roles");
    roles = rolesField == null
      ? []
      : String(rolesField).split(",").map((s) => s.trim()).filter(Boolean);
    location = String(form.get("location") ?? "");
    consent = String(form.get("consent") ?? "false") === "true";
  }
  if (!consent) {
    // Decline path: still call consumeToken with empty name/roles so the token
    // is marked used and we don't spam the worker with retries.
    const result = await ctx.runMutation(internal.optIn.consumeToken, {
      token,
      name: "",
      roles: [],
      location: "",
      consent: false,
    });
    return new Response(optInPage(token, "Got it — you won't be on future broadcasts."), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!name || roles.length === 0) {
    return new Response(optInPage(token, "Please fill in your name and at least one role."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const result = await ctx.runMutation(internal.optIn.consumeToken, {
    token,
    name,
    roles,
    location,
    consent: true,
  });
  return new Response(
    optInPage(token, "You're in. We'll reach out the next time a shift near you needs covering."),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
});
