import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import {
  contactPolicyValidator,
  deliveryModeValidator,
  experienceProfileValidator,
  notificationCadenceValidator,
  serendipityValidator,
} from "./market";

const preferenceResult = v.object({
  currency: v.string(),
  locale: v.string(),
  timeZone: v.string(),
  countryCode: v.optional(v.string()),
  locality: v.optional(v.string()),
  radiusKm: v.optional(v.number()),
  deliveryMode: deliveryModeValidator,
  allowedCountries: v.optional(v.array(v.string())),
  language: v.optional(v.string()),
  notificationCadence: notificationCadenceValidator,
  weeklyGarageBrief: v.boolean(),
  quietHoursStart: v.optional(v.number()),
  quietHoursEnd: v.optional(v.number()),
  serendipity: serendipityValidator,
  experienceProfile: experienceProfileValidator,
  contactPolicy: contactPolicyValidator,
  preferredDomains: v.optional(v.array(v.string())),
  blockedDomains: v.optional(v.array(v.string())),
});

export type ScoutPreferences = {
  currency: string;
  locale: string;
  timeZone: string;
  countryCode?: string;
  locality?: string;
  radiusKm?: number;
  deliveryMode: "pickup" | "shipping" | "either";
  allowedCountries?: string[];
  language?: string;
  notificationCadence: "instant" | "daily_digest";
  weeklyGarageBrief: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  serendipity: "exact" | "smart" | "delight";
  experienceProfile: "collector" | "deal_radar" | "adaptive";
  contactPolicy: "alerts_only" | "draft_for_review";
  preferredDomains?: string[];
  blockedDomains?: string[];
};

const defaults: ScoutPreferences = {
  currency: "USD",
  locale: "en",
  timeZone: "UTC",
  deliveryMode: "either" as const,
  notificationCadence: "instant" as const,
  weeklyGarageBrief: true,
  serendipity: "smart" as const,
  experienceProfile: "adaptive" as const,
  contactPolicy: "draft_for_review" as const,
};

function validatePreferences(args: {
  currency: string;
  locale: string;
  timeZone: string;
  countryCode?: string;
  radiusKm?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  allowedCountries?: string[];
  preferredDomains?: string[];
  blockedDomains?: string[];
}) {
  if (!/^[A-Z]{3}$/.test(args.currency)) {
    throw new Error("Currency must be a three-letter ISO code");
  }
  if (args.countryCode && !/^[A-Z]{2}$/.test(args.countryCode)) {
    throw new Error("Country must be a two-letter ISO code");
  }
  if (args.locale.length === 0 || args.locale.length > 64) {
    throw new Error("Locale must be between 1 and 64 characters");
  }
  try {
    Intl.DateTimeFormat("en", { timeZone: args.timeZone });
  } catch {
    throw new Error("Choose a valid IANA time zone");
  }
  if (args.radiusKm !== undefined && (args.radiusKm < 1 || args.radiusKm > 20000)) {
    throw new Error("Search radius must be between 1 and 20,000 km");
  }
  const hasQuietStart = args.quietHoursStart !== undefined;
  const hasQuietEnd = args.quietHoursEnd !== undefined;
  if (hasQuietStart !== hasQuietEnd) {
    throw new Error("Set both quiet-hours boundaries or neither");
  }
  for (const hour of [args.quietHoursStart, args.quietHoursEnd]) {
    if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
      throw new Error("Quiet hours must use whole hours from 0 to 23");
    }
  }
  for (const collection of [
    args.allowedCountries,
    args.preferredDomains,
    args.blockedDomains,
  ]) {
    if (collection && collection.length > 12) {
      throw new Error("Choose at most 12 countries or domains");
    }
  }
  if (
    args.allowedCountries?.some((country) => !/^[A-Z]{2}$/.test(country))
  ) {
    throw new Error("Allowed markets must use two-letter ISO country codes");
  }
  for (const domains of [args.preferredDomains, args.blockedDomains]) {
    if (domains?.some((domain) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))) {
      throw new Error("Domains should look like example.com, without a path");
    }
  }
  if (
    args.quietHoursStart !== undefined &&
    args.quietHoursStart === args.quietHoursEnd
  ) {
    throw new Error("Quiet-hours start and end must be different");
  }
}

export const getMine = query({
  args: {},
  returns: preferenceResult,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const saved = await ctx.db
      .query("userPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .unique();
    if (!saved) return defaults;
    return {
      currency: saved.currency,
      locale: saved.locale,
      timeZone: saved.timeZone,
      countryCode: saved.countryCode,
      locality: saved.locality,
      radiusKm: saved.radiusKm,
      deliveryMode: saved.deliveryMode,
      allowedCountries: saved.allowedCountries,
      language: saved.language,
      notificationCadence: saved.notificationCadence,
      weeklyGarageBrief: saved.weeklyGarageBrief ?? false,
      quietHoursStart: saved.quietHoursStart,
      quietHoursEnd: saved.quietHoursEnd,
      serendipity: saved.serendipity,
      experienceProfile: saved.experienceProfile ?? "adaptive",
      contactPolicy: saved.contactPolicy,
      preferredDomains: saved.preferredDomains,
      blockedDomains: saved.blockedDomains,
    };
  },
});

export const getForOwnerInternal = internalQuery({
  args: { ownerId: v.string() },
  returns: preferenceResult,
  handler: async (ctx, args) => {
    const saved = await ctx.db
      .query("userPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    if (!saved) return defaults;
    return {
      currency: saved.currency,
      locale: saved.locale,
      timeZone: saved.timeZone,
      countryCode: saved.countryCode,
      locality: saved.locality,
      radiusKm: saved.radiusKm,
      deliveryMode: saved.deliveryMode,
      allowedCountries: saved.allowedCountries,
      language: saved.language,
      notificationCadence: saved.notificationCadence,
      weeklyGarageBrief: saved.weeklyGarageBrief ?? false,
      quietHoursStart: saved.quietHoursStart,
      quietHoursEnd: saved.quietHoursEnd,
      serendipity: saved.serendipity,
      experienceProfile: saved.experienceProfile ?? "adaptive",
      contactPolicy: saved.contactPolicy,
      preferredDomains: saved.preferredDomains,
      blockedDomains: saved.blockedDomains,
    };
  },
});

export const saveMine = mutation({
  args: preferenceResult,
  returns: preferenceResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const normalized = {
      ...args,
      currency: args.currency.trim().toUpperCase(),
      locale: args.locale.trim(),
      timeZone: args.timeZone.trim(),
      countryCode: args.countryCode?.trim().toUpperCase(),
      locality: args.locality?.trim() || undefined,
      language: args.language?.trim() || undefined,
      allowedCountries: args.allowedCountries
        ? [...new Set(args.allowedCountries.map((country) => country.trim().toUpperCase()).filter(Boolean))]
        : undefined,
      preferredDomains: args.preferredDomains
        ? [...new Set(args.preferredDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
        : undefined,
      blockedDomains: args.blockedDomains
        ? [...new Set(args.blockedDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))]
        : undefined,
    };
    validatePreferences(normalized);
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .unique();
    const value = { ...normalized, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("userPreferences", {
        ownerId: identity.tokenIdentifier,
        ...value,
      });
    }
    return normalized;
  },
});
