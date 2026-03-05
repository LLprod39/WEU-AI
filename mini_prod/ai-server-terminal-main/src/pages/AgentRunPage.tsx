import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  fetchAgentRunDetail,
  fetchAgentRunLog,
  replyToAgent,
  stopAgent,
  updatePipelineTask,
  aiRefinePipelineTask,
  approvePipelinePlan,
  type AgentRunDetail,
} from "@/lib/api";
import {
  Bot, ArrowLeft, Square, Send, Brain, Terminal,
  CheckCircle2, XCircle, Clock, Activity, MessageSquare,
  FileText, AlertTriangle, ChevronRight, RefreshCw,
  Target, Cpu, ChevronDown, ChevronUp, SkipForward,
  RotateCcw, HelpCircle, Layers, Pencil, Trash2, Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function AgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState<"pipeline" | "report">("pipeline");
  const [localPlanTasks, setLocalPlanTasks] = useState<AgentRunDetail["plan_tasks"] | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const rid = parseInt(runId || "0", 10);

  const { data: runData, isLoading } = useQuery({
    queryKey: ["agent-run", rid],
    queryFn: () => fetchAgentRunDetail(rid),
    enabled: rid > 0,
    refetchInterval: 3000,
  });

  const { data: logData } = useQuery({
    queryKey: ["agent-run-log", rid],
    queryFn: () => fetchAgentRunLog(rid),
    enabled: rid > 0,
    refetchInterval: 2000,
  });

  const run = runData?.run;
  const serverPlanTasks = logData?.plan_tasks || run?.plan_tasks || [];
  // localPlanTasks overrides server data after user edits (clears on next poll)
  const planTasks = localPlanTasks ?? serverPlanTasks;
  const isMulti = run?.agent_mode === "multi";
  const isPlanReview = run?.status === "plan_review";
  const isActive = run && ["running", "paused", "waiting", "pending"].includes(run.status);
  const hasReport = run && (run.final_report || run.ai_analysis);

  useEffect(() => {
    if (run && !isActive && !isPlanReview && hasReport) {
      setActiveTab("report");
    } else if (run && isMulti) {
      setActiveTab("pipeline");
    }
  }, [run?.id, run?.status]);

  const onApprovePlan = async () => {
    if (!run) return;
    setApproving(true);
    setApproveError(null);
    try {
      await approvePipelinePlan(run.id);
      await queryClient.invalidateQueries({ queryKey: ["agent-run", rid] });
      await queryClient.invalidateQueries({ queryKey: ["agent-run-log", rid] });
    } catch (err: unknown) {
      setApproveError(err instanceof Error ? err.message : "Ошибка запуска выполнения");
    } finally {
      setApproving(false);
    }
  };

  useEffect(() => {
    if (autoScroll && logEndRef.current && activeTab === "pipeline") {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [planTasks.length, autoScroll, activeTab]);

  const onStop = async () => {
    if (!run) return;
    setStopping(true);
    try {
      await stopAgent(run.agent_id);
      await queryClient.invalidateQueries({ queryKey: ["agent-run", rid] });
    } finally {
      setStopping(false);
    }
  };

  const onReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await replyToAgent(rid, replyText.trim());
      setReplyText("");
      await queryClient.invalidateQueries({ queryKey: ["agent-run", rid] });
    } finally {
      setSending(false);
    }
  };

  if (isLoading || !run) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t("loading")}</span>
        </div>
      </div>
    );
  }

  const elapsed = run.duration_ms || (Date.now() - new Date(run.started_at).getTime());

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/agents">
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{run.agent_name}</span>
          <StatusBadge status={run.status} />
          {isMulti && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 font-bold uppercase">
              <Layers className="inline h-2.5 w-2.5 mr-0.5" />Pipeline
            </span>
          )}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground ml-2">
            <span><Clock className="inline h-2.5 w-2.5 mr-0.5" />{formatDuration(elapsed)}</span>
            {isMulti ? (
              <span><Cpu className="inline h-2.5 w-2.5 mr-0.5" />{planTasks.length} tasks</span>
            ) : (
              <span><Activity className="inline h-2.5 w-2.5 mr-0.5" />{run.total_iterations} iter</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {run.connected_servers.length > 0 && (
            <div className="flex items-center gap-1">
              {run.connected_servers.map((s) => (
                <Link key={s.server_id} to={`/servers/${s.server_id}/terminal`}>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/80 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer">
                    <Terminal className="inline h-2.5 w-2.5 mr-0.5" />{s.server_name}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {isActive && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs px-3 gap-1.5"
              onClick={onStop}
              disabled={stopping}
            >
              {stopping ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
              {t("agent.stop")}
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border bg-card/50 shrink-0 px-4">
        {isMulti && (
          <button
            onClick={() => setActiveTab("pipeline")}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === "pipeline" ? "border-violet-400 text-violet-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Layers className="inline h-3 w-3 mr-1" />
            Pipeline
            {(isActive || isPlanReview) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
          </button>
        )}
        <button
          onClick={() => setActiveTab("report")}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === "report" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          <FileText className="inline h-3 w-3 mr-1" />
          {t("agent.report")}
          {hasReport && !isActive && <CheckCircle2 className="inline h-3 w-3 ml-1 text-green-400" />}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "pipeline" && isMulti ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/50 bg-secondary/10 shrink-0">
              <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                <span>{planTasks.filter(t => t.status === "done").length}/{planTasks.length} tasks done</span>
                {planTasks.some(t => t.status === "failed") && (
                  <span className="text-red-400">{planTasks.filter(t => t.status === "failed").length} failed</span>
                )}
              </div>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded h-3 w-3" />
                Auto-scroll
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isPlanReview && (
                <div className="mx-4 mt-3 mb-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-amber-300 mb-1">
                        Ожидание подтверждения плана
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Оркестратор составил план из {planTasks.length} задач. Проверьте задачи, при необходимости отредактируйте или удалите лишние — затем нажмите «Запустить выполнение».
                      </p>
                      {approveError && (
                        <p className="text-xs text-red-400 mb-2">{approveError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 bg-green-600 hover:bg-green-500 text-white"
                          onClick={onApprovePlan}
                          disabled={approving}
                        >
                          {approving ? (
                            <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Запускаю…</>
                          ) : (
                            <><CheckCircle2 className="h-3.5 w-3.5" />Запустить выполнение</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-red-500/40 text-red-400 hover:bg-red-500/10"
                          onClick={onStop}
                          disabled={stopping}
                        >
                          <Square className="h-3 w-3" />
                          Отменить
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <PipelineFlowView
                run={run}
                planTasks={planTasks}
                isActive={!!isActive || isPlanReview}
                pendingQuestion={run.pending_question}
                replyText={replyText}
                setReplyText={setReplyText}
                sending={sending}
                onReply={onReply}
                onTasksUpdated={(tasks) => {
                  setLocalPlanTasks(tasks);
                  queryClient.invalidateQueries({ queryKey: ["agent-run", rid] });
                  queryClient.invalidateQueries({ queryKey: ["agent-run-log", rid] });
                }}
              />
              <div ref={logEndRef} />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <ReportView run={run} t={t} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Edit Modal
// ---------------------------------------------------------------------------

type PlanTask = AgentRunDetail["plan_tasks"][number];

function TaskEditModal({
  task,
  runId,
  onClose,
  onSaved,
}: {
  task: PlanTask;
  runId: number;
  onClose: () => void;
  onSaved: (tasks: PlanTask[]) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const aiInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updatePipelineTask(runId, task.id, { action: "update", name, description });
      onSaved(res.plan_tasks);
      toast({ description: "Задача обновлена" });
      onClose();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        description: e instanceof Error ? e.message : "Ошибка сохранения",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await updatePipelineTask(runId, task.id, { action: "delete" });
      onSaved(res.plan_tasks);
      toast({ description: "Задача удалена" });
      onClose();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        description: e instanceof Error ? e.message : "Ошибка удаления",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleAiRefine = async () => {
    if (!aiMsg.trim()) return;
    setAiLoading(true);
    setAiError("");
    try {
      const res = await aiRefinePipelineTask(runId, task.id, aiMsg.trim());
      if (!res.success) {
        setAiError(res.error || "Ошибка ИИ");
        return;
      }
      setName(res.task.name);
      setDescription(res.task.description);
      setAiMsg("");
      onSaved(res.plan_tasks);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Ошибка ИИ");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/30">
          <Pencil className="h-4 w-4 text-violet-400 shrink-0" />
          <span className="text-sm font-semibold text-foreground flex-1">Редактировать задачу</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary/50 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Fields */}
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Название</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm bg-secondary/30 border-border"
              placeholder="Название задачи"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Описание</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-28 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-colors"
              placeholder="Опишите что нужно сделать..."
            />
          </div>
        </div>

        {/* AI Chat */}
        <div className="px-4 pb-4 space-y-2">
          <div className="border border-violet-500/20 rounded-xl bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-400 font-medium">
              <Sparkles className="h-3 w-3" /> ИИ-ассистент
            </div>
            <p className="text-[11px] text-muted-foreground">
              Напиши что изменить, и ИИ автоматически обновит название и описание задачи
            </p>
            {aiError && (
              <div className="text-[11px] text-red-400 bg-red-500/10 rounded px-2 py-1">{aiError}</div>
            )}
            <div className="flex gap-2">
              <Input
                ref={aiInputRef}
                value={aiMsg}
                onChange={(e) => setAiMsg(e.target.value)}
                placeholder="Напр: добавь проверку дискового пространства"
                className="h-8 text-xs bg-background/50 border-violet-500/20 flex-1"
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAiRefine()}
                disabled={aiLoading}
              />
              <Button
                size="sm"
                className="h-8 px-3 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                onClick={handleAiRefine}
                disabled={aiLoading || !aiMsg.trim()}
              >
                {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {aiLoading ? "Думает…" : "Изменить"}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/10">
          <Button
            size="sm"
            variant="destructive"
            className="h-8 px-3 gap-1.5 text-xs"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleting || saving}
          >
            {deleting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Удалить задачу
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="h-8 px-3 text-xs" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Сохранить
            </Button>
          </div>
        </div>
      </div>

      <ConfirmActionDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Удалить задачу"
        description={`Удалить задачу "${task.name}" из плана выполнения?`}
        confirmLabel="Удалить задачу"
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          void handleDelete();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Flow View (n8n-style vertical chain)
// ---------------------------------------------------------------------------

function PipelineFlowView({
  run,
  planTasks,
  isActive,
  pendingQuestion,
  replyText,
  setReplyText,
  sending,
  onReply,
  onTasksUpdated,
}: {
  run: AgentRunDetail;
  planTasks: PlanTask[];
  isActive: boolean;
  pendingQuestion: string;
  replyText: string;
  setReplyText: (v: string) => void;
  sending: boolean;
  onReply: () => void;
  onTasksUpdated?: (tasks: PlanTask[]) => void;
}) {
  const goal = run.agent_name;
  const isCompleted = run.status === "completed";
  const isFailed = run.status === "failed";
  const [editingTask, setEditingTask] = useState<PlanTask | null>(null);

  const canEdit = planTasks.some(t => t.status === "pending");

  return (
    <div className="p-6 max-w-2xl mx-auto">

      {/* Task edit modal */}
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          runId={run.id}
          onClose={() => setEditingTask(null)}
          onSaved={(tasks) => {
            setEditingTask(null);
            onTasksUpdated?.(tasks);
          }}
        />
      )}

      {/* Goal node */}
      <FlowNode
        icon={<Target className="h-4 w-4 text-blue-400" />}
        label="Цель"
        title={run.agent_name}
        color="blue"
        status="done"
      >
        <p className="text-xs text-muted-foreground mt-1">
          {(run as { goal?: string }).goal || goal}
        </p>
      </FlowNode>

      <FlowConnector />

      {/* Planning node */}
      <FlowNode
        icon={<Brain className="h-4 w-4 text-violet-400" />}
        label="Оркестратор"
        title="Планирование"
        color="violet"
        status={planTasks.length > 0 ? "done" : isActive ? "running" : "pending"}
      >
        {planTasks.length > 0 ? (
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              Создан план из {planTasks.length} задач
            </p>
            {canEdit && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-medium">
                <Pencil className="inline h-2 w-2 mr-0.5" />кликни задачу для редактирования
              </span>
            )}
          </div>
        ) : isActive ? (
          <p className="text-xs text-violet-400/70 animate-pulse mt-1">Разбиваю цель на задачи…</p>
        ) : null}
      </FlowNode>

      {/* Task nodes */}
      {planTasks.map((task, idx) => (
        <div key={task.id}>
          <FlowConnector active={task.status === "running"} />
          <TaskNode
            task={task}
            index={idx}
            onEdit={task.status === "pending" || task.status === "failed" || task.status === "skipped"
              ? () => setEditingTask(task)
              : undefined}
          />
          {task.orchestrator_decision && task.status !== "done" && (
            <>
              <FlowConnector thin />
              <OrchestratorDecisionNode decision={task.orchestrator_decision} taskName={task.name} />
            </>
          )}
        </div>
      ))}

      {/* Final report node */}
      {(isCompleted || isFailed || run.final_report) && (
        <>
          <FlowConnector />
          <FlowNode
            icon={<FileText className="h-4 w-4 text-green-400" />}
            label="Синтез"
            title="Финальный отчёт"
            color="green"
            status={run.final_report ? "done" : isActive ? "running" : "pending"}
          >
            {run.final_report && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{run.final_report.slice(0, 150)}…</p>
            )}
          </FlowNode>
        </>
      )}

      {/* Thinking indicator */}
      {isActive && planTasks.length > 0 && !planTasks.some(t => t.status === "running") && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse py-4 pl-6">
          <Brain className="h-3.5 w-3.5 text-violet-400" />
          <span>Оркестратор анализирует результаты…</span>
        </div>
      )}

      {/* Pending question */}
      {pendingQuestion && (
        <div className="mt-4 border border-orange-500/20 bg-orange-500/5 rounded-lg px-4 py-3">
          <div className="flex items-start gap-2 mb-2">
            <MessageSquare className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">{pendingQuestion}</p>
          </div>
          <div className="flex gap-2">
            <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Ваш ответ…" className="h-8 text-xs bg-background" onKeyDown={(e) => e.key === "Enter" && onReply()} />
            <Button size="sm" className="h-8 px-3 gap-1" onClick={onReply} disabled={sending}><Send className="h-3 w-3" /></Button>
          </div>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Node
// ---------------------------------------------------------------------------

function TaskNode({ task, index, onEdit }: { task: PlanTask; index: number; onEdit?: () => void }) {
  const [expanded, setExpanded] = useState(task.status === "running" || task.status === "done");

  useEffect(() => {
    if (task.status === "running") setExpanded(true);
  }, [task.status]);

  const statusConfig = {
    pending: { icon: <Clock className="h-4 w-4 text-muted-foreground" />, color: "gray" as const, label: "В очереди" },
    running: { icon: <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />, color: "blue" as const, label: "Выполняется" },
    done: { icon: <CheckCircle2 className="h-4 w-4 text-green-400" />, color: "green" as const, label: "Готово" },
    failed: { icon: <XCircle className="h-4 w-4 text-red-400" />, color: "red" as const, label: "Ошибка" },
    skipped: { icon: <SkipForward className="h-4 w-4 text-yellow-400" />, color: "yellow" as const, label: "Пропущено" },
  };

  const cfg = statusConfig[task.status] || statusConfig.pending;

  return (
    <FlowNode
      icon={cfg.icon}
      label={`Задача ${index + 1}`}
      title={task.name}
      color={cfg.color}
      status={task.status as "pending" | "running" | "done" | "failed" | "skipped"}
      expandable
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      badge={cfg.label}
      onEdit={onEdit}
    >
      {expanded && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">{task.description}</p>

          {/* Live thought */}
          {task.thought && task.status === "running" && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded px-2.5 py-2">
              <div className="text-[9px] text-purple-400 mb-1 flex items-center gap-1">
                <Brain className="h-2.5 w-2.5" /> МЫШЛЕНИЕ
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">{task.thought}</p>
            </div>
          )}

          {/* Iterations */}
          {task.iterations && task.iterations.length > 0 && (
            <TaskIterations iterations={task.iterations} />
          )}

          {/* Result */}
          {task.result && (
            <div className="bg-green-500/5 border border-green-500/20 rounded px-2.5 py-2">
              <div className="text-[9px] text-green-400 mb-1 flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> РЕЗУЛЬТАТ
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{task.result}</p>
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div className="bg-red-500/5 border border-red-500/20 rounded px-2.5 py-2">
              <div className="text-[9px] text-red-400 mb-1 flex items-center gap-1">
                <XCircle className="h-2.5 w-2.5" /> ОШИБКА
              </div>
              <p className="text-xs text-red-400/80 font-mono">{task.error}</p>
            </div>
          )}
        </div>
      )}
    </FlowNode>
  );
}

// ---------------------------------------------------------------------------
// Task Iterations (collapsed sub-steps inside a task node)
// ---------------------------------------------------------------------------

function TaskIterations({ iterations }: { iterations: PlanTask["iterations"] }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <button
        onClick={() => setShow(!show)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {iterations.length} шаг{iterations.length > 1 && iterations.length < 5 ? "а" : "ов"} выполнения
      </button>
      {show && (
        <div className="mt-2 space-y-1.5 pl-2 border-l border-border/40">
          {iterations.map((it, i) => (
            <div key={i} className="text-[11px]">
              <div className="flex items-center gap-1.5 text-muted-foreground/70">
                <span className="font-mono text-[9px]">#{it.iteration}</span>
                {it.action && <span className="px-1 rounded bg-blue-500/10 text-blue-400 font-mono">{it.action}</span>}
              </div>
              {it.thought && <p className="text-foreground/70 mt-0.5 pl-4">{it.thought.slice(0, 200)}</p>}
              {it.observation && (
                <pre className="text-[10px] text-muted-foreground pl-4 mt-0.5 font-mono whitespace-pre-wrap bg-secondary/10 rounded px-2 py-1 max-h-24 overflow-y-auto">
                  {it.observation.slice(0, 500)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator Decision Node
// ---------------------------------------------------------------------------

function OrchestratorDecisionNode({ decision, taskName }: { decision: { action: string; reason?: string; message?: string }; taskName: string }) {
  const decisionConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    retry: { icon: <RotateCcw className="h-3 w-3 text-yellow-400" />, label: "Повтор", color: "text-yellow-400" },
    skip: { icon: <SkipForward className="h-3 w-3 text-gray-400" />, label: "Пропустить", color: "text-gray-400" },
    ask_user: { icon: <HelpCircle className="h-3 w-3 text-orange-400" />, label: "Спросить пользователя", color: "text-orange-400" },
    abort: { icon: <XCircle className="h-3 w-3 text-red-400" />, label: "Прервать пайплайн", color: "text-red-400" },
  };
  const cfg = decisionConfig[decision.action] || decisionConfig.skip;

  return (
    <div className="ml-6 px-3 py-2 rounded-lg border border-dashed border-orange-500/30 bg-orange-500/5 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Brain className="h-3 w-3 text-violet-400" />
        <span className="text-[9px] uppercase text-violet-400">Решение оркестратора</span>
      </div>
      <div className={`flex items-center gap-1 mt-1 font-medium ${cfg.color}`}>
        {cfg.icon} {cfg.label}
      </div>
      {(decision.reason || decision.message) && (
        <p className="text-muted-foreground mt-1 text-[11px]">{decision.reason || decision.message}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic flow node
// ---------------------------------------------------------------------------

type FlowColor = "blue" | "green" | "violet" | "red" | "yellow" | "gray";

const colorMap: Record<FlowColor, { border: string; bg: string; label: string; ring: string }> = {
  blue: { border: "border-blue-500/40", bg: "bg-blue-500/5", label: "text-blue-400", ring: "ring-blue-500/30" },
  green: { border: "border-green-500/40", bg: "bg-green-500/5", label: "text-green-400", ring: "ring-green-500/30" },
  violet: { border: "border-violet-500/40", bg: "bg-violet-500/5", label: "text-violet-400", ring: "ring-violet-500/30" },
  red: { border: "border-red-500/40", bg: "bg-red-500/5", label: "text-red-400", ring: "ring-red-500/30" },
  yellow: { border: "border-yellow-500/40", bg: "bg-yellow-500/5", label: "text-yellow-400", ring: "ring-yellow-500/30" },
  gray: { border: "border-border/40", bg: "bg-secondary/10", label: "text-muted-foreground", ring: "ring-border/30" },
};

function FlowNode({
  icon,
  label,
  title,
  color,
  status,
  expandable,
  expanded,
  onToggle,
  badge,
  onEdit,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  color: FlowColor;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  badge?: string;
  onEdit?: () => void;
  children?: React.ReactNode;
}) {
  const c = colorMap[color];
  const isRunning = status === "running";

  return (
    <div
      className={`rounded-xl border ${c.border} ${c.bg} px-4 py-3 transition-all ${isRunning ? `ring-2 ${c.ring} shadow-lg` : ""} ${onEdit ? "group" : ""}`}
    >
      <div
        className={`flex items-center gap-2 ${expandable ? "cursor-pointer select-none" : ""}`}
        onClick={expandable ? onToggle : undefined}
      >
        <div className={`flex-shrink-0 ${isRunning ? "animate-pulse" : ""}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className={`text-[9px] uppercase tracking-wider font-medium ${c.label}`}>{label}</div>
          <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        </div>
        {badge && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${c.bg} ${c.label} border ${c.border}`}>
            {badge}
          </span>
        )}
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-violet-500/20 hover:text-violet-400 shrink-0"
            title="Редактировать задачу"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {expandable && (
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector line between nodes
// ---------------------------------------------------------------------------

function FlowConnector({ active, thin }: { active?: boolean; thin?: boolean }) {
  return (
    <div className="flex justify-start pl-7 py-0.5">
      <div
        className={`w-0.5 ${thin ? "h-4" : "h-6"} ${active ? "bg-blue-400 animate-pulse" : "bg-border/40"} rounded-full`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; pulse?: boolean }> = {
    running: { bg: "bg-blue-500/20", text: "text-blue-400", pulse: true },
    paused: { bg: "bg-yellow-500/20", text: "text-yellow-400" },
    waiting: { bg: "bg-orange-500/20", text: "text-orange-400", pulse: true },
    plan_review: { bg: "bg-amber-500/20", text: "text-amber-400", pulse: true },
    pending: { bg: "bg-secondary", text: "text-muted-foreground" },
    completed: { bg: "bg-green-500/20", text: "text-green-400" },
    failed: { bg: "bg-red-500/20", text: "text-red-400" },
    stopped: { bg: "bg-secondary", text: "text-muted-foreground" },
  };
  const c = config[status] || config.pending;
  const label = status === "plan_review" ? "review" : status;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${c.bg} ${c.text} ${c.pulse ? "animate-pulse" : ""}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Report view — full-width, no max-w constraint
// ---------------------------------------------------------------------------

function ReportView({ run, t }: {
  run: AgentRunDetail;
  t: (key: string) => string;
}) {
  const report = run.final_report || run.ai_analysis;
  const isComplete = run.status === "completed";
  const isFailed = run.status === "failed";

  return (
    <div className="min-h-full py-10 px-8 max-w-[780px] mx-auto font-sans">

      {/* Header */}
      <div className="text-center mb-10">
        <div className={`inline-flex items-center justify-center h-11 w-11 rounded-full mb-4 ${isComplete ? "bg-green-500/10" : isFailed ? "bg-red-500/10" : "bg-secondary/30"}`}>
          {isComplete ? <CheckCircle2 className="h-5 w-5 text-green-400" /> : isFailed ? <AlertTriangle className="h-5 w-5 text-red-400" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">{run.agent_name}</h2>
        <StatusBadge status={run.status} />
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <MetaCard icon={<Clock className="h-3.5 w-3.5" />} label={t("agent.duration")} value={formatDuration(run.duration_ms)} />
        <MetaCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label={run.agent_mode === "multi" ? "Tasks" : t("agent.iterations")}
          value={run.agent_mode === "multi" ? String(run.plan_tasks?.length || 0) : String(run.total_iterations)}
        />
        <MetaCard
          icon={<Terminal className="h-3.5 w-3.5" />}
          label="Servers"
          value={run.connected_servers.length > 0 ? run.connected_servers.map(s => s.server_name).join(", ") : run.server_name}
        />
        <MetaCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label={isComplete ? t("agent.completed_at") : t("agent.failed_at")}
          value={run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}
        />
      </div>

      {/* Console output (mini mode) */}
      {run.agent_mode === "mini" && run.commands_output.length > 0 && (
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Console Output</p>
          <div className="space-y-2">
            {run.commands_output.map((cmd, i) => (
              <div key={i} className="bg-[#0d1117] rounded-lg overflow-hidden border border-border/30">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-border/20">
                  <span className="text-green-400 font-mono text-[10px]">$</span>
                  <span className="font-mono text-xs text-foreground flex-1">{cmd.cmd}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${cmd.exit_code === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>exit {cmd.exit_code}</span>
                  <span className="text-[9px] text-muted-foreground">{cmd.duration_ms}ms</span>
                </div>
                {cmd.stdout && <pre className="px-4 py-3 text-[11px] text-foreground/75 font-mono whitespace-pre-wrap overflow-x-auto max-h-52">{cmd.stdout.slice(0, 4000)}</pre>}
                {cmd.stderr && <pre className="px-4 py-3 text-[11px] text-red-400/70 font-mono whitespace-pre-wrap border-t border-red-500/10">{cmd.stderr.slice(0, 800)}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report text */}
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
            [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-5 [&_blockquote]:py-2 [&_blockquote]:my-5 [&_blockquote]:text-[15px] [&_blockquote]:text-foreground/70 [&_blockquote]:italic [&_blockquote]:bg-secondary/10 [&_blockquote]:rounded-r-lg [&_blockquote]:not-italic
            [&_code]:text-[13px] [&_code]:font-mono [&_code]:bg-secondary/40 [&_code]:text-foreground/85 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:not-italic
            [&_pre]:bg-secondary/20 [&_pre]:border [&_pre]:border-border/30 [&_pre]:rounded-xl [&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:font-mono [&_pre]:text-foreground/75 [&_pre]:my-5 [&_pre]:leading-relaxed
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
          <FileText className="h-8 w-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">
            {["running", "pending"].includes(run.status) ? "Отчёт появится после завершения агента." : "Отчёт недоступен."}
          </p>
        </div>
      )}

      <div className="h-12" />
    </div>
  );
}

function MetaCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2">
      <div className="flex items-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs font-medium text-foreground truncate">{value}</p>
    </div>
  );
}
