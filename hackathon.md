# Jamanyo — Build Log

## Concept
Jamanyo is an email-first two-directional hunt agent: users send a request to their agent inbox,
and the agent searches or monitors the web, verifies candidates, and replies with results through
AgentMail. The dashboard is a live control plane for hunts, candidates, outreach, and activity.

## Stack
- **Backend**: Convex (Cloud) — auth, schema, functions, crons, HTTP webhooks
- **Auth**: `@convex-dev/auth` (Password provider, verified-email confirmation, built-in JWT)
- **Rate limiting**: `@convex-dev/rate-limiter`
- **LLM**: OpenAI client pointed at NVIDIA NIM endpoint
- **Scraping/search**: `firecrawl` package
- **Email**: `agentmail` package (explicit private per-user inbox provisioning, Svix-signed webhooks, and account-confirmation delivery)
- **Frontend**: React 19 + Vite + plain CSS (Instrument Serif font)
- **Hosting**: `@convex-dev/static-hosting` on Convex

## Public Build
- **Live app**: https://basic-hippopotamus-995.convex.site
- **Deployment**: Convex development deployment (publicly reachable)
- **Public repository**: https://github.com/eugene-tulu/convexallgas
- **Demo video**: Pending recording after deployment

## Development Journey

### Round 1 — Architecture & Schema
- Read all 22 existing Proxy source files to establish ground truth
- Deleted all Proxy-specific functions (shifts, workers, replies, escalation, optIn, seed, bridge, etc.)
- Designed new data model: `hunts`, `candidates`, `outreach`, `events` tables
- Auth via `@convex-dev/auth` — `convexAuth({ providers: [Password] })` server-side,
  `ConvexAuthProvider` + `useConvexAuth` client-side

### Round 2 — Core Functions
- Wrote all 16 Convex modules: auth, schema, llm, firecrawl, hunts, candidates, verify,
  hunt, outreach, outreachBridge, outreachActions, http, crons, rateLimit, events, eventsLog, mail
- Ran `npx convex codegen` — 5 iterations to resolve all TypeScript errors
- Fixed: `await` on `getUserIdentity()`, `internalMutation` declarations, circular type
  references, firecrawl type casts, HMAC Web Crypto API, `http.route()` pattern

### Round 3 — Frontend & Polish
- `src/main.tsx`: swapped `ConvexProvider` → `ConvexAuthProvider`
- `src/index.css`: Jamanyo calm-patience design tokens (plain CSS, no Tailwind)
- `src/App.tsx`: full React app with auth gating, hunt creation, hunt detail, candidate
  verification, outreach drafting — using `useQuery`/`useMutation`/`useAction` hooks

### Key Technical Decisions
- **NIM JSON Schema**: Tested via curl — NIM does NOT support `json_schema` response_format.
  Used `safeJsonParse` (bracket-balanced extractor) as primary fallback path.
- **AgentMail**: User-owned inbox records, Svix-signed webhook routing by inbox and thread,
  sender ownership checks, inbound message deduplication, threaded replies, and idempotent
  outbound sends. Each physical inbox must map to exactly one Jamanyo owner; ambiguous legacy
  mappings fail closed rather than falling back to a shared inbox.
- **Rate Limiter**: Relaxed starting numbers with `TODO_REVIEW` comments. Must use object
  key form `{ key: ownerId }` — array form unsupported.

## Phantom Pattern Review Notes
During review, identified a recurring anti-pattern in the Convex agent framework:
phantom type references where internal function signatures reference models that
only exist in the generated `dataModel.d.ts` at runtime. This manifests as:
1. Circular type references in `hunt.ts` (buildSearchQuery, draftOutreachBody)
2. `spec.make` validator errors when the inferred type doesn't match the runtime schema
3. `ctx.runAction` calls where the action type is inferred before codegen completes

Fix: explicit return type annotations + `as Doc<...>` casts on all builder functions,
and keeping provider inbox creation in an explicit, confirmed action rather than a mutation
side effect.

## Status
The working tree implements dashboard/email handoff, explicit private inbox setup,
sender-safe webhook processing, retained hunt activity, Firecrawl Monitor integration, and durable
notification retries. The NVIDIA-backed LLM endpoint remains unchanged by request. A public
development build is live on Convex static hosting; no Convex production deployment has been
performed.

### 2026-09-12 - working tree
Added the email-first runtime: authenticated users can provision an agent inbox, signed AgentMail
webhooks route verified owner requests into hunts or monitors, and replies are sent in the same
email thread. The webhook receiver now verifies AgentMail's Svix signature format, supports
inbox-specific signing secrets, rejects non-owner commands, and fetches an omitted message body
from AgentMail when needed. Restored Convex Auth HTTP route registration alongside the webhook
routes so the password-based dashboard sign-in remains live. Added Firecrawl scraping before verification, native Monitor webhooks
with scheduled-search fallback, persisted monitor checks, per-user authorization, webhook
deduplication, idempotent threaded outreach, and durable hunt run records with retries,
per-hunt cadence, and paginated cron scheduling. Newly verified search matches now reply in the
requester's original email thread and are marked delivered only after the send succeeds, preventing
repeat notifications across scheduled checks (`convex/schema.ts`, `convex/http.ts`,
`convex/mail.ts`, `convex/inboundActions.ts`, `convex/firecrawl.ts`, `convex/hunt.ts`,
`convex/huntRuns.ts`, `convex/candidates.ts`).
Dashboard-created hunts now let users choose dashboard-only operation or a linked AgentMail
notification thread. When enabled, the app provisions a durable thread and reuses it for verified
search matches and Firecrawl monitor changes; the outbound thread and messages link back to the
same hunt, and switching notifications off preserves the dashboard activity history. Existing inbox
provisioning also refreshes the signed-in account contact before sending updates (`convex/hunts.ts`,
`convex/hunt.ts`, `convex/firecrawl.ts`, `convex/agentThreads.ts`, `convex/mail.ts`,
`src/App.tsx`).
Package.json deps pruned (removed map/x402 packages). index.html updated with
Jamanyo branding and Instrument Serif font.
Resolved the Convex development typecheck for the standard Password-auth
configuration by locally typing the platform-injected site URL, without adding
Node globals to the browser application (`convex/auth.config.ts`).
Fixed the post-sign-up blank screen by keeping the authenticated hunt query in
the same React hook order on every render and skipping it until a session is
available (`src/App.tsx`).

