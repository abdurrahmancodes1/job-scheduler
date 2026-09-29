import { useEffect, useMemo, useState } from "react";

// const API_BASE = "http://localhost:4000";
const API_BASE = "/api";

const tabs = ["All", "Queued", "Processing", "Failed", "Dlq"];

const statusStyles = {
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-600",
  PROCESSING: "border-blue-200 bg-blue-50 text-blue-600",
  QUEUED: "border-amber-200 bg-amber-50 text-amber-600",
  RETRYING: "border-purple-200 bg-purple-50 text-purple-600",
  FAILED: "border-red-200 bg-red-50 text-red-600",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-600",
};

function formatRunAt(dateStr) {
  if (!dateStr) return "Immediate";

  try {
    const d = new Date(dateStr);

    if (isNaN(d.getTime())) return dateStr;

    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");

    return `${month} ${day}, ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

function formatEventTime(timestamp) {
  if (!timestamp) return "-";

  try {
    const d = new Date(timestamp);

    if (isNaN(d.getTime())) return "-";

    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
  } catch {
    return "-";
  }
}

function formatShortId(id) {
  if (!id) return "";

  return id.length > 15 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function Status({ state }) {
  const style =
    statusStyles[state] || "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase border ${style}`}
    >
      {state}
    </span>
  );
}

function Metric({ title, value, dotColor }) {
  return (
    <article className="rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-xs font-medium text-slate-600">{title}</span>
      </div>

      <div className="mt-1.5 text-2xl font-bold text-slate-900 leading-none">
        {value}
      </div>
    </article>
  );
}

