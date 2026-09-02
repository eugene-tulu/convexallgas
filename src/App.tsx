import React, { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

type Tab = "dashboard" | "crawl" | "search" | "inbox" | "reminders";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(null);

  const projects = useQuery(api.projects.list) ?? [];
  const regulations = useQuery(api.regulations.list) ?? [];
  const obligations = useQuery(api.obligations.listObligations) ?? [];

  const project = projects.find((p) => p._id === selectedProjectId) ?? projects[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">EIA Compliance Copilot</h1>
            <p className="text-sm text-gray-500">
              AI-powered environmental impact assessment compliance tracking
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="border border-gray-300 rounded px-3 py-1 text-sm"
              value={project?._id ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value as Id<"projects">)}
            >
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1">
          {(["dashboard", "crawl", "search", "inbox", "reminders"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "dashboard" && (
          <Dashboard
            projects={projects}
            regulations={regulations}
            obligations={obligations}
            projectId={project?._id}
          />
        )}
        {activeTab === "crawl" && <CrawlPanel project={project} />}
        {activeTab === "search" && <SearchPanel />}
        {activeTab === "inbox" && <InboxPanel />}
        {activeTab === "reminders" && <RemindersPanel project={project} />}
      </main>
    </div>
  );
}

function Dashboard({ projects, regulations, obligations, projectId }: any) {
  const projectObligations = projectId
    ? obligations.filter((o: any) => o.projectId === projectId)
    : obligations;
  const overdue = projectObligations.filter((o: any) => o.status === "overdue");
  const pending = projectObligations.filter((o: any) => o.status === "pending");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Projects" value={projects.length} color="blue" />
        <Stat label="Regulations" value={regulations.length} color="green" />
        <Stat
          label="Overdue"
          value={overdue.length}
          color="red"
          highlight={overdue.length > 0}
        />
        <Stat label="Pending" value={pending.length} color="yellow" />
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Obligations</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {projectObligations.length === 0 ? (
            <p className="px-6 py-4 text-gray-500">No obligations yet. Click "Crawl" to get started.</p>
          ) : (
            projectObligations.map((ob: any) => (
              <ObligationRow key={ob._id} obligation={ob} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ObligationRow({ obligation }: any) {
  const markComplete = useMutation(api.obligations.markObligationCompleted);
  const snooze = useMutation(api.obligations.snoozeObligation);
  const isOverdue = obligation.status === "overdue";
  const daysUntil = Math.ceil((obligation.deadline - Date.now()) / (1000 * 60 * 60 * 24));

  return (
    <div className="px-6 py-4 flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-gray-900">{obligation.commitmentText}</p>
        <p className="text-sm text-gray-500">
          Deadline: {new Date(obligation.deadline).toLocaleDateString()} (
          {daysUntil > 0 ? `${daysUntil}d left` : `${Math.abs(daysUntil)}d ago`})
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-1 text-xs rounded ${
            isOverdue
              ? "bg-red-100 text-red-800"
              : obligation.status === "completed"
              ? "bg-green-100 text-green-800"
              : "bg-yellow-100 text-yellow-800"
          }`}
        >
          {obligation.status}
        </span>
        {obligation.status !== "completed" && (
          <>
            <button
              onClick={() => markComplete({ id: obligation._id })}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              Complete
            </button>
            <button
              onClick={() => snooze({ id: obligation._id, snoozeMs: 24 * 60 * 60 * 1000 })}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Snooze 1d
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, highlight }: any) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
    yellow: "bg-yellow-50 text-yellow-700",
  };
  return (
    <div
      className={`p-4 rounded-lg ${colors[color]} ${
        highlight ? "ring-2 ring-red-400" : ""
      }`}
    >
      <p className="text-sm">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function CrawlPanel({ project }: any) {
  const [query, setQuery] = useState("California wind farm environmental compliance");
  const [results, setResults] = useState<any[]>([]);
  const [scraping, setScraping] = useState(false);
  const [scrapedDocs, setScrapedDocs] = useState<any[]>([]);
  const search = useAction(api.firecrawl.search);
  const scrape = useAction(api.firecrawl.scrape);
  const summarize = useAction(api.llm.runLlmTask);

  async function handleSearch() {
    const res = await search({ query, limit: 10 });
    setResults(res as any[]);
  }

  async function handleScrapeAll() {
    setScraping(true);
    const docs = [];
    for (const r of results) {
      try {
        const scraped = (await scrape({ url: r.url })) as any;
        docs.push({ ...r, ...scraped });
      } catch (e) {
        console.error(`Failed to scrape ${r.url}`, e);
      }
    }
    setScraping(false);
    setScrapedDocs(docs);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Crawl Regulatory Sources</h2>
        <p className="text-sm text-gray-500 mb-4">
          Search and scrape regulatory content for {project?.name ?? "your project"}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2"
            placeholder="e.g., California wind farm environmental compliance"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="font-semibold">Search Results ({results.length})</h3>
            <button
              onClick={handleScrapeAll}
              disabled={scraping}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {scraping ? "Scraping..." : "Scrape All"}
            </button>
          </div>
          <div className="divide-y divide-gray-200">
            {results.map((r, i) => (
              <div key={i} className="px-6 py-3">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-600 font-medium hover:underline"
                >
                  {r.title}
                </a>
                <p className="text-sm text-gray-500">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {scrapedDocs.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-semibold">Scraped Documents ({scrapedDocs.length})</h3>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {scrapedDocs.map((d, i) => (
              <details key={i} className="px-6 py-3">
                <summary className="font-medium cursor-pointer">{d.title || d.url}</summary>
                <pre className="mt-2 text-xs bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
                  {d.markdown?.slice(0, 1000)}
                  {d.markdown && d.markdown.length > 1000 ? "..." : ""}
                </pre>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const search = useAction(api.search.searchDocuments);

  async function handleSearch() {
    setSearching(true);
    try {
      const res = (await search({ query })) as any[];
      setResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Document Search</h2>
        <p className="text-sm text-gray-500 mb-4">
          Semantic search across all crawled documents and regulations
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border border-gray-300 rounded px-3 py-2"
            placeholder="What do you want to find?"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-semibold">Results ({results.length})</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {results.map((r, i) => (
              <div key={i} className="px-6 py-3">
                <p className="text-sm text-gray-500">{r.source}</p>
                <p className="text-sm mt-1">{r.content?.slice(0, 300)}...</p>
                <p className="text-xs text-gray-400 mt-1">Score: {r.score.toFixed(3)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxPanel() {
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [selectedInbox, setSelectedInbox] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const listInboxes = useAction(api.mail.listInboxes);
  const listMessages = useAction(api.mail.listMessages);
  const createInbox = useAction(api.mail.getOrCreateInbox);

  React.useEffect(() => {
    loadInboxes();
  }, []);

  React.useEffect(() => {
    if (selectedInbox) loadMessages();
  }, [selectedInbox]);

  async function loadInboxes() {
    const res = (await listInboxes({})) as any[];
    setInboxes(res);
    if (res.length > 0 && !selectedInbox) setSelectedInbox(res[0].inboxId);
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const res = (await listMessages({ inboxId: selectedInbox!, limit: 20 })) as any[];
      setMessages(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateInbox() {
    const inbox = (await createInbox({
      username: `compliance-${Date.now()}`,
      displayName: "Compliance Inbox",
    })) as any;
    setInboxes([...inboxes, inbox]);
    setSelectedInbox(inbox.inboxId);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Inbox</h2>
          <button
            onClick={handleCreateInbox}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Inbox
          </button>
        </div>
        <select
          className="w-full border border-gray-300 rounded px-3 py-2"
          value={selectedInbox ?? ""}
          onChange={(e) => setSelectedInbox(e.target.value)}
        >
          {inboxes.map((i) => (
            <option key={i.inboxId} value={i.inboxId}>
              {i.email}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold">Messages ({messages.length})</h3>
        </div>
        {loading ? (
          <p className="px-6 py-4 text-gray-500">Loading...</p>
        ) : messages.length === 0 ? (
          <p className="px-6 py-4 text-gray-500">No messages.</p>
        ) : (
          <div className="divide-y divide-gray-200">
            {messages.map((m) => (
              <div key={m.messageId} className="px-6 py-3">
                <p className="font-medium">{m.subject}</p>
                <p className="text-sm text-gray-500">From: {m.from}</p>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{m.preview}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RemindersPanel({ project }: any) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [inbox, setInbox] = useState<any>(null);
  const listInboxes = useAction(api.mail.listInboxes);
  const createInbox = useAction(api.mail.getOrCreateInbox);
  const sendEmail = useAction(api.mail.sendEmail);
  const generateText = useAction(api.llm.runLlmTask);

  React.useEffect(() => {
    (async () => {
      const inboxes = (await listInboxes({})) as any[];
      if (inboxes.length > 0) {
        setInbox(inboxes[0]);
      } else {
        const i = (await createInbox({
          username: `compliance-${Date.now()}`,
          displayName: "Compliance Bot",
        })) as any;
        setInbox(i);
      }
    })();
  }, []);

  async function handleGenerateDraft() {
    if (!project) return;
    const text = await generateText({
      prompt: `Draft a professional compliance reminder email for the project "${project.name}" regarding the obligation: "${subject || "upcoming deadline"}". Keep it concise.`,
      systemPrompt: "You are a compliance officer drafting professional reminder emails.",
    });
    setBody(text as string);
  }

  async function handleSend() {
    if (!inbox || !to) return;
    await sendEmail({
      inboxId: inbox.inboxId,
      to,
      subject: subject || "Compliance Reminder",
      text: body,
    });
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Send Compliance Reminder</h2>
        {inbox && (
          <p className="text-sm text-gray-500 mb-4">
            From: {inbox.email}
          </p>
        )}
        <div className="space-y-3">
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Recipient email"
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (or obligation to remind about)"
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
          <div className="flex gap-2">
            <button
              onClick={handleGenerateDraft}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              AI Draft
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Email body..."
            rows={6}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
          <button
            onClick={handleSend}
            disabled={!inbox || !to || !body}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {sent ? "Sent!" : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