### 2026-09-13 - personal scout controls and respectful delivery
Added a production-oriented market context layer for new and email-created missions. A mission
can now retain a currency-aware minor-unit budget (without guessing exchange rates), market country
or region, radius, pickup/shipping preference, time zone, trusted/blocked domains, urgency, an
optional expiry, alert cadence, quiet hours, discovery style, and a seller-contact policy
(`convex/schema.ts`, `convex/market.ts`, `convex/preferences.ts`, `convex/hunts.ts`,
`convex/inboundActions.ts`, `convex/verify.ts`). User defaults live in an owner-scoped preference
record and remain separate from per-mission overrides.

Added a feedback loop for cleared candidates. Dashboard feedback records why a lead was useful,
off-style, too expensive, too far away, or untrusted; recent feedback is supplied to the next
verification task so the scout can explain and adjust future recommendations (`convex/huntFeedback.ts`,
`convex/hunt.ts`). Candidate verification now returns explicit availability, source trust, listing
price/currency, stated total where available, and short match reasons. Currency normalization is
only recorded when the source and mission currency already match.

Email delivery now honors a mission's alert policy. Quiet-hour and daily-digest updates are placed
in a durable, idempotent queue that can coalesce several results into one later update; urgent
missions can bypass a digest but not quiet hours. Queued sends record their eventual status without
removing the dashboard activity trail. Firecrawl monitor schedules use the mission's time zone,
monitor callbacks respect expiry, and native-monitor failure continues as scheduled search
(`convex/notifications.ts`, `convex/hunt.ts`, `convex/firecrawl.ts`, `convex/huntRuns.ts`).
An expiring mission now schedules its own archival; if it owns a native Firecrawl monitor, the
expiry action also asks Firecrawl to delete that remote monitor before recording the final local
state.

The React dashboard now presents a three-question mission brief, saved Scout settings, manual
pause/resume, Firecrawl monitor setup, transparent results/reasons, feedback buttons, quiet-hour
and digest choices, and an explicit approval boundary before any seller email. Dashboard and inbox
continue to reference the same mission history. The sign-out action is now awaited, has a visible
in-progress state, and reports an auth-provider failure instead of failing silently (`src/App.tsx`,
`src/index.css`).

Added a car-culture experience layer without turning the app into a car-only product. Vehicle
missions can use a per-user default or per-mission override: **Collector’s Desk** gives
price-floor and aspirational acquisitions a selective, evidence-led presentation, while **Deal
Radar** makes ceiling/value missions concise and action-oriented. Adaptive vehicle missions choose
those profiles from the mission direction; watches and reservation missions remain neutral. A garage
brief now records transmission, drive side, maximum mileage, exterior colour, must-have details, and
hard no’s. These criteria and the chosen profile carry through search queries, native Firecrawl
monitor queries and summaries, verification prompts, email-intent parsing, dashboard notes, and emailed results
(`convex/market.ts`, `convex/schema.ts`, `convex/preferences.ts`, `convex/hunts.ts`,
`convex/hunt.ts`, `convex/verify.ts`, `convex/inboundActions.ts`, `src/App.tsx`,
`src/index.css`).

Added a live Garage Brief for every vehicle mission. It turns the existing verified-candidate
trail into an evidence-backed weekly ritual: a “one to watch,” a candid near-miss, or a calm
explanation that nothing is worth interrupting the user for yet. Deal Radar briefs surface a
single act-or-walk-away decision; Collector’s Desk briefs favour comparative evidence over false
urgency. An hourly Convex cron identifies Monday 09:00 in each mission’s configured time zone,
creates an idempotent delivery marker, and sends the brief through the existing opted-in email
thread only when that mission’s weekly ritual is enabled; dashboard-only behaviour and quiet/digest
delivery rules remain intact
(`convex/garageBriefs.ts`, `convex/garageBriefActions.ts`, `convex/crons.ts`,
`convex/schema.ts`, `src/App.tsx`, `src/index.css`).

The weekly email ritual is reversible from either channel: a user can switch it on or off in the
mission dashboard or reply in the linked AgentMail thread with that request. Inbox-side changes
verify the thread owner and mission category before updating the same persisted setting, and leave
the live dashboard brief available when email delivery is turned off (`convex/inboundActions.ts`,
`convex/hunts.ts`).

Verified locally on 2026-09-13 with `npx convex typecheck`, `npx tsc --noEmit`, and a Vite
production build directed to a temporary output folder. No production deployment, live URL,
external email, or provider request was performed as part of this update.

### 2026-09-15 — production hardening (working tree)
Hardened the routes most likely to cause real-user harm before a public release. Agent inboxes are
now explicit, private, and owner-scoped; the shared-inbox fallback and the provider-message listing
route were removed. Duplicate legacy mappings fail closed; all mappings to a shared physical inbox
are disabled before any owner can move to a new private inbox, so a partially migrated legacy inbox
can never become accidentally usable. Password sign-up now requires email confirmation and uses a
configured AgentMail operational inbox to send that confirmation.

Added per-user capacity controls for inbox provisioning, manual hunts, and monitor creation;
reduced candidate search result limits; changed automatic hunt cadence to 15 minutes; and added
durable retry/backoff for queued email delivery. New candidates no longer retain raw scraped listing
text, public candidate reads exclude legacy raw text, and scheduled retention removes short-lived
webhook/message/idempotency data after 30 days and operational records after 90 days. Hunt results
now prominently say they are based on available listing information, not an inspection, title
check, valuation, or guarantee.

