import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchAgents,
  fetchAgentTemplates,
  fetchFrontendBootstrap,
  createAgent,
  deleteAgent,
  runAgent,
  stopAgent,
  type AgentItem,
  type AgentTemplate,
  type AgentRunResult,
} from "@/lib/api";
import {
  Bot, Plus, Play, Trash2, RefreshCw, Clock, Zap, Eye,
  FileText, Server, X, Square,
  Brain, Target, Settings2, Layers, Terminal, CheckCircle2,
  AlertTriangle, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  FilterBar,
  MetricCard,
  MetricGrid,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import ReactMarkdown from "react-markdown";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

const MODE_ICONS: Record<string, typeof Bot> = { mini: Zap, full: Brain, multi: Layers };
const AGENT_ICONS: Record<string, string> = {
  security_audit: "🔒", log_analyzer: "📋", performance: "⚡", disk_report: "💾",
  docker_status: "🐳", service_health: "⚙️", custom: "🔧",
  security_patrol: "🛡️", deploy_watcher: "🚀", log_investigator: "🔍",
  infra_scout: "🗺️", multi_health: "💚",
};

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

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [modeFilter, setModeFilter] = useState<"all" | "mini" | "full" | "multi">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["agents", "list"],
    queryFn: () => fetchAgents(),
    refetchInterval: 10_000,
  });

  const allAgents = data?.agents || [];
  const agents = allAgents.filter(
    (a) => modeFilter === "all" || a.mode === modeFilter,
  );
  const runningAgents = allAgents.filter((agent) => !!agent.active_run_id).length;
  const scheduledAgents = allAgents.filter((agent) => agent.schedule_minutes > 0).length;
  const autonomousAgents = allAgents.filter((agent) => agent.mode === "full" || agent.mode === "multi").length;
  const modeCounts = {
    all: allAgents.length,
    mini: allAgents.filter((agent) => agent.mode === "mini").length,
    full: allAgents.filter((agent) => agent.mode === "full").length,
    multi: allAgents.filter((agent) => agent.mode === "multi").length,
  } as const;

  const onRun = async (ag: AgentItem) => {
    setRunningId(ag.id);
    setResult(null);
    try {
      const res = await runAgent(ag.id);
      if (res.runs?.length > 0) {
        setResult(res.runs[0]);
        setReportModalOpen(true);
      }
      if ((ag.mode === "full" || ag.mode === "multi") && res.run_id) {
        navigate(`/agents/run/${res.run_id}`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch {
      setResult({ run_id: 0, server_name: "Error", status: "failed", ai_analysis: "Run failed.", duration_ms: 0, commands_output: [] });
    } finally {
      setRunningId(null);
    }
  };

  const onStop = async (ag: AgentItem) => {
    await stopAgent(ag.id);
    await queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  const onDelete = async (id: number) => {
    await deleteAgent(id);
    await queryClient.invalidateQueries({ queryKey: ["agents"] });
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;

  return (
    <PageShell>
      <PageHero
        kicker="Runtime Fleet"
        title="Server Agents"
        description={
          <>
            This page is the live execution layer: the runtime fleet operators can run, stop, inspect, and schedule.
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge label="runtime fleet" tone="info" />
              <span>Studio owns configs, skills, MCP, and pipeline composition.</span>
            </div>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-2 rounded-xl"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["agents"] })}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh fleet
            </Button>
            <Button size="sm" variant="outline" className="gap-2 rounded-xl" onClick={() => navigate("/studio/agents")}>
              <Settings2 className="h-4 w-4" />
              Open Studio configs
            </Button>
            <Button size="sm" className="gap-2 rounded-xl" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New agent
            </Button>
          </div>
        }
      >
        <MetricGrid>
          <MetricCard
            label="Total fleet"
            value={allAgents.length}
            description="Configured agents available to operators."
            icon={<Bot className="h-5 w-5 text-primary" />}
            tone="info"
          />
          <MetricCard
            label="Running now"
            value={runningAgents}
            description="Agents currently holding a live execution slot."
            icon={<Activity className="h-5 w-5 text-blue-400" />}
            tone={runningAgents > 0 ? "info" : "default"}
          />
          <MetricCard
            label="Scheduled"
            value={scheduledAgents}
            description="Bots with recurring execution windows."
            icon={<RefreshCw className="h-5 w-5 text-emerald-400" />}
            tone="success"
          />
          <MetricCard
            label="Autonomous"
            value={autonomousAgents}
            description="Full and pipeline agents with reasoning loops."
            icon={<Brain className="h-5 w-5 text-violet-400" />}
            tone="warning"
          />
        </MetricGrid>
      </PageHero>

      <SectionCard
        title="Runtime vs builder"
        description="Agents here are executable runtime units. Reusable bot profiles, skills, and MCP connectivity live in Studio."
        icon={<Layers className="h-4 w-4 text-primary" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/studio/skills")}>
              <Brain className="h-4 w-4" />
              Skill Catalog
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/studio/mcp")}>
              <Terminal className="h-4 w-4" />
              MCP Registry
            </Button>
          </div>
        }
      >
        <FilterBar>
          <div>
            <p className="text-sm font-semibold text-foreground">Fleet filters</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Narrow the runtime list by execution model. Counts reflect the whole fleet, not just the current filter.
            </p>
          </div>
          <div className="enterprise-segmented">
            {([
              { key: "all", label: "All" },
              { key: "mini", label: "Mini" },
              { key: "full", label: "Full" },
              { key: "multi", label: "Pipeline" },
            ] as const).map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setModeFilter(entry.key)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  modeFilter === entry.key
                    ? "border-primary/60 bg-primary/12 text-primary"
                    : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-secondary/40 hover:text-foreground"
                }`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">{entry.label}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{modeCounts[entry.key]}</div>
              </button>
            ))}
          </div>
        </FilterBar>
      </SectionCard>

      {/* Last run result toast */}
      {result && !reportModalOpen && (
        <div className="enterprise-panel flex items-center gap-3 rounded-2xl px-4 py-3">
          <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${result.status === "completed" ? "bg-green-500/15" : "bg-red-500/15"}`}>
            {result.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-foreground">{result.server_name}</span>
            <span className="text-[10px] text-muted-foreground ml-2">{formatDuration(result.duration_ms)}</span>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={() => setReportModalOpen(true)}>
            <FileText className="h-3 w-3" /> View Report
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 shrink-0 text-muted-foreground" onClick={() => setResult(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Full-screen report modal */}
      {result && (
        <ReportModal result={result} open={reportModalOpen} onClose={() => setReportModalOpen(false)} />
      )}

      {/* Agent list */}
      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-5 w-5" />}
          title="No runtime agents match this filter"
          description="The runtime fleet is empty for the current execution model. Create an agent here, or prepare reusable profiles in Studio before attaching them to operations."
          actions={
            <>
              <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2 rounded-xl">
                <Plus className="h-4 w-4" /> Create agent
              </Button>
              <Button size="sm" variant="outline" className="gap-2 rounded-xl" onClick={() => navigate("/studio/agents")}>
                <Settings2 className="h-4 w-4" /> Open Agent Configs
              </Button>
            </>
          }
          hint="Runtime fleet = live execution layer. Studio Agent Configs = reusable builder profiles with prompts, tools, MCP services, and skills."
        />
      ) : (
        <section className="enterprise-panel overflow-hidden rounded-2xl">
          <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Agent catalog</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {agents.length} of {allAgents.length} configured agents.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              Visible actions stay pinned so operators do not need to hunt for controls on hover.
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {agents.map((ag) => {
              const ModeIcon = MODE_ICONS[ag.mode] || Zap;
              const isRunning = runningId === ag.id || !!ag.active_run_id;
              return (
                <div key={ag.id} className="grid gap-4 px-5 py-4 transition-colors hover:bg-secondary/15 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="flex min-w-0 gap-3">
                    <span className="text-lg shrink-0">{AGENT_ICONS[ag.agent_type] || "🔧"}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-foreground">{ag.name}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${ag.mode === "full" ? "bg-purple-500/18 text-purple-300" : ag.mode === "multi" ? "bg-violet-500/18 text-violet-300" : "bg-blue-500/18 text-blue-300"}`}>
                          <ModeIcon className="h-3 w-3" />{ag.mode === "multi" ? "Pipeline" : ag.mode}
                        </span>
                        <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          {ag.agent_type_display}
                        </span>
                        {ag.active_run_id && (
                          <span className="rounded-full bg-green-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-green-300">
                            Running
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Server className="h-3 w-3" /> {ag.server_count} servers</span>
                        {ag.last_run_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last run {relativeTime(ag.last_run_at)} ago</span>}
                        {ag.schedule_minutes > 0 && <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Every {ag.schedule_minutes} min</span>}
                        {(ag.mode === "full" || ag.mode === "multi") && <span className="flex items-center gap-1"><Target className="h-3 w-3" /> {ag.mode === "multi" ? "Task decomposition" : `${ag.max_iterations} iterations`}</span>}
                      </div>
                      {ag.goal && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{ag.goal}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0 lg:justify-end">
                    {ag.active_run_id ? (
                      <>
                        <Link to={`/agents/run/${ag.active_run_id}`}>
                          <Button size="sm" variant="outline" className="gap-2">
                            <Eye className="h-4 w-4" /> Watch
                          </Button>
                        </Link>
                        <Button size="sm" variant="outline" className="gap-2 text-red-300 hover:text-red-200" onClick={() => onStop(ag)}>
                          <Square className="h-4 w-4" /> Stop
                        </Button>
                      </>
                    ) : (
                      <>
                        {ag.last_run_id && (
                          <Link to={`/agents/run/${ag.last_run_id}`}>
                            <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground hover:text-foreground">
                              <FileText className="h-4 w-4" /> Report
                            </Button>
                          </Link>
                        )}
                        <Button size="sm" variant="outline" className="gap-2" disabled={isRunning} onClick={() => onRun(ag)}>
                          {isRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground hover:text-red-300" onClick={() => setDeleteTarget(ag)}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["agents"] }); }} />

      <ConfirmActionDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete agent"
        description={deleteTarget ? `Delete agent "${deleteTarget.name}" and remove it from the fleet catalog?` : ""}
        confirmLabel="Delete agent"
        onConfirm={() => {
          if (!deleteTarget) return;
          void onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------

function CreateAgentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<"template" | "config">("template");
  const [mode, setMode] = useState<"mini" | "full" | "multi">("mini");
  const [selectedType, setSelectedType] = useState("");
  const [name, setName] = useState("");
  const [commands, setCommands] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [goal, setGoal] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxIter, setMaxIter] = useState(20);
  const [multiServer, setMultiServer] = useState(false);
  const [selectedServers, setSelectedServers] = useState<number[]>([]);
  const [schedule, setSchedule] = useState(0);
  const [saving, setSaving] = useState(false);

  const { data: tplData } = useQuery({ queryKey: ["agents", "templates"], queryFn: fetchAgentTemplates, enabled: open });
  const { data: bootstrapData } = useQuery({ queryKey: ["frontend", "bootstrap"], queryFn: fetchFrontendBootstrap, staleTime: 30_000 });

  const templates = (tplData?.templates || []).filter((t) => t.mode === mode || (mode === "multi" && t.mode === "full"));
  const servers = bootstrapData?.servers || [];

  const onSelectTemplate = (tpl: AgentTemplate) => {
    setSelectedType(tpl.type);
    setName(tpl.name);
    setCommands(tpl.commands.join("\n"));
    setAiPrompt(tpl.ai_prompt);
    if (tpl.mode === "full" || mode === "multi") {
      setGoal(tpl.goal || "");
      setSystemPrompt(tpl.system_prompt || "");
      setMultiServer(tpl.allow_multi_server || false);
    }
    setStep("config");
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const cmdList = commands.split("\n").map((c) => c.trim()).filter(Boolean);
      await createAgent({
        name: name || "Custom Agent",
        mode,
        agent_type: selectedType || "custom",
        server_ids: selectedServers,
        commands: cmdList,
        ai_prompt: aiPrompt,
        schedule_minutes: schedule,
        goal,
        system_prompt: systemPrompt,
        max_iterations: maxIter,
        allow_multi_server: multiServer,
      });
      onCreated();
      resetForm();
    } finally { setSaving(false); }
  };

  const resetForm = () => {
    setStep("template"); setMode("mini"); setSelectedType(""); setName("");
    setCommands(""); setAiPrompt(""); setGoal(""); setSystemPrompt("");
    setMaxIter(20); setMultiServer(false); setSelectedServers([]); setSchedule(0);
  };

  const toggleServer = (id: number) => setSelectedServers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const selectAll = () => { if (selectedServers.length === servers.length) setSelectedServers([]); else setSelectedServers(servers.map((s) => s.id)); };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl border-border/70 bg-card/95 p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="enterprise-kicker">{step === "template" ? "Template Library" : "Configuration"}</div>
              <DialogTitle className="mt-2">
                {step === "template" ? "Create agent" : `Configure ${mode === "multi" ? "multi-agent pipeline" : mode === "full" ? "full agent" : "mini agent"}`}
              </DialogTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                {step === "template"
                  ? "Start from a standard operating template or open a custom agent from scratch."
                  : "Define runtime behavior, target servers and execution cadence before saving the bot."}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/40 px-2 py-2 text-xs text-muted-foreground">
              <span className={`rounded-full px-3 py-1 ${step === "template" ? "bg-primary/15 text-primary" : ""}`}>1. Template</span>
              <span className={`rounded-full px-3 py-1 ${step === "config" ? "bg-primary/15 text-primary" : ""}`}>2. Configure</span>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="max-h-[75vh] overflow-y-auto px-6 py-6 sm:px-7 sm:py-7">
          {step === "template" ? (
            <div className="space-y-4">
              {/* Mode selector */}
              <div className="grid gap-3 lg:grid-cols-3">
                <button onClick={() => setMode("mini")} className={`enterprise-stat text-left rounded-2xl p-4 transition-colors ${mode === "mini" ? "border-primary/50 bg-primary/10" : "hover:border-primary/20"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4 text-blue-400" />
                    <span className="text-sm font-medium">Mini Agent</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">Run a defined command set on selected servers and add an AI-generated summary afterward.</p>
                </button>
                <button onClick={() => setMode("full")} className={`enterprise-stat text-left rounded-2xl p-4 transition-colors ${mode === "full" ? "border-primary/50 bg-primary/10" : "hover:border-primary/20"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium">Full Agent (ReAct)</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">Autonomous worker with a reasoning loop, goal tracking and optional multi-server execution.</p>
                </button>
                <button onClick={() => setMode("multi")} className={`enterprise-stat text-left rounded-2xl p-4 transition-colors ${mode === "multi" ? "border-violet-500/50 bg-violet-500/10" : "hover:border-violet-500/20"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Layers className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-medium">Multi-Agent Pipeline</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">An orchestrator decomposes a complex goal into tasks and coordinates separate agent executions.</p>
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {templates.map((tpl) => (
                  <button key={tpl.type} onClick={() => onSelectTemplate(tpl)}
                    className="enterprise-stat text-left rounded-2xl p-4 transition-colors hover:border-primary/35">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{AGENT_ICONS[tpl.type] || "🔧"}</span>
                      <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {tpl.mode === "full" ? (tpl.goal || "").slice(0, 80) + "..." : `${tpl.command_count} commands`}
                    </p>
                  </button>
                ))}
                <button onClick={() => { setSelectedType("custom"); setStep("config"); }}
                  className="enterprise-stat text-left rounded-2xl p-4 transition-colors hover:border-primary/35">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🔧</span>
                    <span className="text-sm font-medium text-foreground">Custom</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">Build a new agent with your own goal, commands and schedule.</p>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agent" className="bg-background/70" />
                  </div>

                  {(mode === "full" || mode === "multi") && (
                    <>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Target className="h-4 w-4 text-primary" /> Goal
                        </label>
                        <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={4} className="bg-background/70 text-sm"
                          placeholder={mode === "multi" ? "Describe the complex goal. E.g.: 'Perform a full security audit: check users, open ports, failed logins, suspicious processes and provide recommendations.'" : "What should this agent achieve? Be specific about the end result."} />
                        {mode === "multi" && (
                          <p className="text-xs text-violet-300">The orchestrator will break this goal into separate tasks and coordinate child agents.</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-foreground"><Settings2 className="h-4 w-4 text-primary" /> System Prompt</label>
                        <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} className="bg-background/70 text-sm"
                          placeholder="Optional role, tone or non-default instructions for the agent." />
                      </div>
                    </>
                  )}

                  {mode === "mini" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">Commands</label>
                      <Textarea value={commands} onChange={(e) => setCommands(e.target.value)} rows={6} className="bg-background/70 font-mono text-[13px]"
                        placeholder="hostname&#10;uptime&#10;free -m" />
                      <p className="text-xs text-muted-foreground">One command per line. Keep the list deterministic for routine checks and reports.</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">AI Prompt</label>
                    <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={3} className="bg-background/70 text-sm"
                      placeholder="Extra instructions for AI analysis, output format or reporting." />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="enterprise-stat rounded-2xl px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Execution settings</p>
                    {(mode === "full" || mode === "multi") && (
                      <div className="mt-4 space-y-2">
                        <label className="text-sm font-medium text-foreground">Max iterations</label>
                        <Input type="number" min={1} max={100} value={maxIter} onChange={(e) => setMaxIter(Number(e.target.value))} className="bg-background/70" />
                      </div>
                    )}
                    {(mode === "full" || mode === "multi") && (
                      <label className="mt-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-3 text-sm text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={multiServer} onChange={(e) => setMultiServer(e.target.checked)} className="h-4 w-4 rounded border-border bg-background accent-primary" />
                        Allow multi-server execution
                      </label>
                    )}
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-foreground">Schedule</label>
                        <span className="text-xs font-mono text-muted-foreground">{schedule === 0 ? "Manual" : `${schedule} min`}</span>
                      </div>
                      <input type="range" min={0} max={1440} step={5} value={schedule} onChange={(e) => setSchedule(Number(e.target.value))}
                        className="enterprise-range" />
                      <p className="text-xs text-muted-foreground">Set to zero for manual execution only.</p>
                    </div>
                  </div>

                  <div className="enterprise-stat rounded-2xl px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Target servers</p>
                        <p className="mt-1 text-sm text-foreground">{selectedServers.length} selected</p>
                      </div>
                      <Button type="button" size="sm" variant="outline" className="gap-2" onClick={selectAll}>
                        {selectedServers.length === servers.length ? "Clear all" : "Select all"}
                      </Button>
                    </div>
                    <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                      {servers.map((s) => (
                        <button key={s.id} type="button" onClick={() => toggleServer(s.id)}
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left text-sm transition-colors ${selectedServers.includes(s.id) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/70 bg-background/35 text-muted-foreground hover:border-primary/20 hover:text-foreground"}`}>
                          <span>{s.name}</span>
                          <span className={`h-2.5 w-2.5 rounded-full ${selectedServers.includes(s.id) ? "bg-primary" : "bg-border"}`} />
                        </button>
                      ))}
                      {servers.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                          No servers available in the frontend bootstrap catalog.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogBody>
        {step === "config" && (
          <DialogFooter className="border-t border-border/70 px-6 py-4 sm:px-7">
            <Button size="sm" variant="outline" onClick={() => setStep("template")}>Back</Button>
            <Button size="sm" onClick={onSave} disabled={saving || !selectedServers.length}>
              {saving ? "Creating..." : "Create Agent"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Full-screen Report Modal
// ---------------------------------------------------------------------------

function ReportModal({ result, open, onClose }: { result: AgentRunResult; open: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"report" | "console">("report");
  const report = result.final_report || result.ai_analysis || "";
  const hasConsole = result.commands_output.length > 0;
  const isCompleted = result.status === "completed";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-card">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isCompleted ? "bg-green-500/10" : "bg-red-500/10"}`}>
            {isCompleted ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <AlertTriangle className="h-4 w-4 text-red-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Agent Report — {result.server_name}</p>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
              <span className={`font-bold uppercase ${isCompleted ? "text-green-400" : "text-red-400"}`}>{result.status}</span>
              <span className="flex items-center gap-0.5"><Activity className="h-2.5 w-2.5" />{formatDuration(result.duration_ms)}</span>
              {hasConsole && <span className="flex items-center gap-0.5"><Terminal className="h-2.5 w-2.5" />{result.commands_output.length} commands</span>}
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        {hasConsole && (
          <div className="shrink-0 flex border-b border-border px-5 bg-card/50">
            <button
              onClick={() => setActiveTab("report")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "report" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <FileText className="inline h-3 w-3 mr-1" />Report
            </button>
            <button
              onClick={() => setActiveTab("console")}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === "console" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <Terminal className="inline h-3 w-3 mr-1" />Console ({result.commands_output.length})
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === "report" ? (
            <div className="py-8 px-8 max-w-[720px] mx-auto font-sans">
              {report ? (
                <div
                  className="
                    [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:text-foreground [&_h1]:leading-snug [&_h1]:mb-3 [&_h1]:mt-0
                    [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-widest [&_h2]:text-muted-foreground [&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-border/30
                    [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-2
                    [&_p]:text-[15px] [&_p]:text-foreground/80 [&_p]:leading-[1.8] [&_p]:mb-4
                    [&_ul]:mb-5 [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:marker:text-muted-foreground/60
                    [&_ol]:mb-5 [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_ol]:list-decimal [&_ol]:marker:text-muted-foreground/60
                    [&_li]:text-[15px] [&_li]:text-foreground/80 [&_li]:leading-[1.8]
                    [&_strong]:font-semibold [&_strong]:text-foreground
                    [&_em]:italic [&_em]:text-foreground/65
                    [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-5 [&_blockquote]:py-2 [&_blockquote]:my-5 [&_blockquote]:bg-secondary/10 [&_blockquote]:rounded-r-lg [&_blockquote]:text-[15px] [&_blockquote]:text-foreground/70
                    [&_code]:text-[13px] [&_code]:font-mono [&_code]:bg-secondary/40 [&_code]:text-foreground/85 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                    [&_pre]:bg-secondary/20 [&_pre]:border [&_pre]:border-border/30 [&_pre]:rounded-xl [&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:font-mono [&_pre]:text-foreground/75 [&_pre]:my-5
                    [&_hr]:border-border/25 [&_hr]:my-8
                    [&_table]:w-full [&_table]:text-sm [&_table]:my-6 [&_table]:border-collapse [&_table]:border [&_table]:border-border/40 [&_table]:rounded-lg [&_table]:overflow-hidden
                    [&_thead]:bg-secondary/40
                    [&_th]:text-left [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:border [&_th]:border-border/30
                    [&_td]:px-4 [&_td]:py-3 [&_td]:text-[13px] [&_td]:text-foreground/80 [&_td]:border [&_td]:border-border/20 [&_td]:align-top [&_td]:leading-snug
                    [&_tr:nth-child(even)_td]:bg-secondary/10
                    [&_tr:hover_td]:bg-primary/5
                  "
                >
                  <ReactMarkdown>{report}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No report available</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {result.commands_output.map((cmd, i) => (
                <div key={i} className="bg-[#0d1117] rounded-lg overflow-hidden border border-border/30">
                  <div className="flex items-center gap-2 px-3 py-2 bg-secondary/10 border-b border-border/20">
                    <span className="text-green-400 font-mono text-[11px]">$</span>
                    <span className="font-mono text-xs text-foreground flex-1">{cmd.cmd}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cmd.exit_code === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      exit {cmd.exit_code}
                    </span>
                    <span className="text-[9px] text-muted-foreground">{cmd.duration_ms}ms</span>
                  </div>
                  {cmd.stdout && (
                    <pre className="px-3 py-2.5 text-[11px] text-foreground/80 font-mono whitespace-pre-wrap overflow-x-auto">{cmd.stdout}</pre>
                  )}
                  {cmd.stderr && (
                    <pre className="px-3 py-2.5 text-[11px] text-red-400/80 font-mono whitespace-pre-wrap border-t border-red-500/10">{cmd.stderr}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
