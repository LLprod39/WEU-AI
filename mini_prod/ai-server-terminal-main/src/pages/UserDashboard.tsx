import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMonitoringDashboard,
  resolveAlert,
  aiAnalyzeServer,
  fetchAgents,
  fetchAgentTemplates,
  createAgent,
  deleteAgent,
  runAgent,
  stopAgent,
  fetchFrontendBootstrap,
  fetchAgentDashboardRuns,
  type ServerAlertItem,
  type AgentItem,
  type AgentRunResult,
  type DashboardRunItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  Server,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Bot,
  X,
  RefreshCw,
  Bell,
  Terminal,
  Play,
  Plus,
  Trash2,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
  Brain,
  Activity,
  Eye,
  Square,
  ExternalLink,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

const AGENT_ICONS: Record<string, string> = {
  security_audit: "🔒",
  log_analyzer: "📋",
  performance: "⚡",
  disk_report: "💾",
  docker_status: "🐳",
  service_health: "⚙️",
  custom: "🔧",
  security_patrol: "🛡️",
  deploy_manager: "🚀",
  log_investigator: "🔍",
  health_checker: "💓",
  backup_manager: "📦",
};

const STATUS_BG: Record<string, string> = {
  running: "bg-blue-500/15 border-blue-500/30",
  paused: "bg-yellow-500/15 border-yellow-500/30",
  waiting: "bg-orange-500/15 border-orange-500/30",
  pending: "bg-muted/30 border-border",
  completed: "bg-green-500/10 border-green-500/20",
  failed: "bg-red-500/10 border-red-500/20",
  stopped: "bg-muted/20 border-border",
};

const STATUS_TEXT: Record<string, string> = {
  running: "text-blue-400",
  paused: "text-yellow-400",
  waiting: "text-orange-400",
  pending: "text-muted-foreground",
  completed: "text-green-400",
  failed: "text-red-400",
  stopped: "text-muted-foreground",
};