Added `convex-test` coverage for cross-account candidate access, ambiguous inbox rejection,
durable retry persistence, provisioning limits, and message retention. Verified locally with
`npm test` (5 passing tests), `npm run lint`, `npm run build`, `git diff --check`, and
`npm audit --omit=dev --audit-level=high` (0 vulnerabilities). No production deployment or live
end-to-end provider exercise was performed. The target deployment must set
`AUTH_EMAIL_INBOX_ID` and `AUTH_EMAIL_FROM` before password confirmation email can be enabled;
the OpenAI/NVIDIA provider contract remains intentionally unchanged.

### 2026-09-16 — development email-auth configuration
Configured the dedicated AgentMail operational inbox on the Convex development deployment for
password-confirmation delivery (`AUTH_EMAIL_INBOX_ID`, `AUTH_EMAIL_FROM`). This inbox is reserved
for Jamanyo system email and is not a shared customer-agent inbox. No production configuration,
customer inbox provisioning, or live confirmation-email exercise was performed in this update.

### 2026-09-16 — development deployment
Published the current Convex functions and schema to the development deployment with TypeScript
typechecking enabled. The deployment includes the private-inbox, webhook, retry, retention, and
email-confirmation configuration work recorded above. No production deployment or live
confirmation-email account test was performed.

Updated the password experience in the same development deployment: new passwords now require at
least eight characters, existing users are never blocked by a browser-side password-length check,
and invalid credentials produce a generic customer-safe message rather than an internal auth error.
For pre-verification accounts, a correct existing-password sign-in starts the configured email
confirmation flow. Verified locally with the test suite, TypeScript checks, and a production build.

### 2026-09-16 — development authentication repair
Corrected the development authentication configuration after a real sign-in trace showed that a
correct password could not begin email confirmation because `SITE_URL` and `JWKS` were absent.
Kept the existing signing key, configured its matching public JWKS, and set the development return
origin. The public development signing-key endpoint now responds successfully. No production
configuration, account data, or live confirmation-email exercise was changed in this update.

### 2026-09-16 — development AgentMail credential repair
A live confirmation attempt reached the AgentMail send request but was rejected. Diagnostics showed
the current local credential could access the configured operational inbox while the development
deployment held a different credential. Updated that development-only secret and verified the
deployment credential now matches the local one and can read the inbox. No production setting or
additional confirmation email was sent as part of the repair.

### 2026-09-16 — development confirmation-delivery diagnostics
After synchronizing credentials, a confirmation request still reached the provider but failed with
an opaque response. Confirmed the active inbox-scoped credential is valid and is not explicitly
restricted from sending. Published a development-only, redacted provider diagnostic at the
boundary so the next attempt can identify the rejection class without recording recipient,
verification-link, or credential data. TypeScript validation passed; no production setting or test
email was sent.

### 2026-09-16 — development confirmation-send repair
Provider diagnostics identified a validation failure in the confirmation email's idempotency key:
the previous delimiter was not allowed by AgentMail. Replaced it with a permitted delimiter while
retaining a unique key per verification token; the token source is alphanumeric. Published this
development-only repair after the test suite (five passing tests), TypeScript checks, and production
build all passed. A real resend remains the final delivery confirmation; no production change was
made.

### 2026-09-16 — development magic-link completion repair
Completed the browser side of password confirmation. The client automatically redeems a clicked
link with its one-time code, while the default email-provider authorization expected a separate
email form field and rejected that callback. Configured the documented magic-link behavior so the
single-use, 30-minute code completes the verified session. Published after five passing tests,
TypeScript checks, and a production build; no production deployment was made.

### 2026-09-16 — development verification-provider registration repair
A live confirmation-link callback revealed one remaining configuration omission: the email verifier
was supplied to the Password provider but was not registered in Convex Auth's provider list.
Registered it alongside Password so Convex can resolve the emailed code and complete the verified
session. This corrects the prior magic-link completion entry. Published to the development
deployment after five passing tests, TypeScript checks, a production build, and a whitespace check;
no production deployment or account data change was made.

### 2026-09-16 — development verification round trip
Confirmed the repaired password-confirmation flow with a real development sign-in: Convex redeemed
the confirmation code, refreshed the authenticated session, signed out, and then completed a normal
password sign-in with a refreshed session. This validates existing-account verification, sign-out,
and subsequent verified sign-in without recording account or inbox identifiers. No production
deployment was performed.

### 2026-09-16 — development activity-feed response repair
Fixed a dashboard crash exposed after creating a mission. The per-mission and recent activity
queries returned full Convex event documents, including system fields, while their declared response
validators omitted those fields. Both queries now use the schema-derived event-document validator,
and regression coverage exercises the authorized post-create activity feed (`convex/events.ts`,
`tests/production-hardening.test.ts`). Verified with six passing tests, TypeScript checks, a
production build, and a whitespace check; published to development only.

### 2026-09-16 — development Firecrawl and inbox-setup repair
Removed Firecrawl's paid-tier threat-protection option from the scrape, search, crawl, and interact
calls after a development search showed the capability was unavailable to the current account.
Private inbox setup now resolves the authenticated Convex Auth user's verified email from its user
record rather than relying on an optional session claim; accounts without a verified email remain
blocked. Added regression coverage for verified-email ownership. Verified with seven passing tests,
TypeScript checks, a production build, and a whitespace check; published to development only.

### 2026-09-16 — development inbox-provisioning diagnostics
Hardened private inbox provisioning after a user-triggered provider creation returned only a generic
failure. Provider errors now record only redacted status, name, and code; creation conflicts are
detected by status and can recover a pre-existing deterministic inbox across paginated results.
Known permission and quota failures now return actionable dashboard messages without falling back to
a shared inbox (`convex/mail.ts`). Verified with seven passing tests, TypeScript checks, a
production build, and a whitespace check; published to development only.

### 2026-09-16 — development AgentMail provisioning permission diagnosis
A live private-inbox request confirmed that the configured AgentMail credential is missing the
provider's inbox-creation permission. Jamanyo keeps private inbox isolation in place and tells the
user to install a workspace-level credential with that permission instead of silently sharing an
inbox. No production deployment or provider data mutation was performed.

