import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Square,
  RotateCcw,
  Workflow,
  ExternalLink,
  Copy,
  AlertTriangle,
  Brain,
  Terminal,
  Activity,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge as UiStatusBadge } from "@/components/ui/page-shell";
import { studioRuns, studioPipelines, type PipelineRun, type PipelineNode } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Agent event types from WebSocket
// ---------------------------------------------------------------------------
interface AgentEvent {
  event_type: "agent_thought" | "agent_action" | "agent_observation" | "agent_status" | "agent_report";
  data: Record<string, unknown>;
  ts: number;
}

type NodeAgentEvents = Record<string, AgentEvent[]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDuration(seconds: number | null, lang: "ru" | "en"): string {
  if (!seconds) return "—";
  if (seconds < 60) return lang === "ru" ? `${Math.round(seconds)}с` : `${Math.round(seconds)}s`;
  return lang === "ru"
    ? `${Math.floor(seconds / 60)}м ${Math.round(seconds % 60)}с`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function fmtDate(iso: string | null, lang: "ru" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ status, lang }: { status: string; lang: "ru" | "en" }) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const cfg: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    completed: { icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-green-500/15 text-green-400 border-green-500/30", label: tr("Выполнен", "Completed") },
    failed:    { icon: <XCircle     className="h-3 w-3" />, cls: "bg-red-500/15 text-red-400 border-red-500/30",     label: tr("Ошибка", "Failed") },
    running:   { icon: <Loader2     className="h-3 w-3 animate-spin" />, cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", label: tr("Выполняется", "Running") },
    pending:   { icon: <Clock       className="h-3 w-3" />, cls: "bg-muted/60 text-muted-foreground border-border",  label: tr("Ожидание", "Pending") },
    stopped:   { icon: <Square      className="h-3 w-3" />, cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", label: tr("Остановлен", "Stopped") },
  };
  const s = cfg[status] || cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Node state icon
// ---------------------------------------------------------------------------
function NodeIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (status === "failed")    return <XCircle      className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (status === "running")   return <Loader2      className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
  if (status === "skipped")   return <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

// ---------------------------------------------------------------------------
// Agent steps for a node
// ---------------------------------------------------------------------------
function AgentSteps({ events, lang }: { events: AgentEvent[]; lang: "ru" | "en" }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  if (!events.length) return null;

  return (
    <div className="mt-2 space-y-1.5 max-h-72 overflow-auto pr-1">
      {events.map((ev, i) => {
        if (ev.event_type === "agent_thought") {
          const thought = String(ev.data.thought || "").trim();
          if (!thought) return null;
          return (
            <div key={i} className="flex gap-2 items-start text-xs">
              <Brain className="h-3.5 w-3.5 text-purple-400 shrink-0 mt-0.5" />
              <span className="text-muted-foreground leading-relaxed">{thought}</span>
            </div>
          );
        }
        if (ev.event_type === "agent_action") {
          const tool = String(ev.data.tool || ev.data.action || "");
          const iter = ev.data.iteration ? `#${ev.data.iteration}` : "";
          return (
            <div key={i} className="flex gap-2 items-start text-xs">
              <Zap className="h-3.5 w-3.5 text-yellow-400 shrink-0 mt-0.5" />
              <span className="text-yellow-300 font-mono">
                {iter && <span className="text-muted-foreground mr-1">{iter}</span>}
                {tool}
                {ev.data.args && (
                  <span className="text-muted-foreground ml-1 font-normal">
                    {JSON.stringify(ev.data.args).slice(0, 120)}
                  </span>
                )}
              </span>
            </div>
          );
        }
        if (ev.event_type === "agent_observation") {
          const obs = String(ev.data.observation || "").trim().slice(0, 300);
          if (!obs) return null;
          return (
            <div key={i} className="flex gap-2 items-start text-xs">
              <Terminal className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
              <span className="text-green-300 font-mono leading-relaxed whitespace-pre-wrap">{obs}</span>
            </div>
          );
        }
        if (ev.event_type === "agent_status") {
          const status = String(ev.data.status || "");
          if (!status || status === "connecting") return null;
          const iter = ev.data.iteration ? (lang === "ru" ? ` · итер ${ev.data.iteration}` : ` · iter ${ev.data.iteration}`) : "";
          return (
            <div key={i} className="flex gap-2 items-center text-xs text-muted-foreground">
              <Activity className="h-3 w-3 shrink-0" />
              <span>{status}{iter}</span>
            </div>
          );
        }
        return null;
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run detail panel
// ---------------------------------------------------------------------------
function RunDetail({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const { toast } = useToast();
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [nodeAgentEvents, setNodeAgentEvents] = useState<NodeAgentEvents>({});
  const wsRef = useRef<WebSocket | null>(null);

  const { data: run, refetch } = useQuery({
    queryKey: ["studio", "run", runId],
    queryFn: () => studioRuns.get(runId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "running" || s === "pending" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  // WebSocket connection for live agent events
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws/studio/pipeline-runs/${runId}/live/`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "node_event" && msg.event_type && msg.node_id) {
          const ev: AgentEvent = { event_type: msg.event_type, data: msg.data || {}, ts: Date.now() };
          setNodeAgentEvents((prev) => ({
            ...prev,
            [msg.node_id]: [...(prev[msg.node_id] || []), ev],
          }));
          // Auto-expand the node that has activity
          setExpandedNode((cur) => cur ?? msg.node_id);
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId]);

  const stopMutation = useMutation({
    mutationFn: () => studioRuns.stop(runId),
    onSuccess: () => { refetch(); toast({ description: tr("Запуск остановлен", "Run stopped") }); },
  });

  const navigate = useNavigate();

  if (!run) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> {tr("Загрузка…", "Loading…")}
      </div>
    );
  }

  const nodeStates: Record<string, Record<string, unknown>> =
    (run.node_states as Record<string, Record<string, unknown>>) || {};
  const nodes: PipelineNode[] = (run.nodes_snapshot || []).filter(
    (n) => !n.type?.startsWith("trigger/")
  );
  const nodeStateList = Object.values(nodeStates);
  const completedNodes = nodeStateList.filter((state) => state.status === "completed").length;
  const failedNodes = nodeStateList.filter((state) => state.status === "failed").length;
  const activeAgentActions = Object.values(nodeAgentEvents)
    .flat()
    .filter((event) => event.event_type === "agent_action").length;

  const copyOutput = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ description: tr("Скопировано", "Copied") }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{tr(`Запуск #${run.id}`, `Run #${run.id}`)}</span>
              <StatusBadge status={run.status} lang={lang} />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {run.pipeline_name} · {fmtDate(run.started_at || run.created_at, lang)} · {fmtDuration(run.duration_seconds, lang)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(run.status === "running" || run.status === "pending") && (
            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
              onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
              <Square className="h-3 w-3" /> {tr("Стоп", "Stop")}
            </Button>
          )}
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
            onClick={() => navigate(`/studio/pipeline/${run.pipeline_id}`)}>
            <ExternalLink className="h-3 w-3" /> {tr("Открыть пайплайн", "Open pipeline")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => refetch()}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>{tr(`${completedNodes} нод завершено`, `${completedNodes} nodes completed`)}</span>
            <span>{tr(`${failedNodes} с ошибкой`, `${failedNodes} failed`)}</span>
            <span>{tr(`${activeAgentActions} agent actions`, `${activeAgentActions} agent actions`)}</span>
          </div>

          {/* Error banner */}
          {run.error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <div className="font-medium mb-1 flex items-center gap-1.5">
                <XCircle className="h-4 w-4" /> {tr("Ошибка выполнения", "Execution failed")}
              </div>
              <pre className="whitespace-pre-wrap text-xs font-mono">{run.error}</pre>
            </div>
          )}

          {/* Summary / Report */}
          {run.summary && (
            <div className="enterprise-panel rounded-md">
              <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2">
                <span className="text-sm font-medium">{tr("Отчёт", "Report")}</span>
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => copyOutput(run.summary)}>
                  <Copy className="h-3 w-3" /> {tr("Копировать", "Copy")}
                </Button>
              </div>
              <div className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed max-h-80 overflow-auto">
                {run.summary}
              </div>
            </div>
          )}

          {/* Node states */}
          <div>
            <div className="text-sm font-medium mb-2 text-muted-foreground">{tr(`Узлы (${nodes.length})`, `Nodes (${nodes.length})`)}</div>
            <div className="space-y-2">
              {nodes.map((node) => {
                const st = nodeStates[node.id] || {};
                const status = (st.status as string) || "pending";
                const output = (st.output as string) || "";
                const error = (st.error as string) || "";
                const isExp = expandedNode === node.id;
                const agentEvents = nodeAgentEvents[node.id] || [];
                const hasContent = !!(output || error || agentEvents.length);
                const startedAt = st.started_at as string | undefined;
                const finishedAt = st.finished_at as string | undefined;
                const isAgentNode = node.type?.startsWith("agent/");

                let duration = "";
                if (startedAt && finishedAt) {
                  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
                  duration = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
                }

                // Count agent iterations for the badge
                const iterCount = agentEvents.filter((e) => e.event_type === "agent_action").length;

                return (
                  <div key={node.id} className={`rounded-lg border transition-colors ${
                    status === "failed"    ? "border-red-500/30 bg-red-500/5"
                    : status === "completed" ? "border-green-500/20 bg-green-500/5"
                    : status === "running"   ? "border-blue-500/30 bg-blue-500/5"
                    : status === "skipped"   ? "border-yellow-500/20 bg-yellow-500/5"
                    : "border-border bg-card/50"
                  }`}>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      onClick={() => hasContent && setExpandedNode(isExp ? null : node.id)}
                    >
                      <NodeIcon status={status} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{(node.data?.label as string) || node.id}</div>
                        <div className="text-xs text-muted-foreground">{node.type}</div>
                      </div>
                      {isAgentNode && iterCount > 0 && (
                        <span className="text-xs text-purple-400 shrink-0 flex items-center gap-1">
                          <Brain className="h-3 w-3" />{iterCount}
                        </span>
                      )}
                      {duration && <span className="text-xs text-muted-foreground shrink-0">{duration}</span>}
                      {hasContent && (
                        isExp
                          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>

                    {isExp && hasContent && (
                      <div className="border-t border-border px-4 py-3 space-y-2">
                        {/* Live agent steps */}
                        {isAgentNode && agentEvents.length > 0 && (
                          <div className="rounded bg-muted/10 border border-border/50 px-3 py-2">
                            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                              <Activity className="h-3 w-3 text-blue-400" />
                              <span>{tr("Шаги агента", "Agent steps")} · {iterCount} {tr("действий", "actions")}</span>
                            </div>
                            <AgentSteps events={agentEvents} lang={lang} />
                          </div>
                        )}
                        {error && (
                          <div className="text-xs text-red-300 bg-red-900/20 rounded px-3 py-2 font-mono">
                            {error}
                          </div>
                        )}
                        {output && (
                          <div className="relative">
                            <Button
                              size="sm" variant="ghost"
                              className="absolute right-1 top-1 h-6 text-xs gap-1 z-10"
                              onClick={() => copyOutput(output)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all leading-relaxed bg-muted/20 rounded px-3 py-2 max-h-96 overflow-auto pr-16">
                              {output.length > 5000 ? output.slice(0, 5000) + tr("\n\n… [обрезано, полный вывод > 5000 символов]", "\n\n… [truncated, full output > 5000 chars]") : output}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {nodes.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {tr("Нет данных по узлам — пайплайн ещё не запускался или не сохранил snapshot", "No node data yet — pipeline has not run or did not persist a snapshot")}
                </div>
              )}
            </div>
          </div>

          {/* Raw JSON for debugging */}
          <div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setShowRaw(!showRaw)}
            >
              {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {tr("Raw JSON (для отладки)", "Raw JSON (for debugging)")}
            </button>
            {showRaw && (
              <pre className="mt-2 text-xs font-mono text-muted-foreground bg-muted/20 rounded px-4 py-3 max-h-96 overflow-auto">
                {JSON.stringify({ status: run.status, error: run.error, node_states: run.node_states, context: run.context }, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs list
// ---------------------------------------------------------------------------
const STATUS_FILTERS = ["all", "running", "completed", "failed", "pending", "stopped"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export default function PipelineRunsPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const navigate = useNavigate();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pipelineFilter, setPipelineFilter] = useState<number | null>(null);

  const { data: runs = [], isLoading, refetch } = useQuery({
    queryKey: ["studio", "runs"],
    queryFn: studioRuns.list,
    refetchInterval: 5000,
  });

  const { data: pipelines = [] } = useQuery({
    queryKey: ["studio", "pipelines"],
    queryFn: () => studioPipelines.list(),
  });

  const filtered = runs.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (pipelineFilter && r.pipeline_id !== pipelineFilter) return false;
    return true;
  });
  const failureBuckets = runs
    .filter((run) => run.status === "failed")
    .reduce<Record<string, number>>((acc, run) => {
      const message = (run.error || "").toLowerCase();
      const bucket =
        message.includes("timeout")
          ? tr("Таймауты", "Timeouts")
          : message.includes("mcp")
            ? "MCP"
            : message.includes("permission") || message.includes("forbidden")
              ? tr("Права доступа", "Permissions")
              : message.includes("ssh") || message.includes("connection")
                ? tr("Подключения", "Connectivity")
                : tr("Прочее", "Other");
      acc[bucket] = (acc[bucket] || 0) + 1;
      return acc;
    }, {});
  const failureHighlights = Object.entries(failureBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const statusCount = (s: string) => runs.filter((r) => r.status === s).length;
  const statusLabels: Record<StatusFilter, string> = {
    all: tr("Все", "All"),
    running: tr("Выполняются", "Running"),
    completed: tr("Выполнены", "Completed"),
    failed: tr("Ошибки", "Failed"),
    pending: tr("Ожидание", "Pending"),
    stopped: tr("Остановлены", "Stopped"),
  };

  return (
    <div className="h-full px-4 py-6 sm:px-6">
      <div className="grid h-full min-h-0 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="enterprise-panel flex min-h-0 flex-col overflow-hidden rounded-md">
          <div className="border-b border-border/70 px-5 py-5 shrink-0">
            <div className="enterprise-kicker">{tr("Телеметрия Studio", "Studio Telemetry")}</div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate("/studio")} className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">{tr("Запуски пайплайнов", "Pipeline Runs")}</h1>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {tr("Просматривайте последние исполнения, фильтруйте по пайплайну и статусу, анализируйте live-активность агентов.", "Review recent executions, narrow the list by pipeline or status, and inspect live agent activity.")}
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => refetch()}>
                <RotateCcw className="h-4 w-4" />
                {tr("Обновить", "Refresh")}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span>{tr(`${statusCount("completed")} выполнено`, `${statusCount("completed")} completed`)}</span>
              <span>{tr(`${statusCount("running")} выполняются`, `${statusCount("running")} running`)}</span>
              <span>{tr(`${statusCount("failed")} требуют внимания`, `${statusCount("failed")} need attention`)}</span>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      statusFilter === status
                        ? "bg-primary/12 text-primary"
                        : "bg-secondary/20 text-muted-foreground hover:bg-secondary/35 hover:text-foreground"
                    }`}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">{statusLabels[status]}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {status === "all" ? runs.length : statusCount(status)}
                    </div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Фильтр пайплайна", "Pipeline filter")}</label>
                <select
                  value={pipelineFilter ?? ""}
                  onChange={(event) => setPipelineFilter(event.target.value ? Number(event.target.value) : null)}
                  className="enterprise-select"
                >
                  <option value="">{tr("Все пайплайны", "All pipelines")}</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> {tr("Загрузка…", "Loading…")}
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="p-4">
                <EmptyState
                  icon={<Workflow className="h-5 w-5" />}
                  title={tr("По текущим фильтрам запусков не найдено", "No runs match the current filters")}
                  description={tr(
                    "Runs — это операторский слой инспекции. Измените статус или pipeline filter, либо вернитесь в Studio и запустите automation вручную.",
                    "Runs are the operator-side inspection layer. Change the status or pipeline filter, or go back to Studio and start an automation manually.",
                  )}
                  actions={
                    <>
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setStatusFilter("all"); setPipelineFilter(null); }}>
                        {tr("Сбросить фильтры", "Clear filters")}
                      </Button>
                      <Button size="sm" className="rounded-xl" onClick={() => navigate("/studio")}>
                        {tr("Перейти к пайплайнам", "Go to pipelines")}
                      </Button>
                    </>
                  }
                />
              </div>
            )}

            {filtered.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                className={`w-full border-b border-border/60 px-5 py-4 text-left transition-colors hover:bg-secondary/15 ${
                  selectedRunId === run.id ? "bg-primary/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-medium text-sm truncate">{run.pipeline_name}</span>
                  <StatusBadge status={run.status} lang={lang} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{tr(`Запуск #${run.id}`, `Run #${run.id}`)}</span>
                  <span>•</span>
                  <span>{fmtDate(run.started_at || run.created_at, lang)}</span>
                  {run.duration_seconds && (
                    <>
                      <span>•</span>
                      <span>{fmtDuration(run.duration_seconds, lang)}</span>
                    </>
                  )}
                </div>
                {run.error && (
                  <div className="mt-2 text-xs text-red-400 truncate">{run.error}</div>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="hidden min-h-0 overflow-hidden rounded-md xl:flex enterprise-panel">
          {selectedRunId ? (
            <RunDetail runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-8 text-center">
              <div className="max-w-xl space-y-4 text-left">
                <div className="enterprise-kicker">{tr("Инспекция запуска", "Run Inspection")}</div>
                <h2 className="text-2xl font-semibold text-foreground">{tr("Выберите запуск пайплайна", "Select a pipeline run")}</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {tr("Справа появится операторский inspector: summary, timeline нод, live agent steps, logs, errors и итоговый отчёт.", "The operator inspector appears here: summary, node timeline, live agent steps, logs, errors, and the final report.")}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl bg-background/30 p-4">
                    <div className="text-sm font-semibold text-foreground">{tr("Что доступно после выбора", "What becomes visible after selection")}</div>
                    <div className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                      <div>{tr("1. Краткая сводка run-status и длительности.", "1. A summary of run status and duration.")}</div>
                      <div>{tr("2. Timeline нод с outputs и errors по каждой из них.", "2. A node timeline with outputs and errors per step.")}</div>
                      <div>{tr("3. Live agent reasoning и финальный report.", "3. Live agent reasoning and the final report.")}</div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-background/30 p-4">
                    <div className="text-sm font-semibold text-foreground">{tr("Последние категории сбоев", "Recent failure categories")}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {failureHighlights.length > 0 ? (
                        failureHighlights.map(([label, count]) => (
                          <UiStatusBadge key={label} label={`${label} · ${count}`} tone="danger" />
                        ))
                      ) : (
                        <div className="text-xs leading-5 text-muted-foreground">
                          {tr("Недавних failure buckets нет. Когда появятся неуспешные запуски, здесь будет краткая классификация причин.", "No recent failure buckets yet. When failed runs appear, this block will show a lightweight classification of causes.")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {selectedRunId && (
        <section className="enterprise-panel mt-5 overflow-hidden rounded-md xl:hidden">
          <RunDetail runId={selectedRunId} onClose={() => setSelectedRunId(null)} />
        </section>
      )}
    </div>
  );
}
