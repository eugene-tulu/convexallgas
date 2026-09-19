import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";

const CATEGORIES = ["hypercar", "watch", "reservation", "salvage_flip"] as const;
const DIRECTIONS = [
  { value: "below", label: "Find below a budget" },
  { value: "above", label: "Find above a floor" },
  { value: "match", label: "Find a specific match" },
] as const;
const DISCOVERY_VIBES = [
  { value: "weekend_escape", label: "A proper weekend escape", note: "Something that makes an ordinary Saturday feel planned." },
  { value: "first_proper_car", label: "My first proper car", note: "Fun, forgiving, and easy to grow into." },
  { value: "road_trip", label: "Long-road energy", note: "Comfort, character, and miles that feel worth doing." },
  { value: "hands_on_project", label: "A car to learn on", note: "I want some spanners, stories, and progress." },
  { value: "understated_fast", label: "Quietly quick", note: "Interesting to the right people, invisible to everyone else." },
  { value: "occasion_car", label: "Make an entrance", note: "A car with theatre, character, and a reason to take the long way." },
] as const;
const QUIET_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SOURCE_SHORTCUTS = [
  { domain: "classic.com", label: "Classic.com" },
  { domain: "bringatrailer.com", label: "Bring a Trailer" },
  { domain: "hemmings.com", label: "Hemmings" },
] as const;

type Category = (typeof CATEGORIES)[number];
type Direction = (typeof DIRECTIONS)[number]["value"];
type DeliveryMode = "pickup" | "shipping" | "either";
type NotificationCadence = "instant" | "daily_digest";
type Serendipity = "exact" | "smart" | "delight";
type ContactPolicy = "alerts_only" | "draft_for_review";
type Urgency = "whenever" | "soon" | "urgent";
type ExperienceProfile = "collector" | "deal_radar" | "adaptive";
type MissionIntent = "known_car" | "guided" | "listing_review";
type HuntMode = "search" | "monitor" | "one_off";
type MonitorPurpose = "discovery" | "auction";
type DiscoveryVibe = (typeof DISCOVERY_VIBES)[number]["value"];
type OwnershipAppetite = "turn_key" | "learn_as_i_go" | "hands_on";
type DiscoveryBrief = {
  prompt?: string;
  vibes?: DiscoveryVibe[];
  ownershipAppetite?: OwnershipAppetite;
};
type FeedbackKind =
  | "good_lead"
  | "wrong_style"
  | "too_expensive"
  | "too_far"
  | "not_trusted";

type CandidateForUser = Omit<Doc<"candidates">, "rawContent">;
type HuntRunForUser = {
  status: "queued" | "running" | "completed" | "failed";
  scheduledAt: number;
  startedAt?: number;
  finishedAt?: number;
};

type MonitorCheckForUser = {
  _id: Id<"monitorChecks">;
  checkId: string;
  status: string;
  changed: number;
  added: number;
  removed: number;
  errors: number;
  changedUrls: string[];
  createdAt: number;
};

type HuntSpec = {
  make?: string;
  model?: string;
  generation?: string;
  variant?: string;
  minYear?: number;
  maxYear?: number;
  bodyStyle?:
    | "coupe"
    | "convertible"
    | "sedan"
    | "wagon"
    | "suv"
    | "truck"
    | "hatchback"
    | "other"
    | "either";
  originality?: "original" | "modified" | "restomod" | "either";
  brand?: string;
  venueName?: string;
  city?: string;
  dateRangeStart?: number;
  dateRangeEnd?: number;
  partySize?: number;
  salvageOnly?: boolean;
  maxMileage?: number;
  transmission?: "manual" | "automatic" | "either";
  driveSide?: "left" | "right" | "either";
  exteriorColor?: string;
  mustHave?: string;
  avoid?: string;
};

type ScoutPreferences = {
  currency: string;
  locale: string;
  timeZone: string;
  countryCode?: string;
  locality?: string;
  radiusKm?: number;
  deliveryMode: DeliveryMode;
  allowedCountries?: string[];
  language?: string;
  notificationCadence: NotificationCadence;
  weeklyGarageBrief: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  serendipity: Serendipity;
  experienceProfile: ExperienceProfile;
  contactPolicy: ContactPolicy;
  preferredDomains?: string[];
  blockedDomains?: string[];
};

type PreferenceForm = {
  currency: string;
  timeZone: string;
  countryCode: string;
  locality: string;
  radiusKm: string;
  deliveryMode: DeliveryMode;
  notificationCadence: NotificationCadence;
  weeklyGarageBrief: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  serendipity: Serendipity;
  experienceProfile: ExperienceProfile;
  contactPolicy: ContactPolicy;
  preferredDomains: string;
  blockedDomains: string;
};

const DEFAULT_PREFERENCES: ScoutPreferences = {
  currency: "USD",
  locale: "en",
  timeZone: "UTC",
  deliveryMode: "either",
  notificationCadence: "instant",
  weeklyGarageBrief: true,
  serendipity: "smart",
  experienceProfile: "adaptive",
  contactPolicy: "draft_for_review",
};

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function huntRunErrorMessage(error: unknown): string {
  const message = errorMessage(error, "");
  if (/provider request failed|firecrawl|temporarily unavailable/i.test(message)) {
    return "Jamanyo couldn't reach every source just now. Your mission is still saved—try again shortly or bring a listing directly for a focused check.";
  }
  if (/paused or archived/i.test(message)) {
    return "Resume this mission before asking Jamanyo to check again.";
  }
  return errorMessage(error, "The scout couldn't start this check. Please try again.");
}

function monitorErrorMessage(error: unknown): string {
  const message = errorMessage(error, "");
  if (/rate limit|retry after/i.test(message)) {
    return "Jamanyo has reached this source’s short request limit. Your watch is safely paused; retry it in a minute and it will continue from the same mission.";
  }
  if (/auction watch|monitor webhook|firecrawl/i.test(message)) {
    return "Jamanyo could not start this public-listing watch, so it is not checking the auction right now. Retry the watch shortly; the mission and its evidence are still saved.";
  }
  if (/monitoring capacity/i.test(message)) {
    return "Jamanyo has reached its temporary watch capacity. This mission is saved; try starting the watch again shortly.";
  }
  return errorMessage(error, "Jamanyo couldn't start this watch. The mission is still saved, so you can retry shortly.");
}

function authenticationErrorMessage(
  error: unknown,
  mode: "signIn" | "signUp",
): string {
  const message = errorMessage(error, "");
  if (/InvalidSecret|Invalid credentials/i.test(message)) {
    return "Email or password is incorrect.";
  }
  if (/valid email address/i.test(message)) {
    return "Enter a valid email address.";
  }
  if (/at least 8 characters/i.test(message)) {
    return "Use a password with at least 8 characters.";
  }
  if (/confirmation email|Email verification is not configured/i.test(message)) {
    return "We couldn't send a confirmation email. Please try again shortly.";
  }
  return mode === "signUp"
    ? "We couldn't create your account. Please try again."
    : "We couldn't sign you in. Please try again.";
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitList(value: string): string[] | undefined {
  const values = [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
  return values.length > 0 ? values : undefined;
}

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatHuntBudget(hunt: Doc<"hunts">): string | null {
  if (hunt.money?.amountMinor !== undefined) {
    return formatMoney(hunt.money.amountMinor, hunt.money.currency);
  }
  return hunt.threshold !== undefined ? hunt.threshold.toLocaleString() : null;
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    hypercar: "Enthusiast car",
    watch: "Watch",
    reservation: "Reservation",
    salvage_flip: "Salvage flip",
  };
  return labels[category] ?? category;
}

function discoveryVibeLabel(value: string): string {
  return DISCOVERY_VIBES.find((vibe) => vibe.value === value)?.label ?? value.replace(/_/g, " ");
}

function missionIntentLabel(intent: MissionIntent | undefined): string | null {
  if (intent === "guided") return "Human-first car brief";
  if (intent === "listing_review") return "Listing check";
  return null;
}

function directionLabel(direction: string): string {
  if (direction === "below") return "Budget ceiling";
  if (direction === "above") return "Price floor";
  return "Specific match";
}

function huntDirectionLabel(hunt: Doc<"hunts">): string {
  if (hunt.missionIntent === "guided" && hunt.direction === "match") {
    return "Open discovery";
  }
  return directionLabel(hunt.direction);
}

function isVehicleCategory(category: string): boolean {
  return category === "hypercar" || category === "salvage_flip";
}

function profileForHunt(hunt: Doc<"hunts">): ExperienceProfile {
  if (hunt.experienceProfile) return hunt.experienceProfile;
  if (!isVehicleCategory(hunt.category)) return "adaptive";
  if (hunt.direction === "above") return "collector";
  if (hunt.direction === "below") return "deal_radar";
  return "adaptive";
}

function profileLabel(profile: ExperienceProfile): string {
  if (profile === "collector") return "Collector’s Desk";
  if (profile === "deal_radar") return "Deal Radar";
  return "Adaptive scout";
}

function profileDescription(profile: ExperienceProfile): string {
  if (profile === "collector") {
    return "Selective, story-rich notes on provenance, condition, specification, and long-term desirability.";
  }
  if (profile === "deal_radar") {
    return "Fast, practical signals on availability, price, condition risk, and whether to act or walk away.";
  }
  return "A balanced search style that adjusts to each mission.";
}

function marketLabel(hunt: Doc<"hunts">): string {
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(", ");
  const radius = hunt.market?.radiusKm ? `${hunt.market.radiusKm} km` : null;
  const delivery =
    hunt.market?.deliveryMode === "pickup"
      ? "pickup"
      : hunt.market?.deliveryMode === "shipping"
        ? "shipping"
        : null;
  return [location, radius, delivery].filter(Boolean).join(" · ") || "Any suitable market";
}

function alertLabel(hunt: Doc<"hunts">): string {
  const cadence = hunt.notificationCadence === "daily_digest" ? "Daily digest" : "Instant alerts";
  const quiet =
    hunt.quietHoursStart !== undefined && hunt.quietHoursEnd !== undefined
      ? `Quiet ${String(hunt.quietHoursStart).padStart(2, "0")}:00–${String(hunt.quietHoursEnd).padStart(2, "0")}:00`
      : null;
  return [cadence, quiet, hunt.timeZone].filter(Boolean).join(" · ");
}

function sourceLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Listing source";
  }
}

function candidateSourceLabel(candidate: CandidateForUser): string {
  return candidate.verification.sourceContext?.sourceLabel ?? sourceLabel(candidate.sourceUrl);
}

function listingPriceLabel(
  priceType: CandidateForUser["verification"]["priceType"],
): string {
  if (priceType === "current_bid") return "Current bid";
  if (priceType === "buy_now") return "Buy now";
  if (priceType === "market_context") return "Market context";
  if (priceType === "asking_price") return "Asking price";
  return "Listed price";
}

function sourcePlanStatusLabel(status: string): string {
  if (status === "sources_found") return "Ready to inspect";
  if (status === "no_sources") return "No pages surfaced";
  if (status === "unavailable") return "Temporarily unavailable";
  return "Skipped";
}

function signalLabel(signal: string): string {
  const labels: Record<string, string> = {
    sold_listing: "Already sold",
    not_currently_available: "Not available now",
    auction_price_can_change: "Auction bid can change",
    market_context_not_a_listing: "Market context, not an individual listing",
    historical_price_not_actionable: "Historic result, not a live price",
    not_a_listing: "Not an individual listing",
    editorial_content: "Editorial content",
    not_a_specific_listing: "No specific vehicle offered",
    availability_not_confirmed: "Availability not confirmed",
    price_not_actionable: "Price cannot support a decision",
    source_unavailable_to_user: "Source unavailable to you",
    source_says_listing_closed: "Source says this listing has closed",
  };
  return labels[signal] ?? signal.replace(/_/g, " ");
}

function publicImageUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function vehicleMissionTitle(hunt: Doc<"hunts">): string {
  if (!isVehicleCategory(hunt.category)) return categoryLabel(hunt.category);
  if (hunt.missionIntent === "guided") {
    const prompt = hunt.discoveryBrief?.prompt?.replace(/\s+/g, " ").trim();
    if (prompt) return prompt.length > 72 ? `${prompt.slice(0, 69)}…` : prompt;
    const vibes = hunt.discoveryBrief?.vibes?.map(discoveryVibeLabel) ?? [];
    return vibes.length > 0 ? vibes.join(" · ") : "Find my kind of car";
  }
  if (hunt.missionIntent === "listing_review") return "Check this listing";
  const spec = hunt.spec as HuntSpec;
  const years =
    spec.minYear && spec.maxYear
      ? `${spec.minYear}–${spec.maxYear}`
      : spec.minYear
        ? `${spec.minYear}+`
        : spec.maxYear
          ? `Before ${spec.maxYear}`
          : "";
  return [years, spec.make, spec.model, spec.variant].filter(Boolean).join(" ") || "Vehicle mission";
}

function vehicleSpecFacts(hunt: Doc<"hunts">): string[] {
  const spec = hunt.spec as HuntSpec;
  const years =
    spec.minYear && spec.maxYear
      ? `${spec.minYear}–${spec.maxYear}`
      : spec.minYear
        ? `${spec.minYear}+`
        : spec.maxYear
          ? `before ${spec.maxYear}`
          : undefined;
  const bodyStyle =
    spec.bodyStyle && spec.bodyStyle !== "either"
      ? spec.bodyStyle === "suv"
        ? "SUV"
        : spec.bodyStyle
      : undefined;
  const originality =
    spec.originality && spec.originality !== "either"
      ? spec.originality === "restomod"
        ? "restomod"
        : spec.originality
      : undefined;
  const discoveryFacts =
    hunt.missionIntent === "guided"
      ? [
          ...(hunt.discoveryBrief?.vibes?.map(discoveryVibeLabel) ?? []),
          hunt.discoveryBrief?.ownershipAppetite === "turn_key"
            ? "turn-key preferred"
            : hunt.discoveryBrief?.ownershipAppetite === "learn_as_i_go"
              ? "learn as I go"
              : hunt.discoveryBrief?.ownershipAppetite === "hands_on"
                ? "hands-on welcome"
                : undefined,
        ]
      : hunt.missionIntent === "listing_review"
        ? ["shared listing"]
        : [];
  return [
    years,
    spec.generation ? `Gen ${spec.generation}` : undefined,
    spec.variant,
    bodyStyle,
    originality,
    spec.transmission && spec.transmission !== "either"
      ? spec.transmission
      : undefined,
    spec.driveSide && spec.driveSide !== "either"
      ? `${spec.driveSide.toUpperCase()}HD`
      : undefined,
    spec.maxMileage ? `≤ ${spec.maxMileage.toLocaleString()} mi` : undefined,
    spec.exteriorColor,
    ...discoveryFacts,
  ].filter((fact): fact is string => Boolean(fact));
}