### 2026-09-16 — development Firecrawl source-limitation handling
Normalized Firecrawl's known unsupported-source response into a typed scrape result. A hunt now
records that detailed inspection was limited and continues from available search metadata, while
unexpected scrape failures still surface normally (`convex/firecrawl.ts`, `convex/hunt.ts`).
Verified with seven passing tests, TypeScript checks, a production build, and a whitespace check;
published to development only.

### 2026-09-16 — development email-access gate and controlled demo
Replaced raw inbox-provisioning failures with typed dashboard states: verified users can join an
idempotent private-inbox waitlist while the dashboard remains fully usable. Private provisioning is
closed by default until a credential with the needed provider capability is installed. A single,
deployment-configured verified account can opt into the existing operational inbox for a labelled
demo; the allowlist value and inbox identifiers are not recorded here.

The demo mapping is one-to-one, and inbound mail accepts agent commands only from its verified
owner; third-party senders are accepted solely as replies to that owner's approved outreach thread
(`convex/mail.ts`, `convex/inbox.ts`, `convex/http.ts`, `src/App.tsx`). The allowlist is rechecked
in dashboard, webhook, and sending paths, so removing or changing it revokes a prior demo mapping.
Verified with nine passing tests, TypeScript checks, a production build, and a whitespace check;
published to development only.

### 2026-09-16 — development AgentMail idempotency contract repair
A real demo send surfaced an AgentMail header validation rule: Jamanyo's semantic idempotency keys
could contain characters that the provider rejects. Outbound sends and threaded replies now encode
only at the provider boundary, preserving internal Convex idempotency keys and deterministic retry
behavior. The encoding is collision-safe, so an existing underscore cannot be confused with an
escaped character (`convex/agentmailIdempotency.ts`, `convex/mail.ts`). Added regression coverage
for allowed output, retry determinism, collision safety, and the empty-key fallback. The prior
failed provider request did not send an email; a subsequent retry uses the repaired key. Verified
with 10 passing tests, TypeScript checks, a production build, a whitespace check, and a
development-only Convex publish with typechecking enabled.

### 2026-09-16 — development inbound-email delivery repair
A live demo proved outbound agent mail but showed no inbound webhook activity after a reply.
Provider inspection found no inbox-scoped subscription: an app-wide signing-secret setting had
caused setup to skip the per-inbox webhook even though no discoverable app-wide subscription was
present. Jamanyo now always creates or reuses the inbox-specific `message.received` subscription
and retains its signing secret. Verification prefers that inbox secret while accepting a configured
app-wide secret during transition (`convex/mail.ts`, `convex/http.ts`).

Existing inboxes now expose only a safe connection-state flag, never the secret, and show a
Reconnect email control when repair is needed (`convex/inbox.ts`, `src/App.tsx`). Added regression
coverage for connected and disconnected states without leaking webhook credentials. Verified locally
with 11 passing tests, TypeScript checks, a production build, and a whitespace check; published to
the development deployment with Convex typechecking enabled.

### 2026-09-16 — development vehicle dossier and source-media update
Made the car experience more useful without turning Jamanyo into a copied listing marketplace.
Vehicle missions now carry a small canonical brief—make, model, generation, variant, year range,
body style, and originality—from either the dashboard or a natural-language email request. The same
brief reaches search, monitoring, and source assessment so the dashboard and agent inbox remain two
interchangeable ways to run one mission.

When Firecrawl provides source metadata, Jamanyo preserves the listing title and a public Open Graph
or source image URL alongside the assessed candidate. URLs are constrained to ordinary public HTTP(S)
addresses; the app never fetches listing media server-side. The dashboard adds a Mission Dossier,
observed-listing-range context explicitly labelled as not a valuation, evidence coverage, source
provenance, and visual candidate cards. A real source photo appears only when available; otherwise a
clearly labelled Jamanyo fallback avoids pretending that a generic image depicts the vehicle. Cards
separate what the listing says, the agent's observed signals, and what still requires direct human
confirmation. Garage Brief highlights use the same source-media treatment and no longer describe an
LLM assessment as a verification or inspection.

Added regression coverage for structured vehicle briefs and owner-scoped source title/image metadata.
Verified with 12 passing tests, TypeScript checks, a production build, a whitespace check, and a
development-only Convex publish with typechecking enabled. No production deployment, source scrape,
or account data change was made for this entry.

### 2026-09-16 — development source-actionability gate
Separated useful research from buyer-actionable leads. Each newly assessed source records whether it
was a specific listing, whether detailed inspection succeeded, and whether it is a potential lead,
research, or unavailable source. A lead now requires a specific available listing, successful
detailed inspection, and an explicit price when the mission has a price floor or ceiling.

The dashboard places non-leads in a collapsed Research Trail and keeps them from notifications,
seller-outreach drafts, Garage Brief recommendations, and market-range context. A buyer can mark a
source they cannot open as unavailable; the mutation is owner-scoped, idempotent, logged in activity,
and preserves that demotion when the source is seen again. Older candidates are safely treated as
research until a fresh assessment writes the new disposition (`convex/candidates.ts`,
`convex/hunt.ts`, `convex/verify.ts`, `convex/garageBriefs.ts`, `src/App.tsx`).

Also clarified that the legacy internal vehicle category covers all enthusiast vehicles, not only
exotic supercars, so the assessor does not reject an appropriate car on that wording alone. Added
coverage for authorization, legacy-result suppression, user source reporting, and non-repromotion.
Verified with 13 passing tests, TypeScript checks, a production build, a whitespace check, and a
development-only Convex function publish with typechecking enabled. No production deployment or
source-account creation was performed.

