// A model can occasionally confuse a historic auction price with a live bid.
// These source-supplied phrases are strong enough to act as a deterministic
// safety rail before Jamanyo presents a purchase opportunity.
export function sourceClearlySaysListingClosed(
  title: string | undefined,
  content: string,
): boolean {
  const normalizedTitle = (title ?? "").replace(/\s+/g, " ").toLowerCase();
  const normalizedContent = content.replace(/\s+/g, " ").toLowerCase();
  const titleSignal =
    /\b(?:sold(?:\s+for)?|closed on|auction (?:has )?(?:ended|closed)|bidding (?:has )?closed)\b/.test(
      normalizedTitle,
    );
  const contentSignal =
    /\b(?:auction (?:has )?(?:ended|closed)|bidding (?:has )?closed|this lot (?:has )?sold|sold for\s+[$€£])\b/.test(
      normalizedContent,
    );
  return titleSignal || contentSignal;
}
