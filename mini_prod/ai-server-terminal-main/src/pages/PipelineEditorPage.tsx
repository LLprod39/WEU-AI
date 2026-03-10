import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeMouseHandler,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Save,
  Play,
  ArrowLeft,
  ChevronRight,
  X,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Square,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Copy,
  Search,
  Sparkles,
  Bot,
  Wand2,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  studioPipelines,
  studioAgents,
  studioServers,
  studioRuns,
  studioMCP,
  studioSkills,
  fetchModels,
  refreshModels,
  type MCPServerInspection,
  type PipelineNode,
  type PipelineEdge,
  type PipelineRun,
  type PipelineTrigger,
  type StudioPipelineGraphPatch,
} from "@/lib/api";
import {
  TriggerNode,
  AgentNode,
  SSHCommandNode,
  ConditionNode,
  ParallelNode,
  OutputNode,
  LLMQueryNode,
  MCPCallNode,
  EmailNode,
  WaitNode,
  HumanApprovalNode,
  TelegramNode,
  NODE_PALETTE,
  type NodeType,
} from "@/components/pipeline/nodes";
import {
  getNodeCategoryLabel,
  getNodePaletteText,
  getNodeTypeGuidance,
  getNodeTypeInfo,
  localize,
  type PipelineEditorLang,
} from "@/components/pipeline/nodes/nodeMeta";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// React Flow node type map
// ---------------------------------------------------------------------------
const nodeTypes = {
  "trigger/manual": TriggerNode,
  "trigger/webhook": TriggerNode,
  "trigger/schedule": TriggerNode,
  "agent/react": AgentNode,
  "agent/multi": AgentNode,
  "agent/ssh_cmd": SSHCommandNode,
  "agent/llm_query": LLMQueryNode,
  "agent/mcp_call": MCPCallNode,
  "logic/condition": ConditionNode,
  "logic/parallel": ParallelNode,
  "logic/wait": WaitNode,
  "logic/human_approval": HumanApprovalNode,
  "output/report": OutputNode,
  "output/webhook": OutputNode,
  "output/email": EmailNode,
  "output/telegram": TelegramNode,
};

// ---------------------------------------------------------------------------
// Run Monitor Panel
// ---------------------------------------------------------------------------
const NODE_STATUS_ICON: Record<string, React.ReactNode> = {
  running:            <Loader2      className="h-3 w-3 animate-spin text-blue-400" />,
  awaiting_approval:  <Clock        className="h-3 w-3 text-yellow-400 animate-pulse" />,
  completed:          <CheckCircle2 className="h-3 w-3 text-green-400" />,
  failed:             <XCircle      className="h-3 w-3 text-red-400" />,
  pending:            <Clock        className="h-3 w-3 text-muted-foreground" />,
  skipped:            <ChevronRight className="h-3 w-3 text-muted-foreground" />,
};