### 2026-09-16 — live development source-quality validation
Ran a dashboard-only, exact-match vehicle mission for a manual E46 M3 below USD 35,000. Email,
agent-inbox setup, and seller outreach were disabled; after the completed check, the test mission
was paused. Firecrawl returned 12 sources and Jamanyo promoted zero: ten generic research,
search, valuation, editorial, or category pages remained in the Research Trail, while two sources
with restricted detailed inspection were labelled unavailable. One social-post result appeared to
meet the car and price criteria, but was correctly withheld because its source could not be fully
inspected. The live result validates the false-positive gate and exposes the next discovery task:
prefer individual listing-detail pages over broad web-result pages. No production deployment,
external account creation, email, or seller contact occurred.

### 2026-09-16 — human-first discovery and listing-quality update
Added three persisted entry points for enthusiast-car missions: a known-car brief for people who
have the taxonomy, a guided human-language brief for people who know the feeling or use case, and
a direct public-listing check. Guided briefs retain a short description, selected lifestyle cues,
and an ownership appetite without requiring a make, model, or year. The verifier receives that
brief as a fit criterion, but the existing evidence rule remains intact: only a detailed,
inspectable, currently available specific listing with an explicit price can become a potential
lead for a budget mission.

Discovery now sends Firecrawl a listing-focused query using quoted vehicle identity where known,
listing-language terms, and negative content terms. It passes a market location and either the
user's domain allow-list or a default exclusion list for content/community surfaces; explicit
user domain rules still take precedence. A user-supplied listing is inspected directly instead of
being sent through a broad web search. Firecrawl results continue through detailed scraping and
the structured OpenAI/NVIDIA verification step before they appear in the dashboard.

The React dashboard now starts missions with “I know the car,” “I know the feeling,” or “I found
something” cards. Taxonomy appears only on the known-car route; guided discovery uses plain-language
prompts, lifestyle directions, and ownership appetite. Location, source preferences, delivery,
alert timing, email, and seller-contact controls are progressive disclosure rather than a required
intake form. Scout Settings received the same treatment: a base-camp card, visual personality
choices, and an optional advanced source/contact panel. Mission evidence wording now distinguishes
sources screened from inspectable listings, and the dashboard-only Garage Brief no longer claims
that email delivery is enabled.

Verified locally with `npm test -- --run` (15 passing tests), TypeScript linting, a Vite production
build to a temporary directory, and `git diff --check`. The Convex functions and schema were then
published only to the development deployment with typechecking enabled. No production deployment,
external hunt run, email, seller contact, account creation, or third-party login occurred.

### 2026-09-16 — live development guided-discovery validation
Ran one dashboard-only guided car mission with a bounded USD budget, a plain-language brief for an
analogue manual weekend car, two lifestyle directions, and a learning-oriented ownership appetite.
No email, agent-inbox activation, seller contact, account creation, or production deployment was
involved. The mission created successfully and its first manual market check completed without a
runtime error, but Firecrawl returned zero listing-focused sources; therefore Jamanyo processed and
cleared zero candidates.

This is an important product finding rather than a successful result to overstate. The guided
query currently concatenates every selected lifestyle phrase, ownership phrase, the full natural-
language brief, listing-only constraints, and the Deal Radar suffix into a single search request
(`convex/hunt.ts`). That makes an exploratory brief brittle: the UI accepts a human description,
but the retrieval layer still behaves like an over-specified database query. The calm empty state
truthfully avoids inventing a lead, yet it does not tell the user whether Jamanyo found no sources
or rejected weak sources, nor offer a useful next move. The next discovery iteration should turn a
guided brief into a small, diverse set of vehicle hypotheses or query lanes, retain provenance per
lane, and explain the zero-result state in human terms before asking for more constraint. No code
or deployment change was made from this live validation.

### 2026-09-16 — transparent guided-discovery lanes
Implemented the next discovery iteration from the live validation. A person who knows the feeling
but not the taxonomy can now save a guided enthusiast-car brief as a one-off market check, with no
budget or background monitoring required. The initial form asks only for a plain-language picture,
up to three desired feelings, and ownership appetite; budget, ongoing scouting, and search style
remain optional in the collapsed fine-tuning area.

The backend turns that brief into at most three separate, human-readable search hypotheses. It uses
the existing model path when available and a deterministic, non-prescriptive fallback when it is
not. Each Firecrawl search is bounded to four results; the three lanes run independently with
`Promise.allSettled`, duplicate URLs are removed, and each lane records whether it found sources,
found none, or was temporarily unavailable. That means one search/provider failure does not erase
the useful work from the other directions. A zero-source pass is shown as a search outcome—not a
market verdict—and the user can explicitly choose “Broaden the scout” for a wider retry. One-off
missions are excluded from the recurring sweep, so Jamanyo never implies it is monitoring when it
is not.

The dashboard now exposes the directions, their rationale, and source counts in a Guided Discovery
Map; it uses an abstract discovery visual until a real listing image exists. Existing guided
missions that ran before this schema still render honestly as needing a fresh map rather than
claiming their old generic pass used the new strategy. Mission titles retain the person’s own brief
instead of collapsing back to the legacy internal category name. On small screens, the header uses
compact controls, missions become a horizontal rail, and the title/badge row wraps cleanly rather
than crushing the mission name.

This pattern was informed by Firecrawl’s public search example, which retries a different strategy
when initial results are insufficient and only deep-dives when data is missing, and by TinyFish
cookbook examples that isolate source failures with bounded parallel work. Jamanyo adopts the
resilient lane pattern without adding a new scraping vendor or asking users to provide credentials
to listing sites. Firecrawl remains responsible for web discovery and readable source content;
Jamanyo’s verifier remains responsible for the evidence gate.

Verified with 19 passing regression tests, TypeScript linting, a Vite production build to a
temporary directory, whitespace validation, and a development-only Convex publish with typechecking
enabled. The guided form and phone-sized layout were also inspected in the local preview. No
production deployment, external hunt run, email, seller contact, third-party login, or account
creation occurred for this entry.