export default function UserDashboard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{ name: string; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [runningAgentId, setRunningAgentId] = useState<number | null>(null);
  const [stoppingAgentId, setStoppingAgentId] = useState<number | null>(null);
  const [agentResult, setAgentResult] = useState<AgentRunResult | null>(null);
  const [expandedRaw, setExpandedRaw] = useState(false);
  const [reportOpen, setReportOpen] = useState<DashboardRunItem | null>(null);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<AgentItem | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["monitoring", "dashboard"],
    queryFn: fetchMonitoringDashboard,
    refetchInterval: 30_000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    staleTime: 15_000,
  });

  const { data: runsData } = useQuery({
    queryKey: ["agents", "dashboard-runs"],
    queryFn: fetchAgentDashboardRuns,
    refetchInterval: 5_000,
  });

  const filteredAlerts = data?.alerts || [];

  const onResolve = async (alertId: number) => {
    await resolveAlert(alertId);
    await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
  };

  const onAnalyze = async (serverId: number) => {
    setAnalyzing(serverId);
    try {
      const res = await aiAnalyzeServer(serverId);
      setAnalysisResult({ name: res.server_name, text: res.analysis });
    } catch {
      setAnalysisResult({ name: "Error", text: "AI analysis failed." });
    } finally {
      setAnalyzing(null);
    }
  };

  const onRunAgent = async (agent: AgentItem) => {
    if (agent.mode === "full") {
      setRunningAgentId(agent.id);
      try {
        const res = await runAgent(agent.id);
        await queryClient.invalidateQueries({ queryKey: ["agents"] });
        await queryClient.invalidateQueries({ queryKey: ["agents", "dashboard-runs"] });
        if (res.run_id) {
          navigate(`/agents/run/${res.run_id}`);
        }
      } finally {
        setRunningAgentId(null);
      }
      return;
    }
    setRunningAgentId(agent.id);
    setAgentResult(null);
    try {
      const res = await runAgent(agent.id);
      if (res.runs && res.runs.length > 0) {
        setAgentResult(res.runs[0]);
      }
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      await queryClient.invalidateQueries({ queryKey: ["agents", "dashboard-runs"] });
    } catch {
      setAgentResult({ run_id: 0, server_name: "Error", status: "failed", ai_analysis: "Agent run failed.", duration_ms: 0, commands_output: [] });
    } finally {
      setRunningAgentId(null);
    }
  };

  const onStopAgent = async (agentId: number) => {
    setStoppingAgentId(agentId);
    try {
      await stopAgent(agentId);
      await queryClient.invalidateQueries({ queryKey: ["agents", "dashboard-runs"] });
    } finally {
      setStoppingAgentId(null);
    }
  };

  const onDeleteAgent = async (agentId: number) => {
    await deleteAgent(agentId);
    await queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("dash.loading")}</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">{t("dash.error")}</div>;

  const { summary } = data;
  const problemCount = summary.critical + summary.unreachable + summary.warning;
  const agents = agentsData?.agents || [];
  const activeRuns = runsData?.active || [];
  const recentRuns = runsData?.recent || [];

  return (
    <PageShell>
      <PageHero
        kicker="Operations Workspace"
        title={t("udash.title")}
        description={
          <>
            A quieter operator view for health, alerts and live agent activity.
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge label={problemCount > 0 ? "attention required" : "healthy now"} tone={problemCount > 0 ? "danger" : "success"} />
              <span>{activeRuns.length} active runs</span>
              <span>·</span>
              <span>{filteredAlerts.length} alerts</span>
            </div>
          </>
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 rounded-xl px-4"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["monitoring"] });
              queryClient.invalidateQueries({ queryKey: ["agents", "dashboard-runs"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("udash.refresh")}
          </Button>
        }
      />

      <div className="grid gap-3 xl:grid-cols-4">
        <div className="workspace-subtle rounded-2xl px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("udash.my_servers")}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{summary.total_servers}</div>
          <div className="mt-1 text-xs text-muted-foreground">{summary.healthy} {t("udash.healthy_lc")}</div>
        </div>
        <div className="workspace-subtle rounded-2xl px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("udash.problems")}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{problemCount}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {problemCount > 0 ? `${summary.critical} crit · ${summary.warning} warn · ${summary.unreachable} down` : t("udash.all_good")}
          </div>
        </div>
        <div className="workspace-subtle rounded-2xl px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("udash.active_alerts")}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{filteredAlerts.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{activeRuns.length} active runs · {recentRuns.length} recent</div>
        </div>
        <div className="workspace-subtle rounded-2xl px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("agent.title")}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{agents.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">Runtime agents available from the dashboard surface.</div>
        </div>
      </div>

      {/* Alerts */}
      <SectionCard
        title={t("udash.alerts")}
        description="Current infrastructure issues that likely need a human decision or AI-assisted triage."
        icon={<Shield className="h-4 w-4 text-red-300" />}
      >
        {filteredAlerts.length > 0 ? (
          <div className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-2xl border border-border/80 bg-background/30">
            {filteredAlerts.map((a: ServerAlertItem) => (
              <div key={a.id} className="flex items-center gap-2 px-5 py-3 text-xs">
                <span className={`px-1 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                  {a.severity === "critical" ? "CRIT" : "WARN"}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-foreground font-medium">{a.title}</span>
                  <span className="text-muted-foreground ml-1.5">{a.server_name}</span>
                </div>
                <span className="text-muted-foreground shrink-0">{relativeTime(a.created_at)}</span>
                <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-xl px-2 text-[10px]" disabled={analyzing === a.server_id} onClick={() => onAnalyze(a.server_id)}>
                  <Bot className={`h-3 w-3 ${analyzing === a.server_id ? "animate-spin text-primary" : ""}`} /> AI
                </Button>
                <Link to={`/servers/${a.server_id}/terminal`}>
                  <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2"><Terminal className="h-3 w-3" /></Button>
                </Link>
                <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2 text-muted-foreground" onClick={() => onResolve(a.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Shield className="h-5 w-5" />}
            title="No active alerts"
            description="The operator surface is quiet right now. Use the sections below to inspect active runs, recent automation, and runtime agents."
          />
        )}
      </SectionCard>

      {/* AI / Agent analysis result */}
      {(analysisResult || agentResult) && (
        <SectionCard
          title={agentResult ? `${t("agent.result")}: ${agentResult.server_name}` : `AI: ${analysisResult!.name}`}
          description="Latest AI-assisted analysis or agent result."
          icon={<Bot className="h-4 w-4 text-primary" />}
        >
          <div className="rounded-2xl border border-border/80 bg-background/30">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
            <div className="flex items-center gap-2">
              {agentResult && (
                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${agentResult.status === "completed" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {agentResult.status}
                </span>
              )}
              {agentResult && <span className="text-[10px] text-muted-foreground">{formatDuration(agentResult.duration_ms)}</span>}
            </div>
            <div className="flex items-center gap-1">
              {agentResult && agentResult.commands_output.length > 0 && (
              <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2 text-[10px]" onClick={() => setExpandedRaw(!expandedRaw)}>
                  {expandedRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Raw
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2" onClick={() => { setAnalysisResult(null); setAgentResult(null); setExpandedRaw(false); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            </div>
          {expandedRaw && agentResult && (
            <div className="max-h-60 overflow-y-auto border-b border-border bg-secondary/10">
              {agentResult.commands_output.map((cmd, i) => (
                <div key={i} className="px-4 py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 text-[10px] mb-1">
                    <span className="font-mono text-foreground">{cmd.cmd}</span>
                    <span className={`px-1 rounded ${cmd.exit_code === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      exit {cmd.exit_code}
                    </span>
                    <span className="text-muted-foreground">{cmd.duration_ms}ms</span>
                  </div>
                  {cmd.stdout && <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">{cmd.stdout.slice(0, 1000)}</pre>}
                  {cmd.stderr && <pre className="text-[10px] text-red-400/70 whitespace-pre-wrap">{cmd.stderr.slice(0, 300)}</pre>}
                </div>
              ))}
            </div>
          )}
            <div className="p-5 prose prose-sm prose-invert max-w-none text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-xs [&_li]:text-xs [&_code]:text-[11px] [&_pre]:text-[11px] [&_strong]:text-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground">
              <ReactMarkdown>{agentResult?.ai_analysis || analysisResult?.text || ""}</ReactMarkdown>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ===== ACTIVE AGENTS ===== */}
      <SectionCard
        title={t("agent.active_runs")}
        description="Live runtime executions that are currently occupying an agent slot."
        icon={<Activity className="h-4 w-4 text-blue-400" />}
      >
        {activeRuns.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-blue-500/20 bg-background/35">
            <div className="divide-y divide-border/30">
              {activeRuns.map((run) => (
                <ActiveRunCard
                  key={run.id}
                  run={run}
                  onOpen={() => navigate(`/agents/run/${run.id}`)}
                  onStop={() => onStopAgent(run.agent_id)}
                  stopping={stoppingAgentId === run.agent_id}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="No active agent runs"
            description="When an agent is running right now, this area becomes the live runtime board with duration, iteration count, and quick stop/open actions."
          />
        )}
      </SectionCard>

      {/* ===== RECENT RUNS ===== */}
      <SectionCard
        title={t("agent.recent_runs")}
        description="Recently completed automation results. Use this list for quick post-run inspection before opening the full runtime report."
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      >
        {recentRuns.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-background/35">
            <div className="divide-y divide-border/30">
              {recentRuns.map((run) => (
                <RecentRunCard
                  key={run.id}
                  run={run}
                  onViewReport={() => setReportOpen(run)}
                  onOpen={() => navigate(`/agents/run/${run.id}`)}
                  t={t}
                />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Clock className="h-5 w-5" />}
            title="No recent automation results"
            description="Completed runs and reports will appear here. Until then, use the agent catalog below to trigger the first execution."
          />
        )}
      </SectionCard>

      {/* Agents list */}
      <SectionCard
        title={t("agent.title")}
        description="Runtime agents available from the dashboard surface."
        icon={<Zap className="h-4 w-4 text-yellow-400" />}
        actions={
          <div className="flex items-center gap-1.5">
            <Link to="/agents">
              <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-xl px-3 text-[10px]">
                {t("agent.view_all")} →
              </Button>
            </Link>
            <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl px-3 text-[10px]" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3 w-3" /> {t("agent.new")}
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-background/30">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{t("agent.title")}</span>
            <span className="text-[10px] text-muted-foreground">{agents.length}</span>
          </div>
          </div>

        {agents.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("agent.empty")}</p>
            <Link to="/agents">
              <Button size="sm" variant="outline" className="mt-2 h-8 gap-1 rounded-xl px-3 text-xs">
                <Plus className="h-3 w-3" /> {t("agent.create_first")}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {agents.slice(0, 5).map((ag: AgentItem) => (
              <div key={ag.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-base shrink-0">{AGENT_ICONS[ag.agent_type] || "🔧"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{ag.name}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${ag.mode === "full" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}>
                      {ag.mode}
                    </span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">{ag.agent_type_display}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {ag.server_count} {t("agent.servers_lc")}
                    {ag.last_run_at ? ` · ${t("agent.last_run")} ${relativeTime(ag.last_run_at)}` : ""}
                    {ag.schedule_minutes > 0 ? ` · ${t("agent.every")} ${ag.schedule_minutes}m` : ""}
                  </p>
                </div>
                {ag.active_run_id ? (
                  <Link to={`/agents/run/${ag.active_run_id}`}>
                    <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl border-blue-500/30 px-3 text-[10px] text-blue-400">
                      <Eye className="h-3 w-3" /> {t("agent.open")}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="sm" variant="outline"
                    className="h-8 gap-1 rounded-xl px-3 text-[10px]"
                    disabled={runningAgentId === ag.id}
                    onClick={() => onRunAgent(ag)}
                  >
                    {runningAgentId === ag.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {t("agent.run")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2 text-muted-foreground hover:text-red-400" onClick={() => setDeleteAgentTarget(ag)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {agents.length > 5 && (
              <div className="px-4 py-2 text-center">
                <Link to="/agents" className="text-[10px] text-primary hover:underline">
                  +{agents.length - 5} more agents →
                </Link>
              </div>
            )}
          </div>
        )}
        </div>
      </SectionCard>

      {/* Server status tags */}
      {data.servers.length > 0 && (
        <SectionCard
          title={t("udash.server_status")}
          description="Compact per-server status labels for quick scanning."
          icon={<Server className="h-4 w-4 text-primary" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {data.servers.map((srv) => (
              <div key={srv.server_id} className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-background/30 px-2.5 py-1.5 text-[10px]" title={`CPU: ${srv.cpu_percent ?? "—"}% | RAM: ${srv.memory_percent ?? "—"}% | Disk: ${srv.disk_percent ?? "—"}%`}>
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${srv.status === "healthy" ? "bg-green-400" : srv.status === "warning" ? "bg-yellow-400" : srv.status === "critical" || srv.status === "unreachable" ? "bg-red-500 animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-foreground">{srv.server_name}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Report dialog */}
      {reportOpen && (
        <Dialog open={!!reportOpen} onOpenChange={() => setReportOpen(null)}>
          <DialogContent className="w-[95vw] max-w-3xl rounded-2xl border-border bg-background/95">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span>{reportOpen.agent_name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${STATUS_TEXT[reportOpen.status] || "text-muted-foreground"} ${reportOpen.status === "completed" ? "bg-green-500/20" : reportOpen.status === "failed" ? "bg-red-500/20" : "bg-secondary"}`}>
                  {reportOpen.status}
                </span>
              </DialogTitle>
            </DialogHeader>
            <DialogBody className="max-h-[70vh] overflow-y-auto">
              {/* Run meta */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-4 pb-3 border-b border-border">
                <span><Clock className="inline h-2.5 w-2.5 mr-0.5" /> {formatDuration(reportOpen.duration_ms)}</span>
                <span><Activity className="inline h-2.5 w-2.5 mr-0.5" /> {reportOpen.total_iterations} {t("agent.iterations")}</span>
                <span><Terminal className="inline h-2.5 w-2.5 mr-0.5" /> {reportOpen.server_name}</span>
                {reportOpen.connected_servers.length > 1 && (
                  <span>+ {reportOpen.connected_servers.length - 1} servers</span>
                )}
                <span className="ml-auto">{relativeTime(reportOpen.started_at)}</span>
              </div>

              {/* Commands output for mini runs */}
              {reportOpen.agent_mode === "mini" && reportOpen.commands_output.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Commands</div>
                  <div className="space-y-1.5">
                    {reportOpen.commands_output.map((cmd, i) => (
                      <div key={i} className="bg-secondary/20 rounded px-3 py-2 font-mono text-[10px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-foreground">$ {cmd.cmd}</span>
                          <span className={`px-1 rounded text-[9px] ${cmd.exit_code === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                            {cmd.exit_code}
                          </span>
                          <span className="text-muted-foreground">{cmd.duration_ms}ms</span>
                        </div>
                        {cmd.stdout && (
                          <pre className="text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">{cmd.stdout.slice(0, 2000)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Report / analysis */}
              <div
                className="
                  [&_h1]:text-[17px] [&_h1]:font-bold [&_h1]:text-foreground [&_h1]:leading-snug [&_h1]:mb-3 [&_h1]:mt-0
                  [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-widest [&_h2]:text-muted-foreground [&_h2]:mt-7 [&_h2]:mb-2.5 [&_h2]:pb-1.5 [&_h2]:border-b [&_h2]:border-border/30
                  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1.5
                  [&_p]:text-[13px] [&_p]:text-foreground/80 [&_p]:leading-[1.7] [&_p]:mb-3
                  [&_ul]:mb-4 [&_ul]:pl-4 [&_ul]:space-y-1 [&_ul]:list-disc [&_ul]:marker:text-muted-foreground/60
                  [&_ol]:mb-4 [&_ol]:pl-4 [&_ol]:space-y-1 [&_ol]:list-decimal [&_ol]:marker:text-muted-foreground/60
                  [&_li]:text-[13px] [&_li]:text-foreground/80 [&_li]:leading-[1.7]
                  [&_strong]:font-semibold [&_strong]:text-foreground
                  [&_em]:italic [&_em]:text-foreground/65
                  [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:py-1.5 [&_blockquote]:my-4 [&_blockquote]:bg-secondary/10 [&_blockquote]:rounded-r-lg [&_blockquote]:text-[13px] [&_blockquote]:text-foreground/70
                  [&_code]:text-[11px] [&_code]:font-mono [&_code]:bg-secondary/40 [&_code]:text-foreground/85 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                  [&_pre]:bg-secondary/20 [&_pre]:border [&_pre]:border-border/30 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-[11px] [&_pre]:font-mono [&_pre]:text-foreground/75 [&_pre]:my-4
                  [&_hr]:border-border/25 [&_hr]:my-6
                  [&_table]:w-full [&_table]:text-xs [&_table]:my-5 [&_table]:border-collapse [&_table]:border [&_table]:border-border/40 [&_table]:rounded-lg [&_table]:overflow-hidden
                  [&_thead]:bg-secondary/50
                  [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:border [&_th]:border-border/30
                  [&_td]:px-3 [&_td]:py-2 [&_td]:text-[12px] [&_td]:text-foreground/80 [&_td]:border [&_td]:border-border/20 [&_td]:align-top [&_td]:leading-snug
                  [&_tr:nth-child(even)_td]:bg-secondary/10
                "
              >
                <ReactMarkdown>{reportOpen.final_report || reportOpen.ai_analysis || "No report available."}</ReactMarkdown>
              </div>
            </DialogBody>
            <DialogFooter>
              {(reportOpen.agent_mode === "full" || reportOpen.agent_mode === "multi") && (
                <Link to={`/agents/run/${reportOpen.id}`} onClick={() => setReportOpen(null)}>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                    <ExternalLink className="h-3 w-3" /> Открыть полностью
                  </Button>
                </Link>
              )}
              <Button size="sm" onClick={() => setReportOpen(null)}>{t("agent.close_report")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create agent dialog */}
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["agents"] }); }}
      />

      <ConfirmActionDialog
        open={!!deleteAgentTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteAgentTarget(null);
        }}
        title="Delete agent"
        description={deleteAgentTarget ? `Delete agent "${deleteAgentTarget.name}" from your dashboard catalog?` : ""}
        confirmLabel="Delete agent"
        onConfirm={() => {
          if (!deleteAgentTarget) return;
          void onDeleteAgent(deleteAgentTarget.id);
          setDeleteAgentTarget(null);
        }}
      />
    </PageShell>
  );
}

function ActiveRunCard({ run, onOpen, onStop, stopping, t }: {
  run: DashboardRunItem;
  onOpen: () => void;
  onStop: () => void;
  stopping: boolean;
  t: (key: string) => string;
}) {
  const elapsed = Date.now() - new Date(run.started_at).getTime();

  return (
    <div className={`px-5 py-4 ${STATUS_BG[run.status] || ""} transition-colors`}>
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <span className="text-lg">{AGENT_ICONS[run.agent_type] || "🤖"}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-medium text-foreground">{run.agent_name}</span>
            <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase ${STATUS_TEXT[run.status] || "text-muted-foreground"} ${run.status === "running" ? "bg-blue-500/20" : run.status === "waiting" ? "bg-orange-500/20" : run.status === "paused" ? "bg-yellow-500/20" : "bg-secondary"}`}>
              {run.status}
            </span>
            {run.agent_mode === "full" && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 font-bold">FULL</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span><Clock className="inline h-2.5 w-2.5 mr-0.5" />{formatDuration(elapsed)}</span>
            {run.total_iterations > 0 && (
              <span><Brain className="inline h-2.5 w-2.5 mr-0.5" />{run.total_iterations} {t("agent.iterations")}</span>
            )}
            {run.connected_servers.length > 0 && (
              <span className="flex items-center gap-1">
                <Terminal className="inline h-2.5 w-2.5" />
                {run.connected_servers.map((s) => s.server_name).join(", ")}
              </span>
            )}
            {run.connected_servers.length === 0 && run.server_name && (
              <span><Terminal className="inline h-2.5 w-2.5 mr-0.5" />{run.server_name}</span>
            )}
          </div>

          {run.pending_question && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded-xl border border-orange-500/20 bg-orange-500/10 px-2 py-1">
              <Bot className="h-3 w-3 text-orange-400 shrink-0" />
              <span className="text-[10px] text-orange-300 truncate">{run.pending_question}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl border-blue-500/30 px-3 text-[10px] text-blue-400 hover:bg-blue-500/10" onClick={onOpen}>
            <Eye className="h-3 w-3" /> {t("agent.open")}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2 text-red-400 hover:bg-red-500/10" onClick={onStop} disabled={stopping}>
            {stopping ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecentRunCard({ run, onViewReport, onOpen, t }: {
  run: DashboardRunItem;
  onViewReport: () => void;
  onOpen: () => void;
  t: (key: string) => string;
}) {
  const hasReport = !!(run.final_report || run.ai_analysis);

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/10 transition-colors">
      <div className="shrink-0">
        {run.status === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-green-400" />
        ) : run.status === "failed" ? (
          <X className="h-4 w-4 text-red-400" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{run.agent_name}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${run.agent_mode === "full" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
            {run.agent_mode}
          </span>
          <span className="text-[10px] text-muted-foreground">→ {run.server_name}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{formatDuration(run.duration_ms)}</span>
          {run.total_iterations > 0 && <span>{run.total_iterations} iter</span>}
          <span>{relativeTime(run.completed_at || run.started_at)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {hasReport && (
          <Button size="sm" variant="outline" className="h-8 gap-1 rounded-xl px-3 text-[10px]" onClick={onViewReport}>
            <FileText className="h-3 w-3" /> {t("agent.report")}
          </Button>
        )}
        {run.agent_mode === "full" && (
          <Button size="sm" variant="ghost" className="h-8 rounded-xl px-2 text-muted-foreground" onClick={onOpen}>
            <ExternalLink className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CreateAgentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<"template" | "config">("template");
  const [selectedType, setSelectedType] = useState("");
  const [name, setName] = useState("");
  const [commands, setCommands] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [selectedServers, setSelectedServers] = useState<number[]>([]);
  const [schedule, setSchedule] = useState(0);
  const [saving, setSaving] = useState(false);

  const { data: tplData } = useQuery({
    queryKey: ["agents", "templates"],
    queryFn: fetchAgentTemplates,
    enabled: open,
  });

  const { data: bootstrapData } = useQuery({
    queryKey: ["frontend", "bootstrap"],
    queryFn: fetchFrontendBootstrap,
    staleTime: 30_000,
  });

  const templates = tplData?.templates || [];
  const servers = bootstrapData?.servers || [];

  const onSelectTemplate = (type: string) => {
    setSelectedType(type);
    const tpl = templates.find((t) => t.type === type);
    if (tpl) {
      setName(tpl.name);
      setCommands(tpl.commands.join("\n"));
      setAiPrompt(tpl.ai_prompt);
    } else {
      setName("");
      setCommands("");
      setAiPrompt("");
    }
    setStep("config");
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const cmdList = commands.split("\n").map((c) => c.trim()).filter(Boolean);
      await createAgent({
        name: name || "Custom Agent",
        agent_type: selectedType || "custom",
        server_ids: selectedServers,
        commands: cmdList,
        ai_prompt: aiPrompt,
        schedule_minutes: schedule,
      });
      onCreated();
      setStep("template");
      setSelectedType("");
      setName("");
      setCommands("");
      setAiPrompt("");
      setSelectedServers([]);
      setSchedule(0);
    } finally {
      setSaving(false);
    }
  };

  const toggleServer = (id: number) => {
    setSelectedServers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedServers.length === servers.length) setSelectedServers([]);
    else setSelectedServers(servers.map((s) => s.id));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl rounded-2xl border-border bg-background/95">
        <DialogHeader>
          <DialogTitle>{step === "template" ? t("agent.choose_template") : t("agent.configure")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          {step === "template" ? (
            <div className="grid grid-cols-2 gap-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.type}
                  onClick={() => onSelectTemplate(tpl.type)}
                  className="rounded-[22px] border border-border bg-secondary/30 p-3 text-left transition-[border-color,background-color] hover:border-primary/40 hover:bg-secondary/40"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{AGENT_ICONS[tpl.type] || "🔧"}</span>
                    <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{tpl.command_count} {t("agent.commands_lc")}</p>
                </button>
              ))}
              <button
                onClick={() => onSelectTemplate("custom")}
                className="rounded-[22px] border border-border bg-secondary/30 p-3 text-left transition-[border-color,background-color] hover:border-primary/40 hover:bg-secondary/40"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🔧</span>
                  <span className="text-sm font-medium text-foreground">Custom</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{t("agent.custom_desc")}</p>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("agent.name_label")}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agent" className="bg-secondary/50 h-8 text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("agent.select_servers")}</label>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={selectAll} className={`px-2 py-1 text-[10px] rounded border transition-colors ${selectedServers.length === servers.length ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {t("agent.all")}
                  </button>
                  {servers.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleServer(s.id)}
                      className={`px-2 py-1 text-[10px] rounded border transition-colors ${selectedServers.includes(s.id) ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("agent.commands_label")}</label>
                <Textarea value={commands} onChange={(e) => setCommands(e.target.value)} rows={5} className="bg-secondary/50 font-mono text-[11px]" placeholder="hostname&#10;uptime&#10;free -m" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("agent.ai_prompt_label")}</label>
                <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={3} className="bg-secondary/50 text-xs" placeholder={t("agent.ai_prompt_placeholder")} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">{t("agent.schedule")}</label>
                  <span className="text-xs font-mono text-foreground">{schedule === 0 ? t("agent.manual") : `${schedule} min`}</span>
                </div>
                <input type="range" min={0} max={1440} step={5} value={schedule} onChange={(e) => setSchedule(Number(e.target.value))} className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary" />
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>{t("agent.manual")}</span>
                  <span>5m</span>
                  <span>1h</span>
                  <span>24h</span>
                </div>
              </div>
            </div>
          )}
        </DialogBody>
        {step === "config" && (
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setStep("template")}>{t("agent.back")}</Button>
            <Button size="sm" onClick={onSave} disabled={saving || !selectedServers.length}>
              {saving ? t("set.saving") : t("agent.create")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