function candidateTitle(candidate: CandidateForUser): string {
  return candidate.verification.listingTitle || candidateSourceLabel(candidate);
}

function isPotentialLead(candidate: CandidateForUser): boolean {
  return candidate.clearsThreshold && candidate.disposition === "potential_lead";
}

function candidateDecision(candidate: CandidateForUser): {
  label:
    | "Pursue"
    | "Ask first"
    | "Watch"
    | "Pass"
    | "Research"
    | "Needs review"
    | "Source unavailable";
  tone: "pursue" | "ask" | "watch" | "pass";
} {
  const verification = candidate.verification;
  if (
    candidate.disposition === "source_unavailable" ||
    candidate.sourceInspection === "user_reported_unavailable"
  ) {
    return { label: "Source unavailable", tone: "pass" };
  }
  if (candidate.disposition === "research") {
    return { label: "Research", tone: "watch" };
  }
  if (!isPotentialLead(candidate)) {
    return { label: "Needs review", tone: "watch" };
  }
  if (
    verification.availability === "available" &&
    verification.sellerTrust === "reviewed" &&
    verification.flags.length === 0
  ) {
    return { label: "Pursue", tone: "pursue" };
  }
  if (isPotentialLead(candidate)) return { label: "Ask first", tone: "ask" };
  if (verification.availability === "unavailable") return { label: "Pass", tone: "pass" };
  return { label: "Watch", tone: "watch" };
}