### 2026-09-16 — mission management and live development update
Added full owner-scoped mission management to the dashboard. A mission can now be edited in place
without creating a duplicate: Jamanyo preserves its channel/thread relationship, records a
`hunt_updated` activity event, marks the previous research trail as potentially based on the old
brief, and uses the new criteria only on the next check. For a live Firecrawl monitor, the backend
first stops the old monitor, saves the new brief transactionally, then creates a monitor from the
new criteria. If native monitoring is unavailable during that refresh, the mission truthfully
falls back to scheduled search without automatically spending a new search run just because the
user pressed Save.

The dashboard now has a compact **Edit mission** route and a deliberate **Remove mission**
confirmation. Removal immediately hides the mission from its owner-facing list, stops a remote
monitor before local deletion, and removes local candidates, feedback, outreach drafts, queued
notifications, activity, runs, monitor checks, and linked local thread records in small scheduled
batches. The worker waits for an in-flight hunt to complete and retires queued runs before it
clears data, so removal cannot leave a late result behind. Already delivered external email is
explicitly called out as non-recallable. Delayed monitor callbacks and email-thread commands no-op
safely while removal is in progress
(`convex/hunts.ts`, `convex/schema.ts`, `convex/hunt.ts`, `convex/firecrawl.ts`,
`convex/inboundActions.ts`, `src/App.tsx`, `src/index.css`).

Added authorization and lifecycle coverage: another account cannot update or delete a mission; an
edit clears a stale guided-discovery map without silently queuing a hunt; deletion removes the
owner's local trail without affecting another owner's mission; and an in-flight hunt keeps the
mission in its temporary deleting state until it finishes. Verified with 22 passing regression
tests, TypeScript linting, a Vite production build, whitespace validation, and a development-only
Convex publish with typechecking enabled.

Ran one intentional live development update on the existing paused manual E46 M3 mission: changed
its presentation from Deal Radar to Collector's Desk. The mission remained paused and did not start
a Firecrawl check; the sidebar badge, dossier language, Garage Brief language, saved-brief warning,
and activity feed all updated reactively. The deletion confirmation was opened and then cancelled;
no live mission was removed. No production deployment, email, seller contact, third-party login,
or account creation occurred.

### 2026-09-16 — working tree — dossier reliability and common-car validation
Fixed a dashboard layout defect that was compressing the Mission Dossier into a 42-pixel strip in
the vertical flex layout. Detail cards now retain their natural height and the dashboard scrolls,
so the vehicle brief, source image or fallback visual, market context, evidence coverage, and current
call are all visible together (`src/index.css`). The Dossier now subscribes to the mission's recent
run state and distinguishes an active check, a failed check, a paused mission, a completed check
with no usable evidence, and sources screened with no qualifying lead (`src/App.tsx`). It no longer
labels an already-started or completed check as “First check ready.”

Ran one dashboard-only development mission for a common manual roadster with a USD ceiling. The
precise first Firecrawl query returned zero sources. Jamanyo then used one bounded fallback search
with simpler vehicle terms, the same market/domain scope, and a maximum of eight results; that
fallback returned eight listing-focused sources. The first source was a known user-inaccessible
marketplace, so the test mission was paused before it could be misrepresented as a completed
lead-quality result. This validates the empty-query recovery path while leaving the final source
quality assessment explicitly unfinished.

The scraper now disables Firecrawl's multi-minute automatic resume for a slow source, allowing a
mission to continue from limited search evidence rather than hanging on one marketplace. The known
inaccessible marketplace is excluded from default discovery, but a user's explicit preferred-domain
choice still overrides that default (`convex/firecrawl.ts`, `convex/market.ts`). Added regression
coverage for the fallback query and default exclusion. Verified with 24 passing tests, TypeScript
linting, a Vite production build, whitespace validation, a browser inspection of the repaired
Dossier, and development-only Convex publishes with typechecking enabled. No production deployment,
email, seller contact, third-party login, account creation, or external account action occurred.

### 2026-09-17 — working tree — source-navigation validation
Compared the same two common-car briefs against Classic.com's public market surfaces and ran two
temporary dashboard-only Jamanyo checks restricted to `classic.com`. Classic resolves the Miata
brief to the canonical ND-generation market (`2016–2023`) and exposes individual active cards with
year, price, mileage, transmission, drive side, location, status, seller/source, verification
signal, image count, and update/auction timing. The public page visibly contained manual
2016–2022 listings under the brief's USD 25,000 ceiling. Its canonical E46 manual-coupe market
also exposed active listing cards and a separate market benchmark, making the distinction between
a market context page and an individual sale clear.

Both Jamanyo checks showed the present discovery gap honestly. The exact Firecrawl search returned
zero sources, then the bounded eight-result fallback located Classic taxonomy pages. For the
Miata, it initially visited NA, NB, and NC market hubs rather than the ND generation; for the E46,
it correctly descended from the E46 M3 market to the canonical manual-coupe market. The verifier
rejected every market page as `research`: no specific vehicle, explicit asking price, or confirmed
availability was present. The E46 market benchmark was explicitly treated as context rather than a
listing price. Both temporary tests were paused after the evaluation.

The resulting source-navigation recommendation is evidence-first: resolve a vehicle brief to a
source-specific canonical market route, enumerate its public individual listing cards, apply
year/transmission/price/status constraints there, and then verify each direct listing URL. Market
pages should enrich the dossier and never become leads. No Classic account, follow/save action,
seller contact, email, production deployment, or source adapter implementation occurred in this
validation.

A second public-source pass across Bring a Trailer and Hemmings confirmed the same navigation
shape with different price semantics. Bring a Trailer resolves each car to a dedicated vehicle hub
and separates live auctions from completed results and editorial content; its direct listing pages
provide auction state, current bid, end time, and detailed condition/provenance evidence. Hemmings
uses make/model classified hubs that mix classified, make-offer, and auction cards with direct
listing pages that expose an asking price and structured vehicle facts. A sampled E46 listing had a
top-level transmission value that conflicted with its descriptive summary, validating the need for
Jamanyo to surface explicit source-evidence conflicts rather than trust one field. No account,
watchlist, contact, email, production deployment, or source-adapter implementation occurred.

