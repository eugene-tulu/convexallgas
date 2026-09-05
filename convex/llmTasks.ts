"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { runLlmTask } from "./llm";

// Extract the first balanced top-level JSON object from a string. Handles
// nested objects, quoted strings with escaped quotes, and ignores braces
// inside string literals. Returns null if no balanced object is found.
function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (c === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function safeJsonParse<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) as T };
  } catch (e) {
    const candidate = extractFirstJsonObject(cleaned);
    if (candidate) {
      try {
        return { ok: true, value: JSON.parse(candidate) as T };
      } catch (e2) {
        return { ok: false, error: (e2 as Error).message };
      }
    }
    return { ok: false, error: (e as Error).message };
  }
}

export const extractBusinessProfile = action({
  args: {
    markdown: v.string(),
    businessName: v.string(),
    city: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const systemPrompt =
      "You extract a structured business profile from web content. Return ONLY valid JSON matching the schema. Do not include markdown fences or commentary.";
    const userPrompt = `Extract a business profile for "${args.businessName}" in ${args.city} from the following content.

Return JSON with these fields:
{
  "name": string,            // canonical business name
  "category": string,        // e.g. "cafe", "school", "clinic", "retail" - keep generic
  "hoursJson": string,       // JSON string of weekly hours, e.g. {\"mon\":\"7-17\",\"tue\":\"7-17\"}; empty string if unknown
  "sizeSignal": string,      // short free-text estimate of size, e.g. "small (1-5 staff)" or "medium (20-50)"
  "location": string         // city and state/country if known
}

Content:
"""
${args.markdown.slice(0, 8000)}
"""`;

    const raw = (await ctx.runAction(internal.llmTaskBridge.runLlmTaskRaw, {
      prompt: userPrompt,
      systemPrompt,
    })) as string;
    const parsed = safeJsonParse<{
      name: string;
      category: string;
      hoursJson: string;
      sizeSignal: string;
      location: string;
    }>(raw);
    if (!parsed.ok) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "businesses",
        rowId: "extract",
        action: "parse_failed",
        summary: `extract-business-profile JSON parse failed: ${parsed.error}. Raw: ${raw.slice(0, 200)}`,
      });
      return null;
    }
    return parsed.value;
  },
});

export const draftBroadcastEmail = action({
  args: {
    role: v.string(),
    startTime: v.number(),
    urgency: v.string(),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    businessName: v.string(),
    recipientCount: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const systemPrompt = `You draft short, warm, plain-language email bodies for a shift call-out.
Rules:
- Address the worker by nothing specific (no fake names).
- Lead with the role and when the shift starts.
- State the rate as "$${args.displayRate}${args.displayRateLabel}" once, in plain text.
- Include a one-line social-proof cue: "Sent to ${args.recipientCount} ${args.recipientCount === 1 ? "person" : "people"} — first to reply gets it." Use the actual number above; do not invent one.
- Tone: like a relieved coworker, not a system notification. No "Dear Valued Employee", no exclamation-mark spam, no corporate HR voice.
- End with a one-line instruction: "Just reply to this email to put your hand up."
- 4-7 short lines total. No subject line, no signature, no marketing fluff.`;
    const startStr = new Date(args.startTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const urgencyBit =
      args.urgency === "critical"
        ? "It's last-minute — really appreciate you considering."
        : args.urgency === "urgent"
        ? "Bit of a scramble today, thanks for the help."
        : args.urgency === "low"
        ? "No rush, just filling in."
        : "";
    const userPrompt = `Role: ${args.role}
Start: ${startStr}
Business: ${args.businessName}
Urgency: ${args.urgency} (${urgencyBit})
Rate: $${args.displayRate}${args.displayRateLabel}
Recipient count: ${args.recipientCount}`;

    return await ctx.runAction(internal.llmTaskBridge.runLlmTaskRaw, {
      prompt: userPrompt,
      systemPrompt,
    });
  },
});

export const draftConfirmEmail = action({
  args: {
    role: v.string(),
    startTime: v.number(),
    businessName: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const systemPrompt = `You draft a short, warm, human email confirming a worker got the shift.
Rules:
- Sound like a relieved coworker, not a system notification.
- Lead with gratitude ("You're a lifesaver, thank you" or similar).
- Confirm role, time, and the business name once.
- 2-4 lines, no subject line, no marketing, no emojis.
- End with a soft "see you then" sign-off.`;
    const startStr = new Date(args.startTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const userPrompt = `Role: ${args.role}
Start: ${startStr}
Business: ${args.businessName}`;
    return await ctx.runAction(internal.llmTaskBridge.runLlmTaskRaw, {
      prompt: userPrompt,
      systemPrompt,
    });
  },
});

export const draftRejectEmail = action({
  args: {
    role: v.string(),
    businessName: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const systemPrompt = `You draft a short, warm, human email to a worker who replied but didn't get the shift.
Rules:
- Sound like a grateful coworker, not a system notification.
- Lead with thanks for responding — "the shift's covered, but thank you for getting back to me fast."
- Reassure them they will be the first to hear about future nearby shifts.
- 3-5 lines, no subject line, no marketing, no emojis.
- Tone: equally warm as the confirmation email; do not sound dismissive.`;
    const userPrompt = `Role they replied to: ${args.role}
Business: ${args.businessName}`;
    return await ctx.runAction(internal.llmTaskBridge.runLlmTaskRaw, {
      prompt: userPrompt,
      systemPrompt,
    });
  },
});

export const parseReply = action({
  args: {
    rawReplyText: v.string(),
    role: v.string(),
    startTime: v.number(),
    shiftId: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const systemPrompt = `You parse a free-text reply to a shift call-out and return structured availability.
Return ONLY valid JSON, no markdown fences, no commentary.`;
    const startStr = new Date(args.startTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const userPrompt = `Shift role: ${args.role}
Shift start: ${startStr}

Worker's reply:
"""
${args.rawReplyText.slice(0, 2000)}
"""

Return JSON of shape:
{
  "available": boolean,        // true if the worker is putting their hand up for the shift
  "constraints": string,       // short note on time/logistics constraints ("can do from 3pm", "have car", or "")
  "confidence": number,        // 0..1 how confident you are in the available flag
  "reasons": string            // one short sentence explaining the call (kept for the manager to see)
}`;

    const raw = (await ctx.runAction(internal.llmTaskBridge.runLlmTaskRaw, {
      prompt: userPrompt,
      systemPrompt,
    })) as string;
    const parsed = safeJsonParse<{
      available: boolean;
      constraints: string;
      confidence: number;
      reasons: string;
    }>(raw as string);
    if (!parsed.ok) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "responses",
        rowId: args.shiftId,
        action: "parse_failed",
        summary: `parse-reply JSON parse failed: ${parsed.error}. Raw: ${raw.slice(0, 200)}`,
      });
      return null;
    }
    return parsed.value;
  },
});
