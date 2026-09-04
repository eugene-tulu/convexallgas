import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

export default function App() {
  const businesses = useQuery(api.businessesQueries.list) ?? [];
  const [businessId, setBusinessId] = useState<Id<"businesses"> | null>(null);
  const [tab, setTab] = useState<"shifts" | "workers" | "activity" | "onboard">("shifts");

  useEffect(() => {
    if (!businessId && businesses.length > 0) {
      setBusinessId(businesses[0]._id);
    }
  }, [businesses, businessId]);

  const biz = useMemo(() => businesses.find((b) => b._id === businessId) ?? null, [businesses, businessId]);
  const runSeed = useAction(api.seedAction.runSeed);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ background: "white", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Proxy</h1>
            <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
              Email-first shift call-outs. AI ranks, manager approves, system covers the rest.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {businesses.length === 0 && (
              <button
                onClick={() => runSeed({})}
                style={{ padding: "6px 12px", background: "#0f172a", color: "white", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
              >
                Seed demo data
              </button>
            )}
            {businesses.length > 0 && (
              <select
                value={businessId ?? ""}
                onChange={(e) => setBusinessId(e.target.value as Id<"businesses">)}
                style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }}
              >
                {businesses.map((b) => (
                  <option key={b._id} value={b._id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <nav style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", display: "flex", gap: 4 }}>
          {(["shifts", "workers", "onboard", "activity"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 500,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === t ? "#0f172a" : "transparent"}`,
                color: tab === t ? "#0f172a" : "#6b7280",
                cursor: "pointer",
              }}
            >
              {t === "shifts" ? "Shifts" : t === "workers" ? "Workers" : t === "onboard" ? "Onboard business" : "Activity"}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px" }}>
        {!biz && tab !== "onboard" && (
          <div style={{ background: "white", borderRadius: 8, padding: 32, textAlign: "center", color: "#6b7280" }}>
            <p>No business yet. Click <strong>Seed demo data</strong> for Merced Coffee Co., or use the Onboard tab to add one.</p>
          </div>
        )}
        {tab === "shifts" && biz && <ShiftsTab businessId={biz._id} />}
        {tab === "workers" && biz && <WorkersTab businessId={biz._id} />}
        {tab === "onboard" && <OnboardTab />}
        {tab === "activity" && <ActivityTab />}
      </main>
    </div>
  );
}

function ShiftsTab({ businessId }: { businessId: Id<"businesses"> }) {
  const shifts = useQuery(api.shifts.list, { businessId }) ?? [];
  const workers = useQuery(api.workers.list, { businessId }) ?? [];
  const postShift = useMutation(api.shifts.postShift);
  const rebroadcast = useMutation(api.shifts.rebroadcastShift);
  const [creating, setCreating] = useState(false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
      <div>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Active shifts</h2>
        {shifts.length === 0 ? (
          <div style={{ background: "white", borderRadius: 8, padding: 24, color: "#6b7280" }}>
            No shifts yet. Post one on the right to start a broadcast.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {shifts.map((s) => (
              <ShiftCard key={s._id} shift={s} onRebroadcast={(rate, label) => rebroadcast({ shiftId: s._id, displayRate: rate, displayRateLabel: label })} />
            ))}
          </div>
        )}
      </div>
      <div>
        <div style={{ background: "white", borderRadius: 8, padding: 16, position: "sticky", top: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Post a call-out</h3>
          <PostShiftForm
            disabled={creating}
            onSubmit={async (data) => {
              setCreating(true);
              try {
                await postShift({ businessId, ...data });
              } finally {
                setCreating(false);
              }
            }}
            consentedCount={workers.filter((w) => w.consent).length}
          />
        </div>
      </div>
    </div>
  );
}

function PostShiftForm({ onSubmit, disabled, consentedCount }: { onSubmit: (d: { role: string; startTime: number; urgency: "critical" | "urgent" | "normal" | "low"; displayRate: number; displayRateLabel: string }) => void; disabled: boolean; consentedCount: number }) {
  const [role, setRole] = useState("barista");
  const [urgency, setUrgency] = useState<"critical" | "urgent" | "normal" | "low">("urgent");
  const [displayRate, setDisplayRate] = useState(22);
  const [label, setLabel] = useState("/hr");
  const [startTimeOffset, setStartTimeOffset] = useState(60);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ role, startTime: Date.now() + startTimeOffset * 60 * 1000, urgency, displayRate, displayRateLabel: label });
      }}
      style={{ display: "grid", gap: 8 }}
    >
      <Field label="Role">
        <input value={role} onChange={(e) => setRole(e.target.value)} style={input} />
      </Field>
      <Field label="Starts in (minutes)">
        <input type="number" value={startTimeOffset} onChange={(e) => setStartTimeOffset(parseInt(e.target.value) || 60)} style={input} />
      </Field>
      <Field label="Urgency">
        <select value={urgency} onChange={(e) => setUrgency(e.target.value as "critical" | "urgent" | "normal" | "low")} style={input}>
          <option value="critical">critical (3 min timeout)</option>
          <option value="urgent">urgent (5 min timeout)</option>
          <option value="normal">normal (10 min timeout)</option>
          <option value="low">low (20 min timeout)</option>
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <Field label="Display rate ($)">
          <input type="number" value={displayRate} onChange={(e) => setDisplayRate(parseFloat(e.target.value) || 0)} style={input} />
        </Field>
        <Field label="Label">
          <select value={label} onChange={(e) => setLabel(e.target.value)} style={input}>
            <option value="/hr">/hr</option>
            <option value="flat">flat</option>
          </select>
        </Field>
      </div>
      <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>
        Will broadcast to <strong>{consentedCount}</strong> consented worker{consentedCount === 1 ? "" : "s"} on file.
      </p>
      <button type="submit" disabled={disabled} style={primaryBtn}>
        {disabled ? "Posting…" : "Post + broadcast"}
      </button>
    </form>
  );
}

function ShiftCard({ shift, onRebroadcast }: { shift: any; onRebroadcast: (rate: number, label: string) => void }) {
  const shortlist = useQuery(api.repliesQueries.shortlist, { shiftId: shift._id }) ?? [];
  const approve = useMutation(api.repliesQueries.approveCandidate);
  const [rebRate, setRebRate] = useState(shift.displayRate);
  const [rebLabel, setRebLabel] = useState(shift.displayRateLabel);

  const elapsed =
    shift.broadcastAt && shift.confirmedAt
      ? Math.round((shift.confirmedAt - shift.broadcastAt) / 1000)
      : null;
  const availableInternal = shortlist.filter(
    (r: any) => r.source === "internal" && r.parsedAvailability?.available && r.receivedAt >= (shift.broadcastAt ?? 0)
  );
  const external = shortlist.filter((r: any) => r.source === "external");

  return (
    <div style={{ background: "white", borderRadius: 8, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {shift.role} <span style={{ color: "#6b7280", fontWeight: 400 }}>· {new Date(shift.startTime).toLocaleString()}</span>
          </div>
          <div style={{ color: "#6b7280", fontSize: 12 }}>
            ${shift.displayRate}{shift.displayRateLabel} · urgency {shift.urgency} · round {shift.broadcastRound}
          </div>
        </div>
        <StatusBadge status={shift.status} elapsed={elapsed} />
      </div>

      {availableInternal.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#374151", fontWeight: 600, marginBottom: 6 }}>Internal candidates</div>
          {availableInternal.map((r: any) => (
            <div key={r._id} style={candidateRow(r.source)}>
              <div>
                <div style={{ fontWeight: 500 }}>{r.worker?.name ?? "(unknown)"} <span style={{ color: "#6b7280", fontSize: 12 }}>· {r.worker?.contact}</span></div>
                <div style={{ color: "#374151", fontSize: 12, marginTop: 2 }}>"{r.rawReplyText.slice(0, 140)}"</div>
                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
                  {r.parsedAvailability?.constraints && <>constraints: {r.parsedAvailability.constraints} · </>}
                  confidence {Math.round((r.parsedAvailability?.confidence ?? 0) * 100)}% · score {r.rankScore?.toFixed(2)} · reliability {r.worker?.reliabilityScore?.toFixed(2)}
                </div>
              </div>
              {shift.status !== "confirmed" && shift.status !== "cancelled" && (
                <button onClick={() => approve({ shiftId: shift._id, responseId: r._id })} style={approveBtn}>
                  Approve
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {shift.status === "escalating" && external.length === 0 && (
        <div style={{ marginTop: 12, padding: 10, background: "#fef3c7", color: "#92400e", borderRadius: 6, fontSize: 13 }}>
          Checking outside options… looking at warm backup pool, then a live search.
        </div>
      )}

      {external.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#7c2d12", fontWeight: 600, marginBottom: 6, padding: "4px 8px", background: "#fed7aa", borderRadius: 4, display: "inline-block" }}>
            Outside your roster (external — approval required before any contact)
          </div>
          {external.map((r: any) => (
            <div key={r._id} style={{ ...candidateRow("external"), borderColor: "#fdba74" }}>
              <div>
                <a href={r.externalSourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#9a3412", fontWeight: 500 }}>
                  {r.externalSourceUrl}
                </a>
                <div style={{ color: "#7c2d12", fontSize: 11, marginTop: 2 }}>
                  Source URL only — no contact info scraped. Click to view the listing.
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {shift.status === "escalating" && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", padding: 10, background: "#fef2f2", borderRadius: 6 }}>
          <div style={{ flex: 1, fontSize: 13, color: "#991b1b" }}>
            Internal sourcing timed out. Bump the rate and re-broadcast, or wait for external results.
          </div>
          <input type="number" value={rebRate} onChange={(e) => setRebRate(parseFloat(e.target.value) || 0)} style={{ ...input, width: 70 }} />
          <select value={rebLabel} onChange={(e) => setRebLabel(e.target.value)} style={{ ...input, width: 70 }}>
            <option value="/hr">/hr</option>
            <option value="flat">flat</option>
          </select>
          <button onClick={() => onRebroadcast(rebRate, rebLabel)} style={{ ...primaryBtn, background: "#dc2626" }}>
            Re-broadcast
          </button>
        </div>
      )}

      {shift.status === "confirmed" && (
        <div style={{ marginTop: 12, padding: 10, background: "#dcfce7", color: "#166534", borderRadius: 6, fontSize: 13 }}>
          Confirmed in {elapsed}s from broadcast.
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, elapsed }: { status: string; elapsed: number | null }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    broadcasting: { color: "#1e40af", bg: "#dbeafe", label: "broadcasting" },
    shortlist_ready: { color: "#92400e", bg: "#fef3c7", label: "shortlist ready" },
    escalating: { color: "#991b1b", bg: "#fee2e2", label: "checking outside" },
    confirmed: { color: "#166534", bg: "#dcfce7", label: elapsed != null ? `confirmed (${elapsed}s)` : "confirmed" },
    cancelled: { color: "#374151", bg: "#e5e7eb", label: "cancelled" },
  };
  const s = map[status] ?? map.broadcasting;
  return (
    <span style={{ padding: "3px 8px", fontSize: 11, fontWeight: 600, color: s.color, background: s.bg, borderRadius: 4 }}>
      {s.label}
    </span>
  );
}

function candidateRow(source: string): React.CSSProperties {
  return {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: 10,
    marginTop: 6,
    background: source === "external" ? "#fff7ed" : "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 13,
  };
}

function WorkersTab({ businessId }: { businessId: Id<"businesses"> }) {
  const workers = useQuery(api.workers.list, { businessId }) ?? [];
  const setConsent = useMutation(api.workers.setConsent);
  return (
    <div>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Workers</h2>
      <div style={{ background: "white", borderRadius: 8, padding: 16 }}>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 12px" }}>
          Workers only receive future broadcasts if <strong>consent = true</strong>. Toggle below to demonstrate the consent filter.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 12 }}>
              <th style={th}>Name</th>
              <th style={th}>Contact</th>
              <th style={th}>Roles</th>
              <th style={th}>Consent</th>
              <th style={th}>Reliability</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w._id} style={{ borderTop: "1px solid #f3f4f6" }}>
                <td style={td}>{w.name}</td>
                <td style={{ ...td, color: "#6b7280" }}>{w.contact}</td>
                <td style={td}>{w.roles.join(", ")}</td>
                <td style={td}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={w.consent} onChange={(e) => setConsent({ workerId: w._id, consent: e.target.checked })} />
                    {w.consent ? "yes" : "no"}
                  </label>
                </td>
                <td style={td}>{w.reliabilityScore.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OnboardTab() {
  const createBusiness = useAction(api.businesses.createBusiness);
  const [name, setName] = useState("Acme Bakery");
  const [category, setCategory] = useState("bakery");
  const [location, setLocation] = useState("Merced, CA");
  const [sizeSignal, setSizeSignal] = useState("small (3-8 staff)");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Onboard a business (Firecrawl-enriched profile)</h2>
      <div style={{ background: "white", borderRadius: 8, padding: 16, display: "grid", gap: 8 }}>
        <p style={{ color: "#6b7280", fontSize: 13, margin: "0 0 6px" }}>
          Manager signs up with name, city, and an optional website. For this build, the manager reviews/edits the
          structured profile below before confirming (no auto-save).
        </p>
        <Field label="Business name"><input value={name} onChange={(e) => setName(e.target.value)} style={input} /></Field>
        <Field label="Category (generic, e.g. cafe, bakery, clinic)"><input value={category} onChange={(e) => setCategory(e.target.value)} style={input} /></Field>
        <Field label="Location"><input value={location} onChange={(e) => setLocation(e.target.value)} style={input} /></Field>
        <Field label="Size signal"><input value={sizeSignal} onChange={(e) => setSizeSignal(e.target.value)} style={input} /></Field>
        <Field label="Source URL (optional)"><input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} style={input} placeholder="https://..." /></Field>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await createBusiness({ name, category, location, sizeSignal, hoursJson: "{}", sourceUrl: sourceUrl || undefined });
              setResult(`Created ${name} with inbox ${(r as any).inboxEmail}`);
            } catch (e) {
              setResult(`Error: ${(e as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
          style={primaryBtn}
        >
          {busy ? "Creating…" : "Confirm + create business"}
        </button>
        {result && <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>{result}</p>}
      </div>
    </div>
  );
}

function ActivityTab() {
  const events = useQuery(api.events.recent, { limit: 200 }) ?? [];
  return (
    <div>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Activity log</h2>
      <div style={{ background: "white", borderRadius: 8, padding: 16, maxHeight: 600, overflowY: "auto" }}>
        {events.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No events yet.</p>
        ) : events.map((e) => (
          <div key={e._id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
            <span style={{ display: "inline-block", padding: "1px 6px", background: badgeBg(e.action), color: badgeColor(e.action), borderRadius: 4, fontSize: 11, fontWeight: 600, marginRight: 8 }}>
              {e.action}
            </span>
            <span style={{ color: "#111827" }}>{e.summary}</span>
            <span style={{ color: "#9ca3af", marginLeft: 8, fontSize: 11 }}>{new Date(e.timestamp).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function badgeBg(action: string): string {
  if (action.includes("confirmed")) return "#dcfce7";
  if (action.includes("broadcast")) return "#dbeafe";
  if (action.includes("parse_failed")) return "#fee2e2";
  if (action.includes("escalat")) return "#fed7aa";
  if (action.includes("reply")) return "#ede9fe";
  return "#f3f4f6";
}
function badgeColor(action: string): string {
  if (action.includes("confirmed")) return "#166534";
  if (action.includes("broadcast")) return "#1e40af";
  if (action.includes("parse_failed")) return "#991b1b";
  if (action.includes("escalat")) return "#9a3412";
  if (action.includes("reply")) return "#5b21b6";
  return "#374151";
}

const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, width: "100%" };
const primaryBtn: React.CSSProperties = { padding: "8px 12px", background: "#0f172a", color: "white", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const approveBtn: React.CSSProperties = { ...primaryBtn, background: "#16a34a", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 6px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 6px" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
      {children}
    </label>
  );
}