### 2026-09-17 — source-access and regional-discovery decision
Defined Jamanyo's source portfolio as a ranked, permission-aware registry rather than an attempt
to crawl every marketplace. A mission will select a small set of sources by vehicle type, buyer
intent, location, listing format, evidence quality, and available access route; direct listing
pages remain the only buyer-actionable evidence, while aggregators and market pages remain
discovery or context.

Facebook Marketplace is intentionally not an automated Jamanyo source at this stage. User
passwords, session cookies, background browser automation, and autonomous seller messages are
out of scope; unsupported Marketplace listings can instead be submitted by a buyer for a
human-triggered evidence check. Regional structured marketplaces and enthusiast auction sites
are candidates for future source adapters only after their permitted access path and listing
quality are validated. No Facebook connection, account access, source adapter, deployment, or
 external account action was implemented in this decision.

### 2026-09-17 — development — source-aware vehicle discovery and evidence safety
Implemented a small, explicit vehicle-source registry for Classic.com, Bring a Trailer, and
Hemmings (`convex/sourceRegistry.ts`). Known-car searches now run source-specific, bounded
queries in parallel, distinguish individual vehicle pages from market hubs, and only pass route
shapes understood as direct listings to evidence review. Recognised hubs are mapped once for
direct pages; non-listing/editorial routes are not promoted into the research trail. If the
portfolio finds no direct page, Jamanyo makes one bounded broader listing search rather than
pretending to have comprehensive coverage. Each pass persists a source plan with page counts,
availability states, source format, and price meaning, which the dashboard renders as a compact
"Source portfolio" rather than hiding the search scope (`convex/hunt.ts`, `convex/hunts.ts`,
`convex/schema.ts`, `convex/market.ts`, `src/App.tsx`, `src/index.css`).

Firecrawl requests now use a shared 30-second client timeout with no hidden transport retries
(`convex/firecrawl.ts`). A slow source therefore records as unavailable for this pass instead of
holding the whole mission open; a later scheduled check can retry it independently.

Price treatment is now source-aware. Classified listings use asking-price semantics; a live
auction may use a current bid; a market benchmark or completed result cannot support a ceiling or
floor decision. The verifier receives that route context and the dashboard labels the number as
"Asking price", "Current bid", "Buy now", or market context instead of calling every number an
asking price. Raw internal flags in the evidence trail are translated into plain language.

Ran a temporary, dashboard-only development E46 M3 manual mission against the default portfolio.
Classic and Hemmings returned market routes but no direct vehicle pages; Bring a Trailer supplied
one direct auction page. An initial live pass exposed a useful safety failure: a page title that
said the auction was closed could be misread as a live current bid by the model. Jamanyo did not
send email or contact a seller, but the result made the gap clear. Added a deterministic
source-declared closed/sold guard (`convex/listingEvidence.ts`) that overrides model availability,
marks the price as historical context, removes it from potential leads, and puts the source's
closed-state explanation first in the evidence trail. The final confirmation pass screened one
direct page and cleared zero leads; the closed auction was recorded only as research. The temporary
mission was then paused so it cannot create further checks.

Verified with 26 passing regression tests, TypeScript linting, a Vite production build, and
development-only Convex publishes with typechecking enabled. No production deployment, email,
seller contact, third-party login, or external account creation occurred for this entry.

### 2026-09-17 — development — truthful auction monitoring and dashboard validation
Added a dedicated **Auction Watch** path for one public, specific listing. It stores observable
facts separately from ordinary discovery—visible bid or asking price, currency, reserve signal,
availability, stated end time, source evidence, and alert milestones—rather than treating an
auction as a normal market search. The first snapshot is deliberately silent; later notifications
require a material public change or a meaningful deadline milestone. Jamanyo does not generate a
valuation, inspection outcome, or bidding instruction from this path (`convex/auctionWatches.ts`,
`convex/schema.ts`, `convex/firecrawl.ts`, `convex/hunts.ts`, `convex/crons.ts`).

Firecrawl monitor callbacks now use a dedicated deployment-configured callback URL and an
HMAC-SHA-256 signature check over the raw request body. The HTTP route claims an idempotency record
and returns quickly before scheduling the heavier provider/LLM/email work. Pause, resume, and
archive actions now synchronise the upstream Firecrawl monitor rather than changing only the
dashboard status. A monitor that cannot start is recorded as **needs attention**, not claimed as
active; Auction Watch keeps the mission saved, exposes a retry, and never silently falls back to a
generic search (`convex/http.ts`, `convex/firecrawl.ts`, `convex/hunts.ts`).

The dashboard now has a compact Watch Health strip and three clear views—Now, Leads, and Research.
An auction mission uses a single-listing dossier and direct source scope instead of a generic market
portfolio or weekly Garage Brief. Its creation form removes discovery-only location, source,
serendipity, and seller-contact controls after “Watch one live auction” is selected. Paused,
archived, rate-limited, and provider-failure states use plain language and never expose a raw
Convex stack trace. Garage Briefs are also disabled in the form, owner/email mutations, and weekly
delivery worker for Auction Watch missions (`src/App.tsx`, `src/index.css`, `convex/hunts.ts`,
`convex/garageBriefs.ts`).

Ran a dashboard-only development test with a public BMW M3 auction listing. The first attempt
correctly exposed missing callback configuration; that was repaired with development-only Convex
environment settings. A second attempt revealed that Firecrawl SDK v4 interprets `maxRetries: 0`
as zero attempts, so the client now uses one bounded attempt. The repaired test created a real
Firecrawl monitor, then successfully completed provider-synchronised active → paused → active →
paused lifecycle transitions; it was left paused after the test to avoid background provider use.
No email, seller contact, account creation, production deployment, or third-party login was
involved. The provider had not produced its first scheduled check by the end
of the session, so a real signed Firecrawl callback and downstream notification remain explicitly
unverified.