function ShortJobId({ id, onClick }) {
  const [copied, setCopied] = useState(false);
  const shortId = formatShortId(id);

  async function copyId(e) {
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  }

  return (
    <div className="group inline-flex items-center gap-1.5 font-mono text-xs text-slate-700">
      <span
        onClick={onClick}
        title={id}
        className="cursor-pointer font-medium hover:text-blue-600 transition"
      >
        {shortId}
      </span>

      <button
        type="button"
        onClick={copyId}
        title="Copy job ID"
        className="rounded p-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-700"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

function EventItem({ event }) {
  const getEventIcon = (name) => {
    switch (name) {
      case "JOB_COMPLETED":
        return (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        );

      case "JOB_FAILED":
        return (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" />
        );

      case "JOB_PROCESSING":
      case "JOB_RECEIVED":
        return (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
        );

      case "JOB_CREATED":
        return (
          <span className="mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border-2 border-slate-600 bg-white" />
        );

      default:
        return (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
        );
    }
  };

  return (
    <div className="border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2.5">
        {getEventIcon(event.event)}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-800 leading-none">
                {event.event}
              </p>

              <p className="mt-1 text-xs text-slate-500 leading-tight">
                {event.message}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-xs text-slate-400 tabular-nums leading-none">
                {formatEventTime(event.timestamp)}
              </p>

              <p className="mt-1 text-[11px] font-medium text-slate-500 leading-tight">
                {event.source}
              </p>
            </div>
          </div>

          {event.jobId && (
            <p className="mt-1 font-mono text-[11px] text-slate-400">
              {formatShortId(event.jobId)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 5;

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [events, setEvents] = useState([]);

  const [metrics, setMetrics] = useState({
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    retrying: 0,
    cancelled: 0,
  });

  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showCreateJob, setShowCreateJob] = useState(true);
  const [jobMode, setJobMode] = useState("now");

  const [jobType, setJobType] = useState("pdf");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionJobId, setActionJobId] = useState(null);

  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    loadDashboard();

    const interval = setInterval(() => {
      loadDashboard();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [tab, search]);

  async function loadDashboard() {
    await Promise.all([fetchJobs(), fetchMetrics(), fetchEvents()]);
  }

  async function fetchJobs() {
    try {
      const response = await fetch(`${API_BASE}/jobs`);

      if (!response.ok) {
        throw new Error("Failed to fetch jobs");
      }

      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    }
  }

  async function fetchMetrics() {
    try {
      const response = await fetch(`${API_BASE}/metrics`);

      if (!response.ok) {
        throw new Error("Failed to fetch metrics");
      }

      const data = await response.json();

      setMetrics({
        queued: data.queued ?? 0,
        processing: data.processing ?? 0,
        completed: data.completed ?? 0,
        failed: data.failed ?? 0,
        retrying: data.retrying ?? 0,
        cancelled: data.cancelled ?? 0,
      });
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
    }
  }

  async function fetchEvents() {
    try {
      const response = await fetch(`${API_BASE}/events`);

      if (!response.ok) {
        throw new Error("Failed to fetch events");
      }

      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    }
  }

  const filteredJobs = useMemo(() => {
    const query = search.toLowerCase().trim();

    return jobs.filter((job) => {
      const matchesTab =
        tab === "All" ||
        (tab === "Dlq"
          ? job.state === "FAILED"
          : job.state === tab.toUpperCase());

      const matchesSearch = !query || job.jobId?.toLowerCase().includes(query);

      return matchesTab && matchesSearch;
    });
  }, [jobs, tab, search]);

  const totalPages = Math.ceil(filteredJobs.length / PAGE_SIZE) || 1;

  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;

    return filteredJobs.slice(start, start + PAGE_SIZE);
  }, [filteredJobs, currentPage]);

  async function openJobDetails(jobId) {
    setSelectedJobId(jobId);
    setSelectedJob(null);
    setLoadingDetails(true);

    try {
      const response = await fetch(`${API_BASE}/jobs/${jobId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch job details");
      }

      const data = await response.json();
      setSelectedJob(data);
    } catch (error) {
      console.error("Failed to fetch job details:", error);
    } finally {
      setLoadingDetails(false);
    }
  }

  function closeJobDetails() {
    setSelectedJobId(null);
    setSelectedJob(null);
  }

  async function executeJob(event) {
    event.preventDefault();

    if (submitting) return;

    try {
      setSubmitting(true);

      const payload =
        jobType === "pdf"
          ? {
              type: "pdf",
              payload: {
                title,
                ...(email ? { email } : {}),
                ...(simulateFailure ? { simulateFailure: true } : {}),
              },
            }
          : {
              type: "email",
              payload: {
                email,
                ...(simulateFailure ? { simulateFailure: true } : {}),
              },
            };

      const response = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to create job");
      }

      closeCreateModal();
      await loadDashboard();
    } catch (error) {
      console.error("Failed to execute job:", error);
    } finally {
      setSubmitting(false);
    }
  }

  async function scheduleJob(event) {
    event.preventDefault();

    if (submitting) return;

    try {
      setSubmitting(true);

      const payload =
        jobType === "pdf"
          ? {
              type: "pdf",
              payload: {
                title,
                ...(email ? { email } : {}),
              },
            }
          : {
              type: "email",
              payload: {
                email,
              },
            };

      const response = await fetch(`${API_BASE}/jobs/schedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          runAt: new Date(scheduleDate).toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to schedule job");
      }

      closeCreateModal();
      await loadDashboard();
    } catch (error) {
      console.error("Failed to schedule job:", error);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(jobId) {
    try {
      setActionJobId(jobId);

      const response = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to cancel job");
      }

      await loadDashboard();
    } catch (error) {
      console.error("Failed to cancel job:", error);
    } finally {
      setActionJobId(null);
    }
  }

  function closeCreateModal() {
    setShowCreateJob(false);
    setTitle("");
    setEmail("");
    setScheduleDate("");
    setJobMode("now");
    setSimulateFailure(false);
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f8fafc] text-slate-900 font-sans antialiased">
      <div className="mx-auto flex h-full w-full max-w-[1500px] overflow-hidden">
        {/* MAIN CONTENT */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-5">
          {/* HEADER */}
          <header className="flex shrink-0 items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Job Scheduler
              </h1>

              <p className="mt-0.5 text-xs text-slate-500">
                Monitor and manage background jobs
              </p>
            </div>

            {!showCreateJob && !selectedJobId && (
              <button
                type="button"
                onClick={() => setShowCreateJob(true)}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                + Create job
              </button>
            )}
          </header>

          {/* METRICS */}
          <section className="grid shrink-0 grid-cols-4 gap-3">
            <Metric
              title="Queued"
              value={metrics.queued}
              dotColor="bg-amber-400"
            />

            <Metric
              title="Processing"
              value={metrics.processing}
              dotColor="bg-blue-500"
            />

            <Metric
              title="Completed"
              value={metrics.completed}
              dotColor="bg-emerald-500"
            />

            <Metric
              title="Dead-lettered"
              value={metrics.failed}
              dotColor="bg-red-500"
            />
          </section>

          {/* JOBS + ACTIVITY */}
          <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[1.55fr_1fr]">
            {/* JOBS */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <div className="mb-3 shrink-0">
                <h2 className="mb-2.5 text-sm font-semibold text-slate-900">
                  Jobs
                </h2>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    {tabs.map((item) => (
                      <button
                        key={item}
                        onClick={() => setTab(item)}
                        className={`rounded-md px-3 py-1 text-xs transition ${
                          tab === item
                            ? "bg-blue-50 font-medium text-blue-600"
                            : "font-normal text-slate-500 hover:text-slate-700"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <svg
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>

                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search jobs..."
                      className="h-8 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
                <div className="min-h-0 overflow-auto">
                  <table className="w-full table-fixed border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                        <th className="w-[28%] px-3 py-2 font-medium">
                          Job ID
                        </th>

                        <th className="w-[16%] px-3 py-2 font-medium">Type</th>

                        <th className="w-[20%] px-3 py-2 font-medium">State</th>

                        <th className="w-[16%] px-3 py-2 font-medium">
                          Attempts
                        </th>

                        <th className="w-[20%] px-3 py-2 font-medium">
                          Run at
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {paginatedJobs.map((job) => {
                        const canCancel =
                          job.state === "QUEUED" || job.state === "RETRYING";

                        const typeDisplay =
                          job.type?.toUpperCase() === "PDF"
                            ? "PDF"
                            : job.type
                              ? job.type.charAt(0).toUpperCase() +
                                job.type.slice(1).toLowerCase()
                              : "-";

                        return (
                          <tr
                            key={job.jobId}
                            className="border-b border-slate-100/70 text-xs transition last:border-b-0 hover:bg-slate-50/50"
                          >
                            <td className="px-3 py-2.5">
                              <ShortJobId
                                id={job.jobId}
                                onClick={() => openJobDetails(job.jobId)}
                              />
                            </td>

                            <td className="px-3 py-2.5 font-medium text-slate-700">
                              {typeDisplay}
                            </td>

                            <td className="px-3 py-2.5">
                              <Status state={job.state} />
                            </td>

                            <td className="px-3 py-2.5 tabular-nums text-slate-600">
                              {job.attempts}/{job.maxAttempts}
                            </td>

                            <td className="px-3 py-2.5 text-slate-600">
                              <div className="flex items-center gap-2">
                                <span>
                                  {formatRunAt(job.runAt || job.updatedAt)}
                                </span>

                                {canCancel && (
                                  <button
                                    type="button"
                                    disabled={actionJobId === job.jobId}
                                    onClick={() => cancelJob(job.jobId)}
                                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500 transition hover:bg-slate-50 hover:text-red-600 disabled:opacity-50"
                                  >
                                    {actionJobId === job.jobId
                                      ? "..."
                                      : "Cancel"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {paginatedJobs.length === 0 && (
                        <tr>
                          <td
                            colSpan="5"
                            className="py-10 text-center text-xs text-slate-400"
                          >
                            No jobs found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {filteredJobs.length > 0 && (
                  <div className="flex shrink-0 items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                    <div>
                      Showing{" "}
                      <span className="font-medium text-slate-700">
                        {(currentPage - 1) * PAGE_SIZE + 1}
                      </span>{" "}
                      to{" "}
                      <span className="font-medium text-slate-700">
                        {Math.min(currentPage * PAGE_SIZE, filteredJobs.length)}
                      </span>{" "}
                      of{" "}
                      <span className="font-medium text-slate-700">
                        {filteredJobs.length}
                      </span>{" "}
                      jobs
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={currentPage === 1}
                        onClick={() =>
                          setCurrentPage((p) => Math.max(p - 1, 1))
                        }
                        className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Previous
                      </button>

                      <span>
                        {currentPage} / {totalPages}
                      </span>

                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setCurrentPage((p) => Math.min(p + 1, totalPages))
                        }
                        className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SYSTEM ACTIVITY */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  System Activity
                </h2>

                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Live
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {events.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    No activity yet.
                  </div>
                ) : (
                  events
                    .slice(0, 50)
                    .map((event) => <EventItem key={event.id} event={event} />)
                )}
              </div>
            </div>
          </section>
        </main>

        {/* CREATE JOB PANEL */}
        {showCreateJob && !selectedJobId && (
          <aside className="flex h-full w-[350px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-base font-semibold text-slate-900">
                Create Job
              </h2>

              <button
                type="button"
                onClick={closeCreateModal}
                className="text-lg leading-none text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={jobMode === "now" ? executeJob : scheduleJob}
              className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto p-5"
            >
              <div className="space-y-3.5">
                <div>
                  <label className="mb-2 block text-xs font-semibold text-slate-700">
                    Execute
                  </label>

                  <div className="flex items-center gap-5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input
                        type="radio"
                        name="jobMode"
                        checked={jobMode === "now"}
                        onChange={() => setJobMode("now")}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      Now
                    </label>

                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                      <input
                        type="radio"
                        name="jobMode"
                        checked={jobMode === "schedule"}
                        onChange={() => setJobMode("schedule")}
                        className="h-3.5 w-3.5 accent-blue-600"
                      />
                      Schedule for later
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Job type
                  </label>

                  <select
                    value={jobType}
                    onChange={(e) => setJobType(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="pdf">PDF</option>
                    <option value="email">Email</option>
                  </select>
                </div>

                {jobType === "pdf" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                      PDF title
                    </label>

                    <input
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Monthly Report"
                      className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    {jobType === "pdf" ? "Email (optional)" : "Email"}
                  </label>

                  <input
                    type="email"
                    required={jobType === "email"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="recipient@example.com"
                    className="h-9 w-full rounded-lg border border-slate-200 px-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="simulateFailure"
                    type="checkbox"
                    checked={simulateFailure}
                    onChange={(e) => setSimulateFailure(e.target.checked)}
                    className="h-3.5 w-3.5 accent-red-600"
                  />

                  <label
                    htmlFor="simulateFailure"
                    className="cursor-pointer text-xs text-slate-600"
                  >
                    Simulate failure
                  </label>
                </div>

                {simulateFailure && (
                  <p className="text-[11px] text-red-500">
                    Testing only — this job will intentionally fail in the
                    worker.
                  </p>
                )}
                {jobMode === "schedule" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Run at
                    </label>

                    <input
                      required
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full rounded-lg bg-blue-600 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? "Working..."
                    : jobMode === "now"
                      ? "Create job"
                      : "Schedule job"}
                </button>
              </div>
            </form>
          </aside>
        )}

        {/* JOB DETAILS */}
        {selectedJobId && (
          <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Job Details
                </h2>

                {selectedJob && (
                  <p className="text-xs font-medium uppercase text-slate-500">
                    {selectedJob.type}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={closeJobDetails}
                className="text-lg leading-none text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {loadingDetails ? (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
                Loading details...
              </div>
            ) : selectedJob ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">
                    Job ID
                  </p>

                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700">
                      {selectedJob.jobId}
                    </code>

                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(selectedJob.jobId)
                      }
                      className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">
                      State
                    </p>

                    <Status state={selectedJob.state} />
                  </div>

                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">
                      Attempts
                    </p>

                    <p className="text-xs font-medium text-slate-700">
                      {selectedJob.attempts} / {selectedJob.maxAttempts}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">
                    Run At
                  </p>

                  <p className="text-xs text-slate-700">
                    {formatRunAt(selectedJob.runAt || selectedJob.updatedAt)}
                  </p>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase text-slate-500">
                    Payload
                  </p>

                  <pre className="max-h-36 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700">
                    {JSON.stringify(selectedJob.payload, null, 2)}
                  </pre>
                </div>

                {selectedJob.error && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase text-red-500">
                      Error
                    </p>

                    <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                      {selectedJob.error}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
                Failed to load job details.
              </div>
            )}

            <div className="border-t border-slate-100 p-4">
              <button
                type="button"
                onClick={closeJobDetails}
                className="w-full rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