function RunMonitorPanel({
  runId,
  onClose,
}: {
  runId: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { lang } = useI18n();
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  const { data: run } = useQuery({
    queryKey: ["studio", "run", runId],
    queryFn: () => studioRuns.get(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const stopMutation = useMutation({
    mutationFn: () => studioRuns.stop(runId),
  });

  const isActive = run?.status === "running" || run?.status === "pending";

  const statusColor: Record<string, string> = {
    completed: "text-green-400",
    failed:    "text-red-400",
    running:   "text-blue-400",
    pending:   "text-muted-foreground",
    stopped:   "text-yellow-400",
  };

  const nodeStates: Record<string, Record<string, unknown>> = (run?.node_states as Record<string, Record<string, unknown>>) || {};

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {isActive
            ? <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            : run?.status === "completed"
              ? <CheckCircle2 className="h-4 w-4 text-green-400" />
              : run?.status === "failed"
                ? <XCircle className="h-4 w-4 text-red-400" />
                : <Clock className="h-4 w-4 text-muted-foreground" />
          }
          <span className="text-sm font-semibold">{localize(lang, `Запуск #${runId}`, `Run #${runId}`)}</span>
          <span className={`text-xs font-medium ${statusColor[run?.status || ""] || ""}`}>
            {formatRunStatus(run?.status, lang)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <button
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="h-3 w-3" /> {localize(lang, "Остановить", "Stop")}
            </button>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/40"
            onClick={() => navigate("/studio/runs")}
            title={localize(lang, "Все логи", "All logs")}
          >
            <ChevronRight className="h-3 w-3" /> {localize(lang, "Логи", "Logs")}
          </button>
          <button className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-3 space-y-2 text-xs">
        {/* Error banner */}
        {run?.error && (
          <div className="rounded bg-red-900/20 border border-red-500/30 px-3 py-2 text-red-300">
            <strong>{localize(lang, "Ошибка", "Error")}:</strong> {run.error}
          </div>
        )}

        {/* Summary */}
        {run?.summary && (
          <div className="rounded bg-muted/30 border border-border px-3 py-2 text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">
            {run.summary}
          </div>
        )}

        {/* Node states */}
        {run?.nodes_snapshot && (run.nodes_snapshot as PipelineNode[]).filter((n) => !n.type?.startsWith("trigger/")).map((node) => {
          const state = nodeStates[node.id] || {};
          const status = (state.status as string) || "pending";
          const output = (state.output as string) || "";
          const error = (state.error as string) || "";
          const isExpanded = expandedNode === node.id;
          const hasContent = output || error;

          return (
            <div key={node.id} className="rounded border border-border bg-card/50">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                onClick={() => hasContent && setExpandedNode(isExpanded ? null : node.id)}
              >
                <span className="shrink-0">{NODE_STATUS_ICON[status] || NODE_STATUS_ICON.pending}</span>
                <span className="flex-1 truncate font-medium">{(node.data?.label as string) || node.id}</span>
                <span className="text-muted-foreground text-[10px] shrink-0">{node.type}</span>
                {hasContent && (
                  isExpanded
                    ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
              </button>

              {/* Human Approval waiting state — always show links */}
              {status === "awaiting_approval" && (
                <div className="border-t border-border px-3 py-2 space-y-2">
                  <p className="text-yellow-400 text-[11px] font-medium">⏳ {localize(lang, "Ожидается ваше решение...", "Waiting for your decision...")}</p>
                  {(state.approve_url as string) && (
                    <div className="flex gap-2">
                      <a
                        href={state.approve_url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center text-xs py-1.5 rounded bg-green-800/40 border border-green-600/40 text-green-300 hover:bg-green-700/50 transition-colors"
                      >
                        ✅ {localize(lang, "Подтвердить", "Approve")}
                      </a>
                      <a
                        href={state.reject_url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center text-xs py-1.5 rounded bg-red-900/30 border border-red-600/40 text-red-300 hover:bg-red-800/40 transition-colors"
                      >
                        ❌ {localize(lang, "Отклонить", "Reject")}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {isExpanded && hasContent && status !== "awaiting_approval" && (
                <div className="border-t border-border px-3 py-2 space-y-1">
                  {error && (
                    <div className="text-red-300 bg-red-900/20 rounded px-2 py-1">{error}</div>
                  )}
                  {output && (
                    <pre className="text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-auto leading-relaxed">
                      {output.length > 2000 ? output.slice(0, 2000) + "\n…[truncated]" : output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!run && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> {localize(lang, "Загрузка…", "Loading…")}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node config panel
// ---------------------------------------------------------------------------
const AGENT_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "grok", label: "Grok" },
  { value: "claude", label: "Claude" },
] as const;

const DIRECT_LLM_PROVIDERS = AGENT_PROVIDER_OPTIONS.filter((item) => item.value !== "auto");

const CRON_PRESETS = [
  { label: { ru: "Каждые 5 минут", en: "Every 5 min" }, value: "*/5 * * * *" },
  { label: { ru: "Каждый час", en: "Hourly" }, value: "0 * * * *" },
  { label: { ru: "Ежедневно в 04:00", en: "Daily 04:00" }, value: "0 4 * * *" },
] as const;

function toJsonEditorText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "{}";
  const entries = Object.keys(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  return JSON.stringify(value, null, 2);
}

function parseJsonObjectText(text: string): { value: Record<string, unknown> | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: {}, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "JSON must be an object" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

function formatJsonParseError(error: string | null, lang: PipelineEditorLang) {
  if (!error) return null;
  if (error === "JSON must be an object") return localize(lang, "JSON должен быть объектом", "JSON must be an object");
  if (error === "Invalid JSON") return localize(lang, "Некорректный JSON", "Invalid JSON");
  return error;
}

function assignNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;

  let cursor: Record<string, unknown> = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }

    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  });
}

function buildWebhookSamplePayload(mapping: Record<string, unknown>) {
  const sample: Record<string, unknown> = {};
  const entries = Object.entries(mapping || {});
  if (!entries.length) {
    return {
      event: "pipeline.triggered",
      source: "studio",
      payload: {
        example: true,
      },
    };
  }

  entries.forEach(([contextKey, payloadPath]) => {
    if (typeof payloadPath !== "string" || !payloadPath.trim()) return;
    assignNestedValue(sample, payloadPath.trim(), `<${contextKey}>`);
  });

  return sample;
}

function buildWebhookCurlExample(url: string, mapping: Record<string, unknown>) {
  const payload = JSON.stringify(buildWebhookSamplePayload(mapping), null, 2);
  return `curl -X POST "${url}" -H "Content-Type: application/json" -d '${payload}'`;
}

function describeCronExpression(expression: string, lang: PipelineEditorLang) {
  const trimmed = expression.trim();
  if (!trimmed) {
    return {
      tone: "muted" as const,
      message: localize(lang, "Добавьте cron-выражение из 5 полей, чтобы включить расписание.", "Add a 5-field cron expression to enable this schedule."),
    };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    return {
      tone: "error" as const,
      message: localize(lang, "Cron должен содержать 5 полей: минута, час, день, месяц, день недели.", "Cron must contain 5 fields: minute hour day month weekday."),
    };
  }
  return {
    tone: "ok" as const,
    message: localize(lang, "Формат выглядит корректно. Studio ещё раз проверит cron при сохранении.", "Format looks valid. Studio validates the cron expression again on save."),
  };
}

function buildSchemaTemplate(inputSchema?: Record<string, unknown>) {
  const properties = (inputSchema?.properties as Record<string, Record<string, unknown>> | undefined) || {};
  const next: Record<string, unknown> = {};
  Object.entries(properties).forEach(([key, property]) => {
    const type = property?.type;
    if (type === "boolean") next[key] = false;
    else if (type === "number" || type === "integer") next[key] = 0;
    else if (type === "array") next[key] = [];
    else if (type === "object") next[key] = {};
    else next[key] = `{${key}}`;
  });
  return next;
}

function formatStudioDateTime(value: string | null | undefined, lang: PipelineEditorLang) {
  if (!value) return localize(lang, "Никогда", "Never");
  return new Date(value).toLocaleString();
}

function ConfigSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-background/24 px-4 py-4">
      <div className="mb-3 space-y-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {description && <p className="text-[11px] leading-5 text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function formatRunStatus(status: string | undefined, lang: PipelineEditorLang) {
  if (!status) return localize(lang, "загрузка...", "loading...");
  const mapping: Record<string, { ru: string; en: string }> = {
    pending: { ru: "в очереди", en: "pending" },
    running: { ru: "выполняется", en: "running" },
    completed: { ru: "завершён", en: "completed" },
    failed: { ru: "ошибка", en: "failed" },
    stopped: { ru: "остановлен", en: "stopped" },
    awaiting_approval: { ru: "ожидает подтверждения", en: "awaiting approval" },
    skipped: { ru: "пропущен", en: "skipped" },
  };
  return mapping[status]?.[lang] || status;
}

function buildNodeSetupState(
  type: NodeType,
  data: Record<string, unknown>,
  opts: {
    pipelineId: number | null;
    triggerWebhookUrl: string;
    selectedAgentName?: string;
    selectedSkillsCount: number;
    selectedServersCount: number;
    selectedMcpName?: string | null;
    selectedToolName?: string | null;
    cronIsValid: boolean;
    mcpArgsError: string | null;
    webhookError: string | null;
  },
  lang: PipelineEditorLang,
) {
  const issues: string[] = [];
  const highlights: string[] = [];

  if (data.label) highlights.push(String(data.label));

  switch (type) {
    case "trigger/manual":
      highlights.push(localize(lang, "Запуск из панели", "Toolbar run"));
      break;
    case "trigger/webhook":
      if (!opts.pipelineId || !opts.triggerWebhookUrl) issues.push(localize(lang, "Сохраните пайплайн, чтобы получить webhook URL.", "Save the pipeline to generate the webhook URL."));
      if (opts.webhookError) issues.push(localize(lang, "Исправьте JSON-сопоставление webhook payload.", "Fix the webhook payload mapping JSON."));
      highlights.push(opts.triggerWebhookUrl ? localize(lang, "URL готов", "URL ready") : localize(lang, "URL ещё не создан", "Unsaved URL"));
      break;
    case "trigger/schedule":
      if (!String(data.cron_expression || "").trim()) issues.push(localize(lang, "Добавьте cron-выражение.", "Add a cron expression."));
      else if (!opts.cronIsValid) issues.push(localize(lang, "Исправьте формат cron-выражения.", "Fix the cron expression format."));
      highlights.push(String(data.cron_expression || "").trim() || localize(lang, "Cron не задан", "No cron"));
      break;
    case "agent/react":
    case "agent/multi":
      if (!String(data.goal || "").trim()) issues.push(localize(lang, "Опишите цель агента.", "Describe the agent goal."));
      if (!data.agent_config_id && !opts.selectedServersCount && !opts.selectedMcpName && !opts.selectedSkillsCount) {
        issues.push(localize(lang, "Подключите хотя бы одну цель выполнения: сервер, MCP или skill.", "Attach at least one execution target: server, MCP, or skill."));
      }
      highlights.push(
        data.agent_config_id
          ? localize(lang, `Сохранённый агент: ${opts.selectedAgentName || data.agent_config_id}`, `Saved agent: ${opts.selectedAgentName || data.agent_config_id}`)
          : localize(lang, "Встроенная настройка", "Inline agent"),
      );
      if (opts.selectedServersCount) highlights.push(localize(lang, `${opts.selectedServersCount} сервер(а)`, `${opts.selectedServersCount} server${opts.selectedServersCount > 1 ? "s" : ""}`));
      if (opts.selectedSkillsCount) highlights.push(localize(lang, `${opts.selectedSkillsCount} skill(ов)`, `${opts.selectedSkillsCount} skill${opts.selectedSkillsCount > 1 ? "s" : ""}`));
      break;
    case "agent/ssh_cmd":
      if (!data.server_id) issues.push(localize(lang, "Выберите целевой сервер.", "Select the target server."));
      if (!String(data.command || "").trim()) issues.push(localize(lang, "Укажите SSH-команду.", "Provide the SSH command."));
      break;
    case "agent/llm_query":
      if (!String(data.prompt || "").trim()) issues.push(localize(lang, "Укажите prompt для LLM.", "Provide the LLM prompt."));
      highlights.push(String(data.provider || "gemini"));
      if (data.model) highlights.push(String(data.model));
      break;
    case "agent/mcp_call":
      if (!data.mcp_server_id) issues.push(localize(lang, "Выберите MCP-сервер.", "Select the MCP server."));
      if (!String(data.tool_name || "").trim()) issues.push(localize(lang, "Выберите MCP-инструмент.", "Select the MCP tool."));
      if (opts.mcpArgsError) issues.push(localize(lang, "Исправьте JSON аргументов MCP.", "Fix the MCP arguments JSON."));
      if (opts.selectedMcpName) highlights.push(opts.selectedMcpName);
      if (opts.selectedToolName) highlights.push(opts.selectedToolName);
      break;
    case "logic/condition":
      if (!String(data.source_node_id || "").trim()) issues.push(localize(lang, "Подключите или выберите исходную ноду для проверки.", "Connect or select the source node to evaluate."));
      highlights.push(String(data.check_type || "contains"));
      if (String(data.check_type || "contains").includes("contains") && !String(data.check_value || "").trim()) {
        issues.push(localize(lang, "Укажите значение для сравнения.", "Provide the value to compare against."));
      }
      break;
    case "logic/parallel":
      highlights.push(localize(lang, "Параллельное разветвление", "Parallel fan-out"));
      break;
    case "logic/wait":
      highlights.push(localize(lang, `${data.wait_minutes ?? 20} мин.`, `${data.wait_minutes ?? 20} min`));
      break;
    case "logic/human_approval":
      if (!String(data.base_url || "").trim()) issues.push(localize(lang, "Укажите base URL для approve/reject ссылок.", "Provide the base URL used in approval links."));
      highlights.push(localize(lang, `Таймаут ${data.timeout_minutes ?? 120} мин.`, `${data.timeout_minutes ?? 120} min timeout`));
      break;
    case "output/report":
      highlights.push(data.template ? localize(lang, "Свой шаблон", "Custom template") : localize(lang, "Автоотчёт", "Auto report"));
      break;
    case "output/webhook":
      if (!String(data.url || "").trim()) issues.push(localize(lang, "Укажите URL назначения для webhook.", "Provide the destination webhook URL."));
      highlights.push(String(data.url || "").trim() || localize(lang, "URL не задан", "No URL"));
      break;
    case "output/email":
      highlights.push(data.to_email ? localize(lang, "Явные получатели", "Explicit recipients") : localize(lang, "Настройки платформы", "Platform defaults"));
      break;
    case "output/telegram":
      highlights.push(data.chat_id ? localize(lang, "Явный чат", "Explicit chat") : localize(lang, "Настройки платформы", "Platform defaults"));
      break;
    default:
      break;
  }

  return {
    ready: issues.length === 0,
    issues,
    highlights: highlights.filter(Boolean),
  };
}

type LinkedNodeRef = {
  id: string;
  type: string;
  label: string;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  targetNodeId?: string | null;
  nodePatch?: Record<string, unknown>;
  graphPatch?: StudioPipelineGraphPatch;
  warnings?: string[];
};

function getNodeDisplayLabel(node: PipelineNode | LinkedNodeRef, lang: PipelineEditorLang) {
  if ("data" in node) {
    const label = typeof node.data?.label === "string" ? node.data.label.trim() : "";
    if (label) return label;
    return getNodeTypeInfo(node.type, lang).label || node.id;
  }
  return node.label || getNodeTypeInfo(node.type, lang).label || node.id;
}

function buildLinkedNodeRefs(nodeId: string, nodes: PipelineNode[], edges: PipelineEdge[], lang: PipelineEditorLang) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodeMap.get(edge.source))
    .filter((node): node is PipelineNode => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: getNodeDisplayLabel(node, lang),
    }));
  const outgoing = edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => nodeMap.get(edge.target))
    .filter((node): node is PipelineNode => Boolean(node))
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: getNodeDisplayLabel(node, lang),
    }));
  return { incoming, outgoing };
}

function buildDefaultNodeData(type: NodeType, lang: PipelineEditorLang) {
  switch (type) {
    case "trigger/manual":
      return { is_active: true };
    case "trigger/webhook":
      return { is_active: true, webhook_payload_map: {}, webhook_payload_map_text: "{}" };
    case "trigger/schedule":
      return { is_active: true, cron_expression: "*/5 * * * *" };
    case "agent/react":
    case "agent/multi":
      return { max_iterations: 6, on_failure: "abort" };
    case "agent/llm_query":
      return { provider: "gemini", on_failure: "abort" };
    case "agent/mcp_call":
      return { arguments: {}, arguments_text: "{}", on_failure: "abort" };
    case "logic/condition":
      return { check_type: "contains" };
    case "logic/wait":
      return { wait_minutes: 20 };
    case "logic/human_approval":
      return { timeout_minutes: 120 };
    case "output/email":
      return { subject: localize(lang, "Отчёт пайплайна: {pipeline_name}", "Pipeline Report: {pipeline_name}") };
    default:
      return {};
  }
}

function buildConnectionAutofillPatch(target: PipelineNode, source: PipelineNode, pipelineName: string, lang: PipelineEditorLang) {
  const data = (target.data || {}) as Record<string, unknown>;
  const outputToken = `{${source.id}_output}`;
  const sourceLabel = getNodeDisplayLabel(source, lang);
  const patch: Record<string, unknown> = {};

  if (target.type === "logic/condition") {
    if (!String(data.source_node_id || "").trim()) patch.source_node_id = source.id;
    if (!String(data.check_type || "").trim()) patch.check_type = "contains";
  }

  if (target.type === "agent/llm_query" && !String(data.prompt || "").trim()) {
    patch.prompt = localize(
      lang,
      `Проанализируй ${outputToken} от шага ${sourceLabel} и кратко опиши главный результат, риски и следующий рекомендуемый шаг.`,
      `Review ${outputToken} from ${sourceLabel} and explain the key result, risks, and recommended next action.`,
    );
  }

  if (target.type === "output/report" && !String(data.template || "").trim()) {
    patch.template = localize(
      lang,
      `# Отчёт по пайплайну ${pipelineName || "Pipeline"}\n\n## ${sourceLabel}\n\n${outputToken}`,
      `# ${pipelineName || "Pipeline"} report\n\n## ${sourceLabel}\n\n${outputToken}`,
    );
  }

  if (target.type === "output/email") {
    if (!String(data.subject || "").trim()) patch.subject = localize(lang, "Отчёт пайплайна: {pipeline_name}", "Pipeline Report: {pipeline_name}");
    if (!String(data.body || "").trim()) {
      patch.body = localize(
        lang,
        `# ${pipelineName || "Pipeline"}\n\n## ${sourceLabel}\n\n${outputToken}`,
        `# ${pipelineName || "Pipeline"}\n\n## ${sourceLabel}\n\n${outputToken}`,
      );
    }
  }

  if (target.type === "output/telegram" && !String(data.message || "").trim()) {
    patch.message = `*{pipeline_name}*\n\n## ${sourceLabel}\n\n${outputToken}`;
  }

  if (target.type === "logic/human_approval") {
    if (!String(data.message || "").trim()) {
      patch.message = localize(
        lang,
        `Требуется подтверждение для шага ${sourceLabel}\n\n${outputToken}\n\nПодтвердить: {approve_url}\nОтклонить: {reject_url}`,
        `Approval required for ${sourceLabel}\n\n${outputToken}\n\nApprove: {approve_url}\nReject: {reject_url}`,
      );
    }
    if (!String(data.email_body || "").trim()) {
      patch.email_body = localize(
        lang,
        `Требуется подтверждение для шага ${sourceLabel}\n\n${outputToken}\n\nПодтвердить: {approve_url}\nОтклонить: {reject_url}`,
        `Approval required for ${sourceLabel}\n\n${outputToken}\n\nApprove: {approve_url}\nReject: {reject_url}`,
      );
    }
  }

  return patch;
}

function buildResourceAutofillPatch(
  node: PipelineNode,
  resources: {
    incomingNodes: LinkedNodeRef[];
    servers: Array<{ id: number; name: string; host: string }>;
    mcps: Array<{ id: number; name: string }>;
    pipelineName: string;
    lang: PipelineEditorLang;
  },
) {
  const base = buildConnectionAutofillPatch(
    node,
    resources.incomingNodes.length
      ? ({
          id: resources.incomingNodes[0].id,
          type: resources.incomingNodes[0].type,
          position: { x: 0, y: 0 },
          data: { label: resources.incomingNodes[0].label },
        } as PipelineNode)
      : node,
    resources.pipelineName,
    resources.lang,
  );
  const patch: Record<string, unknown> = resources.incomingNodes.length ? { ...base } : {};
  const data = (node.data || {}) as Record<string, unknown>;

  if (node.type === "agent/ssh_cmd" && !data.server_id && resources.servers.length === 1) {
    patch.server_id = resources.servers[0].id;
  }

  if (node.type === "agent/mcp_call" && !data.mcp_server_id && resources.mcps.length === 1) {
    patch.mcp_server_id = resources.mcps[0].id;
    patch.mcp_server_name = resources.mcps[0].name;
    if (!("arguments" in patch)) patch.arguments = {};
    if (!("arguments_text" in patch)) patch.arguments_text = "{}";
  }

  return patch;
}

function buildTokenSuggestions(incomingNodes: LinkedNodeRef[], nodeId: string, lang: PipelineEditorLang) {
  const tokens = incomingNodes.flatMap((item) => [
    {
      key: `${item.id}-output`,
      label: localize(lang, `${item.label} -> вывод`, `${item.label} output`),
      token: `{${item.id}_output}`,
    },
    {
      key: `${item.id}-state`,
      label: localize(lang, `${item.label} -> результат`, `${item.label} result`),
      token: `{${item.id}}`,
    },
  ]);
  tokens.push({
    key: `${nodeId}-all`,
    label: localize(lang, "Все предыдущие выводы", "All previous outputs"),
    token: "{all_outputs}",
  });
  return tokens;
}

function normaliseAssistantPatch(
  patch: Record<string, unknown>,
  opts: {
    mcpList: Array<{ id: number; name: string }>;
  },
) {
  const next: Record<string, unknown> = { ...patch };

  if (typeof next.mcp_server_id === "string" && next.mcp_server_id.trim()) {
    const parsed = Number(next.mcp_server_id);
    if (!Number.isNaN(parsed)) next.mcp_server_id = parsed;
  }

  if (typeof next.agent_config_id === "string" && next.agent_config_id.trim()) {
    const parsed = Number(next.agent_config_id);
    if (!Number.isNaN(parsed)) next.agent_config_id = parsed;
  }

  if (Array.isArray(next.server_ids)) {
    next.server_ids = next.server_ids
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item));
  }

  if (typeof next.server_id === "string" && next.server_id.trim()) {
    const parsed = Number(next.server_id);
    if (!Number.isNaN(parsed)) next.server_id = parsed;
  }

  if (Array.isArray(next.skill_slugs)) {
    next.skill_slugs = next.skill_slugs.map((item) => String(item).trim()).filter(Boolean);
  }

  if (next.arguments && typeof next.arguments === "object" && !Array.isArray(next.arguments) && !next.arguments_text) {
    next.arguments_text = JSON.stringify(next.arguments, null, 2);
  }
  if (typeof next.arguments_text === "string" && !next.arguments && !parseJsonObjectText(next.arguments_text).error) {
    next.arguments = parseJsonObjectText(next.arguments_text).value || {};
  }

  if (
    next.webhook_payload_map &&
    typeof next.webhook_payload_map === "object" &&
    !Array.isArray(next.webhook_payload_map) &&
    !next.webhook_payload_map_text
  ) {
    next.webhook_payload_map_text = JSON.stringify(next.webhook_payload_map, null, 2);
  }
  if (typeof next.webhook_payload_map_text === "string" && !next.webhook_payload_map && !parseJsonObjectText(next.webhook_payload_map_text).error) {
    next.webhook_payload_map = parseJsonObjectText(next.webhook_payload_map_text).value || {};
  }

  if (typeof next.mcp_server_id === "number" && !next.mcp_server_name) {
    const match = opts.mcpList.find((item) => item.id === next.mcp_server_id);
    if (match) next.mcp_server_name = match.name;
  }

  return next;
}

function isNodeType(value: string): value is NodeType {
  return value in nodeTypes;
}

function describeGraphPatch(graphPatch: StudioPipelineGraphPatch | null | undefined, lang: PipelineEditorLang) {
  if (!graphPatch || (!graphPatch.nodes.length && !graphPatch.edges.length)) return null;
  const nodeLabels = graphPatch.nodes.map((item) => item.label || getNodeTypeInfo(item.type, lang).label || item.type);
  const edgeLabels = graphPatch.edges.map((item) => `${item.source} -> ${item.target}${item.label ? ` (${item.label})` : ""}`);
  return {
    nodeCount: graphPatch.nodes.length,
    edgeCount: graphPatch.edges.length,
    nodeLabels,
    edgeLabels,
  };
}

function PipelineCopilotDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  nodes,
  edges,
  selectedNode,
  onApplyPatch,
  onApplyGraphPatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: number | null;
  pipelineName: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  selectedNode: PipelineNode | null;
  onApplyPatch: (targetNodeId: string, patch: Record<string, unknown>) => void;
  onApplyGraphPatch: (graphPatch: StudioPipelineGraphPatch) => void;
}) {
  const { lang } = useI18n();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [generatorBrief, setGeneratorBrief] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const nonTriggerNodes = nodes.filter((item) => !item.type.startsWith("trigger/"));
  const triggerCount = nodes.filter((item) => item.type.startsWith("trigger/")).length;
  const outputCount = nodes.filter((item) => item.type.startsWith("output/")).length;

  useEffect(() => {
    if (!open) return;
    setDraft("");
    setGeneratorBrief("");
    setMessages([
      {
        id: `pipeline-copilot-intro-${pipelineId ?? "new"}`,
        role: "assistant",
        content: localize(
          lang,
          "Я анализирую весь граф пайплайна: триггеры, исполняющие ноды, выходы, связи, использование MCP и skills, а также слабые места перед запуском. Отсюда же могу предложить как точечный patch для конкретной ноды, так и целый кусок графа.",
          "I analyze the full pipeline graph: triggers, execution nodes, outputs, links, MCP/skills usage, and weak spots before launch. I can propose both a targeted patch for one node and a larger graph patch.",
        ),
      },
    ]);
  }, [lang, open, pipelineId]);

  const assistantMutation = useMutation({
    mutationFn: (message: string) =>
      studioPipelines.assistant({
        pipeline_id: pipelineId,
        pipeline_name: pipelineName || "Untitled",
        nodes,
        edges,
        selected_node: selectedNode,
        user_message: message,
      }),
    onSuccess: (result) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `pipeline-assistant-${Date.now()}`,
          role: "assistant",
          content: result.reply,
          targetNodeId: result.target_node_id,
          nodePatch: result.node_patch,
          graphPatch: result.graph_patch,
          warnings: result.warnings,
        },
      ]);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : localize(lang, "Не удалось получить ответ от ИИ-копайлота.", "AI copilot failed."),
      });
    },
  });

  const submitPrompt = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || assistantMutation.isPending) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `pipeline-user-${Date.now()}`,
        role: "user",
        content: trimmed,
      },
    ]);
    setDraft("");
    await assistantMutation.mutateAsync(trimmed);
  };

  const quickPrompts = [
    localize(lang, "Объясни, что делает этот пайплайн и как сейчас устроен граф.", "Explain what this pipeline does and how the graph is structured."),
    localize(lang, "Что в этом пайплайне ещё слабо или не готово к надёжному запуску?", "What still looks weak or not production-ready in this pipeline?"),
    localize(lang, "Подскажи, какие следующие ноды или изменения стоит добавить.", "Suggest the next nodes or changes that should be added."),
    localize(lang, "Сгенерируй стартовый graph patch для следующей части пайплайна.", "Generate a starter graph patch for the next part of the pipeline."),
  ];

  const handleGenerateFromBrief = async () => {
    const trimmed = generatorBrief.trim();
    if (!trimmed || assistantMutation.isPending) return;
    await submitPrompt(
      localize(
        lang,
        `Построй улучшение или стартовую схему пайплайна под такую задачу:\n\n${trimmed}\n\n` +
          "Если нужно, верни graph_patch с новыми нодами и связями. " +
          "Если уместно, укажи, к какой существующей ноде лучше привязать новую ветку.",
        `Build an improvement or starter pipeline layout for this task:\n\n${trimmed}\n\n` +
          "If needed, return graph_patch with new nodes and links. " +
          "If relevant, suggest which existing node should be the best anchor for a new branch.",
      )
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0">
        <div className="flex h-[min(84vh,900px)] min-h-0 flex-col overflow-hidden">
          <div className="border-b border-border bg-background px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">
                    {localize(lang, "AI помощник пайплайна", "Pipeline AI Assistant")}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{pipelineId ? localize(lang, `Пайплайн #${pipelineId}`, `Pipeline #${pipelineId}`) : localize(lang, "Несохранённый пайплайн", "Unsaved pipeline")}</span>
                </div>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Bot className="h-4 w-4 text-primary" />
                  {localize(lang, "ИИ-помощник для всего пайплайна", "AI assistant for the full pipeline")}
                </DialogTitle>
                <DialogDescription className="max-w-3xl text-sm leading-6">
                  {localize(
                    lang,
                    "Помощник проверяет структуру графа, триггеры, исполняющие шаги, выходы, использование MCP и skills, а также помогает строить новые ветки. Если у вас выбрана нода, он может дать и точечный patch для неё.",
                    "The assistant reviews graph structure, triggers, execution steps, outputs, MCP/skills usage, and helps design new branches. If a node is selected, it can return a focused patch for that node.",
                  )}
                </DialogDescription>
              </div>
              <Sparkles className="mt-1 h-5 w-5 shrink-0 text-primary/80" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/15 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Ноды", "Nodes")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{nodes.length}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/15 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Исполнение", "Execution")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{nonTriggerNodes.length}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/15 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Триггеры", "Triggers")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{triggerCount}</p>
              </div>
              <div className="rounded-md border border-border bg-muted/15 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Выходы", "Outputs")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{outputCount}</p>
              </div>
            </div>
            {selectedNode && (
              <div className="mt-4 rounded-md border border-primary/20 bg-primary/8 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Текущий фокус", "Current focus")}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{getNodeDisplayLabel(selectedNode, lang)}</p>
              </div>
            )}
            <div className="mt-4 rounded-md border border-border bg-muted/15 px-4 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">{localize(lang, "Генерация пайплайна по задаче", "Generate pipeline from a brief")}</p>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {localize(
                  lang,
                  "Кратко опишите задачу. AI-помощник предложит структуру и при необходимости подготовит graph patch для canvas.",
                  "Provide a short task brief. The AI assistant will propose a structure and can generate a graph patch for the canvas.",
                )}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <Textarea
                  value={generatorBrief}
                  onChange={(event) => setGeneratorBrief(event.target.value)}
                  rows={3}
                  placeholder={localize(
                    lang,
                    "Например: принять webhook из GitLab, проверить деплой через MCP, запросить подтверждение и отправить итог в Telegram.",
                    "Example: accept a GitLab webhook, verify deployment via MCP, request approval, then send summary to Telegram.",
                  )}
                  className="resize-none text-sm"
                />
                <Button type="button" className="h-full min-h-11 gap-2" disabled={!generatorBrief.trim() || assistantMutation.isPending} onClick={() => void handleGenerateFromBrief()}>
                  {assistantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {localize(lang, "Сформировать схему", "Generate layout")}
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 bg-muted/[0.08]">
            <div className="space-y-4 px-6 py-5">
              {messages.map((message) => {
                const isAssistant = message.role === "assistant";
                const hasPatch = Boolean(message.nodePatch && Object.keys(message.nodePatch).length && message.targetNodeId);
                const graphPatchSummary = describeGraphPatch(message.graphPatch, lang);
                return (
                  <div
                    key={message.id}
                    className={`rounded-md border px-4 py-4 ${
                      isAssistant ? "border-border bg-background/88" : "border-primary/25 bg-primary/8"
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant={isAssistant ? "outline" : "default"} className="rounded-full px-2.5 py-0.5 text-[10px]">
                        {isAssistant ? localize(lang, "ИИ", "AI") : localize(lang, "Вы", "You")}
                      </Badge>
                      {message.targetNodeId && (
                        <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">
                          {localize(lang, "Цель", "Target")}: {message.targetNodeId}
                        </Badge>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground/95">{message.content}</div>
                    {message.warnings && message.warnings.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {message.warnings.map((warning) => (
                          <p key={warning} className="text-xs leading-5 text-amber-300">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                    {hasPatch && (
                      <div className="mt-4 space-y-3">
                        <pre className="max-h-56 overflow-auto rounded-md border border-border/70 bg-muted/30 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                          {JSON.stringify(message.nodePatch, null, 2)}
                        </pre>
                        <Button type="button" className="h-9 gap-2" onClick={() => onApplyPatch(message.targetNodeId || "", message.nodePatch || {})}>
                          <Wand2 className="h-4 w-4" />
                          {localize(lang, "Применить к", "Apply to")} {message.targetNodeId}
                        </Button>
                      </div>
                    )}
                    {graphPatchSummary && (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-md border border-border/70 bg-muted/20 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">
                              {localize(lang, "Предпросмотр изменений", "Change preview")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {localize(
                                lang,
                                `${graphPatchSummary.nodeCount} нод, ${graphPatchSummary.edgeCount} связей`,
                                `${graphPatchSummary.nodeCount} nodes, ${graphPatchSummary.edgeCount} edges`,
                              )}
                            </span>
                          </div>
                          {graphPatchSummary.nodeLabels.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {graphPatchSummary.nodeLabels.map((label) => (
                                <Badge key={label} variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                                  {label}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {graphPatchSummary.edgeLabels.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {graphPatchSummary.edgeLabels.map((label) => (
                                <p key={label} className="text-[11px] leading-5 text-muted-foreground">
                                  {label}
                                </p>
                              ))}
                            </div>
                          )}
                          <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border/70 bg-background/75 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                            {JSON.stringify(message.graphPatch, null, 2)}
                          </pre>
                        </div>
                        <Button type="button" variant="outline" className="h-9 gap-2" onClick={() => onApplyGraphPatch(message.graphPatch || { anchor_node_id: null, nodes: [], edges: [] })}>
                          <Sparkles className="h-4 w-4" />
                          {localize(lang, "Применить изменения в граф", "Apply graph changes")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="border-t border-border bg-background px-6 py-5">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <Button key={prompt} type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-1.5 text-[11px]" onClick={() => void submitPrompt(prompt)}>
                  {prompt}
                </Button>
              ))}
            </div>
            <div className="space-y-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                placeholder={localize(
                  lang,
                  "Спросите про весь пайплайн: чего не хватает, как его перестроить, какие ноды добавить, где использовать MCP или skills, и как сделать всё безопаснее.",
                  "Ask about the full pipeline: what is missing, what to redesign, which nodes to add, where to use MCP or skills, and how to make it safer.",
                )}
                className="resize-none text-sm"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  {localize(
                    lang,
                    "Можно спрашивать широко: например, «собери правильный webhook в MCP flow» или «что здесь слабо перед продом».",
                    "You can ask broadly, for example: 'build a proper webhook MCP flow' or 'what is risky before production?'",
                  )}
                </p>
                <Button type="button" className="h-9 gap-2" disabled={!draft.trim() || assistantMutation.isPending} onClick={() => void submitPrompt(draft)}>
                  {assistantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {localize(lang, "Отправить запрос", "Send request")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NodeConfigPanel({
  node,
  pipelineId,
  pipelineName,
  trigger,
  nodes,
  edges,
  onUpdate,
  onClose,
  onDelete,
}: {
  node: PipelineNode;
  pipelineId: number | null;
  pipelineName: string;
  trigger?: PipelineTrigger | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: agents = [] } = useQuery({ queryKey: ["studio", "agents"], queryFn: studioAgents.list });
  const { data: servers = [] } = useQuery({ queryKey: ["studio", "servers"], queryFn: studioServers.list });
  const { data: mcpList = [] } = useQuery({ queryKey: ["studio", "mcp"], queryFn: studioMCP.list });
  const { data: skillList = [] } = useQuery({ queryKey: ["studio", "skills"], queryFn: studioSkills.list });
  const queryClient = useQueryClient();
  const { data: modelsData } = useQuery({ queryKey: ["api", "models"], queryFn: fetchModels });
  const [d, setD] = useState<Record<string, unknown>>(node.data || {});
  const [loadingModelsFor, setLoadingModelsFor] = useState<string | null>(null);
  const [webhookMapText, setWebhookMapText] = useState(
    () => (typeof node.data?.webhook_payload_map_text === "string" ? String(node.data.webhook_payload_map_text) : toJsonEditorText(node.data?.webhook_payload_map)),
  );
  const [mcpArgsText, setMcpArgsText] = useState(
    () => (typeof node.data?.arguments_text === "string" ? String(node.data.arguments_text) : toJsonEditorText(node.data?.arguments || {})),
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const autoAppliedSignatureRef = useRef("");

  const set = (key: string, val: unknown) => {
    const next = { ...d, [key]: val };
    setD(next);
    onUpdate(node.id, next);
  };

  const setMany = (patch: Record<string, unknown>) => {
    const next = { ...d, ...patch };
    setD(next);
    onUpdate(node.id, next);
  };

  const type = node.type as NodeType;
  const provider =
    type === "agent/llm_query"
      ? ((d.provider as string) || "gemini")
      : type === "agent/react" || type === "agent/multi"
        ? ((d.provider as string) || "auto")
        : "";
  const modelProvider = provider && provider !== "auto" ? provider : "";
  const modelList = (modelProvider && modelsData && (modelsData as Record<string, string[] | undefined>)[modelProvider]) ?? [];
  const selectedAgent = agents.find((agent) => String(agent.id) === String(d.agent_config_id || ""));
  const selectedMcpId = d.mcp_server_id ? Number(d.mcp_server_id) : null;
  const selectedMcp = mcpList.find((mcp) => mcp.id === selectedMcpId) || null;
  const selectedSkillSlugs = Array.isArray(d.skill_slugs) ? (d.skill_slugs as string[]) : [];
  const selectedSkills = skillList.filter((skill) => selectedSkillSlugs.includes(skill.slug));
  const webhookState = parseJsonObjectText(webhookMapText);
  const mcpArgsState = parseJsonObjectText(mcpArgsText);
  const cronHint = describeCronExpression(String(d.cron_expression || ""), lang);
  const triggerWebhookUrl = trigger?.webhook_url ? new URL(trigger.webhook_url, window.location.origin).toString() : "";
  const webhookPayloadMap =
    webhookState.value || ((d.webhook_payload_map && typeof d.webhook_payload_map === "object" && !Array.isArray(d.webhook_payload_map)) ? (d.webhook_payload_map as Record<string, unknown>) : {});
  const webhookCurlExample = triggerWebhookUrl ? buildWebhookCurlExample(triggerWebhookUrl, webhookPayloadMap) : "";

  useEffect(() => {
    setD(node.data || {});
    setWebhookMapText(
      typeof node.data?.webhook_payload_map_text === "string"
        ? String(node.data.webhook_payload_map_text)
        : toJsonEditorText(node.data?.webhook_payload_map),
    );
    setMcpArgsText(
      typeof node.data?.arguments_text === "string"
        ? String(node.data.arguments_text)
        : toJsonEditorText(node.data?.arguments || {}),
    );
    setLoadingModelsFor(null);
    autoAppliedSignatureRef.current = "";
  }, [node.id, node.data]);

  const { data: mcpInspection, isFetching: isFetchingMcpTools } = useQuery({
    queryKey: ["studio", "mcp", selectedMcpId, "tools"],
    queryFn: () => studioMCP.tools(selectedMcpId as number),
    enabled: type === "agent/mcp_call" && !!selectedMcpId,
  });
  const mcpTools = (mcpInspection as MCPServerInspection | undefined)?.tools || [];
  const selectedTool = mcpTools.find((tool) => tool.name === String(d.tool_name || "")) || null;
  const { incoming: incomingNodes, outgoing: outgoingNodes } = buildLinkedNodeRefs(node.id, nodes, edges, lang);
  const tokenSuggestions = buildTokenSuggestions(incomingNodes, node.id, lang);

  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    if (!(type === "agent/llm_query" || type === "agent/react" || type === "agent/multi") || !modelProvider || !modelList.length) return;
    const current = (d.model as string) || "";
    if (current && !modelList.includes(current)) set("model", modelList[0]);
  }, [type, modelsData, modelProvider, modelList.length]);

  useEffect(() => {
    if (!(type === "agent/llm_query" || type === "agent/react" || type === "agent/multi") || !modelProvider || loadingModelsFor !== null) return;
    const list = (modelsData && (modelsData as Record<string, string[] | undefined>)[modelProvider]) ?? [];
    if (list.length > 0) return;
    const prov = modelProvider;
    setLoadingModelsFor(prov);
    refreshModels(prov as "gemini" | "grok" | "openai" | "claude")
      .then((res) => {
        queryClient.setQueryData(["api", "models"], (old: Record<string, unknown> | undefined) => ({
          ...(old ?? {}),
          [prov]: res.models,
        }));
        if (res.models.length && providerRef.current === prov) {
          const next = { ...d, provider: prov, model: res.models[0] };
          setD(next);
          onUpdate(node.id, next);
        }
      })
      .finally(() => setLoadingModelsFor(null));
  }, [type, modelProvider, modelsData]);

  const typeInfo = getNodeTypeInfo(type, lang);
  const typeGuide = getNodeTypeGuidance(type, lang);
  const setupState = buildNodeSetupState(type, d, {
    pipelineId,
    triggerWebhookUrl,
    selectedAgentName: selectedAgent?.name,
    selectedSkillsCount: selectedSkills.length,
    selectedServersCount: Array.isArray(d.server_ids) ? d.server_ids.length : 0,
    selectedMcpName: selectedMcp?.name || null,
    selectedToolName: selectedTool?.name || null,
    cronIsValid: cronHint.tone !== "error",
    mcpArgsError: mcpArgsState.error,
    webhookError: webhookState.error,
  }, lang);
  const smartAutofillPatch = buildResourceAutofillPatch(
    { ...node, data: d },
    {
      incomingNodes,
      servers,
      mcps: mcpList.map((item) => ({ id: item.id, name: item.name })),
      pipelineName,
      lang,
    },
  );

  useEffect(() => {
    const patch = buildResourceAutofillPatch(
      { ...node, data: d },
      {
        incomingNodes,
        servers,
        mcps: mcpList.map((item) => ({ id: item.id, name: item.name })),
        pipelineName,
        lang,
      },
    );
    if (!Object.keys(patch).length) return;
    const signature = `${node.id}:${JSON.stringify(patch)}`;
    if (autoAppliedSignatureRef.current === signature) return;
    autoAppliedSignatureRef.current = signature;
    setMany(patch);
  }, [node.id, d, incomingNodes, servers, mcpList, pipelineName]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">{typeGuide.category}</span>
            <span className="text-[11px] text-muted-foreground">{node.id}</span>
          </div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="text-muted-foreground">{typeInfo.icon}</span>
            <span>{typeInfo.label}</span>
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8 rounded-md text-muted-foreground">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem className="text-red-300 focus:text-red-200" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {localize(lang, "Удалить ноду", "Delete node")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 bg-background/10">
        <div className="space-y-4 px-4 py-4">
        <ConfigSection title={localize(lang, "Сводка настройки", "Setup Overview")} description={typeGuide.summary}>
          <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3 text-[11px]">
            <div className="font-medium text-foreground">
              {setupState.ready ? localize(lang, "Готово к запуску", "Ready to run") : localize(lang, `Требует настройки: ${setupState.issues.length}`, `Needs setup: ${setupState.issues.length}`)}
            </div>
            {setupState.highlights.length > 0 && (
              <div className="mt-1 text-muted-foreground">
                {setupState.highlights.slice(0, 4).join(" · ")}
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Что настроить", "What to configure")}</p>
              <div className="mt-2 space-y-1.5">
                {typeGuide.checklist.map((item) => (
                  <p key={item} className="text-xs leading-5 text-foreground/90">{item}</p>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {setupState.ready ? localize(lang, "Статус настройки", "Configuration status") : localize(lang, "Что нужно до запуска ноды", "Before this node can run")}
              </p>
              <div className="mt-2 space-y-1.5">
                {setupState.ready ? (
                  <p className="text-xs leading-5 text-emerald-400">{localize(lang, "У ноды есть минимально необходимая конфигурация для запуска.", "This node has the minimum required configuration for execution.")}</p>
                ) : (
                  setupState.issues.map((item) => (
                    <p key={item} className="text-xs leading-5 text-amber-200">{item}</p>
                  ))
                )}
              </div>
            </div>
          </div>
        </ConfigSection>

        <ConfigSection title={localize(lang, "Связанный контекст", "Connected Context")} description={localize(lang, "Studio автоматически подставляет частые поля из связанных нод. При необходимости вы всё ещё можете переопределить значения вручную.", "Studio now uses linked nodes to prefill the most common fields. You can still override anything manually.")}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Входящие ноды", "Incoming nodes")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {incomingNodes.length ? incomingNodes.map((item) => (
                  <span key={item.id} className="rounded-full border border-border/70 bg-background/35 px-2.5 py-1 text-[11px] text-muted-foreground">{item.label}</span>
                )) : <p className="text-xs leading-5 text-muted-foreground">{localize(lang, "Пока нет подключённой upstream-ноды.", "No upstream node connected yet.")}</p>}
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Следующие ноды", "Downstream nodes")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {outgoingNodes.length ? outgoingNodes.map((item) => (
                  <span key={item.id} className="rounded-full border border-border/70 bg-background/35 px-2.5 py-1 text-[11px] text-muted-foreground">{item.label}</span>
                )) : <p className="text-xs leading-5 text-muted-foreground">{localize(lang, "После этой ноды пока ничего не подключено.", "Nothing connected after this node yet.")}</p>}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{localize(lang, "Полезные переменные", "Useful variables")}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{localize(lang, "Копируйте токены из связанных нод вместо ручного ввода.", "Copy tokens from linked nodes instead of typing them by hand.")}</p>
              </div>
              {Object.keys(smartAutofillPatch).length > 0 && (
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-[11px]" onClick={() => setMany(smartAutofillPatch)}>
                  <Wand2 className="h-3.5 w-3.5" />
                  {localize(lang, "Применить автонастройки заново", "Re-apply smart defaults")}
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tokenSuggestions.map((item) => (
                <Button
                  key={item.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-[11px]"
                  onClick={async () => {
                    await navigator.clipboard.writeText(item.token);
                    toast({ description: localize(lang, `${item.label} скопировано`, `${item.label} copied`) });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        </ConfigSection>

        <ConfigSection title={localize(lang, "Общее", "General")} description={localize(lang, "Задайте понятное имя, чтобы оператор сразу понимал назначение шага.", "Give the node a human-readable name so operators can understand the graph at a glance.")}>
          <div className="space-y-1.5">
            <Label className="text-xs">{localize(lang, "Название (необязательно)", "Label (optional)")}</Label>
            <Input value={(d.label as string) || ""} onChange={(e) => set("label", e.target.value)} placeholder={localize(lang, "Название ноды", "Node label")} className="h-9 text-sm" />
          </div>
        </ConfigSection>

        {(type === "trigger/manual" || type === "trigger/webhook" || type === "trigger/schedule") && (
          <ConfigSection title={localize(lang, "Управление триггером", "Trigger Control")} description={localize(lang, "После каждого сохранения триггеры пересобираются из этой ноды, поэтому именно её настройки являются источником истины.", "Triggers are derived from this node after each save, so the node settings are the source of truth.")}>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              {localize(lang, "Параметры триггера собираются из этой ноды после нажатия ", "Trigger settings are created from this node when you click ")}<strong>{localize(lang, "Сохранить", "Save")}</strong>.
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs font-medium">{localize(lang, "Триггер включён", "Trigger enabled")}</p>
                <p className="text-[10px] text-muted-foreground">{localize(lang, "Можно отключить запуск, не удаляя ноду", "Disable the start without deleting the node")}</p>
              </div>
              <Switch checked={(d.is_active as boolean) ?? true} onCheckedChange={(checked) => set("is_active", checked)} />
            </div>
          </ConfigSection>
        )}

        {type === "trigger/manual" && (
          <ConfigSection title={localize(lang, "Ручной запуск", "Manual Entry")} description={localize(lang, "Используйте этот режим, когда пайплайн должен запускаться оператором из Studio или из внутреннего API-клиента.", "Use this when operators should start the pipeline manually from Studio or from an internal API client.")}>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-1">
              <p className="text-xs font-medium">{localize(lang, "Ручной старт", "Manual start")}</p>
              <p className="text-[11px] text-muted-foreground">
                {localize(lang, "Запускайте этот пайплайн кнопкой ", "Start this pipeline from the Studio ")}<strong>{localize(lang, "Запустить", "Run")}</strong>
                {pipelineId ? localize(lang, ` или POST /api/studio/pipelines/${pipelineId}/run/.`, ` or POST /api/studio/pipelines/${pipelineId}/run/.`) : "."}
              </p>
            </div>
          </ConfigSection>
        )}

        {type === "trigger/webhook" && (
          <ConfigSection title={localize(lang, "Входящий webhook", "Webhook Entry")} description={localize(lang, "Откройте стабильную входящую точку и сопоставьте поля payload с переменными, которые используют downstream-ноды.", "Expose a stable inbound endpoint and map request payload fields into the variables used by downstream nodes.")}>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{localize(lang, "Webhook URL", "Webhook URL")}</Label>
                {pipelineId && triggerWebhookUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(triggerWebhookUrl);
                      toast({ description: localize(lang, "Webhook URL скопирован", "Webhook URL copied") });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    {localize(lang, "Копировать", "Copy")}
                  </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 break-all">
                {pipelineId && triggerWebhookUrl ? triggerWebhookUrl : localize(lang, "Сохраните пайплайн, чтобы получить webhook URL", "Save the pipeline once to generate the webhook URL")}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Сопоставление payload (JSON)", "Payload mapping (JSON)")}</Label>
              <Textarea
                value={webhookMapText}
                onChange={(e) => {
                  const value = e.target.value;
                  setWebhookMapText(value);
                  set("webhook_payload_map_text", value);
                  const parsed = parseJsonObjectText(value);
                  if (!parsed.error) set("webhook_payload_map", parsed.value || {});
                }}
                placeholder={'{\n  "branch": "ref",\n  "commit": "head_commit.id"\n}'}
                className="text-xs font-mono resize-none"
                rows={6}
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Сопоставьте поля входящего payload с переменными пайплайна, например ", "Map incoming payload fields into pipeline variables, for example ")}<code>head_commit.id</code>.
              </p>
              {webhookState.error && <p className="text-[10px] text-red-400">{formatJsonParseError(webhookState.error, lang)}</p>}
            </div>
            {pipelineId && triggerWebhookUrl && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{localize(lang, "Пример curl", "Sample curl")}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-[11px]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(webhookCurlExample);
                      toast({ description: localize(lang, "Тестовая webhook-команда скопирована", "Webhook test command copied") });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    {localize(lang, "Копировать", "Copy")}
                  </Button>
                </div>
                <Textarea value={webhookCurlExample} readOnly rows={6} className="text-[11px] font-mono" />
              </div>
            )}
            {trigger && (
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Последний запуск webhook:", "Last webhook run:")} {formatStudioDateTime(trigger.last_triggered_at, lang)}</p>
            )}
          </ConfigSection>
        )}

        {type === "trigger/schedule" && (
          <ConfigSection title={localize(lang, "Расписание", "Schedule Entry")} description={localize(lang, "Выберите, когда Studio должна автоматически ставить этот пайплайн в очередь. Для типовых интервалов используйте пресеты, для точного контроля — cron.", "Choose when Studio should enqueue this pipeline automatically. Use presets for common cadences and a cron expression for exact control.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Быстрые пресеты", "Quick presets")}</Label>
              <div className="flex flex-wrap gap-2">
                {CRON_PRESETS.map((preset) => (
                  <Button key={preset.value} type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => set("cron_expression", preset.value)}>
                    {preset.label[lang]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Cron-выражение", "Cron Expression")}</Label>
              <Input
                value={(d.cron_expression as string) || ""}
                onChange={(e) => set("cron_expression", e.target.value)}
                placeholder="*/5 * * * *"
                className="h-7 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Примеры:", "Examples:")} <code>0 * * * *</code> {localize(lang, "(каждый час),", "(hourly),")} <code>0 0 * * *</code> {localize(lang, "(ежедневно)", "(daily)")}</p>
              <p className={`text-[10px] ${cronHint.tone === "error" ? "text-red-400" : cronHint.tone === "ok" ? "text-emerald-400" : "text-muted-foreground"}`}>
                {cronHint.message}
              </p>
            </div>
            {trigger && (
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Последний запуск по расписанию:", "Last schedule run:")} {formatStudioDateTime(trigger.last_triggered_at, lang)}</p>
            )}
          </ConfigSection>
        )}

        {/* Agent nodes */}
        {(type === "agent/react" || type === "agent/multi") && (
          <ConfigSection title={localize(lang, "Исполнение агента", "Agent Runtime")} description={localize(lang, "Используйте сохранённый конфиг агента, когда нужны повторно используемые корпоративные настройки. Если шаг уникален для текущего пайплайна, настройте его локально.", "Use a saved agent config when you want reusable corporate defaults. Configure inline when this step is unique to the current pipeline.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Цель", "Goal")}</Label>
              <Textarea
                value={(d.goal as string) || ""}
                onChange={(e) => set("goal", e.target.value)}
                placeholder={localize(lang, "Что именно должен сделать этот агент?", "What should this agent accomplish?")}
                className="text-xs resize-none"
                rows={3}
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Используйте ", "Use ")}{"{variable}"}{localize(lang, " для подстановки контекста", " for context substitution")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Конфиг агента", "Agent Config")}</Label>
              <Select
                value={(d.agent_config_id as string) || "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") {
                    setMany({ agent_config_id: null, agent_name: "" });
                    return;
                  }
                  const agent = agents.find((item) => String(item.id) === v);
                  setMany({ agent_config_id: v, agent_name: agent?.name || "" });
                }}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={localize(lang, "Настроить прямо в этом пайплайне", "Configure directly in this pipeline")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{localize(lang, "Настроить прямо в этом пайплайне", "Configure directly in this pipeline")}</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.icon} {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedAgent && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-[10px]">{selectedAgent.model}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{selectedAgent.max_iterations} iter</Badge>
                  {selectedAgent.mcp_servers?.length > 0 && <Badge variant="secondary" className="text-[10px]">{selectedAgent.mcp_servers.length} MCP</Badge>}
                  {selectedAgent.skills?.length > 0 && <Badge variant="secondary" className="text-[10px]">{selectedAgent.skills.length} skills</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {localize(lang, "Сохранённый конфиг агента управляет prompt, model, tools, подключёнными MCP-серверами и skills. Во время выполнения агент сможет открыть нужные skills, если для сервиса важны специальные правила.", "Saved agent config controls prompt, model, tools, attached MCP servers, and attached skills. The agent can inspect those skills during the run when service-specific rules matter.")}
                </p>
                {selectedAgent.skills?.length > 0 && (
                  <div className="space-y-1">
                    {selectedAgent.skills.slice(0, 2).map((skill) => (
                      <div key={skill.slug} className="rounded bg-muted/30 px-2 py-1">
                        <p className="text-[10px] font-medium">{skill.name}</p>
                        {skill.guardrail_summary?.slice(0, 2).map((item) => (
                          <p key={item} className="text-[10px] text-muted-foreground">• {item}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {selectedAgent.skill_errors?.length > 0 && (
                  <div className="rounded bg-red-900/10 border border-red-500/20 px-2 py-1">
                    {selectedAgent.skill_errors.map((item) => (
                      <p key={item} className="text-[10px] text-red-200">{item}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!(d.agent_config_id) && (
              <>
                  <div className="space-y-1.5">
                  <Label className="text-xs">{localize(lang, "System Prompt", "System Prompt")}</Label>
                  <Textarea
                    value={(d.system_prompt as string) || ""}
                    onChange={(e) => set("system_prompt", e.target.value)}
                    placeholder={localize(lang, "Вы DevOps-агент...", "You are a DevOps agent...")}
                    className="text-xs resize-none"
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{localize(lang, "Провайдер", "Provider")}</Label>
                    <Select
                      value={provider || "auto"}
                      onValueChange={(nextProvider) => {
                        if (nextProvider === "auto") {
                          setMany({ provider: "auto", model: "" });
                          return;
                        }
                        set("provider", nextProvider);
                        setLoadingModelsFor(nextProvider);
                        refreshModels(nextProvider as "gemini" | "grok" | "openai" | "claude")
                          .then((res) => {
                            queryClient.setQueryData(["api", "models"], (old: Record<string, unknown> | undefined) => ({
                              ...(old ?? {}),
                              [nextProvider]: res.models,
                            }));
                            if (res.models.length && providerRef.current === nextProvider) {
                              setMany({ provider: nextProvider, model: res.models[0] });
                            }
                          })
                          .finally(() => setLoadingModelsFor(null));
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_PROVIDER_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{localize(lang, "Модель", "Model")}</Label>
                    {provider === "auto" ? (
                      <div className="h-7 rounded-md border border-border bg-muted/30 px-2 flex items-center text-[11px] text-muted-foreground">
                        {localize(lang, "Используется глобальная модель агента по умолчанию", "Uses the global default agent model")}
                      </div>
                    ) : (
                      <Select value={(d.model as string) || ""} onValueChange={(v) => set("model", v)} disabled={loadingModelsFor === provider}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder={loadingModelsFor === provider ? localize(lang, "Загрузка моделей...", "Loading models...") : localize(lang, "Выберите модель", "Select model")} />
                        </SelectTrigger>
                        <SelectContent>
                          {modelList.length
                            ? modelList.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)
                            : <SelectItem value="_empty" disabled>{localize(lang, "Нет доступных моделей", "No models available")}</SelectItem>}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{localize(lang, "Макс. итераций", "Max Iterations")}</Label>
                  <Input
                    type="number"
                    value={(d.max_iterations as number) || 10}
                    onChange={(e) => set("max_iterations", parseInt(e.target.value) || 10)}
                    className="h-7 text-xs"
                    min={1}
                    max={50}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{localize(lang, "MCP-серверы", "MCP Servers")}</Label>
                  <div className="space-y-1">
                    {((d.mcp_server_ids as number[]) || []).map((mcpId) => {
                      const mcp = mcpList.find((item) => item.id === mcpId);
                      return (
                        <div key={mcpId} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1 text-xs">
                          <span>{mcp?.name || `MCP #${mcpId}`}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => set("mcp_server_ids", ((d.mcp_server_ids as number[]) || []).filter((id) => id !== mcpId))}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                    <Select
                      onValueChange={(value) => {
                        const ids = ((d.mcp_server_ids as number[]) || []);
                        const nextId = parseInt(value);
                        if (!ids.includes(nextId)) set("mcp_server_ids", [...ids, nextId]);
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder={localize(lang, "Добавить MCP-сервер...", "Add MCP server...")} />
                      </SelectTrigger>
                      <SelectContent>
                        {mcpList.map((mcp) => (
                          <SelectItem key={mcp.id} value={String(mcp.id)}>
                            {mcp.name} ({mcp.transport})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {localize(lang, "Подключённые MCP-серверы отдают свои инструменты этому агенту напрямую во время выполнения.", "Attached MCP servers expose their tools directly to this agent at runtime.")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">{localize(lang, "Skills", "Skills")}</Label>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => navigate("/studio/skills")}>
                      <BookOpen className="h-3 w-3" />
                      {localize(lang, "Каталог", "Browse Catalog")}
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {selectedSkillSlugs.map((skillSlug) => {
                      const skill = skillList.find((item) => item.slug === skillSlug);
                      return (
                        <div key={skillSlug} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1 text-xs">
                          <span>{skill?.name || skillSlug}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => set("skill_slugs", selectedSkillSlugs.filter((slug) => slug !== skillSlug))}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                    <Select
                      onValueChange={(value) => {
                        if (!selectedSkillSlugs.includes(value)) set("skill_slugs", [...selectedSkillSlugs, value]);
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder={localize(lang, "Добавить skill...", "Add skill...")} />
                      </SelectTrigger>
                      <SelectContent>
                        {skillList.map((skill) => (
                          <SelectItem key={skill.slug} value={skill.slug}>
                            {skill.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {localize(lang, "Подключённые skills не раскрываются в prompt автоматически. Агент видит их каталог и открывает полный skill только когда это действительно нужно.", "Attached skills are not expanded into the prompt by default. The agent sees their catalog and can open the full skill only when needed.")}
                  </p>
                  {selectedSkills.length > 0 && (
                    <div className="space-y-1">
                      {selectedSkills.map((skill) => (
                        <div key={skill.slug} className="rounded bg-muted/30 px-2 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium">{skill.name}</span>
                            {skill.runtime_enforced && <Badge variant="secondary" className="text-[9px]">{localize(lang, "enforced", "enforced")}</Badge>}
                            {skill.safety_level && <Badge variant="outline" className="text-[9px]">{skill.safety_level}</Badge>}
                          </div>
                          {skill.ui_hint && <p className="text-[10px] text-muted-foreground mt-1">{skill.ui_hint}</p>}
                          {skill.guardrail_summary?.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {skill.guardrail_summary.map((item) => (
                                <p key={item} className="text-[10px] text-muted-foreground">• {item}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Целевые серверы", "Target Servers")}</Label>
              <div className="space-y-1">
                {((d.server_ids as number[]) || []).map((sid) => {
                  const srv = servers.find((s) => s.id === sid);
                  return (
                    <div key={sid} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1 text-xs">
                      <span>{srv?.name || `Server #${sid}`}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        onClick={() => set("server_ids", ((d.server_ids as number[]) || []).filter((id) => id !== sid))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
                <Select
                  onValueChange={(v) => {
                    const ids = ((d.server_ids as number[]) || []);
                    const n = parseInt(v);
                    if (!ids.includes(n)) set("server_ids", [...ids, n]);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={localize(lang, "Добавить сервер...", "Add server...")} />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.host})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "При ошибке", "On Failure")}</Label>
              <Select value={(d.on_failure as string) || "abort"} onValueChange={(v) => set("on_failure", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="abort">{localize(lang, "Остановить пайплайн", "Abort pipeline")}</SelectItem>
                  <SelectItem value="continue">{localize(lang, "Продолжить", "Continue")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </ConfigSection>
        )}

        {/* SSH Command */}
        {type === "agent/ssh_cmd" && (
          <ConfigSection title={localize(lang, "SSH-выполнение", "SSH Execution")} description={localize(lang, "Эта нода выполняет одну явную команду на одном сервере. Если предыдущие шаги создают динамические значения, используйте переменные прямо в команде.", "This node runs one explicit command on one server. Use variables in the command if earlier nodes produce dynamic values.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Целевой сервер", "Target Server")}</Label>
              <Select value={String(d.server_id || "")} onValueChange={(v) => set("server_id", parseInt(v))}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={localize(lang, "Выберите сервер...", "Select server...")} />
                </SelectTrigger>
                <SelectContent>
                  {servers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.host})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Команда", "Command")}</Label>
              <Textarea
                value={(d.command as string) || ""}
                onChange={(e) => set("command", e.target.value)}
                placeholder="df -h && free -h"
                className="text-xs font-mono resize-none"
                rows={3}
              />
            </div>
          </ConfigSection>
        )}

        {/* Condition */}
        {type === "logic/condition" && (
          <ConfigSection title={localize(lang, "Логика ветвления", "Branching Logic")} description={localize(lang, "Укажите, как пайплайн должен выбирать дальнейший путь между исходящими ветками условия.", "Choose how the pipeline should decide between the outgoing condition paths.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Исходная нода", "Source Node")}</Label>
              <Select
                value={(d.source_node_id as string) || "__none__"}
                onValueChange={(value) => set("source_node_id", value === "__none__" ? "" : value)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={localize(lang, "Выберите upstream-ноду", "Select the upstream node")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{localize(lang, "Выберите upstream-ноду", "Select the upstream node")}</SelectItem>
                  {incomingNodes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Это поле автоматически подставляется, когда вы соединяете upstream-ноду с условием.", "This is auto-filled when you connect an upstream node into the condition.")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Тип проверки", "Check Type")}</Label>
              <Select value={(d.check_type as string) || "contains"} onValueChange={(v) => set("check_type", v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{localize(lang, "Вывод содержит", "Output contains")}</SelectItem>
                  <SelectItem value="not_contains">{localize(lang, "Вывод не содержит", "Output does not contain")}</SelectItem>
                  <SelectItem value="status_ok">{localize(lang, "Предыдущая нода успешна", "Previous node succeeded")}</SelectItem>
                  <SelectItem value="status_failed">{localize(lang, "Предыдущая нода завершилась ошибкой", "Previous node failed")}</SelectItem>
                  <SelectItem value="always_true">{localize(lang, "Всегда true", "Always true")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {((d.check_type as string) || "contains").includes("contains") && (
              <div className="space-y-1.5">
                <Label className="text-xs">{localize(lang, "Значение для проверки", "Check Value")}</Label>
                <Input
                  value={(d.check_value as string) || ""}
                  onChange={(e) => set("check_value", e.target.value)}
                  placeholder="error"
                  className="h-7 text-xs"
                />
              </div>
            )}
          </ConfigSection>
        )}

        {/* Output/Webhook */}
        {type === "output/webhook" && (
          <ConfigSection title={localize(lang, "Исходящий webhook", "Webhook Delivery")} description={localize(lang, "Отправьте финальный результат пайплайна во внешнюю систему, которая принимает HTTP POST.", "Send the final pipeline result to an external system that accepts HTTP POST requests.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Webhook URL", "Webhook URL")}</Label>
              <Input
                value={(d.url as string) || ""}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="h-9 text-sm"
              />
            </div>
          </ConfigSection>
        )}

        {/* Output/Report */}
        {type === "output/report" && (
          <ConfigSection title={localize(lang, "Выходной отчёт", "Report Output")} description={localize(lang, "При необходимости задайте markdown-шаблон. Если поле пустое, Studio соберёт отчёт автоматически из результатов предыдущих нод.", "Optionally provide a markdown template. If left empty, Studio will build an automatic report from prior node outputs.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Шаблон отчёта (необязательно)", "Report Template (optional)")}</Label>
              <Textarea
                value={(d.template as string) || ""}
                onChange={(e) => set("template", e.target.value)}
                placeholder={localize(lang, "# Отчёт\n\n{node_id_output}", "# Report\n\n{node_id_output}")}
                className="text-xs font-mono resize-none"
                rows={4}
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Оставьте пустым для автоотчёта", "Leave empty for auto-generated report")}</p>
            </div>
          </ConfigSection>
        )}

        {/* LLM Query */}
        {type === "agent/llm_query" && (
          <ConfigSection title={localize(lang, "LLM-рассуждение", "LLM Reasoning Step")} description={localize(lang, "Используйте эту ноду для анализа или суммаризации без SSH и без автономного выбора инструментов.", "Use this node for a pure reasoning or summarization task without SSH or autonomous tool usage.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Prompt", "Prompt")}</Label>
              <Textarea
                value={(d.prompt as string) || ""}
                onChange={(e) => set("prompt", e.target.value)}
                placeholder={localize(lang, "Проанализируй данные с предыдущих шагов и дай рекомендации...", "Analyze the data from previous steps and provide recommendations...")}
                className="text-xs resize-none"
                rows={5}
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Используйте ", "Use ")}<code>{"{all_outputs}"}</code>{localize(lang, " для всех предыдущих выводов или ", " for all previous node outputs, or ")}<code>{"{node_id}"}</code>{localize(lang, " для конкретной ноды", " for a specific node")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "System Prompt", "System Prompt")}</Label>
              <Textarea
                value={(d.system_prompt as string) || ""}
                onChange={(e) => set("system_prompt", e.target.value)}
                placeholder={localize(lang, "Вы старший DevOps-инженер...", "You are a senior DevOps engineer...")}
                className="text-xs resize-none"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{localize(lang, "Провайдер", "Provider")}</Label>
                <Select
                  value={(d.provider as string) || "gemini"}
                  onValueChange={(nextProvider) => {
                    set("provider", nextProvider);
                    setLoadingModelsFor(nextProvider);
                    refreshModels(nextProvider as "gemini" | "grok" | "openai" | "claude")
                      .then((res) => {
                        queryClient.setQueryData(["api", "models"], (old: Record<string, unknown> | undefined) => ({
                          ...(old ?? {}),
                          [nextProvider]: res.models,
                        }));
                        if (res.models.length && providerRef.current === nextProvider) {
                          setMany({ provider: nextProvider, model: res.models[0] });
                        }
                      })
                      .finally(() => setLoadingModelsFor(null));
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECT_LLM_PROVIDERS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{localize(lang, "Модель", "Model")}</Label>
                <Select value={(d.model as string) || ""} onValueChange={(v) => set("model", v)} disabled={loadingModelsFor === provider}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={loadingModelsFor === provider ? localize(lang, "Загрузка моделей...", "Loading models...") : localize(lang, "Выберите модель", "Select model")} />
                  </SelectTrigger>
                  <SelectContent>
                    {modelList.length
                      ? modelList.map((model) => <SelectItem key={model} value={model}>{model}</SelectItem>)
                      : <SelectItem value="_empty" disabled>{localize(lang, "Нет доступных моделей", "No models available")}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {localize(lang, "Результат будет доступен следующим нодам как ", "Output is available for next nodes as ")}<code>{`{${node.id}}`}</code>{localize(lang, " и ", " and ")}<code>{`{${node.id}_output}`}</code>
            </p>
          </ConfigSection>
        )}

        {type === "agent/mcp_call" && (
          <ConfigSection title={localize(lang, "Прямой MCP-вызов", "Direct MCP Tool Call")} description={localize(lang, "Используйте эту ноду, когда пайплайн должен вызвать один конкретный MCP-инструмент с фиксированными структурированными аргументами.", "Use this when the pipeline must invoke one exact MCP tool with fixed structured arguments.")}>
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              {localize(lang, "Используйте этот шаг, когда пайплайн должен вызвать конкретный MCP-инструмент напрямую, без ожидания решения от LLM или агента.", "Use this node when the pipeline must call a specific MCP tool directly, without waiting for an LLM or agent to decide.")}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "MCP-сервер", "MCP Server")}</Label>
              <Select
                value={selectedMcpId ? String(selectedMcpId) : "__none__"}
                onValueChange={(value) => {
                  if (value === "__none__") {
                    setMany({ mcp_server_id: null, mcp_server_name: "", tool_name: "", arguments_text: "{}", arguments: {} });
                    setMcpArgsText("{}");
                    return;
                  }
                  const nextMcp = mcpList.find((item) => String(item.id) === value);
                  setMany({ mcp_server_id: Number(value), mcp_server_name: nextMcp?.name || "", tool_name: "", arguments_text: "{}", arguments: {} });
                  setMcpArgsText("{}");
                  if (String(d.tool_name || "").trim() || String(mcpArgsText).trim() !== "{}") {
                    toast({ description: localize(lang, "Выбор MCP-инструмента сброшен для нового сервера.", "MCP tool selection was reset for the new server.") });
                  }
                }}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={localize(lang, "Выберите MCP-сервер...", "Select MCP server...")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{localize(lang, "Выберите MCP-сервер...", "Select MCP server...")}</SelectItem>
                  {mcpList.map((mcp) => (
                    <SelectItem key={mcp.id} value={String(mcp.id)}>
                      {mcp.name} ({mcp.transport})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedMcp && (
                <p className="text-[10px] text-muted-foreground">
                  {selectedMcp.last_test_ok === true
                    ? localize(lang, "Последний тест подключения прошёл успешно.", "Last connection test passed.")
                    : selectedMcp.last_test_ok === false
                      ? localize(lang, "Последний тест подключения завершился ошибкой.", "Last connection test failed.")
                      : localize(lang, "Сервер ещё не тестировался.", "Server has not been tested yet.")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Инструмент", "Tool")}</Label>
              <Select
                value={(d.tool_name as string) || "__none__"}
                onValueChange={(value) => {
                  const tool = mcpTools.find((item) => item.name === value);
                  if (!tool) {
                    set("tool_name", "");
                    return;
                  }
                  const previousTool = String(d.tool_name || "").trim();
                  const template = buildSchemaTemplate(tool.inputSchema);
                  const text = JSON.stringify(template, null, 2);
                  setMcpArgsText(text);
                  setMany({ tool_name: tool.name, arguments_text: text, arguments: template });
                  if (previousTool && previousTool !== tool.name) {
                    toast({ description: localize(lang, "Аргументы MCP сброшены под схему выбранного инструмента.", "MCP arguments were reset to match the selected tool schema.") });
                  }
                }}
                disabled={!selectedMcpId || isFetchingMcpTools}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={isFetchingMcpTools ? localize(lang, "Загрузка инструментов...", "Loading tools...") : localize(lang, "Выберите инструмент", "Select tool")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>{localize(lang, "Выберите инструмент", "Select tool")}</SelectItem>
                  {mcpTools.map((tool) => (
                    <SelectItem key={tool.name} value={tool.name}>{tool.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTool && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 space-y-2">
                {selectedTool.description && <p className="text-xs">{selectedTool.description}</p>}
                {selectedTool.inputSchema && (
                  <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {JSON.stringify(selectedTool.inputSchema, null, 2)}
                  </pre>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Аргументы (JSON)", "Arguments (JSON)")}</Label>
              <Textarea
                value={mcpArgsText}
                onChange={(e) => {
                  const value = e.target.value;
                  setMcpArgsText(value);
                  const parsed = parseJsonObjectText(value);
                  if (!parsed.error) setMany({ arguments_text: value, arguments: parsed.value || {} });
                  else setMany({ arguments_text: value, arguments: null });
                }}
                placeholder={'{\n  "path": "{repo_path}"\n}'}
                className="text-xs font-mono resize-none"
                rows={8}
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Аргументы поддерживают переменные пайплайна вроде ", "Arguments support pipeline variables like ")}<code>{"{branch}"}</code>{localize(lang, " и ", " and ")}<code>{"{node_2_output}"}</code>.
              </p>
              {mcpArgsState.error && <p className="text-[10px] text-red-400">{formatJsonParseError(mcpArgsState.error, lang)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "При ошибке", "On Failure")}</Label>
              <Select value={(d.on_failure as string) || "abort"} onValueChange={(value) => set("on_failure", value)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="abort">{localize(lang, "Остановить пайплайн", "Abort pipeline")}</SelectItem>
                  <SelectItem value="continue">{localize(lang, "Продолжить", "Continue")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </ConfigSection>
        )}

        {/* Email Output */}
        {type === "output/email" && (
          <ConfigSection title={localize(lang, "Email-отправка", "Email Delivery")} description={localize(lang, "Отправьте отчёт через SMTP. Можно использовать настройки Studio по умолчанию или переопределить их только для этой ноды.", "Send a report through SMTP. You can rely on Studio defaults or override them for this one node.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Кому (email)", "To Email(s)")}</Label>
              <Input
                value={(d.to_email as string) || ""}
                onChange={(e) => set("to_email", e.target.value)}
                placeholder="admin@example.com, team@example.com"
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Тема", "Subject")}</Label>
              <Input
                value={(d.subject as string) || ""}
                onChange={(e) => set("subject", e.target.value)}
                placeholder={localize(lang, "Отчёт пайплайна: {pipeline_name}", "Pipeline Report: {pipeline_name}")}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Шаблон тела письма (необязательно)", "Body Template (optional)")}</Label>
              <Textarea
                value={(d.body as string) || ""}
                onChange={(e) => set("body", e.target.value)}
                placeholder={localize(lang, "# Отчёт\n\n{all_outputs}", "# Report\n\n{all_outputs}")}
                className="text-xs font-mono resize-none"
                rows={3}
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Оставьте пустым для автогенерации тела письма", "Leave empty for auto-generated body")}</p>
            </div>
            <div className="border-t border-border pt-3 space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase">{localize(lang, "Настройки SMTP (переопределяют настройки Django)", "SMTP Settings (override Django settings)")}</Label>
              <Input
                value={(d.smtp_host as string) || ""}
                onChange={(e) => set("smtp_host", e.target.value)}
                placeholder="smtp.gmail.com"
                className="h-7 text-xs"
              />
              <div className="flex gap-2">
                <Input
                  value={(d.smtp_user as string) || ""}
                  onChange={(e) => set("smtp_user", e.target.value)}
                  placeholder="user@gmail.com"
                  className="h-7 text-xs flex-1"
                />
                <Input
                  value={(d.smtp_password as string) || ""}
                  onChange={(e) => set("smtp_password", e.target.value)}
                  placeholder={localize(lang, "пароль приложения", "app password")}
                  type="password"
                  className="h-7 text-xs w-28"
                />
              </div>
            </div>
          </ConfigSection>
        )}

        {/* Wait */}
        {type === "logic/wait" && (
          <ConfigSection title={localize(lang, "Пауза", "Wait Control")} description={localize(lang, "Приостановите выполнение на заданное время перед следующим шагом.", "Pause the workflow for a specific amount of time before continuing to the next step.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Длительность паузы (минуты)", "Wait Duration (minutes)")}</Label>
              <Input
                type="number"
                value={(d.wait_minutes as number) ?? 20}
                onChange={(e) => set("wait_minutes", parseFloat(e.target.value) || 1)}
                className="h-9 text-sm"
                min={0.1}
                max={1440}
                step={0.5}
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Диапазон: 0.1 – 1440 минут (максимум 24 часа)", "Range: 0.1 – 1440 minutes (24h max)")}</p>
            </div>
          </ConfigSection>
        )}

        {/* Human Approval */}
        {type === "logic/human_approval" && (
          <ConfigSection title={localize(lang, "Подтверждение оператора", "Human Approval Gate")} description={localize(lang, "Приостановите выполнение и дождитесь явного approve или reject от оператора через email или Telegram.", "Pause execution and wait for an explicit operator approval by email or Telegram.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Кому (email)", "To (email)")}</Label>
              <Input
                value={(d.to_email as string) || ""}
                onChange={(e) => set("to_email", e.target.value)}
                placeholder={localize(lang, "или из Studio → Notifications", "or from Studio -> Notifications")}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Тема письма (шаблон)", "Email subject (template)")}</Label>
              <Input
                value={(d.email_subject as string) || ""}
                onChange={(e) => set("email_subject", e.target.value)}
                placeholder={localize(lang, "Пусто = тема по умолчанию", "Empty = default subject")}
                className="h-7 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Переменные", "Variables")}: {"{pipeline_name}"}, {"{run_id}"}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Текст письма (шаблон)", "Email body (template)")}</Label>
              <Textarea
                value={(d.email_body as string) || ""}
                onChange={(e) => set("email_body", e.target.value)}
                placeholder={localize(lang, "Пусто = текст по умолчанию. Переменные ниже.", "Empty = default body text. Variables below.")}
                className="text-xs resize-none"
                rows={8}
              />
              <p className="text-[10px] text-muted-foreground">
                {"{approve_url}"}, {"{reject_url}"}, {"{all_outputs}"}, {"{timeout_minutes}"}
              </p>
            </div>
            <div className="border-t border-border pt-3 space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase">{localize(lang, "Telegram", "Telegram")}</Label>
              <Input
                value={(d.tg_bot_token as string) || ""}
                onChange={(e) => set("tg_bot_token", e.target.value)}
                placeholder={localize(lang, "Bot Token (из @BotFather)", "Bot Token (from @BotFather)")}
                className="h-7 text-xs font-mono"
              />
              <Input
                value={(d.tg_chat_id as string) || ""}
                onChange={(e) => set("tg_chat_id", e.target.value)}
                placeholder={localize(lang, "Chat ID (например -100123456)", "Chat ID (e.g. -100123456)")}
                className="h-7 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Base URL (для approval-ссылок)", "Base URL (for approval links)")}</Label>
              <Input
                value={(d.base_url as string) || ""}
                onChange={(e) => set("base_url", e.target.value)}
                placeholder={localize(lang, "https://ваш-сервер.example.com", "https://your-server.example.com")}
                className="h-7 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Используется в approve/reject URL, которые уходят в уведомлениях", "Used in approve/reject URLs sent in notifications")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Таймаут (минуты)", "Timeout (minutes)")}</Label>
              <Input
                type="number"
                value={(d.timeout_minutes as number) ?? 120}
                onChange={(e) => set("timeout_minutes", parseFloat(e.target.value) || 120)}
                className="h-7 text-xs"
                min={5}
                max={10080}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Сообщение в Telegram (шаблон)", "Telegram message (template)")}</Label>
              <Textarea
                value={(d.message as string) || ""}
                onChange={(e) => set("message", e.target.value)}
                placeholder={localize(lang, "{approve_url}, {reject_url}...", "{approve_url}, {reject_url}...")}
                className="text-xs resize-none"
                rows={4}
              />
            </div>
            <div className="border-t border-border pt-3 space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase">{localize(lang, "SMTP (для approval email)", "SMTP (for approval email)")}</Label>
              <Input
                value={(d.smtp_host as string) || ""}
                onChange={(e) => set("smtp_host", e.target.value)}
                placeholder="smtp.gmail.com"
                className="h-7 text-xs"
              />
              <div className="flex gap-2">
                <Input
                  value={(d.smtp_user as string) || ""}
                  onChange={(e) => set("smtp_user", e.target.value)}
                  placeholder="user@gmail.com"
                  className="h-7 text-xs flex-1"
                />
                <Input
                  value={(d.smtp_password as string) || ""}
                  onChange={(e) => set("smtp_password", e.target.value)}
                  placeholder={localize(lang, "пароль приложения", "app password")}
                  type="password"
                  className="h-7 text-xs w-28"
                />
              </div>
            </div>
          </ConfigSection>
        )}

        {/* Telegram Output */}
        {type === "output/telegram" && (
          <ConfigSection title={localize(lang, "Telegram-отправка", "Telegram Delivery")} description={localize(lang, "Отправьте финальный результат в Telegram-чат. Если стандартной сводки мало, задайте свой шаблон сообщения.", "Send the final result to a Telegram chat. Use the message template if the default summary is not enough.")}>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Bot Token", "Bot Token")}</Label>
              <Input
                value={(d.bot_token as string) || ""}
                onChange={(e) => set("bot_token", e.target.value)}
                placeholder="1234567890:AAF..."
                className="h-7 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">{localize(lang, "Получите у @BotFather в Telegram", "Get from @BotFather on Telegram")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Chat ID", "Chat ID")}</Label>
              <Input
                value={(d.chat_id as string) || ""}
                onChange={(e) => set("chat_id", e.target.value)}
                placeholder="-100123456789"
                className="h-7 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Используйте @userinfobot или @getidsbot, чтобы узнать chat ID", "Use @userinfobot or @getidsbot to find your chat ID")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Шаблон сообщения (необязательно)", "Message Template (optional)")}</Label>
              <Textarea
                value={(d.message as string) || ""}
                onChange={(e) => set("message", e.target.value)}
                placeholder="📊 *{pipeline_name}*\n\n{all_outputs}"
                className="text-xs resize-none"
                rows={4}
              />
              <p className="text-[10px] text-muted-foreground">
                {localize(lang, "Поддерживается Markdown. Переменные:", "Supports Markdown. Variables:")} <code>{"{all_outputs}"}</code>,{" "}
                <code>{"{node_id_output}"}</code>
              </p>
            </div>
          </ConfigSection>
        )}
        </div>
      </ScrollArea>

      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={localize(lang, "Удалить ноду", "Delete node")}
        description={localize(lang, "Нода и все связанные с ней связи будут удалены с canvas.", "This removes the node and all connected edges from the pipeline canvas.")}
        confirmLabel={localize(lang, "Удалить ноду", "Delete node")}
        onConfirm={() => {
          onDelete(node.id);
          setDeleteDialogOpen(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node Palette (left panel)
// ---------------------------------------------------------------------------
function NodePalette({ onAddNode }: { onAddNode: (type: NodeType) => void }) {
  const { lang } = useI18n();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const categories = ["All", ...NODE_PALETTE.map((item) => item.category)];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = NODE_PALETTE
    .filter((group) => activeCategory === "All" || group.category === activeCategory)
    .map((group) => ({
      ...group,
      nodes: group.nodes.filter((node) => {
        if (!normalizedQuery) return true;
        const meta = getNodePaletteText(node.type, lang);
        const categoryLabel = getNodeCategoryLabel(group.category, lang);
        return [meta.label, meta.description, node.type, categoryLabel].some((value) => value.toLowerCase().includes(normalizedQuery));
      }),
    }))
    .filter((group) => group.nodes.length > 0);

  return (
    <div className="flex h-full flex-col border-r border-border/70 bg-background/18">
      <div className="space-y-3 border-b border-border px-4 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{localize(lang, "Библиотека нод", "Node Library")}</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{localize(lang, "Добавляйте шаги без лишнего шума", "Add steps without extra noise")}</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {localize(lang, "Выберите тип шага, Studio добавит его на canvas и сразу откроет настройку справа.", "Choose a step type, Studio adds it to the canvas and opens its setup on the right.")}
          </p>
        </div>
        <div className="grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={localize(lang, "Поиск по нодам, инструментам и триггерам...", "Search nodes, tools, triggers...")}
              className="h-9 rounded-md pl-9 text-sm"
            />
          </div>
          <Select value={activeCategory} onValueChange={setActiveCategory}>
            <SelectTrigger className="h-9 rounded-md text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {getNodeCategoryLabel(category, lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[11px] text-muted-foreground">
            {localize(lang, `${visibleGroups.reduce((sum, group) => sum + group.nodes.length, 0)} типов доступны`, `${visibleGroups.reduce((sum, group) => sum + group.nodes.length, 0)} types available`)}
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {visibleGroups.map((cat) => (
            <div key={cat.category}>
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{getNodeCategoryLabel(cat.category, lang)}</p>
              {cat.nodes.map((node) => {
                const meta = getNodePaletteText(node.type, lang);
                return (
                  <button
                    key={node.type}
                    onClick={() => onAddNode(node.type)}
                    className="group mb-2 w-full rounded-xl border border-border/70 bg-background/28 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-background/38"
                    title={meta.description}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-background/35 text-base text-muted-foreground">
                        {node.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{meta.label}</div>
                        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{meta.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {!visibleGroups.length && (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
              <p className="text-sm font-medium text-foreground">{localize(lang, "Подходящих нод не найдено", "No matching nodes")}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{localize(lang, "Попробуйте другой запрос или сбросьте фильтр по категории.", "Try another keyword or clear the category filter.")}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Editor (needs ReactFlowProvider)
// ---------------------------------------------------------------------------
function PipelineEditorInner({ pipelineId }: { pipelineId: number | null }) {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const { data: pipeline, isLoading } = useQuery({
    queryKey: ["studio", "pipeline", pipelineId],
    queryFn: () => (pipelineId ? studioPipelines.get(pipelineId) : null),
    enabled: !!pipelineId,
  });
  const { data: pipelineCopilotMcpList = [] } = useQuery({ queryKey: ["studio", "mcp"], queryFn: studioMCP.list });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [pipelineName, setPipelineName] = useState("");
  const [lastRun, setLastRun] = useState<PipelineRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [pipelineCopilotOpen, setPipelineCopilotOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [runTaskText, setRunTaskText] = useState("");
  const [runRequester, setRunRequester] = useState("");
  const [runTicketId, setRunTicketId] = useState("");
  const [runAdvancedOpen, setRunAdvancedOpen] = useState(false);
  const [runContextText, setRunContextText] = useState("{}");
  const [runContextError, setRunContextError] = useState<string | null>(null);
  const nodeIdCounter = useRef(1);
  const inspectorOpen = Boolean(activeRunId || selectedNode);

  // Load pipeline data
  useEffect(() => {
    if (pipeline) {
      setPipelineName(pipeline.name);
      setNodes((pipeline.nodes || []) as never[]);
      setEdges((pipeline.edges || []) as never[]);
      if (pipeline.nodes?.length) {
        const maxId = pipeline.nodes.reduce((max, n) => {
          const num = parseInt(n.id.replace(/\D/g, "") || "0");
          return Math.max(max, num);
        }, 0);
        nodeIdCounter.current = maxId + 1;
        // Fit view after nodes load
        setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 100);
      }
    }
  }, [pipeline, setNodes, setEdges, fitView]);

  const saveMutation = useMutation({
    mutationFn: (data: { nodes: PipelineNode[]; edges: PipelineEdge[]; name: string }) =>
      pipelineId
        ? studioPipelines.update(pipelineId, data)
        : studioPipelines.create({ ...data, icon: "⚡" }),
    onSuccess: (p) => {
      queryClient.setQueryData(["studio", "pipeline", p.id], p);
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["studio", "pipeline", p.id] });
      toast({ description: localize(lang, "Пайплайн сохранён", "Pipeline saved") });
      if (!pipelineId) navigate(`/studio/pipeline/${p.id}`, { replace: true });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const runMutation = useMutation({
    mutationFn: ({ targetPipelineId, context }: { targetPipelineId: number; context: Record<string, unknown> }) => {
      return studioPipelines.run(targetPipelineId, context);
    },
    onSuccess: (run) => {
      setLastRun(run);
      setActiveRunId(run.id);
      setSelectedNode(null);
      toast({ description: localize(lang, `Пайплайн запущен — запуск #${run.id}`, `Pipeline started — run #${run.id}`) });
      setRunDialogOpen(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const handleSave = () => {
    saveMutation.mutate({
      name: pipelineName || "Untitled",
      nodes: nodes as unknown as PipelineNode[],
      edges: edges as unknown as PipelineEdge[],
    });
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setEdges((eds) => addEdge(connection, eds));

      const sourceNode = nodes.find((item) => item.id === connection.source);
      const targetNode = nodes.find((item) => item.id === connection.target);
      if (!targetNode) return;

      const patch = sourceNode ? buildConnectionAutofillPatch(targetNode as unknown as PipelineNode, sourceNode as unknown as PipelineNode, pipelineName, lang) : {};
      const nextTarget = Object.keys(patch).length
        ? ({ ...targetNode, data: { ...(targetNode.data || {}), ...patch } } as PipelineNode)
        : (targetNode as unknown as PipelineNode);

      if (Object.keys(patch).length) {
        setNodes((nds) => nds.map((item) => (item.id === targetNode.id ? (nextTarget as never) : item)));
        toast({ description: localize(lang, `${getNodeDisplayLabel(nextTarget, lang)} получила стартовые настройки из нового соединения.`, `${getNodeDisplayLabel(nextTarget, lang)} picked up starter settings from the new connection.`) });
      }

      setActiveRunId(null);
      setSelectedNode(nextTarget);
    },
    [nodes, pipelineName, setEdges, setNodes, toast],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      setActiveRunId(null);
      setSelectedNode(node as unknown as PipelineNode);
    },
    [],
  );

  const handleAddNode = useCallback(
    (type: NodeType) => {
      const id = `node_${nodeIdCounter.current++}`;
      const selected = selectedNode ? nodes.find((item) => item.id === selectedNode.id) : null;
      const defaultPosition = selected
        ? { x: selected.position.x + 260, y: selected.position.y + 24 }
        : screenToFlowPosition({ x: Math.round(window.innerWidth * 0.45), y: Math.round(window.innerHeight * 0.32) });
      const newNode = {
        id,
        type,
        position: defaultPosition,
        data: buildDefaultNodeData(type, lang),
      };
      setNodes((nds) => [...nds, newNode as never]);
      setActiveRunId(null);
      setSelectedNode(newNode as PipelineNode);
    },
    [nodes, selectedNode, setNodes, screenToFlowPosition],
  );

  const handleUpdateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data } : n)),
      );
      setSelectedNode((prev) => (prev?.id === nodeId ? { ...prev, data } : prev));
    },
    [setNodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges],
  );

  const handleApplyPipelineAssistantPatch = useCallback(
    (targetNodeId: string, patch: Record<string, unknown>) => {
      if (!targetNodeId || !Object.keys(patch).length) return;
      const normalized = normaliseAssistantPatch(patch, {
        mcpList: pipelineCopilotMcpList.map((item) => ({ id: item.id, name: item.name })),
      });
      const targetNode = (nodes as unknown as PipelineNode[]).find((item) => item.id === targetNodeId);
      if (!targetNode) {
        toast({ variant: "destructive", description: localize(lang, `Нода ${targetNodeId} не найдена.`, `Node ${targetNodeId} was not found.`) });
        return;
      }
      const currentData = (targetNode.data || {}) as Record<string, unknown>;
      const merged = { ...currentData, ...normalized };
      setNodes((nds) => nds.map((item) => (item.id === targetNodeId ? ({ ...item, data: merged } as never) : item)));
      setSelectedNode({ ...targetNode, data: merged });
      toast({ description: localize(lang, `Предложение ИИ применено к ноде ${getNodeDisplayLabel({ ...targetNode, data: merged }, lang)}.`, `AI suggestion applied to ${getNodeDisplayLabel({ ...targetNode, data: merged }, lang)}.`) });
    },
    [nodes, pipelineCopilotMcpList, setNodes, toast],
  );

  const handleApplyPipelineAssistantGraphPatch = useCallback(
    (graphPatch: StudioPipelineGraphPatch) => {
      if (!graphPatch.nodes.length && !graphPatch.edges.length) {
        toast({ description: localize(lang, "В этом предложении нет изменений графа.", "This suggestion does not include graph changes.") });
        return;
      }

      const existingNodes = nodes as unknown as PipelineNode[];
      const existingNodeIds = new Set(existingNodes.map((item) => item.id));
      const anchorNode =
        existingNodes.find((item) => item.id === graphPatch.anchor_node_id) ||
        (selectedNode ? existingNodes.find((item) => item.id === selectedNode.id) : null) ||
        existingNodes[existingNodes.length - 1] ||
        null;
      const anchorPosition =
        anchorNode?.position ||
        screenToFlowPosition({ x: Math.round(window.innerWidth * 0.52), y: Math.round(window.innerHeight * 0.35) });

      const refToId = new Map<string, string>();
      const createdNodes: PipelineNode[] = [];
      graphPatch.nodes.forEach((spec, index) => {
        if (!spec.ref || !isNodeType(spec.type)) return;
        const newId = `node_${nodeIdCounter.current++}`;
        refToId.set(spec.ref, newId);
        const data = {
          ...buildDefaultNodeData(spec.type, lang),
          ...(spec.data || {}),
        };
        if (spec.label && !String(data.label || "").trim()) data.label = spec.label;
        const fallbackX = 280 * (index + 1);
        const fallbackY = (index % 3) * 120;
        createdNodes.push({
          id: newId,
          type: spec.type,
          position: {
            x: anchorPosition.x + (typeof spec.x_offset === "number" ? spec.x_offset : fallbackX),
            y: anchorPosition.y + (typeof spec.y_offset === "number" ? spec.y_offset : fallbackY),
          },
          data,
        });
      });

      const resolveNodeId = (token: string) => {
        if (!token) return null;
        if (refToId.has(token)) return refToId.get(token) || null;
        if (existingNodeIds.has(token)) return token;
        return null;
      };

      const existingEdgeKeys = new Set((edges as unknown as PipelineEdge[]).map((edge) => `${edge.source}:${edge.target}:${edge.label || ""}`));
      const createdEdges: PipelineEdge[] = [];
      graphPatch.edges.forEach((spec, index) => {
        const source = resolveNodeId(spec.source);
        const target = resolveNodeId(spec.target);
        if (!source || !target) return;
        const edgeKey = `${source}:${target}:${spec.label || ""}`;
        if (existingEdgeKeys.has(edgeKey)) return;
        existingEdgeKeys.add(edgeKey);
        createdEdges.push({
          id: `edge_${Date.now()}_${index}_${source}_${target}`,
          source,
          target,
          label: spec.label,
          sourceHandle: spec.source_handle,
          targetHandle: spec.target_handle,
        });
      });

      if (!createdNodes.length && !createdEdges.length) {
        toast({ description: localize(lang, "В предложении ИИ не найдено валидных изменений графа.", "No valid graph changes were found in this AI suggestion.") });
        return;
      }

      if (createdNodes.length) {
        setNodes((nds) => [...nds, ...(createdNodes as never[])]);
        setSelectedNode(createdNodes[0]);
      }
      if (createdEdges.length) {
        setEdges((eds) => [...eds, ...(createdEdges as never[])]);
      }
      setActiveRunId(null);
      toast({ description: localize(lang, `Применено ${createdNodes.length} нод и ${createdEdges.length} связей из предложения ИИ.`, `Applied ${createdNodes.length} node(s) and ${createdEdges.length} edge(s) from the AI suggestion.`) });
      setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 60);
    },
    [edges, fitView, nodes, screenToFlowPosition, selectedNode, setEdges, setNodes, toast],
  );

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const handleRunSubmit = useCallback(async () => {
    const parsedContext = parseJsonObjectText(runContextText);
    if (parsedContext.error) {
      setRunContextError(parsedContext.error);
      return;
    }
    setRunContextError(null);

    const manualContext: Record<string, unknown> = {
      ...(parsedContext.value || {}),
    };
    if (runTaskText.trim()) manualContext.task = runTaskText.trim();
    if (runRequester.trim()) manualContext.requester = runRequester.trim();
    if (runTicketId.trim()) manualContext.ticket_id = runTicketId.trim();

    try {
      const savedPipeline = await saveMutation.mutateAsync({
        name: pipelineName || "Untitled",
        nodes: nodes as unknown as PipelineNode[],
        edges: edges as unknown as PipelineEdge[],
      });
      await runMutation.mutateAsync({ targetPipelineId: pipelineId ?? savedPipeline.id, context: manualContext });
    } catch {
      // Handled by mutation toasts.
    }
  }, [
    runContextText,
    runTaskText,
    runRequester,
    runTicketId,
    saveMutation,
    pipelineName,
    nodes,
    edges,
    pipelineId,
    runMutation,
  ]);

  if (pipelineId && isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {localize(lang, "Загрузка пайплайна...", "Loading pipeline...")}
      </div>
    );
  }

  const showMiniMap = nodes.length >= 6;

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="z-10 flex flex-wrap items-center gap-2 border-b border-border/70 bg-background/95 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" onClick={() => navigate("/studio")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
          <span className="hidden text-[11px] font-medium text-muted-foreground sm:block">{localize(lang, "Редактор пайплайна", "Pipeline editor")}</span>
          <Input
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            className="h-9 min-w-[220px] max-w-[520px] flex-1 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
            placeholder={localize(lang, "Название пайплайна...", "Pipeline name...")}
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {lastRun && (
            <button
              type="button"
              onClick={() => setActiveRunId(lastRun.id)}
              className="hidden items-center gap-2 rounded-md border border-border/70 bg-background/35 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-background/50 hover:text-foreground sm:flex"
            >
              {lastRun.status === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : lastRun.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
              ) : lastRun.status === "failed" ? (
                <XCircle className="h-3 w-3 text-muted-foreground" />
              ) : (
                <Clock className="h-3 w-3 text-muted-foreground" />
              )}
              <span>{localize(lang, `Последний запуск #${lastRun.id}`, `Latest run #${lastRun.id}`)}</span>
              <span>· {formatRunStatus(lastRun.status, lang)}</span>
            </button>
          )}
          <Button
            size="sm"
            variant={paletteOpen ? "secondary" : "outline"}
            onClick={() => setPaletteOpen((open) => !open)}
            className="h-8 gap-1.5 rounded-md px-3"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {paletteOpen ? localize(lang, "Скрыть библиотеку", "Hide library") : localize(lang, "Показать библиотеку", "Show library")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="h-8 gap-1.5 rounded-md px-3"
          >
            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {localize(lang, "Сохранить", "Save")}
          </Button>
          <Button
            size="sm"
            onClick={() => setRunDialogOpen(true)}
            disabled={runMutation.isPending || saveMutation.isPending}
            className="h-8 gap-1.5 rounded-md px-3"
          >
            {runMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {localize(lang, "Запустить", "Run")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 rounded-md px-3 text-muted-foreground">
                <MoreHorizontal className="h-3.5 w-3.5" />
                {localize(lang, "Ещё", "More")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setPipelineCopilotOpen(true)}>
                <Bot className="mr-2 h-3.5 w-3.5" />
                {localize(lang, "AI помощник пайплайна", "Pipeline AI Assistant")}
              </DropdownMenuItem>
              {lastRun && (
                <DropdownMenuItem onClick={() => setActiveRunId(lastRun.id)}>
                  <Clock className="mr-2 h-3.5 w-3.5" />
                  {localize(lang, `Открыть запуск #${lastRun.id}`, `Open run #${lastRun.id}`)}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <PipelineCopilotDialog
        open={pipelineCopilotOpen}
        onOpenChange={setPipelineCopilotOpen}
        pipelineId={pipelineId}
        pipelineName={pipelineName}
        nodes={nodes as unknown as PipelineNode[]}
        edges={edges as unknown as PipelineEdge[]}
        selectedNode={selectedNode}
        onApplyPatch={handleApplyPipelineAssistantPatch}
        onApplyGraphPatch={handleApplyPipelineAssistantGraphPatch}
      />

      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{localize(lang, "Запуск пайплайна", "Run Pipeline")}</DialogTitle>
            <DialogDescription>
              {localize(lang, "Запустите пайплайн с ручным payload контекста. Если пайплайн ещё новый, Studio сначала сохранит его перед первым запуском.", "Start this pipeline with a manual context payload. If the pipeline is new, Studio will save it before the first run.")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{localize(lang, "Задача или запрос", "Task or request")}</Label>
              <Textarea
                value={runTaskText}
                onChange={(e) => setRunTaskText(e.target.value)}
                rows={8}
                placeholder={localize(lang, "Опишите, что именно этот пайплайн должен обработать, проверить или автоматизировать.", "Describe what this pipeline should process, investigate, or automate.")}
                className="text-sm"
              />
            </div>
            <div className="rounded-md border border-border bg-muted/15">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                onClick={() => setRunAdvancedOpen((open) => !open)}
              >
                <div>
                  <p className="text-xs font-medium">{localize(lang, "Расширенный контекст", "Advanced context")}</p>
                  <p className="text-[11px] text-muted-foreground">{localize(lang, "Необязательные поля requester и сырой JSON-контекст.", "Optional requester metadata and raw JSON fields.")}</p>
                </div>
                {runAdvancedOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {runAdvancedOpen && (
                <div className="space-y-4 border-t border-border px-3 py-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{localize(lang, "Инициатор", "Requester")}</Label>
                      <Input
                        value={runRequester}
                        onChange={(e) => setRunRequester(e.target.value)}
                        placeholder={localize(lang, "Service Desk, CI job, оператор, webhook bridge", "Service Desk, CI job, operator, webhook bridge")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{localize(lang, "Тикет или reference ID", "Ticket or reference ID")}</Label>
                      <Input
                        value={runTicketId}
                        onChange={(e) => setRunTicketId(e.target.value)}
                        placeholder="INC-1428"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{localize(lang, "Дополнительный JSON-контекст", "Advanced JSON context")}</Label>
                    <Textarea
                      value={runContextText}
                      onChange={(e) => {
                        setRunContextText(e.target.value);
                        if (runContextError) setRunContextError(null);
                      }}
                      rows={6}
                      placeholder='{"service":"billing-api","environment":"prod"}'
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {localize(lang, "Дополнительные поля, которые будут слиты с ручным контекстом. Используйте это для входов, специфичных именно для этого пайплайна.", "Optional extra fields merged into the manual context. Use this for pipeline-specific inputs.")}
                    </p>
                    {runContextError && <p className="text-[11px] text-red-400">{runContextError}</p>}
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunDialogOpen(false)}>
              {localize(lang, "Отмена", "Cancel")}
            </Button>
            <Button onClick={handleRunSubmit} disabled={runMutation.isPending || saveMutation.isPending}>
              {runMutation.isPending || saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {localize(lang, "Запустить", "Run")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main area */}
      <div className="min-h-0 flex flex-1 overflow-hidden">
        {/* Left: Node palette */}
        <div
          className={`min-h-0 shrink-0 overflow-hidden border-r border-border transition-[width,border-color] duration-200 ${
            paletteOpen ? "w-72 xl:w-80" : "w-0 border-r-transparent"
          }`}
        >
          {paletteOpen ? <NodePalette onAddNode={handleAddNode} /> : null}
        </div>

        {/* Center: Canvas */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { strokeWidth: 2 },
              animated: true,
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls className="!border-border/70 !bg-background/78 !backdrop-blur [&>button]:!border-border/70 [&>button]:!bg-background/80 [&>button]:!text-foreground [&>button:hover]:!bg-background" />
            {showMiniMap && (
              <MiniMap
                style={{ background: "hsl(var(--background) / 0.85)", border: "1px solid hsl(var(--border))" }}
                maskColor="hsl(var(--background) / 0.82)"
                nodeColor={(node) => {
                  const type = node.type || "";
                  if (type.startsWith("trigger/")) return "#6b7280";
                  if (type.startsWith("agent/")) return "#4b5563";
                  if (type.startsWith("logic/")) return "#9ca3af";
                  if (type.startsWith("output/")) return "#374151";
                  return "#6b7280";
                }}
              />
            )}
            {/* Empty state hint inside React Flow */}
            {nodes.length === 0 && (
              <Panel position="top-center" style={{ pointerEvents: "none", marginTop: "30%" }}>
                <div className="select-none rounded-xl border border-border/60 bg-background/70 px-4 py-3 text-center backdrop-blur">
                  <p className="text-sm text-muted-foreground/70">
                    {paletteOpen
                      ? localize(lang, "Выберите ноду в левой библиотеке, чтобы добавить её и сразу открыть панель настройки.", "Choose a node from the left library to add it and open its setup panel.")
                      : localize(lang, "Откройте библиотеку нод сверху, чтобы быстро добавить первый шаг.", "Open the node library from the toolbar to add the first step.")}
                  </p>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>

      <Sheet
        open={inspectorOpen}
        onOpenChange={(open) => {
          if (!open) {
            setActiveRunId(null);
            setSelectedNode(null);
          }
        }}
      >
        <SheetContent side="right" className="w-[min(70rem,calc(100vw-1rem))] max-w-none gap-0 border-l border-border bg-background p-0 shadow-[0_24px_90px_-36px_rgba(2,6,23,0.9)] sm:max-w-none">
          <SheetTitle className="sr-only">
            {activeRunId
              ? localize(lang, `Монитор запуска #${activeRunId}`, `Run monitor #${activeRunId}`)
              : selectedNode
                ? localize(lang, `Настройка ноды ${getNodeDisplayLabel(selectedNode, lang)}`, `Node setup ${getNodeDisplayLabel(selectedNode, lang)}`)
                : localize(lang, "Инспектор пайплайна", "Pipeline inspector")}
          </SheetTitle>
          {activeRunId ? (
            <RunMonitorPanel
              runId={activeRunId}
              onClose={() => setActiveRunId(null)}
            />
          ) : selectedNode ? (
            <NodeConfigPanel
              key={selectedNode.id}
              node={selectedNode}
              pipelineId={pipelineId}
              pipelineName={pipelineName}
              trigger={pipeline?.triggers?.find((item) => item.node_id === selectedNode.id) || null}
              nodes={nodes as unknown as PipelineNode[]}
              edges={edges as unknown as PipelineEdge[]}
              onUpdate={handleUpdateNodeData}
              onClose={() => setSelectedNode(null)}
              onDelete={handleDeleteNode}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export (wrapped in provider)
// ---------------------------------------------------------------------------
export default function PipelineEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const pipelineId = id ? parseInt(id) : null;

  return (
    <ReactFlowProvider>
      <div className="h-full">
        <PipelineEditorInner pipelineId={pipelineId} />
      </div>
    </ReactFlowProvider>
  );
}