Verified after the changes with `npx tsc --noEmit`, `npm test -- --run` (29 passing tests),
`npm run build`, `git diff --check`, a development-only Convex publish, and browser inspection of
the auction form, active/paused/resumed monitor state, and Now/Leads/Research views. No production
deployment has been performed.

### 2026-09-17 — development — launch-preflight reliability pass
Completed a production-readiness pass across Jamanyo's public Convex surface, owner scoping,
webhook signature boundaries, bounded database reads, scheduled work, and deployment configuration.
The password auth provider and its subject-keyed identity tables are present; each browser-facing
mission, inbox, candidate, activity, watch, preference, outreach, and email setup path derives the
caller from Convex Auth and verifies mission ownership before it reads or changes a record. All
scheduled work targets private `internal.*` functions.

Made one reliability repair: queued-email recovery now passes an explicit clock into its internal
query instead of evaluating the wall clock inside a query. That keeps due-retry selection
deterministic and avoids a cached query missing a newly-due update (`convex/notifications.ts`,
`convex/hunt.ts`). Added regression coverage for that boundary.

Verified with 30 passing regression tests, a TypeScript production build, a clean production
dependency audit, and a development-only Convex function publish. No production deployment,
email, seller contact, third-party login, or external account creation occurred for this entry.

### 2026-09-17 — development — useful first email update
Replaced the generic dashboard-email connection note with a mission-specific, status-aware update.
For example, a paused BMW M3 Auction Watch now identifies itself by vehicle and explains that no
further checks or alerts will run until it is resumed. Active watches describe the narrow kinds of
changes that can trigger an update, including auction timing milestones. This makes the first email
both a safe connection check and an honest operational state update (`convex/hunt.ts`).

Added regression coverage for the tailored subject and paused-watch wording. Verified with 31
passing regression tests, a TypeScript production build, and a development-only Convex function
publish. The external development-email delivery is staged but not yet sent; it awaits an explicit
action-time confirmation. No production deployment, seller contact, third-party login, or account
creation occurred for this entry.

### 2026-09-17 — development — resilient single-account email demo
Hardened the controlled email demo against a development auth-account reset. If and only if the
current account verifies the exact configured demo address, Jamanyo can reclaim that one existing
demo-inbox mapping and retain its webhook secret. It cannot reclaim a private inbox, a mapping for
another address, or a second mapping; this preserves the one-physical-inbox/one-account boundary
and prevents ambiguous inbound ownership (`convex/inbox.ts`, `convex/mail.ts`).

Added positive and negative regression coverage for same-email recovery. Verified with 33 passing
regression tests, a TypeScript production build, and a development-only Convex function publish.
The external development-email delivery remains staged but unsent; no production deployment,
seller contact, third-party login, or account creation occurred for this entry.

### 2026-09-17 — live development email-thread validation
Reconnected the single configured development demo inbox to its same verified test account, then
enabled email updates for the paused BMW M3 Auction Watch. The first connection attempt uncovered a
truthfulness bug: the scheduler would not initialize an email thread for a paused mission, leaving
the dashboard in a pending state even though no message could be sent. Jamanyo now permits that one
initial status note for paused missions, while all future hunt and monitor updates remain suppressed
until the mission resumes (`convex/hunt.ts`).

After the development-only repair, AgentMail accepted the single mission-specific update and
Jamanyo recorded its outbound thread; the dashboard reached its active email-and-dashboard history
state. The watch remained paused throughout, so the test did not consume a new Firecrawl check or
send a seller message. Verified with 33 passing regression tests, a TypeScript production build,
and development-only Convex publishes. No production deployment, third-party login, or account
creation occurred for this entry.

### 2026-09-17 — development — email-first guided discovery repair
A real development email describing a desired kind of car without naming a model reached the signed
AgentMail webhook and exposed an email-only gap: its classifier produced a conventional vehicle
mission without enough taxonomy, so validation failed before Jamanyo could reply. The inbound
delivery was received; no mission or response was created by that failed attempt.

The inbound intent path now recognises known-car, guided-discovery, and listing-review requests.
A model-less enthusiast-car brief becomes a sanitised, one-off guided market map that retains its
budget and constraints but never starts recurring monitoring without an explicit follow-up. If a
recoverable request-validation mismatch still occurs, Jamanyo replies with a useful clarification
instead of returning a webhook 500 and leaving the sender in silence (`convex/inboundActions.ts`).

Added a regression test that normalises a plain-English email brief and persists the resulting
guided mission. Verified with 34 passing regression tests, TypeScript checks, a Vite production
build, whitespace validation, and a development-only Convex publish. No production deployment,
additional provider email, seller contact, third-party login, or account creation occurred.

### 2026-09-17 — live development guided-email round trip
Retested the repaired email path with a plain-English, model-less car brief. The signed AgentMail
webhook created the mission successfully, queued its first market pass, and accepted Jamanyo’s
threaded acknowledgement; the outbound message was also recorded in the shared mission history.
The webhook completed with HTTP 200. A repeat provider delivery was deduplicated safely, so the
same email could not create a second mission or reply.

This validates the email-first guided-discovery handoff through the development deployment:
inbound email → interpreted guided brief → durable hunt run → threaded AgentMail reply. The
acknowledgement is provider-accepted; the asynchronous market pass continues separately. No
production deployment, seller contact, third-party login, or private-inbox provisioning change
occurred in this validation.

### 2026-09-17 — public development static-hosting deployment
Installed and registered Convex Static Hosting while preserving existing root-level Convex Auth and
signed AgentMail and Firecrawl webhook routes. The static catch-all is registered after those exact
routes, so the public single-page app can own navigation without changing the stable integration
URLs (`convex/convex.config.ts`, `convex/http.ts`, `package.json`).

Published the validated React build to the public Convex development site. The hosted sign-in page
rendered successfully, and the release passed TypeScript checks, 34 regression tests, and a Vite
production build. The controlled demo inbox remains available only to its configured verified
account; private inbox provisioning remains disabled, with all other accounts offered a dashboard
and waitlist path. No Convex production deployment, seller contact, third-party login, or private
inbox creation occurred.
