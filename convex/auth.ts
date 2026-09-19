import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import { env } from "./_generated/server";

function safeProviderField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safeValue = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 100);
  return safeValue || undefined;
}

async function agentMailFailureDetails(response: Response) {
  try {
    const payload: unknown = await response.clone().json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    const record = payload as Record<string, unknown>;
    return {
      name: safeProviderField(record.name),
      code: safeProviderField(record.code),
    };
  } catch {
    return {};
  }
}

const emailVerification = Email({
  from: env.AUTH_EMAIL_FROM ?? "Jamanyo <no-reply@invalid.local>",
  maxAge: 30 * 60,
  // ConvexAuthProvider redeems a clicked magic link with its one-time code.
  // The default Email provider additionally expects an email form field, which
  // is not present in that callback. The 32-character code is high entropy,
  // single-use, and expires after maxAge.
  authorize: undefined,
  sendVerificationRequest: async ({ identifier, url, token }) => {
    if (!env.AUTH_EMAIL_INBOX_ID || !env.AUTH_EMAIL_FROM) {
      throw new Error(
        "Email verification is not configured. Set AUTH_EMAIL_INBOX_ID and AUTH_EMAIL_FROM.",
      );
    }

    const response = await fetch(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(env.AUTH_EMAIL_INBOX_ID)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `jamanyo-auth-${token}`,
        },
        body: JSON.stringify({
          to: identifier,
          subject: "Confirm your Jamanyo email",
          text:
            "Confirm your email to activate your Jamanyo account.\n\n" +
            `${url}\n\nThis link expires in 30 minutes. If you did not create an account, you can ignore this email.`,
        }),
      },
    );
    if (!response.ok) {
      const details = await agentMailFailureDetails(response);
      console.error(
        "AgentMail confirmation delivery failed",
        JSON.stringify({
          status: response.status,
          requestId: safeProviderField(response.headers.get("x-request-id")),
          ...details,
        }),
      );
      throw new Error("We couldn't send the confirmation email. Please try again.");
    }
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      verify: emailVerification,
      profile: (params) => {
        const email =
          typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error("Enter a valid email address");
        }
        const name = typeof params.name === "string" ? params.name.trim().slice(0, 80) : "";
        return { email, ...(name ? { name } : {}) };
      },
      validatePasswordRequirements: (password) => {
        if (password.length < 8) {
          throw new Error("Use a password with at least 8 characters");
        }
      },
    }),
    // Password creates its confirmation codes through this provider. It must
    // also be registered here so Convex can redeem the clicked magic link.
    emailVerification,
  ],
});
