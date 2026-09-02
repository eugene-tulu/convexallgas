import React, { useEffect, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

interface AppProps {
  convexUrl: string;
}

export default function App({ convexUrl }: AppProps) {
  const [client, setClient] = useState<ConvexHttpClient | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [regulations, setRegulations] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"projects" | "regulations" | "obligations">("projects");

  useEffect(() => {
    const c = new ConvexHttpClient(convexUrl);
    setClient(c);
  }, [convexUrl]);

  useEffect(() => {
    if (!client) return;
    fetchData();
  }, [client]);

  async function fetchData() {
    if (!client) return;
    setLoading(true);
    try {
      const [p, r, o] = await Promise.all([
        client.query(api.projects.list),
        client.query(api.regulations.list),
        client.query(api.obligations.listObligations),
      ]);
      setProjects(p || []);
      setRegulations(r || []);
      setObligations(o || []);
    } catch (e) {
      console.error("Error fetching data:", e);
    } finally {
      setLoading(false);
    }
  }

  async function seed() {
    if (!client) return;
    await client.mutation(api.seed.seed);
    fetchData();
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">EIA Compliance Copilot</h1>

        <div className="mb-6">
          <button
            onClick={seed}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Seed Demo Data
          </button>
        </div>

        <div className="border-b border-gray-200 mb-4">
          <nav className="flex space-x-6">
            {["projects", "regulations", "obligations"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`py-2 px-1 border-b-2 ${
                  activeTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {activeTab === "projects" && (
              <div className="grid gap-4">
                {projects.length === 0 ? (
                  <p className="text-gray-500">No projects. Seed demo data to get started.</p>
                ) : (
                  projects.map((project: any) => (
                    <div key={project._id} className="bg-white p-4 rounded shadow">
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-sm text-gray-500">
                        Jurisdiction: {project.jurisdiction} • Type: {project.projectType}
                      </p>
                      <span className={`inline-block px-2 py-1 rounded text-xs ${
                        project.status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}>
                        {project.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "regulations" && (
              <div className="grid gap-4">
                {regulations.length === 0 ? (
                  <p className="text-gray-500">No regulations found. Seed demo data to populate.</p>
                ) : (
                  regulations.map((reg: any) => (
                    <div key={reg._id} className="bg-white p-4 rounded shadow">
                      <h3 className="font-semibold">{reg.agency}</h3>
                      <p className="text-sm text-gray-500">
                        Source: {reg.sourceUrl} • Crawled: {new Date(reg.crawledAt).toLocaleDateString()}
                      </p>
                      <p className="text-gray-600 mt-2 line-clamp-3">{reg.summary}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "obligations" && (
              <div className="grid gap-4">
                {obligations.length === 0 ? (
                  <p className="text-gray-500">No obligations found. Seed demo data to populate.</p>
                ) : (
                  obligations.map((ob: any) => (
                    <div key={ob._id} className="bg-white p-4 rounded shadow">
                      <h3 className="font-semibold">{ob.commitmentText}</h3>
                      <p className="text-sm text-gray-500">
                        Project: {ob.projectId} • Deadline: {new Date(ob.deadline).toLocaleDateString()}
                      </p>
                      <span className={`inline-block px-2 py-1 rounded text-xs ${
                        ob.status === "pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : ob.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}>
                        {ob.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
