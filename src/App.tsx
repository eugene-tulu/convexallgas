import React, { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

type Tab = "dashboard" | "crawl" | "search" | "inbox" | "reminders" | "activity";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(null);

  const projects = useQuery(api.projects.list) ?? [];
  const regulations = useQuery(api.regulations.list) ?? [];
  const obligations = useQuery(api.obligations.listObligations) ?? [];

  const project = projects.find((p) => p._id === selectedProjectId) ?? projects[0];

  const seedRag = useAction(api.search.seedRagDemo);
  const seedDemo = useMutation(api.seed.seed);

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
            <button
              onClick={() => seedDemo({})}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Seed Demo Data
            </button>
            <button
              onClick={() => seedRag({})}
              className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Seed RAG Docs
            </button>
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
          {(["dashboard", "crawl", "search", "inbox", "reminders", "activity"] as Tab[]).map((tab) => (
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
        {activeTab === "activity" && <ActivityPanel />}
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
            <div className="px-6 py-6 text-gray-500">
              <p className="mb-2">No compliance obligations for this project yet.</p>
              <p className="text-sm">
                To populate, run the seed action from the Convex dashboard
                (function <code className="bg-gray-100 px-1 rounded">api.seed.seed</code>)
                or click "Seed Demo Data" in the header above.
              </p>
            </div>
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
  const history = useQuery(api.events.forObligation, { obligationId: obligation._id }) ?? [];
  const lastAction = history[0];
  const lastSourceLabel = lastAction
    ? lastAction.action.includes("reply")
      ? "via email"
      : lastAction.action === "completed"
      ? "via dashboard"
      : lastAction.action === "snoozed"
      ? "via dashboard"
      : ""
    : "";

  return (
    <div className="px-6 py-4 flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-gray-900">{obligation.commitmentText}</p>
        <p className="text-sm text-gray-500">
          Deadline: {new Date(obligation.deadline).toLocaleDateString()} (
          {daysUntil > 0 ? `${daysUntil}d left` : `${Math.abs(daysUntil)}d ago`})
          {lastSourceLabel && (
            <span className="ml-2 inline-block px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
              last action: {lastSourceLabel}
            </span>
          )}
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
  const search = useAction(api.firecrawl.searchAndPersist);
  const scrape = useAction(api.firecrawl.scrapeAndPersist);
  const summarize = useAction(api.llm.runLlmTask);

  async function handleSearch() {
    const res = (await search({
      query,
      limit: 10,
      projectId: project?._id,
    })) as any;
    setResults(res.results || []);
  }

  async function handleScrape(url: string) {
    setScraping(true);
    try {
      await scrape({ url, projectId: project?._id });
    } catch (e) {
      console.error(`Failed to scrape ${url}`, e);
    } finally {
      setScraping(false);
    }
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
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-semibold">Search Results ({results.length})</h3>
            <p className="text-sm text-gray-500">
              Click "Scrape" to fetch full content and save to regulations database
            </p>
          </div>
          <div className="divide-y divide-gray-200">
            {results.map((r, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex-1">
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
                <button
                  onClick={() => handleScrape(r.url)}
                  disabled={scraping}
                  className="ml-2 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  {scraping ? "..." : "Scrape"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<"search" | "ask">("search");
  const [answer, setAnswer] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const searchDocs = useAction(api.search.searchDocuments);
  const askDocs = useAction(api.search.askDocuments);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setAnswer(null);
    setContext(null);
    try {
      if (mode === "ask") {
        const res = (await askDocs({ question: query })) as any;
        setAnswer(res.answer);
        setContext(res.context);
        setResults(null);
      } else {
        const res = (await searchDocs({ query })) as any;
        setResults(res);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">RAG Search & Q&A</h2>
        <p className="text-sm text-gray-500 mb-4">
          Vector-based semantic search using NVIDIA NIM embeddings, powered by @convex-dev/rag
        </p>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setMode("search")}
            className={`px-3 py-1 text-sm rounded ${
              mode === "search"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            Search
          </button>
          <button
            onClick={() => setMode("ask")}
            className={`px-3 py-1 text-sm rounded ${
              mode === "ask"
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            Ask (RAG Q&A)
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 border border-gray-300 rounded px-3 py-2"
            placeholder={mode === "search" ? "Find documents about..." : "Ask a question about compliance..."}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? "Working..." : mode === "ask" ? "Ask" : "Search"}
          </button>
        </div>
      </div>

      {answer && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold mb-2">Answer</h3>
          <p className="whitespace-pre-wrap text-gray-800">{answer}</p>
          {context && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-500">
                View source context
              </summary>
              <pre className="mt-2 text-xs bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {context}
              </pre>
            </details>
          )}
        </div>
      )}

      {results && results.results && results.results.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-semibold">Results ({results.results.length})</h3>
            <p className="text-sm text-gray-500">
              Ranked by vector similarity score
            </p>
          </div>
          <div className="divide-y divide-gray-200">
            {results.results.map((r: any, i: number) => (
              <div key={i} className="px-6 py-3">
                <p className="text-sm mt-1 line-clamp-3">{r.content}</p>
                <p className="text-xs text-gray-400 mt-1">Score: {r.score?.toFixed(3)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {results && results.results && results.results.length === 0 && (
        <p className="text-gray-500 px-6">No results found. Try crawling some documents first.</p>
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
          <div className="flex gap-2">
            <button
              onClick={() => { loadInboxes(); if (selectedInbox) loadMessages(); }}
              className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Refresh
            </button>
            <button
              onClick={handleCreateInbox}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Inbox
            </button>
          </div>
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

function ActivityPanel() {
  const events = useQuery(api.events.recent, { limit: 100 }) ?? [];
  const [filter, setFilter] = useState<string>("");

  const filtered = filter
    ? events.filter((e: any) => e.action.includes(filter))
    : events;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-2">Activity Log</h2>
        <p className="text-sm text-gray-500 mb-4">
          Audit trail of every action: cron reminders, dashboard clicks, and email replies.
          Filter by action type to see only one channel.
        </p>
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setFilter("")}
            className={`px-3 py-1 text-sm rounded ${
              filter === "" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("reminder")}
            className={`px-3 py-1 text-sm rounded ${
              filter === "reminder" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Reminders
          </button>
          <button
            onClick={() => setFilter("reply")}
            className={`px-3 py-1 text-sm rounded ${
              filter === "reply" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Email replies
          </button>
          <button
            onClick={() => setFilter("completed")}
            className={`px-3 py-1 text-sm rounded ${
              filter === "completed" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Completions
          </button>
          <button
            onClick={() => setFilter("snoozed")}
            className={`px-3 py-1 text-sm rounded ${
              filter === "snoozed" ? "bg-yellow-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Snoozes
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold">Events ({filtered.length})</h3>
        </div>
        <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-6 py-4 text-gray-500">No events match the current filter.</p>
          ) : (
            filtered.map((e: any) => (
              <div key={e._id} className="px-6 py-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium text-gray-900">
                    <span className={`px-2 py-0.5 rounded text-xs mr-2 ${
                      e.action.includes("reply")
                        ? "bg-purple-100 text-purple-800"
                        : e.action.includes("reminder")
                        ? "bg-blue-100 text-blue-800"
                        : e.action === "completed"
                        ? "bg-green-100 text-green-800"
                        : e.action === "snoozed"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                    }`}>
                      {e.action}
                    </span>
                    {e.summary}
                  </p>
                  <p className="text-xs text-gray-500 whitespace-nowrap ml-4">
                    {new Date(e.timestamp).toLocaleString()}
                  </p>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  table: {e.table} • rowId: {e.rowId}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