function observedMarketContext(
  hunt: Doc<"hunts">,
  candidates: CandidateForUser[],
): {
  headline: string;
  detail: string;
  sourceCount: number;
  photoCount: number;
} {
  const inspectedListings = candidates.filter(
    (candidate) =>
      candidate.sourceInspection === "inspected" &&
      candidate.verification.listingKind === "specific_listing",
  );
  const prices = inspectedListings.flatMap((candidate) => {
    const verification = candidate.verification;
    return (
      verification.listingPriceMinor !== undefined &&
      verification.listingCurrency &&
      (verification.priceType === "asking_price" || verification.priceType === "buy_now")
    )
      ? [{ amountMinor: verification.listingPriceMinor, currency: verification.listingCurrency }]
      : [];
  });
  const targetCurrency = hunt.money?.currency?.toUpperCase();
  const byCurrency = new Map<string, number[]>();
  for (const price of prices) {
    const group = byCurrency.get(price.currency) ?? [];
    group.push(price.amountMinor);
    byCurrency.set(price.currency, group);
  }
  const selectedCurrency =
    targetCurrency && byCurrency.has(targetCurrency)
      ? targetCurrency
      : [...byCurrency.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const selectedPrices = selectedCurrency ? byCurrency.get(selectedCurrency) ?? [] : [];
  const sourceCount = new Set(inspectedListings.map(candidateSourceLabel)).size;
  const photoCount = inspectedListings.filter((candidate) =>
    Boolean(publicImageUrl(candidate.verification.listingImageUrl)),
  ).length;

  if (!selectedCurrency || selectedPrices.length === 0) {
    return {
      headline: "Waiting for an explicit asking price",
      detail: "Jamanyo only builds a range from fixed asking or buy-now prices. Live auction bids and market benchmarks stay separate.",
      sourceCount,
      photoCount,
    };
  }

  const low = Math.min(...selectedPrices);
  const high = Math.max(...selectedPrices);
  const headline =
    low === high
      ? `${formatMoney(low, selectedCurrency)} observed`
      : `${formatMoney(low, selectedCurrency)}–${formatMoney(high, selectedCurrency)} observed`;
  return {
    headline,
    detail: `From ${selectedPrices.length} assessed ${selectedPrices.length === 1 ? "listing" : "listings"} with an explicit fixed ${selectedCurrency} price. This is mission context, not a valuation.`,
    sourceCount,
    photoCount,
  };
}

function ListingVisual({
  title,
  sourceUrl,
  imageUrl,
  className = "",
}: {
  title: string;
  sourceUrl: string;
  imageUrl?: string;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const safeImage = publicImageUrl(imageUrl);
  const source = sourceLabel(sourceUrl);
  if (!safeImage || imageFailed) {
    return (
      <div className={`listing-visual listing-visual-fallback ${className}`} role="img" aria-label={`No listing photo available from ${source}`}>
        <span className="listing-visual-mark">J</span>
        <span>Listing photo unavailable</span>
        <small>{source}</small>
      </div>
    );
  }
  return (
    <div className={`listing-visual ${className}`}>
      <img
        src={safeImage}
        alt={`${title} listing photo`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    </div>
  );
}

function DiscoveryCompass({
  hunt,
  onBroaden,
  broadening = false,
}: {
  hunt: Doc<"hunts">;
  onBroaden?: () => void;
  broadening?: boolean;
}) {
  if (hunt.missionIntent !== "guided") return null;
  const plan = hunt.discoveryPlan;
  const noSources = plan?.sourceCount === 0;
  const needsRemap = !plan && Boolean(hunt.lastRunAt);
  const allSearchesUnavailable =
    Boolean(plan?.lanes.length) && plan?.lanes.every((lane) => lane.status === "unavailable");
  return (
    <section className="card discovery-compass" aria-label="Guided discovery map">
      <div className="discovery-compass-heading">
        <div>
          <p className="brief-kicker">Scout’s first hunches</p>
          <h3>{plan ? "The directions your scout explored" : needsRemap ? "Ready to remap the market" : "Ready for the first market map"}</h3>
        </div>
        {plan && <span className="discovery-breadth">{plan.breadth === "wide" ? "wider pass" : "first pass"}</span>}
      </div>
      <p className="mission-dossier-lede">
        {plan
          ? "These are search hypotheses, not verdicts on what you should buy. Each one stays separate so you can see what the web actually returned."
          : needsRemap
            ? "An earlier search predates this transparent map. Run another check to see three separate listing directions and what each one returns."
            : "When you run the first check, Jamanyo will try three different listing directions instead of forcing you to know the taxonomy upfront."}
      </p>
      {plan && (
        <div className="discovery-lane-list">
          {plan.lanes.map((lane) => (
            <article className="discovery-lane" key={`${lane.label}-${lane.searchTerms}`}>
              <div>
                <strong>{lane.label}</strong>
                <p>{lane.rationale}</p>
              </div>
              <span className={`discovery-lane-status discovery-${lane.status}`}>
                {lane.status === "sources_found"
                  ? `${lane.resultCount} source${lane.resultCount === 1 ? "" : "s"}`
                  : lane.status === "no_sources"
                    ? "None surfaced"
                    : "Unavailable"}
              </span>
            </article>
          ))}
        </div>
      )}
      {noSources && (
        <div className="discovery-outcome">
          <div>
            <strong>{allSearchesUnavailable ? "The search source was temporarily unavailable." : "No listing sources came back from this pass."}</strong>
            <p>{allSearchesUnavailable ? "No market conclusion was drawn. Try the same map again later." : "That is a search outcome, not proof that the kind of car you want does not exist."}</p>
          </div>
          {onBroaden && !allSearchesUnavailable && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onBroaden} disabled={broadening}>
              {broadening ? "Broadening…" : "Broaden the scout"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBriefTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function preferenceFormFrom(preferences: ScoutPreferences): PreferenceForm {
  return {
    currency: preferences.currency,
    timeZone: preferences.timeZone,
    countryCode: preferences.countryCode ?? "",
    locality: preferences.locality ?? "",
    radiusKm: preferences.radiusKm?.toString() ?? "",
    deliveryMode: preferences.deliveryMode,
    notificationCadence: preferences.notificationCadence,
    weeklyGarageBrief: preferences.weeklyGarageBrief,
    quietHoursStart: preferences.quietHoursStart?.toString() ?? "22",
    quietHoursEnd: preferences.quietHoursEnd?.toString() ?? "07",
    serendipity: preferences.serendipity,
    experienceProfile: preferences.experienceProfile,
    contactPolicy: preferences.contactPolicy,
    preferredDomains: preferences.preferredDomains?.join(", ") ?? "",
    blockedDomains: preferences.blockedDomains?.join(", ") ?? "",
  };
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="card modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AuthGate() {
  const { signIn } = useAuthActions();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn("password", {
        flow: mode === "signUp" ? "signUp" : "signIn",
        email,
        password,
        ...(mode === "signUp" ? { name } : {}),
        redirectTo: window.location.origin,
      });
      setVerificationSent(!result.signingIn);
    } catch (caught) {
      setError(authenticationErrorMessage(caught, mode));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1>Jamanyo</h1>
        <p>Your personal scout for scarce, time-sensitive things.</p>
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button type="button" className={`tab-btn ${mode === "signIn" ? "active" : ""}`} onClick={() => { setMode("signIn"); setVerificationSent(false); setError(null); }}>Sign in</button>
          <button type="button" className={`tab-btn ${mode === "signUp" ? "active" : ""}`} onClick={() => { setMode("signUp"); setVerificationSent(false); setError(null); }}>Create account</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-row">
              <label>Email</label>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
            </div>
            <div className="form-row">
              <label>{mode === "signUp" ? "Password (at least 8 characters)" : "Password"}</label>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === "signUp" ? 8 : undefined} autoComplete={mode === "signUp" ? "new-password" : "current-password"} />
            </div>
            {mode === "signUp" && (
              <div className="form-row">
                <label>Name</label>
                <input type="text" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
            )}
          </div>
          {verificationSent && <p className="field-note" role="status">Check your inbox for a confirmation link. Existing accounts receive one after a correct sign-in until their email is verified.</p>}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={submitting}>
            {submitting ? "Working…" : verificationSent ? "Resend confirmation email" : mode === "signUp" ? "Create my scout" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ScoutSettings({ onClose }: { onClose: () => void }) {
  const preferences = useQuery(api.preferences.getMine, {});
  const savePreferences = useMutation(api.preferences.saveMine);
  const initialized = useRef(false);
  const [form, setForm] = useState<PreferenceForm>(preferenceFormFrom(DEFAULT_PREFERENCES));
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preferences || initialized.current) return;
    initialized.current = true;
    setForm(preferenceFormFrom(preferences));
    setQuietEnabled(
      preferences.quietHoursStart !== undefined && preferences.quietHoursEnd !== undefined,
    );
  }, [preferences]);

  const update = <Key extends keyof PreferenceForm>(key: Key, value: PreferenceForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const base = preferences ?? DEFAULT_PREFERENCES;
    try {
      await savePreferences({
        currency: form.currency.trim().toUpperCase(),
        locale: base.locale,
        timeZone: form.timeZone.trim(),
        countryCode: form.countryCode.trim() || undefined,
        locality: form.locality.trim() || undefined,
        radiusKm: numberOrUndefined(form.radiusKm),
        deliveryMode: form.deliveryMode,
        allowedCountries: base.allowedCountries,
        language: base.language,
        notificationCadence: form.notificationCadence,
        weeklyGarageBrief: form.weeklyGarageBrief,
        quietHoursStart: quietEnabled ? numberOrUndefined(form.quietHoursStart) : undefined,
        quietHoursEnd: quietEnabled ? numberOrUndefined(form.quietHoursEnd) : undefined,
        serendipity: form.serendipity,
        experienceProfile: form.experienceProfile,
        contactPolicy: form.contactPolicy,
        preferredDomains: splitList(form.preferredDomains),
        blockedDomains: splitList(form.blockedDomains),
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't save those scout settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Scout settings" onClose={onClose}>
      <p className="modal-intro">Set the few things your scout should remember. New missions borrow these defaults; you can always change the mood or the rules for one particular hunt.</p>
      <form onSubmit={handleSave}>
        <section className="settings-home-card">
          <div>
            <p className="brief-kicker">Base camp</p>
            <h3>Where and how you tend to look</h3>
            <p className="field-note">A city or region is plenty—never an exact address.</p>
          </div>
        <div className="settings-grid">
          <div className="form-row">
            <label>Default currency</label>
            <input value={form.currency} maxLength={3} onChange={(event) => update("currency", event.target.value.toUpperCase())} placeholder="USD" required />
          </div>
          <div className="form-row">
            <label>Time zone</label>
            <input value={form.timeZone} onChange={(event) => update("timeZone", event.target.value)} placeholder="Africa/Nairobi" required />
          </div>
          <div className="form-row">
            <label>Country code</label>
            <input value={form.countryCode} maxLength={2} onChange={(event) => update("countryCode", event.target.value.toUpperCase())} placeholder="KE" />
          </div>
          <div className="form-row">
            <label>City or region</label>
            <input value={form.locality} onChange={(event) => update("locality", event.target.value)} placeholder="Nairobi" />
          </div>
          <div className="form-row">
            <label>Local radius (km)</label>
            <input type="number" min="1" max="20000" value={form.radiusKm} onChange={(event) => update("radiusKm", event.target.value)} placeholder="100" />
          </div>
          <div className="form-row">
            <label>Delivery preference</label>
            <select value={form.deliveryMode} onChange={(event) => update("deliveryMode", event.target.value as DeliveryMode)}>
              <option value="either">Pickup or shipping</option>
              <option value="pickup">Pickup only</option>
              <option value="shipping">Shipping only</option>
            </select>
          </div>
        </div>
        </section>

        <div className="form-section">
          <h3>Give the scout a personality</h3>
          <div className="form-grid two-columns">
            <div className="form-row">
              <label>Alert rhythm</label>
              <select value={form.notificationCadence} onChange={(event) => update("notificationCadence", event.target.value as NotificationCadence)}>
                <option value="instant">Tell me as soon as it matters</option>
                <option value="daily_digest">One considered daily digest</option>
              </select>
            </div>
            <div className="form-row">
              <label>Discovery style</label>
              <select value={form.serendipity} onChange={(event) => update("serendipity", event.target.value as Serendipity)}>
                <option value="exact">Exact only</option>
                <option value="smart">Smart nearby alternatives</option>
                <option value="delight">Surprise me with great adjacent finds</option>
              </select>
            </div>
          </div>
          <div className="profile-choice-grid" role="radiogroup" aria-label="Default car mission experience">
            {([
              ["adaptive", "Adaptive", "Let the hunt decide the pace."],
              ["collector", "Collector’s Desk", "Selective, evidence-led, and editorial."],
              ["deal_radar", "Deal Radar", "Fast signals for a buy-or-walk-away call."],
            ] as Array<[ExperienceProfile, string, string]>).map(([value, label, note]) => <button key={value} type="button" role="radio" aria-checked={form.experienceProfile === value} className={`profile-choice ${form.experienceProfile === value ? "selected" : ""}`} onClick={() => update("experienceProfile", value)}><strong>{label}</strong><small>{note}</small></button>)}
          </div>
          <p className="field-note" style={{ marginTop: 8 }}>This is a starting character, not a status tier. Every mission can still choose its own pace.</p>
          <label className="check-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={form.weeklyGarageBrief} onChange={(event) => update("weeklyGarageBrief", event.target.checked)} />
            Send a calm weekly Garage Brief for vehicle missions
          </label>
          <p className="field-note" style={{ marginTop: 4 }}>It shares a considered lead, a useful near-miss, or a clear all-quiet update—never a marketing blast.</p>
          <label className="check-row">
            <input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />
            Respect quiet hours
          </label>
          {quietEnabled && (
            <div className="form-grid two-columns" style={{ marginTop: 8 }}>
              <div className="form-row">
                <label>Quiet from</label>
                <select value={form.quietHoursStart} onChange={(event) => update("quietHoursStart", event.target.value)}>
                  {QUIET_HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Quiet until</label>
                <select value={form.quietHoursEnd} onChange={(event) => update("quietHoursEnd", event.target.value)}>
                  {QUIET_HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <details className="settings-advanced">
          <summary>
            <span>Source rules and seller contact</span>
            <small>Only if you have strong preferences.</small>
          </summary>
          <div className="settings-advanced-body">
          <div className="form-grid two-columns">
            <div className="form-row">
              <label>Only search these domains</label>
              <input value={form.preferredDomains} onChange={(event) => update("preferredDomains", event.target.value)} placeholder="example.com, dealer.org" />
              <p className="field-note">Leave empty to let each mission choose its source portfolio.</p>
            </div>
            <div className="form-row">
              <label>Never use these domains</label>
              <input value={form.blockedDomains} onChange={(event) => update("blockedDomains", event.target.value)} placeholder="avoid.example" />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 10 }}>
            <label>Seller contact</label>
            <select value={form.contactPolicy} onChange={(event) => update("contactPolicy", event.target.value as ContactPolicy)}>
              <option value="draft_for_review">Prepare drafts; I approve every send</option>
              <option value="alerts_only">Alerts only; never draft seller outreach</option>
            </select>
          </div>
          </div>
        </details>

        {error && <p className="error-msg" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save scout settings"}</button>
        </div>
      </form>
    </Modal>
  );
}

function NewHuntForm({
  initialHunt,
  onClose,
  onCreated,
}: {
  initialHunt?: Doc<"hunts">;
  onClose: () => void;
  onCreated: (huntId: Id<"hunts">) => void;
}) {
  const editing = initialHunt !== undefined;
  const preferences = useQuery(api.preferences.getMine, {});
  const createHunt = useMutation(api.hunts.createHunt);
  const updateMission = useAction(api.hunts.updateMission);
  const getOrCreateInbox = useAction(api.mail.getOrCreateInbox);
  const startMonitor = useAction(api.hunts.startMonitor);
  const initialized = useRef(false);
  const initialThreshold = initialHunt?.threshold ??
    (initialHunt?.money?.amountMinor !== undefined
      ? initialHunt.money.amountMinor / 100
      : undefined);
  const remainingHours = initialHunt?.expiresAt
    ? Math.max(1, Math.ceil((initialHunt.expiresAt - Date.now()) / (60 * 60 * 1000)))
    : undefined;
  const [category, setCategory] = useState<Category>(initialHunt?.category ?? "hypercar");
  const [direction, setDirection] = useState<Direction>(initialHunt?.direction ?? "match");
  const [mode, setMode] = useState<HuntMode>(initialHunt?.mode ?? "search");
  const [monitorPurpose, setMonitorPurpose] = useState<MonitorPurpose>(
    initialHunt?.monitorPurpose ?? "discovery",
  );
  const [missionIntent, setMissionIntent] = useState<MissionIntent>(initialHunt?.missionIntent ?? "known_car");
  const [discoveryPrompt, setDiscoveryPrompt] = useState(initialHunt?.discoveryBrief?.prompt ?? "");
  const [discoveryVibes, setDiscoveryVibes] = useState<DiscoveryVibe[]>(initialHunt?.discoveryBrief?.vibes ?? []);
  const [ownershipAppetite, setOwnershipAppetite] = useState<OwnershipAppetite>(initialHunt?.discoveryBrief?.ownershipAppetite ?? "learn_as_i_go");
  const [threshold, setThreshold] = useState(initialThreshold?.toString() ?? "");
  const [spec, setSpec] = useState<HuntSpec>(initialHunt?.spec ?? {});
  const [currency, setCurrency] = useState(initialHunt?.money?.currency ?? "USD");
  const [countryCode, setCountryCode] = useState(initialHunt?.market?.countryCode ?? "");
  const [locality, setLocality] = useState(initialHunt?.market?.locality ?? "");
  const [radiusKm, setRadiusKm] = useState(initialHunt?.market?.radiusKm?.toString() ?? "");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(initialHunt?.market?.deliveryMode ?? "either");
  const [urgency, setUrgency] = useState<Urgency>(initialHunt?.urgency ?? "soon");
  const [expiresHours, setExpiresHours] = useState(remainingHours?.toString() ?? "");
  const [notificationCadence, setNotificationCadence] = useState<NotificationCadence>(initialHunt?.notificationCadence ?? "instant");
  const [weeklyGarageBrief, setWeeklyGarageBrief] = useState(
    initialHunt ? initialHunt.weeklyGarageBrief === true : true,
  );
  const [quietEnabled, setQuietEnabled] = useState(initialHunt?.quietHoursStart !== undefined && initialHunt?.quietHoursEnd !== undefined);
  const [quietHoursStart, setQuietHoursStart] = useState(initialHunt?.quietHoursStart?.toString() ?? "22");
  const [quietHoursEnd, setQuietHoursEnd] = useState(initialHunt?.quietHoursEnd?.toString() ?? "07");
  const [timeZone, setTimeZone] = useState(initialHunt?.timeZone ?? browserTimeZone());
  const [serendipity, setSerendipity] = useState<Serendipity>(initialHunt?.serendipity ?? "smart");
  const [experienceProfile, setExperienceProfile] = useState<ExperienceProfile>(initialHunt?.experienceProfile ?? "adaptive");
  const [contactPolicy, setContactPolicy] = useState<ContactPolicy>(initialHunt?.contactPolicy ?? "draft_for_review");
  const [preferredDomains, setPreferredDomains] = useState(initialHunt?.sourcePreferences?.includeDomains?.join(", ") ?? "");
  const [blockedDomains, setBlockedDomains] = useState(initialHunt?.sourcePreferences?.excludeDomains?.join(", ") ?? "");
  const [sourceUrls, setSourceUrls] = useState(initialHunt?.sourceUrls?.join("\n") ?? "");
  const [notifyByEmail, setNotifyByEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isAuctionWatch =
    missionIntent !== "listing_review" && mode === "monitor" && monitorPurpose === "auction";

  useEffect(() => {
    if (!preferences || initialized.current) return;
    initialized.current = true;
    if (editing) return;
    setCurrency(preferences.currency);
    setCountryCode(preferences.countryCode ?? "");
    setLocality(preferences.locality ?? "");
    setRadiusKm(preferences.radiusKm?.toString() ?? "");
    setDeliveryMode(preferences.deliveryMode);
    setTimeZone(preferences.timeZone === "UTC" ? browserTimeZone() : preferences.timeZone);
    setNotificationCadence(preferences.notificationCadence);
    setWeeklyGarageBrief(preferences.weeklyGarageBrief);
    setQuietEnabled(preferences.quietHoursStart !== undefined && preferences.quietHoursEnd !== undefined);
    setQuietHoursStart(preferences.quietHoursStart?.toString() ?? "22");
    setQuietHoursEnd(preferences.quietHoursEnd?.toString() ?? "07");
    setSerendipity(preferences.serendipity);
    setExperienceProfile(preferences.experienceProfile);
    setContactPolicy(preferences.contactPolicy);
    setPreferredDomains(preferences.preferredDomains?.join(", ") ?? "");
    setBlockedDomains(preferences.blockedDomains?.join(", ") ?? "");
  }, [editing, preferences]);

  const updateSpec = <Key extends keyof HuntSpec>(key: Key, value: HuntSpec[Key]) => {
    setSpec((current) => ({ ...current, [key]: value }));
  };

  const chooseMissionIntent = (next: MissionIntent) => {
    setMissionIntent(next);
    setError(null);
    if (next !== "known_car") {
      setCategory("hypercar");
      setSpec({});
    }
    if (next === "listing_review") {
      setDirection("match");
      setThreshold("");
      setMode("search");
      setMonitorPurpose("discovery");
    } else if (next === "guided") {
      setDirection("match");
      setThreshold("");
      setMode("one_off");
      setMonitorPurpose("discovery");
    } else {
      setMode("search");
      setMonitorPurpose("discovery");
    }
  };

  const toggleDiscoveryVibe = (vibe: DiscoveryVibe) => {
    setDiscoveryVibes((current) => {
      if (current.includes(vibe)) return current.filter((item) => item !== vibe);
      return current.length >= 3 ? current : [...current, vibe];
    });
  };

  const togglePreferredSource = (domain: string) => {
    const selected = splitList(preferredDomains) ?? [];
    const next = selected.includes(domain)
      ? selected.filter((item) => item !== domain)
      : [...selected, domain];
    setPreferredDomains(next.join(", "));
  };

  const validateMission = () => {
    const sharedSources = splitList(sourceUrls);
    if (missionIntent === "guided" && !discoveryPrompt.trim() && discoveryVibes.length === 0) {
      throw new Error("Tell your scout what you want the car to feel like, or choose a few directions.");
    }
    if (missionIntent === "listing_review" && !sharedSources?.length) {
      throw new Error("Paste the public listing link you want Jamanyo to check.");
    }
    if (mode === "monitor" && monitorPurpose === "auction" && sharedSources?.length !== 1) {
      throw new Error("An Auction Watch needs one public, specific auction listing link.");
    }
    if (missionIntent === "known_car" && category === "hypercar" && !spec.make && !spec.model && !spec.minYear) {
      throw new Error("Add a make, model, or minimum year so your scout knows what to find.");
    }
    if (missionIntent === "known_car" && category === "watch" && !spec.brand) {
      throw new Error("Add the watch brand you want to find.");
    }
    if (missionIntent === "known_car" && category === "salvage_flip" && !spec.make && spec.salvageOnly === undefined) {
      throw new Error("Add a make or say whether this must be a salvage-title vehicle.");
    }
    if (missionIntent === "known_car" && category === "reservation" && !spec.venueName && !spec.city && !spec.partySize) {
      throw new Error("Add a venue, a city, or a party size for the reservation.");
    }
    if (direction !== "match" && numberOrUndefined(threshold) === undefined) {
      throw new Error("Set the budget or price threshold for this mission.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      validateMission();
      const budget = numberOrUndefined(threshold);
      const expiry = numberOrUndefined(expiresHours);
      const cadenceMinutes = urgency === "urgent" ? 15 : urgency === "whenever" ? 360 : 60;
      const sharedSources = splitList(sourceUrls);
      const effectiveMode: HuntMode = missionIntent === "listing_review" ? "search" : mode;
      const missionPayload = {
        direction,
        threshold: direction === "match" ? undefined : budget,
        money:
          direction === "match" || budget === undefined
            ? undefined
            : {
                currency: currency.trim().toUpperCase(),
                amountMinor: Math.round(budget * 100),
                includesFees: false,
              },
        spec: missionIntent === "known_car" ? spec : {},
        mode: effectiveMode,
        monitorPurpose: effectiveMode === "monitor" ? monitorPurpose : undefined,
        sourceUrls:
          missionIntent === "listing_review" || effectiveMode === "monitor"
            ? sharedSources
            : undefined,
        discoveryBrief:
          missionIntent === "guided"
            ? {
                prompt: discoveryPrompt.trim() || undefined,
                vibes: discoveryVibes.length > 0 ? discoveryVibes : undefined,
                ownershipAppetite,
              }
            : undefined,
        cadenceMinutes,
        market: {
          countryCode: countryCode.trim() || undefined,
          locality: locality.trim() || undefined,
          radiusKm: numberOrUndefined(radiusKm),
          deliveryMode,
        },
        timeZone: timeZone.trim(),
        notificationCadence,
        weeklyGarageBrief: isVehicleCategory(category) && !isAuctionWatch ? weeklyGarageBrief : false,
        quietHoursStart: quietEnabled ? numberOrUndefined(quietHoursStart) : undefined,
        quietHoursEnd: quietEnabled ? numberOrUndefined(quietHoursEnd) : undefined,
        serendipity,
        experienceProfile:
          missionIntent === "guided"
            ? experienceProfile
            : isVehicleCategory(category)
              ? experienceProfile
              : "adaptive",
        contactPolicy,
        urgency,
        expiresAt: expiry !== undefined ? Date.now() + expiry * 60 * 60 * 1000 : undefined,
        sourcePreferences: {
          includeDomains: splitList(preferredDomains),
          excludeDomains: splitList(blockedDomains),
        },
      };
      if (editing && initialHunt) {
        await updateMission({ huntId: initialHunt._id, ...missionPayload });
        onCreated(initialHunt._id);
      } else {
        if (notifyByEmail) {
          const inboxSetup = await getOrCreateInbox({ confirmed: true });
          if (inboxSetup.kind !== "ready") throw new Error(inboxSetup.message);
        }
        const huntId = await createHunt({
          category,
          missionIntent,
          notifyByEmail,
          ...missionPayload,
        });
        if (effectiveMode === "monitor") {
          try {
            await startMonitor({ huntId });
          } catch (monitorError) {
            // An Auction Watch is a usable saved mission even if its provider
            // connection is temporarily unavailable. The detail view makes
            // that fact explicit and offers a retry instead of trapping the
            // user in a form with a raw backend error.
            if (monitorPurpose === "auction") {
              onCreated(huntId);
              onClose();
              return;
            }
            throw monitorError;
          }
        }
        onCreated(huntId);
      }
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, editing ? "We couldn't update that mission." : "We couldn't create that mission."));
    } finally {
      setSubmitting(false);
    }
  };

  const showThreshold = missionIntent !== "listing_review" && direction !== "match";
  return (
    <Modal title={editing ? "Tune this mission" : "Give your scout a mission"} onClose={onClose}>
      <p className="modal-intro">{editing ? "Change the saved brief without starting a new search. Jamanyo will use it on the next check, and a live monitor is rebuilt from the new criteria." : "Start where your head is—not where a vehicle database expects it. You can make the brief more exact whenever you like."}</p>
      <form onSubmit={handleSubmit}>
        {!editing && <div className="mission-path-grid" role="radiogroup" aria-label="How you want to start">
          <button type="button" role="radio" aria-checked={missionIntent === "known_car"} className={`mission-path ${missionIntent === "known_car" ? "selected" : ""}`} onClick={() => chooseMissionIntent("known_car")}>
            <span className="mission-path-kicker">I know the car</span>
            <strong>Find a specific machine</strong>
            <small>Model, generation, trim—give the scout the nerdy bits.</small>
          </button>
          <button type="button" role="radio" aria-checked={missionIntent === "guided"} className={`mission-path ${missionIntent === "guided" ? "selected" : ""}`} onClick={() => chooseMissionIntent("guided")}>
            <span className="mission-path-kicker">I know the feeling</span>
            <strong>Find my kind of car</strong>
            <small>Describe the life, the mood, and how involved you want to be.</small>
          </button>
          <button type="button" role="radio" aria-checked={missionIntent === "listing_review"} className={`mission-path ${missionIntent === "listing_review" ? "selected" : ""}`} onClick={() => chooseMissionIntent("listing_review")}>
            <span className="mission-path-kicker">I found something</span>
            <strong>Check this listing</strong>
            <small>Bring a public link; Jamanyo will separate evidence from sales copy.</small>
          </button>
        </div>}
        {editing && <p className="field-note mission-edit-note">This stays a {(missionIntentLabel(missionIntent) ?? "known-car").toLowerCase()} mission. Start a fresh mission if you want to pursue a completely different thing.</p>}
        <div className="form-section">
          <h3>{missionIntent === "guided" ? "Paint the picture" : missionIntent === "listing_review" ? "Bring the listing" : "Name the thing"}</h3>
          {missionIntent === "known_car" ? (
            <div className="form-grid two-columns">
              {!editing ? <div className="form-row">
                <label>What are we looking for?</label>
                <select value={category} onChange={(event) => { setCategory(event.target.value as Category); setSpec({}); }}>
                  {CATEGORIES.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
                </select>
              </div> : <div className="form-row"><label>Mission type</label><p className="field-note">{categoryLabel(category)} · the saved path stays intact.</p></div>}
              <div className="form-row">
                <label>How should it run?</label>
                <select
                  value={mode === "monitor" && monitorPurpose === "auction" ? "auction" : mode}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "auction") {
                      setMode("monitor");
                      setMonitorPurpose("auction");
                    } else {
                      setMode(value as "search" | "monitor");
                      setMonitorPurpose("discovery");
                    }
                  }}
                >
                  <option value="search">Run a focused hunt</option>
                  <option value="monitor">Keep watch on the market</option>
                  <option value="auction">Watch one live auction</option>
                </select>
                <p className="field-note">
                  {mode === "monitor" && monitorPurpose === "auction"
                    ? "Jamanyo watches one public listing’s visible bid, reserve, availability, and stated end time. It will never guess a price or tell you to buy."
                    : mode === "monitor"
                      ? "A calm market watch: Jamanyo surfaces meaningful listing changes, not every page twitch."
                      : "One focused market pass, then you decide whether it deserves a watch."}
                </p>
              </div>
            </div>
          ) : null}
          {missionIntent === "guided" && (
            <div className="guided-brief">
              <div className="form-row">
                <label>What would make this car feel right?</label>
                <textarea rows={3} value={discoveryPrompt} onChange={(event) => setDiscoveryPrompt(event.target.value)} placeholder="For example: I want a small, analog car for weekend escapes—not precious, not a money pit, and fun enough to learn in." />
              </div>
              <div className="guided-vibes" aria-label="Choose up to three directions">
                <p className="field-note">Pick up to three starting directions. No taxonomy test required.</p>
                <div className="guided-vibe-grid">
                  {DISCOVERY_VIBES.map((vibe) => {
                    const selected = discoveryVibes.includes(vibe.value);
                    return <button key={vibe.value} type="button" className={`guided-vibe ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => toggleDiscoveryVibe(vibe.value)}>
                      <strong>{vibe.label}</strong>
                      <small>{vibe.note}</small>
                    </button>;
                  })}
                </div>
              </div>
              <fieldset className="ownership-picker">
                <legend>How involved do you want to be?</legend>
                {([
                  ["turn_key", "Turn-key", "I want to drive, not diagnose."],
                  ["learn_as_i_go", "Learn as I go", "A little learning is part of the point."],
                  ["hands_on", "Hands-on", "Give me the wrenching and the story."],
                ] as Array<[OwnershipAppetite, string, string]>).map(([value, label, note]) => <label key={value} className={`ownership-option ${ownershipAppetite === value ? "selected" : ""}`}><input type="radio" name="ownershipAppetite" value={value} checked={ownershipAppetite === value} onChange={() => setOwnershipAppetite(value)} /><span><strong>{label}</strong><small>{note}</small></span></label>)}
              </fieldset>
              <p className="field-note">Your first check maps three different listing directions—rather than pretending one phrase has already named the perfect car. You can add a budget or keep watching later.</p>
            </div>
          )}
          {missionIntent === "listing_review" && (
            <div className="guided-brief listing-review-brief">
              <div className="form-row">
                <label>Public listing link</label>
                <textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="https://example.com/listing" rows={3} required />
              </div>
              <p className="field-note">This is a source check, not a purchase recommendation. Jamanyo reads the available listing material, flags what is missing, and never contacts the seller on its own.</p>
            </div>
          )}
          {isVehicleCategory(category) && missionIntent === "known_car" && (
            <div className="experience-picker">
              <div className="form-row">
                <label>How should this car mission feel?</label>
                <select value={experienceProfile} onChange={(event) => setExperienceProfile(event.target.value as ExperienceProfile)}>
                  <option value="adaptive">Adaptive — choose the right pace</option>
                  <option value="collector">Collector’s Desk — selective and editorial</option>
                  <option value="deal_radar">Deal Radar — fast and decisive</option>
                </select>
              </div>
              <p className="field-note">{profileDescription(experienceProfile)}</p>
            </div>
          )}
          {missionIntent === "known_car" && <div className="direction-options">
            {DIRECTIONS.map((item) => (
              <label key={item.value} className="check-row">
                <input type="radio" name="direction" value={item.value} checked={direction === item.value} onChange={() => setDirection(item.value)} />
                {item.label}
              </label>
            ))}
          </div>}
          {missionIntent === "known_car" && showThreshold && (
            <div className="form-grid two-columns">
              <div className="form-row">
                <label>Budget / threshold</label>
                <input type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="200000" required />
              </div>
              <div className="form-row">
                <label>Currency</label>
                <input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="USD" required />
              </div>
            </div>
          )}
          {isVehicleCategory(category) && missionIntent === "known_car" && (
            <div className="car-brief">
              <p className="field-note">A good market comparison starts with the right car. Add only the details that actually matter; the same brief will work from dashboard or email.</p>
              <div className="form-grid two-columns">
                <div className="form-row"><label>Make</label><input value={spec.make ?? ""} onChange={(event) => updateSpec("make", event.target.value || undefined)} placeholder={category === "hypercar" ? "Porsche, BMW, McLaren…" : "Toyota, Honda…"} /></div>
                <div className="form-row"><label>Model / family</label><input value={spec.model ?? ""} onChange={(event) => updateSpec("model", event.target.value || undefined)} placeholder="911, M3, GR Yaris…" /></div>
                <div className="form-row"><label>Minimum year</label><input type="number" min="1886" max="2100" value={spec.minYear ?? ""} onChange={(event) => updateSpec("minYear", numberOrUndefined(event.target.value))} placeholder="2020" /></div>
                <div className="form-row"><label>Maximum year</label><input type="number" min="1886" max="2100" value={spec.maxYear ?? ""} onChange={(event) => updateSpec("maxYear", numberOrUndefined(event.target.value))} placeholder="2024" /></div>
                <div className="form-row"><label>Generation</label><input value={spec.generation ?? ""} onChange={(event) => updateSpec("generation", event.target.value || undefined)} placeholder="997.2, E46, 992…" /></div>
                <div className="form-row"><label>Variant / trim</label><input value={spec.variant ?? ""} onChange={(event) => updateSpec("variant", event.target.value || undefined)} placeholder="GT3 Touring, CS, Clubsport…" /></div>
                <div className="form-row"><label>Body style</label><select value={spec.bodyStyle ?? "either"} onChange={(event) => updateSpec("bodyStyle", event.target.value as HuntSpec["bodyStyle"])}><option value="either">Any body style</option><option value="coupe">Coupe</option><option value="convertible">Convertible</option><option value="sedan">Sedan</option><option value="wagon">Wagon</option><option value="suv">SUV</option><option value="truck">Truck</option><option value="hatchback">Hatchback</option><option value="other">Other</option></select></div>
                <div className="form-row"><label>Originality</label><select value={spec.originality ?? "either"} onChange={(event) => updateSpec("originality", event.target.value as HuntSpec["originality"])}><option value="either">Any state</option><option value="original">Original / highly original</option><option value="modified">Modified</option><option value="restomod">Restomod / custom</option></select></div>
                <div className="form-row"><label>Maximum mileage</label><input type="number" min="0" value={spec.maxMileage ?? ""} onChange={(event) => updateSpec("maxMileage", numberOrUndefined(event.target.value))} placeholder="20,000" /></div>
                <div className="form-row"><label>Transmission</label><select value={spec.transmission ?? "either"} onChange={(event) => updateSpec("transmission", event.target.value as HuntSpec["transmission"])}><option value="either">Either</option><option value="manual">Manual</option><option value="automatic">Automatic</option></select></div>
                <div className="form-row"><label>Drive side</label><select value={spec.driveSide ?? "either"} onChange={(event) => updateSpec("driveSide", event.target.value as HuntSpec["driveSide"])}><option value="either">Either</option><option value="left">Left-hand drive</option><option value="right">Right-hand drive</option></select></div>
                <div className="form-row"><label>Exterior colour</label><input value={spec.exteriorColor ?? ""} onChange={(event) => updateSpec("exteriorColor", event.target.value || undefined)} placeholder="Guards Red, silver…" /></div>
              </div>
              <div className="form-grid two-columns" style={{ marginTop: 10 }}>
                <div className="form-row"><label>Must-have details</label><textarea rows={2} value={spec.mustHave ?? ""} onChange={(event) => updateSpec("mustHave", event.target.value || undefined)} placeholder="Clubsport, service history, original paint…" /></div>
                <div className="form-row"><label>Hard no’s</label><textarea rows={2} value={spec.avoid ?? ""} onChange={(event) => updateSpec("avoid", event.target.value || undefined)} placeholder="Accident history, missing records, modifications…" /></div>
              </div>
              {category === "salvage_flip" && <label className="check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={spec.salvageOnly ?? false} onChange={(event) => updateSpec("salvageOnly", event.target.checked)} />Salvage title only</label>}
            </div>
          )}
          {category === "watch" && <div className="form-row"><label>Brand</label><input value={spec.brand ?? ""} onChange={(event) => updateSpec("brand", event.target.value || undefined)} placeholder="Rolex, Patek Philippe…" /></div>}
          {category === "reservation" && (
            <div className="form-grid two-columns">
              <div className="form-row"><label>Venue</label><input value={spec.venueName ?? ""} onChange={(event) => updateSpec("venueName", event.target.value || undefined)} placeholder="Disfrutar…" /></div>
              <div className="form-row"><label>City</label><input value={spec.city ?? ""} onChange={(event) => updateSpec("city", event.target.value || undefined)} placeholder="Barcelona…" /></div>
              <div className="form-row"><label>Party size</label><input type="number" min="1" value={spec.partySize ?? ""} onChange={(event) => updateSpec("partySize", numberOrUndefined(event.target.value))} placeholder="2" /></div>
            </div>
          )}
        </div>

        <details className="mission-fine-tune">
          <summary>
            <span>Fine-tune the scout</span>
            <small>{isAuctionWatch ? "Timing and email are optional." : "Location, trusted sources, timing, and email are optional."}</small>
          </summary>
          <div className="mission-fine-tune-body">
          {missionIntent === "guided" && (
            <div className="form-section guided-optional-controls">
              <h3>Optional: give the scout an edge</h3>
              <p className="field-note">Leave this alone for a quick market map. Add a budget or ongoing scouting only when it will genuinely help.</p>
              <div className="form-grid two-columns">
                <div className="form-row">
                  <label>After the first check</label>
                  <select value={mode} onChange={(event) => setMode(event.target.value as HuntMode)}>
                    <option value="one_off">Stop after one market check</option>
                    <option value="search">Keep scouting with fresh checks</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>How should the notes feel?</label>
                  <select value={experienceProfile} onChange={(event) => setExperienceProfile(event.target.value as ExperienceProfile)}>
                    <option value="adaptive">Adaptive — choose the right pace</option>
                    <option value="collector">Collector’s Desk — selective and editorial</option>
                    <option value="deal_radar">Deal Radar — fast and decisive</option>
                  </select>
                </div>
              </div>
              <div className="direction-options guided-direction-options">
                {DIRECTIONS.map((item) => (
                  <label key={item.value} className="check-row">
                    <input type="radio" name="guidedDirection" value={item.value} checked={direction === item.value} onChange={() => setDirection(item.value)} />
                    {item.label}
                  </label>
                ))}
              </div>
              {showThreshold && (
                <div className="form-grid two-columns">
                  <div className="form-row">
                    <label>Budget / threshold</label>
                    <input type="number" min="0" step="0.01" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="200000" required />
                  </div>
                  <div className="form-row">
                    <label>Currency</label>
                    <input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="USD" required />
                  </div>
                </div>
              )}
            </div>
          )}
          {!isAuctionWatch && <div className="form-section">
          <h3>Give it a home base</h3>
          <p className="field-note">A city or region is enough. Jamanyo does not need your exact location.</p>
          <div className="form-grid two-columns">
            <div className="form-row"><label>Country code</label><input maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} placeholder="KE" /></div>
            <div className="form-row"><label>City or region</label><input value={locality} onChange={(event) => setLocality(event.target.value)} placeholder="Nairobi" /></div>
            <div className="form-row"><label>Radius (km)</label><input type="number" min="1" max="20000" value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} placeholder="100" /></div>
            <div className="form-row"><label>Delivery</label><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as DeliveryMode)}><option value="either">Pickup or shipping</option><option value="pickup">Pickup only</option><option value="shipping">Shipping only</option></select></div>
          </div>
          <div className="form-grid two-columns" style={{ marginTop: 10 }}>
            <div className="form-row"><label>Search only these sources</label><input value={preferredDomains} onChange={(event) => setPreferredDomains(event.target.value)} placeholder="example.com, dealer.org" /><p className="field-note">Leave blank for Jamanyo’s source portfolio. Adding domains makes this a deliberate boundary, not a soft preference.</p>{isVehicleCategory(category) && missionIntent === "known_car" && <div className="source-shortcuts" aria-label="Quick source limits">{SOURCE_SHORTCUTS.map((source) => <button key={source.domain} type="button" className={`source-shortcut ${(splitList(preferredDomains) ?? []).includes(source.domain) ? "selected" : ""}`} onClick={() => togglePreferredSource(source.domain)}>{source.label}</button>)}</div>}</div>
            <div className="form-row"><label>Block domains</label><input value={blockedDomains} onChange={(event) => setBlockedDomains(event.target.value)} placeholder="avoid.example" /></div>
          </div>
          {missionIntent !== "listing_review" && mode === "monitor" && monitorPurpose !== "auction" && <div className="form-row" style={{ marginTop: 10 }}><label>Specific sources to monitor (optional)</label><textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="One public URL per line. Leave blank and Jamanyo will watch its listing-first source portfolio." rows={3} /></div>}
          </div>}
          {isAuctionWatch && <div className="form-section auction-watch-controls">
            <h3>Set the watch</h3>
            <p className="field-note">One specific public listing, then only the timing and notification choices that matter.</p>
            <div className="form-row auction-link-field"><label>Live auction listing</label><textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="Paste one public live-auction URL" rows={3} required /><p className="field-note">One link only. This is a factual watch of the public listing, not a vehicle inspection, valuation, or bidding recommendation.</p></div>
          </div>}

        <div className="form-section">
          <h3>Set the pace</h3>
          <div className="form-grid two-columns">
            <div className="form-row"><label>Urgency</label><select value={urgency} onChange={(event) => setUrgency(event.target.value as Urgency)}><option value="urgent">Urgent — check every 15 minutes</option><option value="soon">Soon — check hourly</option><option value="whenever">Whenever — check every 6 hours</option></select></div>
            <div className="form-row"><label>Stop after (hours)</label><input type="number" min="1" max="8760" value={expiresHours} onChange={(event) => setExpiresHours(event.target.value)} placeholder="Leave blank to continue" /></div>
            <div className="form-row"><label>Email rhythm</label><select value={notificationCadence} onChange={(event) => setNotificationCadence(event.target.value as NotificationCadence)}><option value="instant">Tell me as soon as it matters</option><option value="daily_digest">One daily digest</option></select></div>
            {!isAuctionWatch && <div className="form-row"><label>Discovery style</label><select value={serendipity} onChange={(event) => setSerendipity(event.target.value as Serendipity)}><option value="exact">Exact only</option><option value="smart">Smart nearby alternatives</option><option value="delight">Great adjacent surprises</option></select></div>}
          </div>
          <label className="check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />Respect quiet hours in my time zone</label>
          {quietEnabled && <div className="form-grid three-columns" style={{ marginTop: 8 }}><div className="form-row"><label>From</label><select value={quietHoursStart} onChange={(event) => setQuietHoursStart(event.target.value)}>{QUIET_HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></div><div className="form-row"><label>Until</label><select value={quietHoursEnd} onChange={(event) => setQuietHoursEnd(event.target.value)}>{QUIET_HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></div><div className="form-row"><label>Time zone</label><input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required /></div></div>}
          {!isAuctionWatch && <div className="form-row" style={{ marginTop: 10 }}><label>Seller contact</label><select value={contactPolicy} onChange={(event) => setContactPolicy(event.target.value as ContactPolicy)}><option value="draft_for_review">Prepare a draft; I approve every send</option><option value="alerts_only">Alert me only; never draft outreach</option></select></div>}
          {!editing && <><label className="check-row" style={{ marginTop: 10 }}><input type="checkbox" checked={notifyByEmail} onChange={(event) => setNotifyByEmail(event.target.checked)} />Create a private agent inbox and send email updates too</label>
          {isVehicleCategory(category) && !isAuctionWatch && <><label className="check-row" style={{ marginTop: 8 }}><input type="checkbox" checked={weeklyGarageBrief} disabled={!notifyByEmail} onChange={(event) => setWeeklyGarageBrief(event.target.checked)} />Send a weekly Garage Brief in that email thread</label><p className="field-note">A considered lead, a useful near-miss, or an all-quiet note—only when email updates are on.</p></>}
          <p className="field-note">Optional: email and dashboard refer to the same mission, not two separate agents.</p></>}
        </div>
          </div>
        </details>

        {error && <p className="error-msg" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? (editing ? "Saving…" : "Briefing your scout…") : editing ? "Save mission" : missionIntent === "guided" ? "Map my first directions" : "Give your scout a mission"}</button>
        </div>
      </form>
    </Modal>
  );
}

function MissionDossier({
  hunt,
  candidates,
  cleared,
  experienceProfile,
  runStatus,
}: {
  hunt: Doc<"hunts">;
  candidates: CandidateForUser[];
  cleared: CandidateForUser[];
  experienceProfile: ExperienceProfile;
  runStatus?: HuntRunForUser["status"];
}) {
  const isAuctionWatch = hunt.mode === "monitor" && hunt.monitorPurpose === "auction";
  if (isAuctionWatch) {
    const sourceUrl = hunt.sourceUrls?.[0];
    const watchState =
      hunt.status === "paused" || hunt.monitorStatus === "paused"
        ? "Paused"
        : hunt.monitorStatus === "active"
          ? "Active"
          : "Needs attention";
    return (
      <section className={`card mission-dossier auction-watch-dossier mission-dossier-${experienceProfile}`} aria-label="Auction Watch Dossier">
        <div className="mission-dossier-copy">
          <p className="brief-kicker">Auction watch · public listing</p>
          <h3>One listing, a visible trail</h3>
          <p className="mission-dossier-lede">Jamanyo records only what the listing shows: its visible price or bid, reserve signal, availability, and stated end time.</p>
        </div>
        <div className="auction-dossier-facts">
          <div><span className="snapshot-label">Watch status</span><strong>{watchState}</strong></div>
          <div><span className="snapshot-label">Scope</span><strong>One public listing</strong></div>
          <div><span className="snapshot-label">Decision boundary</span><strong>Not a valuation or inspection</strong></div>
        </div>
        {sourceUrl && <a className="auction-dossier-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open the saved listing ↗</a>}
      </section>
    );
  }
  const market = observedMarketContext(hunt, candidates);
  const visualCandidate =
    cleared.find((candidate) => publicImageUrl(candidate.verification.listingImageUrl)) ??
    candidates.find((candidate) => publicImageUrl(candidate.verification.listingImageUrl)) ??
    cleared[0] ??
    candidates[0];
  const title = vehicleMissionTitle(hunt);
  const facts = vehicleSpecFacts(hunt);
  const activeLeadCount = cleared.length;
  const guidedPlan = hunt.missionIntent === "guided" ? hunt.discoveryPlan : undefined;
  const sourcePlan = hunt.sourcePlan;
  const guidedNoSources = guidedPlan?.sourceCount === 0;
  const guidedSourcesFound = guidedPlan && guidedPlan.sourceCount > 0;
  const guidedAllUnavailable =
    Boolean(guidedPlan?.lanes.length) &&
    guidedPlan?.lanes.every((lane) => lane.status === "unavailable");
  const guidedNeedsRemap = hunt.missionIntent === "guided" && !guidedPlan && Boolean(hunt.lastRunAt);
  const checkInProgress = runStatus === "queued" || runStatus === "running";
  const checkFailed = runStatus === "failed";
  const pausingAfterCurrentSource = hunt.status === "paused" && checkInProgress;
  const sourcesScreened = candidates.length > 0;
  const currentCall =
    activeLeadCount > 0
      ? `${activeLeadCount} ${activeLeadCount === 1 ? "potential lead" : "potential leads"}`
      : pausingAfterCurrentSource
        ? "Pausing after this source"
      : checkInProgress
        ? "Checking sources"
      : checkFailed
        ? "Check needs retry"
      : guidedNoSources
        ? guidedAllUnavailable
          ? "Search unavailable"
          : "Broaden the view"
      : guidedSourcesFound
          ? "Sources found, no lead yet"
          : guidedNeedsRemap
            ? "Fresh map needed"
          : sourcesScreened
            ? "Sources screened, no lead yet"
            : hunt.status === "paused"
              ? "Mission paused"
              : hunt.lastRunAt
                ? "No usable source yet"
                : "First check ready";
  const currentCallDetail =
    activeLeadCount > 0
      ? "Open the evidence before you commit time or money."
      : pausingAfterCurrentSource
        ? "Jamanyo is finishing the source already in progress, then this mission will stay paused."
      : checkInProgress
        ? "Jamanyo is reading listing sources now. Assessed evidence appears here as it arrives."
      : checkFailed
        ? "The last check could not finish. Try another check when you are ready."
      : guidedNoSources
        ? guidedAllUnavailable
          ? "No market conclusion was drawn because the search source was temporarily unavailable."
          : "This pass needs a wider angle; it is not a verdict on the market."
      : guidedSourcesFound
          ? "The scout found sources, but none has enough inspectable listing evidence yet."
          : guidedNeedsRemap
            ? "An earlier search predates the visible map. Check again to see the new directions separately."
          : sourcesScreened
            ? "The scout saw sources, but none has enough inspectable listing evidence to earn a lead yet."
            : hunt.status === "paused"
              ? "Resume when you are ready; Jamanyo will preserve the evidence already gathered."
              : hunt.lastRunAt
                ? "The last check did not produce usable listing evidence. Edit the brief or try again for a fresh pass."
                : "Run the first check to turn your brief into a visible market map.";

  return (
    <section className={`card mission-dossier mission-dossier-${experienceProfile}`} aria-label="Mission Dossier">
      <div className="mission-dossier-copy">
        <p className="brief-kicker">Mission dossier · living market context</p>
        <h3>{title}</h3>
        <p className="mission-dossier-lede">
          {experienceProfile === "collector"
            ? "A calm acquisition view: specification, evidence, and the market around each contender."
            : experienceProfile === "deal_radar"
              ? "A fast decision view: price, availability, and the evidence to act—or hold your nerve."
              : "A clear, evidence-led picture of the market your scout is actually seeing."}
        </p>
        {facts.length > 0 && (
          <div className="spec-chip-row" aria-label="Requested vehicle specification">
            {facts.map((fact) => <span key={fact} className="spec-chip">{fact}</span>)}
          </div>
        )}
      </div>
      {hunt.missionIntent === "guided" && !visualCandidate ? (
        <div className="mission-dossier-visual discovery-dossier-visual" role="img" aria-label="Guided discovery visual">
          <span className="discovery-dossier-mark">3</span>
          <strong>{guidedPlan ? "Search directions" : guidedNeedsRemap ? "Fresh search map" : "Starting directions"}</strong>
          <small>{guidedPlan ? `${guidedPlan.lanes.length} separate hypotheses` : guidedNeedsRemap ? "An earlier pass can be remapped" : "No car taxonomy required"}</small>
        </div>
      ) : (
        <ListingVisual
          className="mission-dossier-visual"
          title={visualCandidate ? candidateTitle(visualCandidate) : title}
          sourceUrl={visualCandidate?.sourceUrl ?? ""}
          imageUrl={visualCandidate?.verification.listingImageUrl}
        />
      )}
      <div className="mission-market-snapshot">
        <div>
          <span className="snapshot-label">Observed listing range</span>
          <strong>{market.headline}</strong>
          <p>{market.detail}</p>
        </div>
        <div>
          <span className="snapshot-label">Evidence coverage</span>
          <strong>{guidedPlan ? `${guidedPlan.sourceCount} source${guidedPlan.sourceCount === 1 ? "" : "s"} explored` : sourcePlan ? `${sourcePlan.entries.length} source route${sourcePlan.entries.length === 1 ? "" : "s"} checked` : `${candidates.length} screened`} · {market.sourceCount} inspectable {market.sourceCount === 1 ? "listing" : "listings"}</strong>
          <p>{market.photoCount > 0 ? `${market.photoCount} ${market.photoCount === 1 ? "listing includes" : "listings include"} a source photo.` : guidedPlan || sourcePlan ? "Only specific, inspectable listings become evidence here." : "Source imagery appears when a listing provides it."}</p>
        </div>
        <div>
          <span className="snapshot-label">Current call</span>
          <strong>{currentCall}</strong>
          <p>{currentCallDetail}</p>
        </div>
      </div>
    </section>
  );
}

function SourcePortfolio({ hunt }: { hunt: Doc<"hunts"> }) {
  if (!isVehicleCategory(hunt.category)) return null;
  const plan = hunt.sourcePlan;
  if (hunt.mode === "monitor" && hunt.monitorPurpose === "auction") {
    const sourceUrl = hunt.sourceUrls?.[0];
    return (
      <section className="card source-portfolio" aria-label="Auction Watch source coverage">
        <div className="source-portfolio-heading">
          <div>
            <p className="brief-kicker">Watch scope</p>
            <h3>One listing, no broadened search</h3>
          </div>
          <span className="source-portfolio-badge">Direct watch</span>
        </div>
        <p className="field-note">Jamanyo is monitoring only the public auction page you supplied. It will not turn this into a market search or contact a seller.</p>
        {sourceUrl && <a className="source-portfolio-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open saved auction listing ↗</a>}
      </section>
    );
  }
  if (hunt.missionIntent === "listing_review") {
    return (
      <section className="card source-portfolio" aria-label="Listing check source coverage">
        <div className="source-portfolio-heading">
          <div>
            <p className="brief-kicker">Source coverage</p>
            <h3>Checking the listing you brought</h3>
          </div>
          <span className="source-portfolio-badge">Direct check</span>
        </div>
        <p className="field-note">Jamanyo reads the supplied link directly. It does not turn this into a broader web hunt or contact a seller.</p>
      </section>
    );
  }
  const allUnavailable =
    Boolean(plan?.entries.length) &&
    plan?.entries.every((entry) => entry.status === "unavailable");
  return (
    <section className="card source-portfolio" aria-label="Mission source portfolio">
      <div className="source-portfolio-heading">
        <div>
          <p className="brief-kicker">Source portfolio</p>
          <h3>{plan ? "Where this mission actually looked" : "A small, evidence-led first pass"}</h3>
        </div>
        {plan && <span className="source-portfolio-badge">{plan.sourceCount} page{plan.sourceCount === 1 ? "" : "s"} to review</span>}
      </div>
      <p className="field-note">
        {plan
          ? allUnavailable
            ? "The planned sources were temporarily unavailable. Jamanyo made no market conclusion from that."
            : "A market hub is navigation, not a lead. Only individual vehicle pages move on to evidence review."
          : "Jamanyo begins with Classic.com, Bring a Trailer, and Hemmings when they fit the brief, then makes one bounded broader search only if those routes do not yield direct vehicle pages."}
      </p>
      {plan && (
        <div className="source-portfolio-grid">
          {plan.entries.map((entry) => (
            <article key={`${entry.sourceId}-${entry.sourceLabel}`} className={`source-portfolio-entry source-status-${entry.status}`}>
              <div>
                <strong>{entry.sourceLabel}</strong>
                <p>{entry.detail}</p>
              </div>
              <div className="source-portfolio-meta">
                <span>{sourcePlanStatusLabel(entry.status)}</span>
                {entry.status === "sources_found" && <small>{entry.resultCount} page{entry.resultCount === 1 ? "" : "s"}</small>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function MonitorHealthStrip({
  hunt,
  checks,
  auctionWatch,
}: {
  hunt: Doc<"hunts">;
  checks: MonitorCheckForUser[];
  auctionWatch: Doc<"auctionWatches"> | null | undefined;
}) {
  if (hunt.mode !== "monitor") return null;
  const active = hunt.status === "active" && hunt.monitorStatus === "active";
  const status = active
    ? hunt.monitorPurpose === "auction"
      ? "Auction Watch active"
      : "Market watch active"
    : hunt.monitorStatus === "needs_attention"
      ? "Watch needs attention"
      : hunt.status === "paused" || hunt.monitorStatus === "paused"
        ? "Watch paused"
        : "Watch is not active";
  const latest = checks[0];
  const observablePrice = auctionWatch?.currentBidMinor ?? auctionWatch?.askingPriceMinor;
  const priceLabel =
    observablePrice !== undefined
      ? formatMoney(observablePrice, auctionWatch?.currency ?? "USD")
      : undefined;
  return (
    <section className={`monitor-health ${active ? "is-active" : "needs-attention"}`} aria-label="Watch health">
      <div className="monitor-health-heading">
        <span className="monitor-pulse" aria-hidden="true" />
        <div>
          <strong>{status}</strong>
          <p>
            {hunt.monitorStatus === "needs_attention"
              ? "Jamanyo could not start this provider watch. It is not checking the listing right now."
              : latest
              ? `Last provider check ${new Date(latest.createdAt).toLocaleString()}`
              : "Waiting for the first provider check."}
          </p>
        </div>
      </div>
      {hunt.monitorPurpose === "auction" && auctionWatch ? (
        <div className="monitor-health-facts">
          {priceLabel && <span>{auctionWatch.currentBidMinor !== undefined ? "Current bid" : "Visible price"}: {priceLabel}</span>}
          <span>Reserve: {auctionWatch.reserveStatus.replace(/_/g, " ")}</span>
          {auctionWatch.endsAt && <span>Ends {formatBriefTimestamp(auctionWatch.endsAt)}</span>}
          <a href={auctionWatch.sourceUrl} target="_blank" rel="noopener noreferrer">Open listing ↗</a>
        </div>
      ) : latest ? (
        <div className="monitor-health-facts">
          <span>{latest.changed + latest.added + latest.removed} recorded change{latest.changed + latest.added + latest.removed === 1 ? "" : "s"}</span>
          {latest.errors > 0 && <span>{latest.errors} source error{latest.errors === 1 ? "" : "s"}</span>}
          {latest.changedUrls[0] && <a href={latest.changedUrls[0]} target="_blank" rel="noopener noreferrer">Open latest source ↗</a>}
        </div>
      ) : null}
    </section>
  );
}

function HuntDetail({ hunt, onBack }: { hunt: Doc<"hunts">; onBack: () => void }) {
  const hasCarExperience = isVehicleCategory(hunt.category);
  const isAuctionWatch = hunt.mode === "monitor" && hunt.monitorPurpose === "auction";
  const candidates = (useQuery(api.candidates.listByHunt, { huntId: hunt._id }) ?? []) as CandidateForUser[];
  const cleared = (useQuery(api.hunts.listCleared, { huntId: hunt._id }) ?? []) as CandidateForUser[];
  const outreachItems = (useQuery(api.outreach.listForHunt, { huntId: hunt._id }) ?? []) as Doc<"outreach">[];
  const feedbackItems = (useQuery(api.huntFeedback.listForHunt, { huntId: hunt._id }) ?? []) as Doc<"huntFeedback">[];
  const events = (useQuery(api.events.forHunt, { huntId: hunt._id }) ?? []) as Doc<"events">[];
  const missionRuns = (useQuery(api.huntRuns.listForHunt, { huntId: hunt._id }) ?? []) as HuntRunForUser[];
  const monitorChecks = (useQuery(
    api.monitorChecks.listForHunt,
    hunt.mode === "monitor" ? { huntId: hunt._id } : "skip",
  ) ?? []) as MonitorCheckForUser[];
  const auctionWatch = useQuery(
    api.auctionWatches.getForHunt,
    hunt.monitorPurpose === "auction" ? { huntId: hunt._id } : "skip",
  );
  const garageBrief = useQuery(
    api.garageBriefs.getForHunt,
    hasCarExperience ? { huntId: hunt._id } : "skip",
  );
  const runHunt = useAction(api.hunt.runHunt);
  const retryMonitor = useAction(api.hunts.startMonitor);
  const deleteMission = useAction(api.hunts.deleteMission);
  const sendOutreach = useMutation(api.outreach.confirmSend);
  const setEmailNotifications = useMutation(api.hunts.setEmailNotifications);
  const setWeeklyGarageBrief = useMutation(api.hunts.setWeeklyGarageBrief);
  const updateStatus = useAction(api.hunts.updateStatus);
  const broadenGuidedDiscovery = useMutation(api.hunts.broadenGuidedDiscovery);
  const recordFeedback = useMutation(api.huntFeedback.record);
  const reportSourceUnavailable = useMutation(api.candidates.reportSourceUnavailable);
  const getOrCreateInbox = useAction(api.mail.getOrCreateInbox);
  const [running, setRunning] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingBrief, setUpdatingBrief] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [retryingMonitor, setRetryingMonitor] = useState(false);
  const [broadening, setBroadening] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState<Id<"candidates"> | null>(null);
  const [sourceReportBusy, setSourceReportBusy] = useState<Id<"candidates"> | null>(null);
  const [editingMission, setEditingMission] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missionView, setMissionView] = useState<"now" | "leads" | "research">("now");

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      await runHunt({ huntId: hunt._id });
    } catch (caught) {
      setError(huntRunErrorMessage(caught));
    } finally {
      setRunning(false);
    }
  };

  const handleStatus = async () => {
    const status = hunt.status === "active" ? "paused" : "active";
    setUpdatingStatus(true);
    setError(null);
    try {
      await updateStatus({ huntId: hunt._id, status });
    } catch (caught) {
      setError(hunt.mode === "monitor" ? monitorErrorMessage(caught) : errorMessage(caught, "We couldn't update this mission."));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleRetryMonitor = async () => {
    setRetryingMonitor(true);
    setError(null);
    try {
      await retryMonitor({ huntId: hunt._id });
    } catch (caught) {
      setError(monitorErrorMessage(caught));
    } finally {
      setRetryingMonitor(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteMission({ huntId: hunt._id });
      onBack();
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't remove this mission."));
      setDeleting(false);
    }
  };

  const handleBroaden = async () => {
    setBroadening(true);
    setError(null);
    try {
      await broadenGuidedDiscovery({ huntId: hunt._id });
      await runHunt({ huntId: hunt._id });
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't broaden this search just now."));
    } finally {
      setBroadening(false);
    }
  };

  const handleEmailNotificationChange = async (enabled: boolean) => {
    setUpdatingEmail(true);
    setError(null);
    try {
      if (enabled) {
        const inboxSetup = await getOrCreateInbox({ confirmed: true });
        if (inboxSetup.kind !== "ready") {
          setError(inboxSetup.message);
          return;
        }
      }
      await setEmailNotifications({ huntId: hunt._id, enabled });
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't update email notifications."));
    } finally {
      setUpdatingEmail(false);
    }
  };

  const handleWeeklyBriefChange = async (enabled: boolean) => {
    if (!hunt.sourceMessageId && hunt.notifyByEmail === false) {
      setError("Turn on email updates before enabling a weekly Garage Brief.");
      return;
    }
    setUpdatingBrief(true);
    setError(null);
    try {
      await setWeeklyGarageBrief({ huntId: hunt._id, enabled });
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't update the weekly Garage Brief."));
    } finally {
      setUpdatingBrief(false);
    }
  };

  const handleSend = async (outreachId: Id<"outreach">) => {
    setError(null);
    try {
      await sendOutreach({ outreachId });
    } catch (caught) {
      setError(errorMessage(caught, "The seller email couldn't be sent."));
    }
  };

  const handleFeedback = async (candidateId: Id<"candidates">, kind: FeedbackKind) => {
    setFeedbackBusy(candidateId);
    setError(null);
    try {
      await recordFeedback({ huntId: hunt._id, candidateId, kind });
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't save that feedback."));
    } finally {
      setFeedbackBusy(null);
    }
  };

  const handleSourceUnavailable = async (candidateId: Id<"candidates">) => {
    setSourceReportBusy(candidateId);
    setError(null);
    try {
      await reportSourceUnavailable({ candidateId });
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't mark that source unavailable."));
    } finally {
      setSourceReportBusy(null);
    }
  };

  const latestActivity = events[0];
  const latestRun = [...missionRuns].sort((a, b) =>
    Math.max(b.finishedAt ?? 0, b.startedAt ?? 0, b.scheduledAt) -
    Math.max(a.finishedAt ?? 0, a.startedAt ?? 0, a.scheduledAt),
  )[0];
  const experienceProfile = profileForHunt(hunt);
  const intentLabel = missionIntentLabel(hunt.missionIntent);
  const candidateReasonLabel =
    experienceProfile === "collector"
      ? "Acquisition note"
      : experienceProfile === "deal_radar"
        ? "Move or walk-away note"
        : "Why it stands out";
  const researchTrail = candidates.filter((candidate) => !isPotentialLead(candidate));
  const guidedNoSources =
    hunt.missionIntent === "guided" && hunt.discoveryPlan?.sourceCount === 0;
  const guidedAllUnavailable =
    hunt.missionIntent === "guided" &&
    Boolean(hunt.discoveryPlan?.lanes.length) &&
    hunt.discoveryPlan?.lanes.every((lane) => lane.status === "unavailable");
  const guidedSourcesWithoutLead =
    hunt.missionIntent === "guided" &&
    (hunt.discoveryPlan?.sourceCount ?? 0) > 0 &&
    cleared.length === 0;
  const guidedNeedsRemap =
    hunt.missionIntent === "guided" && !hunt.discoveryPlan && Boolean(hunt.lastRunAt);
  const briefChangedSinceLastCheck = Boolean(
    hunt.briefUpdatedAt && (!hunt.lastRunAt || hunt.briefUpdatedAt > hunt.lastRunAt),
  );
  const reassurance =
    briefChangedSinceLastCheck
      ? "Your updated brief is saved. The next check will use it; the trail below may reflect the earlier version of this mission."
      : cleared.length > 0
      ? experienceProfile === "collector"
        ? `Your Acquisition Desk has ${cleared.length} potential ${cleared.length === 1 ? "lead" : "leads"}; the evidence stays here so you can compare the details.`
        : experienceProfile === "deal_radar"
          ? `Deal Radar has ${cleared.length} potential ${cleared.length === 1 ? "lead" : "leads"}; availability, price, and risks are ready for a quick call.`
          : `Your scout has ${cleared.length} potential ${cleared.length === 1 ? "lead" : "leads"}; every result stays here for comparison.`
      : guidedNoSources
        ? guidedAllUnavailable
          ? "The search source was temporarily unavailable, so Jamanyo drew no conclusion about the market. Try the same check again later."
          : "The first market check finished without listing sources. Broaden the scout when you want a different angle; this is not a verdict on the cars out there."
        : guidedSourcesWithoutLead
          ? "The scout found sources but not enough inspectable listing evidence to call one a lead. The trail stays visible so nothing gets dressed up as certainty."
          : guidedNeedsRemap
            ? "An earlier search finished before Jamanyo could show the directions separately. Check again to create a transparent market map."
            : hunt.mode === "one_off" && hunt.lastRunAt
            ? "Your one-off market check finished. Run another whenever you want a fresh view—Jamanyo is not quietly watching in the background."
            : hunt.status === "paused"
              ? "This mission is paused. Jamanyo will preserve its trail but will not run another check until you resume it."
              : hunt.status === "archived"
                ? "This mission is archived. Its research remains here, but Jamanyo is not running it."
            : latestActivity
              ? `${hunt.mode === "monitor" ? hunt.monitorStatus === "active" && hunt.status === "active" ? hunt.monitorPurpose === "auction" ? "Auction Watch is reading the public listing on its saved cadence." : "Market Watch is checking for meaningful source changes." : "This watch is not active right now; Jamanyo will not imply that it is." : hunt.mode === "search" ? "Your scout is checking again on its chosen pace." : "Your scout is ready for a first market check."} Most recently: ${latestActivity.summary}`
        : experienceProfile === "collector"
          ? "Your Acquisition Desk is ready. The first check will leave a clear trail of specification and condition here."
          : experienceProfile === "deal_radar"
            ? "Deal Radar is ready. The first check will surface the clearest buy-or-walk-away signal here."
            : "Your scout is ready. The first check will leave a clear trail here.";
  const feedbackFor = (candidateId: Id<"candidates">) => feedbackItems.find((item) => item.candidateId === candidateId);

  return (
    <div className="content">
      <div className="card compact mission-command-deck">
        <div className="detail-title-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
          <div>
            <h2 className="detail-title">{vehicleMissionTitle(hunt)}</h2>
            <p className="text-muted text-sm">{huntDirectionLabel(hunt)}{formatHuntBudget(hunt) ? ` · ${formatHuntBudget(hunt)}` : ""}</p>
          </div>
          {hasCarExperience && !isAuctionWatch && <span className={`experience-badge experience-${experienceProfile}`}>{profileLabel(experienceProfile)}</span>}
          <span className={`status-pill status-${hunt.status}`}>{hunt.status}</span>
        </div>
        <div className="mission-facts">
          <span>Market: {marketLabel(hunt)}</span>
          <span>Alerts: {alertLabel(hunt)}</span>
          {intentLabel && <span>{intentLabel}</span>}
          {hasCarExperience && !isAuctionWatch && <span>{profileDescription(experienceProfile)}</span>}
          {isAuctionWatch ? <span>One public listing</span> : <span>{hunt.serendipity === "delight" ? "Open to delightful alternatives" : hunt.serendipity === "exact" ? "Exact-match scout" : "Smart-match scout"}</span>}
          {hunt.expiresAt && <span>Ends {formatDate(hunt.expiresAt)}</span>}
        </div>
        <p className="reassurance">{reassurance}</p>
        {hunt.mode === "monitor" && (
          <MonitorHealthStrip
            hunt={hunt}
            checks={monitorChecks}
            auctionWatch={auctionWatch}
          />
        )}
        <div className="detail-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { setEditingMission(true); setError(null); }} disabled={deleting}>Edit mission</button>
          {hunt.mode === "monitor" && hunt.monitorStatus === "needs_attention" && <button type="button" className="btn btn-primary" onClick={() => void handleRetryMonitor()} disabled={retryingMonitor}>{retryingMonitor ? "Retrying watch…" : "Retry watch"}</button>}
          {hunt.status !== "archived" && <button type="button" className="btn btn-ghost" onClick={() => void handleStatus()} disabled={updatingStatus}>{updatingStatus ? "Updating…" : hunt.status === "active" ? "Pause mission" : "Resume mission"}</button>}
          {hunt.mode !== "monitor" && hunt.status === "active" && <button type="button" className="btn btn-primary" onClick={() => void handleRun()} disabled={running}>{running ? "Checking…" : hunt.mode === "one_off" && hunt.lastRunAt ? "Check again" : "Check now"}</button>}
          {hunt.mode === "monitor" && <span className="field-note">{hunt.monitorPurpose === "auction" ? "This is a factual public-listing watch—not a valuation or bidding instruction." : hunt.monitorStatus === "active" && hunt.status === "active" ? "Only provider-judged meaningful changes interrupt you." : "This provider watch is not active; check its health above before relying on it."}</span>}
        </div>
        {!confirmingDelete ? <button type="button" className="btn btn-danger btn-sm" onClick={() => { setConfirmingDelete(true); setError(null); }} disabled={deleting}>Remove mission</button> : <div className="mission-delete-confirmation" role="alert">
          <strong>Remove this mission for good?</strong>
          <p>Jamanyo will stop its monitor, remove the dashboard trail, drafts, feedback, and local thread records. Already delivered emails cannot be recalled.</p>
          <div className="detail-actions"><button type="button" className="btn btn-danger" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? "Removing…" : "Remove permanently"}</button><button type="button" className="btn btn-ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Keep mission</button></div>
        </div>}
        {hunt.sourceMessageId ? (
          <p className="field-note">This mission is anchored to its original email thread. Reply there to pause, resume, or refine it.</p>
        ) : (
          <div className="notification-control">
            <label className="check-row"><input type="checkbox" checked={hunt.notifyByEmail !== false} disabled={updatingEmail} onChange={(event) => void handleEmailNotificationChange(event.target.checked)} />Email potential matches and monitor changes</label>
            <p className="field-note">{hunt.notifyByEmail === false ? "Dashboard-only. Turn this on to connect your agent inbox." : hunt.notificationStatus === "active" ? "Email and dashboard update the same mission history." : hunt.notificationStatus === "failed" || hunt.notificationStatus === "unavailable" ? "Email setup needs attention. Toggle this off and on to retry." : "Preparing the email thread for this mission…"}</p>
            {hasCarExperience && !isAuctionWatch && <><label className="check-row" style={{ marginTop: 8 }}><input type="checkbox" checked={hunt.weeklyGarageBrief === true} disabled={updatingBrief || hunt.notifyByEmail === false} onChange={(event) => void handleWeeklyBriefChange(event.target.checked)} />Send this mission’s weekly Garage Brief by email</label><p className="field-note">{hunt.notifyByEmail === false ? "Turn on email updates to receive the weekly ritual in your agent inbox." : hunt.weeklyGarageBrief === true ? "A calm weekly readout will arrive through this mission’s email thread." : "Dashboard brief only. Turn this on when you want the weekly email ritual too."}</p></>}
          </div>
        )}
        <p className="field-note">Jamanyo uses available listing information as a decision aid—not a vehicle inspection, title check, valuation, or guarantee. Confirm condition, history, availability, and terms directly.</p>
      {error && <p className="error-msg" role="alert">{error}</p>}
        <div className="mission-tabs" role="tablist" aria-label="Mission views">
          <button type="button" role="tab" aria-selected={missionView === "now"} className={missionView === "now" ? "selected" : ""} onClick={() => setMissionView("now")}>Now</button>
          <button type="button" role="tab" aria-selected={missionView === "leads"} className={missionView === "leads" ? "selected" : ""} onClick={() => setMissionView("leads")}>Leads {cleared.length > 0 ? `(${cleared.length})` : ""}</button>
          <button type="button" role="tab" aria-selected={missionView === "research"} className={missionView === "research" ? "selected" : ""} onClick={() => setMissionView("research")}>Research {researchTrail.length > 0 ? `(${researchTrail.length})` : ""}</button>
        </div>
      </div>

      {editingMission && <NewHuntForm initialHunt={hunt} onClose={() => setEditingMission(false)} onCreated={() => setEditingMission(false)} />}

      {missionView === "now" && <>
      {hasCarExperience && (
        <MissionDossier
          hunt={hunt}
          candidates={candidates}
          cleared={cleared}
          experienceProfile={experienceProfile}
          runStatus={latestRun?.status}
        />
      )}

      {hasCarExperience && <SourcePortfolio hunt={hunt} />}

      {hunt.missionIntent === "guided" && (
        <DiscoveryCompass
          hunt={hunt}
          onBroaden={() => void handleBroaden()}
          broadening={broadening}
        />
      )}

      {hasCarExperience && !isAuctionWatch && garageBrief && (
        <section className={`card garage-brief garage-brief-${garageBrief.state}`} aria-label="Garage Brief">
          <div className="garage-brief-heading">
            <div>
              <p className="brief-kicker">Weekly ritual · live now</p>
              <h3>{garageBrief.title}</h3>
            </div>
            <span className={`experience-badge experience-${experienceProfile}`}>{profileLabel(experienceProfile)}</span>
          </div>
          <p className="garage-brief-lede">{garageBrief.lede}</p>
          {(garageBrief.topLead || garageBrief.nearMiss) && (
            <div className="garage-brief-highlights">
              {garageBrief.topLead && (
                <div className="garage-brief-highlight primary">
                  <ListingVisual
                    className="garage-brief-visual"
                    title={garageBrief.topLead.sourceLabel}
                    sourceUrl={garageBrief.topLead.sourceUrl}
                    imageUrl={garageBrief.topLead.imageUrl}
                  />
                  <span className="brief-kicker">{garageBrief.state === "act" ? "Decision signal" : "The one to watch"}</span>
                  <a href={garageBrief.topLead.sourceUrl} target="_blank" rel="noopener noreferrer">{garageBrief.topLead.sourceLabel} ↗</a>
                  <p>{garageBrief.topLead.detail}</p>
                  <span className="brief-facts">{[
                    `Confidence ${Math.round(garageBrief.topLead.confidence * 100)}%`,
                    garageBrief.topLead.value,
                    garageBrief.topLead.availability ? `availability: ${garageBrief.topLead.availability}` : undefined,
                    garageBrief.topLead.sellerTrust ? `trust: ${garageBrief.topLead.sellerTrust}` : undefined,
                  ].filter(Boolean).join(" · ")}</span>
                  {garageBrief.state === "act" && <a className="brief-action" href={garageBrief.topLead.sourceUrl} target="_blank" rel="noopener noreferrer">Open lead and decide →</a>}
                </div>
              )}
              {garageBrief.nearMiss && (
                <div className="garage-brief-highlight">
                  <ListingVisual
                    className="garage-brief-visual"
                    title={garageBrief.nearMiss.sourceLabel}
                    sourceUrl={garageBrief.nearMiss.sourceUrl}
                    imageUrl={garageBrief.nearMiss.imageUrl}
                  />
                  <span className="brief-kicker">Worth a closer look</span>
                  <a href={garageBrief.nearMiss.sourceUrl} target="_blank" rel="noopener noreferrer">{garageBrief.nearMiss.sourceLabel} ↗</a>
                  <p>{garageBrief.nearMiss.detail}</p>
                  <span className="brief-facts">{[
                    `Confidence ${Math.round(garageBrief.nearMiss.confidence * 100)}%`,
                    garageBrief.nearMiss.value,
                    garageBrief.nearMiss.availability ? `availability: ${garageBrief.nearMiss.availability}` : undefined,
                  ].filter(Boolean).join(" · ")}</span>
                </div>
              )}
            </div>
          )}
          <p className="garage-brief-decision">{garageBrief.decision}</p>
          <p className="field-note">{garageBrief.lastRunAt ? `Last proper check: ${formatBriefTimestamp(garageBrief.lastRunAt)}. ` : "Your scout is ready for its first proper check. "}{hunt.weeklyGarageBrief === true && (hunt.sourceMessageId || hunt.notifyByEmail !== false) ? "The weekly Garage Brief is also enabled for this mission’s email thread." : "This ritual stays in the dashboard until you enable its weekly email update."}</p>
        </section>
      )}
      </>}

      {missionView === "research" && candidates.length === 0 && <div className="card">
        <h3>Research trail</h3>
        <p className="text-muted text-sm" style={{ marginTop: 8 }}>
          {isAuctionWatch
            ? "Jamanyo will record its first observable auction update here when the provider completes a check. It will not infer condition or a buying recommendation from that listing."
            : guidedNoSources
            ? guidedAllUnavailable
              ? "The search source was temporarily unavailable, so there is no market conclusion or source trail from this pass."
              : "No listing sources came back from the first directions. Broaden the scout to try a wider pass; this is not a claim that the market is empty."
            : guidedSourcesWithoutLead
              ? "Sources surfaced, but none provided enough inspectable listing evidence to enter the trail as a lead."
              : guidedNeedsRemap
                ? "An earlier search predates the visible market map. Check again to see the next pass broken into clear discovery directions."
              : "No sources assessed yet. Jamanyo will keep a compact record of what it screened, even when nothing qualifies."}
        </p>
      </div>}

      {missionView === "research" && researchTrail.length > 0 && <section className="card research-trail">
        <details>
          <summary>
            <span className="research-trail-summary-copy">
              <span className="brief-kicker">Screened sources</span>
              <strong>Research trail ({researchTrail.length})</strong>
            </span>
            <span className="research-trail-summary-action">Show detail</span>
          </summary>
          <p className="field-note research-trail-intro">These sources informed the search or were screened out. They are not potential leads and will not trigger seller outreach.</p>
          <div className="candidate-stack">{researchTrail.map((candidate) => {
          const verification = candidate.verification;
          const feedback = feedbackFor(candidate._id);
          const listingPrice = verification.listingPriceMinor !== undefined && verification.listingCurrency ? formatMoney(verification.listingPriceMinor, verification.listingCurrency) : verification.extractedValue !== undefined ? verification.extractedValue.toLocaleString() : null;
          const decision = candidateDecision(candidate);
          const potentialLead = isPotentialLead(candidate);
          const listingFacts = [
            listingPrice ? `${listingPriceLabel(verification.priceType)}: ${listingPrice}` : "No explicit actionable price found",
            verification.availability ? `Availability: ${verification.availability}` : undefined,
            verification.sellerTrust ? `Source assessment: ${verification.sellerTrust}` : undefined,
            candidate.sourceInspection === "inspected"
              ? "Detailed source inspection: complete"
              : candidate.sourceInspection === "limited"
                ? "Jamanyo could not read the listing detail in full"
                : candidate.sourceInspection === "user_reported_unavailable"
                  ? "Source access: unavailable to you"
                  : "Source inspection: needs a fresh check",
          ].filter((fact): fact is string => Boolean(fact)).join(" · ");
          const observedSignals = verification.matchReasons && verification.matchReasons.length > 0
            ? verification.matchReasons.join(" · ")
            : verification.matchDetail || "No detailed source signal was extracted.";
          const confirmBeforeActing = verification.flags.length > 0
            ? verification.flags.map(signalLabel).join(" · ")
            : "Condition, provenance, and transaction terms still need direct confirmation.";
          return <article key={candidate._id} className={`candidate-card candidate-card-rich ${potentialLead ? "cleared" : ""}`}>
            <ListingVisual
              className="candidate-card-visual"
              title={candidateTitle(candidate)}
              sourceUrl={candidate.sourceUrl}
              imageUrl={verification.listingImageUrl}
            />
            <div className="candidate-card-body">
              <div className="candidate-header">
                <div className="candidate-title-group">
                  <p className="candidate-source">Source · {candidateSourceLabel(candidate)}</p>
                  <a className="candidate-title" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidateTitle(candidate)} <span aria-hidden="true">↗</span></a>
                </div>
                <span className={`decision-pill decision-${decision.tone}`}>{decision.label}</span>
              </div>
              <p className="candidate-meta">Confidence {Math.round(verification.confidence * 100)}% · based on the source material captured for this listing.</p>
              {verification.matchDetail && <p className="candidate-detail">{verification.matchDetail}</p>}
              <details className="candidate-evidence-details">
                <summary>Evidence &amp; caveats</summary>
                <div className="candidate-evidence-grid">
                  <div className="evidence-block">
                    <span className="evidence-label">Listing says</span>
                    <p>{listingFacts}</p>
                  </div>
                  <div className="evidence-block">
                    <span className="evidence-label">{candidateReasonLabel}</span>
                    <p>{observedSignals}</p>
                  </div>
                  <div className="evidence-block evidence-alert">
                    <span className="evidence-label">Confirm before acting</span>
                    <p>{confirmBeforeActing}</p>
                  </div>
                </div>
              </details>
              <div className="source-access-row">
                {candidate.sourceInspection === "user_reported_unavailable" ? <span className="source-unavailable-note">You marked this source unavailable. It will stay out of potential leads.</span> : candidate.sourceInspection === "limited" ? <span className="source-unavailable-note">Open it yourself if you can. If it is a real listing, bring the direct URL back for another check.</span> : <button type="button" className="source-unavailable-button" disabled={sourceReportBusy === candidate._id} onClick={() => void handleSourceUnavailable(candidate._id)}>{sourceReportBusy === candidate._id ? "Marking source…" : "Report source unavailable"}</button>}
              </div>
              {potentialLead && <div className="feedback-row"><span className="feedback-label">Teach your scout:</span>{([
                ["good_lead", "Good lead"],
                ["wrong_style", "Not my style"],
                ["too_expensive", "Too expensive"],
                ["too_far", "Too far"],
                ["not_trusted", "Don't trust it"],
              ] as Array<[FeedbackKind, string]>).map(([kind, label]) => <button key={kind} type="button" className={`feedback-button ${feedback?.kind === kind ? "selected" : ""}`} disabled={feedbackBusy === candidate._id} onClick={() => void handleFeedback(candidate._id, kind)}>{label}</button>)}</div>}
            </div>
          </article>;
          })}</div>
        </details>
      </section>}

      {missionView === "leads" && cleared.length > 0 && <div className="card">
        <h3>{experienceProfile === "collector" ? "Shortlist" : experienceProfile === "deal_radar" ? "Potential leads" : "Potential leads"} ({cleared.length})</h3>
        <p className="field-note">Jamanyo never sends a seller message on its own. You approve every message below.</p>
        <div className="candidate-stack" style={{ marginTop: 10 }}>{cleared.map((candidate) => {
          const outreach = outreachItems.find((item) => item.candidateId === candidate._id);
          const verification = candidate.verification;
          const listingPrice = verification.listingPriceMinor !== undefined && verification.listingCurrency ? formatMoney(verification.listingPriceMinor, verification.listingCurrency) : null;
          const decision = candidateDecision(candidate);
          return <article key={candidate._id} className="candidate-card candidate-card-rich candidate-card-shortlist cleared">
            <ListingVisual
              className="candidate-card-visual"
              title={candidateTitle(candidate)}
              sourceUrl={candidate.sourceUrl}
              imageUrl={verification.listingImageUrl}
            />
            <div className="candidate-card-body">
              <div className="candidate-header">
                <div className="candidate-title-group">
                  <p className="candidate-source">Source · {candidateSourceLabel(candidate)}</p>
                  <a className="candidate-title" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidateTitle(candidate)} <span aria-hidden="true">↗</span></a>
                </div>
                <div className="candidate-status-group">
                  <span className={`decision-pill decision-${decision.tone}`}>{decision.label}</span>
                  {outreach && <span className={`status-pill ${outreach.status === "sent" || outreach.status === "replied" ? "status-active" : "status-paused"}`}>{outreach.status}</span>}
                </div>
              </div>
              {listingPrice && <p className="candidate-meta">{listingPriceLabel(verification.priceType)}: {listingPrice}{verification.priceType === "current_bid" ? " · live auction bids can rise before close" : ""}{verification.estimatedTotalMinor !== undefined && verification.listingCurrency ? ` · stated total ${formatMoney(verification.estimatedTotalMinor, verification.listingCurrency)}` : ""}</p>}
              {verification.matchDetail && <p className="candidate-detail">{verification.matchDetail}</p>}
              {hunt.contactPolicy === "alerts_only" ? <p className="field-note">Alert-only mission: seller outreach is deliberately held.</p> : outreach?.recipientEmail && outreach.status === "drafted" ? <><button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSend(outreach._id)}>Approve &amp; contact seller</button><p className="field-note">This sends the reviewed draft to {outreach.recipientEmail}.</p></> : outreach?.recipientEmail ? <p className="field-note">Seller contact: {outreach.recipientEmail}</p> : <p className="field-note">No seller address was found for this lead.</p>}
              <div className="source-access-row"><button type="button" className="source-unavailable-button" disabled={sourceReportBusy === candidate._id} onClick={() => void handleSourceUnavailable(candidate._id)}>{sourceReportBusy === candidate._id ? "Marking source…" : "Report source unavailable"}</button></div>
            </div>
          </article>;
        })}</div>
      </div>}

      {missionView === "leads" && cleared.length === 0 && <div className="card empty-mission-view">
        <p className="brief-kicker">{isAuctionWatch ? "No auction update yet" : "No shortlist yet"}</p>
        <h3>{isAuctionWatch ? "The first listing observation is still pending." : "Nothing has earned your attention yet."}</h3>
        <p className="text-muted text-sm">{isAuctionWatch ? "When the watch checks the listing, its observable bid, reserve, availability, and deadline signals will appear in the mission trail." : "That is a useful result. Jamanyo keeps sources in Research until a listing has enough public evidence to be worth your time."}</p>
      </div>}

      {missionView === "research" && <div className="card">
        <h3>Activity</h3>
        {events.length === 0 ? <p className="text-muted text-sm" style={{ marginTop: 8 }}>No activity yet.</p> : <div className="activity-feed">{events.map((event) => <div key={event._id} className="activity-item"><span className="dot" /><span className="action">{event.action.replace(/_/g, " ")}</span><span className="summary"> — {event.summary}</span><span className="time">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>)}</div>}
      </div>
      }
    </div>
  );
}

function HuntList({ hunts, selectedHuntId, onSelect, onCreate }: { hunts: Doc<"hunts">[]; selectedHuntId: Id<"hunts"> | null; onSelect: (id: Id<"hunts">) => void; onCreate: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">Missions</div>
        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={onCreate}>+ Give your scout a mission</button>
      </div>
      <div className="hunt-list">
        {hunts.length === 0 ? (
          <div className="sidebar-empty">No missions yet. Brief your scout once, then use either email or the dashboard.</div>
        ) : hunts.map((hunt) => {
          const profile = profileForHunt(hunt);
          return (
            <button key={hunt._id} type="button" className={`hunt-list-item ${selectedHuntId === hunt._id ? "active" : ""}`} onClick={() => onSelect(hunt._id)}>
              <span className="hunt-category">{vehicleMissionTitle(hunt)}</span>
              <span className="hunt-direction">{huntDirectionLabel(hunt)}{formatHuntBudget(hunt) ? ` · ${formatHuntBudget(hunt)}` : ""}</span>
              <span className="hunt-meta">
                <span className={`status-pill status-${hunt.status}`}>{hunt.status}</span>
                {isVehicleCategory(hunt.category) && <span className={`experience-mini experience-${profile}`}>{profileLabel(profile)}</span>}
                {hunt.mode === "monitor" && <span className="monitor-badge">{hunt.monitorPurpose === "auction" ? hunt.monitorStatus === "active" && hunt.status === "active" ? "auction watch" : "auction watch paused" : hunt.monitorStatus === "active" && hunt.status === "active" ? "watching" : "watch paused"}</span>}
                {hunt.mode === "one_off" && <span className="monitor-badge">one check</span>}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function InboxSetup() {
  const inbox = useQuery(api.inbox.getForUser, {});
  const waitlist = useQuery(api.inbox.getWaitlistStatus, {});
  const getOrCreateInbox = useAction(api.mail.getOrCreateInbox);
  const joinWaitlist = useMutation(api.inbox.joinWaitlist);
  const [notice, setNotice] = useState<{ message: string; canJoinWaitlist: boolean } | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const setup = async () => {
    setSettingUp(true);
    setNotice(null);
    try {
      const result = await getOrCreateInbox({ confirmed: true });
      if (result.kind !== "ready") {
        setNotice({
          message: result.message,
          canJoinWaitlist: result.kind === "waitlist",
        });
      }
    } catch {
      setNotice({
        message:
          "We couldn’t check email setup just now. Your dashboard is ready; please try again shortly.",
        canJoinWaitlist: false,
      });
    } finally {
      setSettingUp(false);
    }
  };

  const join = async () => {
    setJoiningWaitlist(true);
    try {
      await joinWaitlist({});
    } catch {
      setNotice({
        message: "We couldn’t save your waitlist request just now. Please try again shortly.",
        canJoinWaitlist: true,
      });
    } finally {
      setJoiningWaitlist(false);
    }
  };

  if (inbox) {
    return (
      <span className="user-email inbox-setup">
        <span className="inbox-email-label">{inbox.access === "demo" ? "Demo agent inbox" : "Agent inbox"}: {inbox.email}</span>
        {!inbox.webhookConnected && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void setup()}
              disabled={settingUp}
            >
              {settingUp ? "Reconnecting…" : <><span className="desktop-label">Reconnect email</span><span className="mobile-label">Reconnect</span></>}
            </button>
            <span className="field-note">Replies need a quick connection.</span>
          </>
        )}
        {notice && (
          <span className="inbox-setup-note">
            <span role="status">{notice.message}</span>
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="user-email inbox-setup">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void setup()}
        disabled={settingUp}
      >
        {settingUp ? "Checking email access…" : <><span className="desktop-label">Set up agent inbox</span><span className="mobile-label">Inbox</span></>}
      </button>
      {notice && (
        <span className="inbox-setup-note">
          <span role="status">{notice.message}</span>
          {notice.canJoinWaitlist && !waitlist?.joined && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void join()}
              disabled={joiningWaitlist}
            >
              {joiningWaitlist ? "Joining…" : "Join the waitlist"}
            </button>
          )}
          {notice.canJoinWaitlist && waitlist?.joined && (
            <span className="inbox-waitlist-confirmation" role="status">
              You’re on the waitlist.
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function UserMenu() {
  const { signOut } = useAuthActions();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (caught) {
      setError(errorMessage(caught, "We couldn't sign you out. Please try again."));
    } finally {
      setSigningOut(false);
    }
  };

  return <div className="user-menu"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>{error && <span className="signout-error" role="alert">{error}</span>}</div>;
}

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [selectedHuntId, setSelectedHuntId] = useState<Id<"hunts"> | null>(null);
  const [showNewMission, setShowNewMission] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const hunts = useQuery(api.hunts.listForUser, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (!isAuthenticated) {
      setSelectedHuntId(null);
      setShowNewMission(false);
      setShowSettings(false);
    }
  }, [isAuthenticated]);

  if (isLoading) return <div className="app-loading">Loading your scout…</div>;
  if (!isAuthenticated) return <AuthGate />;

  const missionList = (hunts ?? []) as Doc<"hunts">[];
  const hunt = missionList.find((item) => item._id === selectedHuntId) ?? null;

  return (
    <div className="app">
      <header className="header">
        <a href="#" className="wordmark" onClick={(event) => { event.preventDefault(); setSelectedHuntId(null); }}>
          Jamanyo <span className="header-context">Built for the garage. Useful everywhere.</span>
        </a>
        <div className="header-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}><span className="desktop-label">Scout settings</span><span className="mobile-label">Scout</span></button>
          <InboxSetup />
          <UserMenu />
        </div>
      </header>
      <div className="main">
        <HuntList hunts={missionList} selectedHuntId={selectedHuntId} onSelect={setSelectedHuntId} onCreate={() => setShowNewMission(true)} />
        <main className="content">
          {hunt ? <HuntDetail hunt={hunt} onBack={() => setSelectedHuntId(null)} /> : (
            <div className="empty">
              <p className="display-italic" style={{ fontSize: 26, color: "var(--ink)" }}>
                {missionList.length === 0 ? "What belongs in your garage?" : "Pick a mission to see the full trail."}
              </p>
              <p className="text-muted text-sm">Start with a car brief or anything else worth finding. Your dashboard and agent inbox always share the same mission.</p>
              {missionList.length === 0 && <button type="button" className="btn btn-primary" onClick={() => setShowNewMission(true)}>Give your scout a mission</button>}
            </div>
          )}
        </main>
      </div>
      {showNewMission && <NewHuntForm onClose={() => setShowNewMission(false)} onCreated={(huntId) => setSelectedHuntId(huntId)} />}
      {showSettings && <ScoutSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
