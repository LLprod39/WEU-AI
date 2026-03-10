import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Save, Loader2, Bot, ArrowLeft, BookOpen, Server, Shield, MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  PageShell,
} from "@/components/ui/page-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { studioAgents, studioMCP, studioServers, studioSkills, type AgentConfig } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const ALL_TOOLS = [
  { id: "ssh_execute", label: "SSH Execute", desc: "Run commands on servers" },
  { id: "read_console", label: "Read Console", desc: "Read terminal output" },
  { id: "send_ctrl_c", label: "Send Ctrl+C", desc: "Interrupt running process" },
  { id: "open_connection", label: "Open Connection", desc: "Open SSH connection" },
  { id: "close_connection", label: "Close Connection", desc: "Close SSH connection" },
  { id: "wait_for_output", label: "Wait for Output", desc: "Wait for regex pattern" },
  { id: "report", label: "Report", desc: "Send intermediate report" },
  { id: "ask_user", label: "Ask User", desc: "Pause and ask for input" },
  { id: "analyze_output", label: "Analyze Output", desc: "LLM analysis of output" },
];

const LLM_MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-2.5-pro",
  "claude-4.5-sonnet",
  "claude-4.5-opus",
  "gpt-5.2",
];

const BOT_STARTER_PRESETS = [
  {
    id: "keycloak-test",
    label: "Keycloak TEST Bot",
    description: "Safe Keycloak bot pinned to the TEST profile.",
    requiredSkills: [],
    patch: {
      name: "Keycloak TEST Bot",
      description: "Service bot for Keycloak TEST tasks with enforced profile guardrails.",
      system_prompt: "You are a cautious Keycloak operator. Work only through attached MCP tools and stop instead of guessing.",
      instructions: "Before mutating anything, read the relevant skills, confirm the environment, discover the exact target, then verify the final state.",
      allowed_tools: ["report", "ask_user", "analyze_output"],
    },
  },
  {
    id: "keycloak-prod",
    label: "Keycloak PROD Bot",
    description: "Production Keycloak bot with pinned profile and stricter safety posture.",
    requiredSkills: [],
    patch: {
      name: "Keycloak PROD Bot",
      description: "Production Keycloak bot with enforced profile pinning and mandatory preflight guardrails.",
      system_prompt: "You are a production Keycloak operator. Be deterministic, conservative, and stop whenever a target is ambiguous.",
      instructions: "Read the attached skills before service-specific changes. Resolve exact targets, run preflight before mutations, and verify everything after changes.",
      allowed_tools: ["report", "ask_user", "analyze_output"],
    },
  },
  {
    id: "investigator",
    label: "Investigation Bot",
    description: "General investigation agent for read-heavy tasks and operator handoff.",
    requiredSkills: [],
    patch: {
      name: "Investigation Bot",
      description: "General-purpose investigation bot for diagnostics, reviews, and evidence collection.",
      system_prompt: "You are a careful investigation agent. Gather evidence first, summarize clearly, and ask before risky actions.",
      instructions: "Prefer discovery and explanation over mutation. Use intermediate reports for long runs.",
      allowed_tools: ["report", "ask_user", "analyze_output", "read_console"],
    },
  },
] as const;

function AgentForm({
  initial,
  onSave,
  onCancel,
  onOpenSkillCatalog,
  isPending,
}: {
  initial: Partial<AgentConfig>;
  onSave: (data: Partial<AgentConfig>) => void;
  onCancel: () => void;
  onOpenSkillCatalog: () => void;
  isPending: boolean;
}) {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const [form, setForm] = useState<Partial<AgentConfig>>({
    name: "",
    description: "",
    icon: "🤖",
    system_prompt: "",
    instructions: "",
    model: "gemini-2.0-flash-exp",
    max_iterations: 10,
    allowed_tools: ["ssh_execute", "report", "ask_user"],
    skill_slugs: [],
    mcp_servers: [],
    server_scope: [],
    ...initial,
  });
  const [editorSection, setEditorSection] = useState<"basics" | "behavior" | "access">("basics");

  const { data: mcpList = [] } = useQuery({ queryKey: ["studio", "mcp"], queryFn: studioMCP.list });
  const { data: servers = [] } = useQuery({ queryKey: ["studio", "servers"], queryFn: studioServers.list });
  const { data: skillList = [] } = useQuery({ queryKey: ["studio", "skills"], queryFn: studioSkills.list });

  const set = (key: keyof AgentConfig, val: unknown) => setForm((f) => ({ ...f, [key]: val }));

  const toggleTool = (toolId: string) => {
    const tools = form.allowed_tools || [];
    set("allowed_tools", tools.includes(toolId) ? tools.filter((t) => t !== toolId) : [...tools, toolId]);
  };

  const toggleMcp = (mcpId: number) => {
    const ids = (form.mcp_servers || []).map((m) => (typeof m === "number" ? m : m.id));
    const next = ids.includes(mcpId) ? ids.filter((id) => id !== mcpId) : [...ids, mcpId];
    set("mcp_servers", next as unknown as AgentConfig["mcp_servers"]);
  };

  const toggleSkill = (skillSlug: string) => {
    const slugs = form.skill_slugs || [];
    const next = slugs.includes(skillSlug) ? slugs.filter((slug) => slug !== skillSlug) : [...slugs, skillSlug];
    set("skill_slugs", next);
  };

  const mcpIds = (form.mcp_servers || []).map((m) => (typeof m === "number" ? m : m.id));
  const skillSlugs = Array.isArray(form.skill_slugs) ? form.skill_slugs : [];
  const selectedSkills = skillList.filter((skill) => skillSlugs.includes(skill.slug));
  const selectedMcpServers = mcpList.filter((mcp) => mcpIds.includes(mcp.id));
  const availablePresets = BOT_STARTER_PRESETS.filter((preset) => preset.requiredSkills.every((slug) => skillList.some((skill) => skill.slug === slug)));
  const selectedTools = ALL_TOOLS.filter((tool) => (form.allowed_tools || []).includes(tool.id));
  const toolText = (toolId: string): { label: string; desc: string } => {
    if (toolId === "ssh_execute") return { label: tr("SSH Выполнение", "SSH Execute"), desc: tr("Запуск команд на серверах", "Run commands on servers") };
    if (toolId === "read_console") return { label: tr("Чтение консоли", "Read Console"), desc: tr("Чтение вывода терминала", "Read terminal output") };
    if (toolId === "send_ctrl_c") return { label: tr("Отправить Ctrl+C", "Send Ctrl+C"), desc: tr("Прервать выполняющийся процесс", "Interrupt running process") };
    if (toolId === "open_connection") return { label: tr("Открыть соединение", "Open Connection"), desc: tr("Открыть SSH-соединение", "Open SSH connection") };
    if (toolId === "close_connection") return { label: tr("Закрыть соединение", "Close Connection"), desc: tr("Закрыть SSH-соединение", "Close SSH connection") };
    if (toolId === "wait_for_output") return { label: tr("Ждать вывод", "Wait for Output"), desc: tr("Ожидать совпадение по regex", "Wait for regex pattern") };
    if (toolId === "report") return { label: tr("Отчёт", "Report"), desc: tr("Отправить промежуточный отчёт", "Send intermediate report") };
    if (toolId === "ask_user") return { label: tr("Спросить пользователя", "Ask User"), desc: tr("Пауза и запрос ввода у оператора", "Pause and ask for input") };
    if (toolId === "analyze_output") return { label: tr("Анализ вывода", "Analyze Output"), desc: tr("LLM-анализ консольного вывода", "LLM analysis of output") };
    return { label: toolId, desc: "" };
  };
  const presetUi = (presetId: string) => {
    if (presetId === "keycloak-test") {
      return {
        label: tr("Keycloak TEST Бот", "Keycloak TEST Bot"),
        description: tr("Безопасный бот для Keycloak, закреплённый за TEST-профилем.", "Safe Keycloak bot pinned to the TEST profile."),
      };
    }
    if (presetId === "keycloak-prod") {
      return {
        label: tr("Keycloak PROD Бот", "Keycloak PROD Bot"),
        description: tr("Продакшн-бот для Keycloak с усиленными защитными ограничениями.", "Production Keycloak bot with pinned profile and stricter safety posture."),
      };
    }
    if (presetId === "investigator") {
      return {
        label: tr("Бот-исследователь", "Investigation Bot"),
        description: tr("Бот для диагностических и аналитических задач с передачей результата оператору.", "General investigation agent for read-heavy tasks and operator handoff."),
      };
    }
    return { label: presetId, description: "" };
  };

  const applyPreset = (presetId: string) => {
    const preset = availablePresets.find((item) => item.id === presetId);
    if (!preset) return;
    setForm((prev) => ({
      ...prev,
      ...preset.patch,
      skill_slugs: Array.isArray(preset.patch.skill_slugs) ? [...preset.patch.skill_slugs] : prev.skill_slugs || [],
    }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-background/24 px-3 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{form.name?.trim() || tr("Новый агент", "New agent")}</span>
        <Badge variant="outline" className="rounded-full text-[10px]">{form.model || "gemini-2.0-flash-exp"}</Badge>
        <span>{tr(`${selectedTools.length} инструментов`, `${selectedTools.length} tools`)}</span>
        <span>{tr(`${selectedMcpServers.length} MCP`, `${selectedMcpServers.length} MCP`)}</span>
        <span>{tr(`${selectedSkills.length} скиллов`, `${selectedSkills.length} skills`)}</span>
        <span>{tr(`${servers.length} серверов доступны в Studio`, `${servers.length} servers available in Studio`)}</span>
      </div>

      {availablePresets.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-background/24 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs">{tr("Быстрый старт", "Quick start")}</Label>
              <p className="mt-1 text-[11px] text-muted-foreground">{tr("Если нужен типовой бот, начните с пресета и потом сузьте доступ вручную.", "Start from a preset if you need a standard bot, then narrow its access manually.")}</p>
            </div>
            <Badge variant="outline" className="rounded-full text-[10px]">
              {availablePresets.length} {tr("доступно", "available")}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {availablePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="rounded-xl border border-border/70 bg-background/24 px-3 py-3 text-left transition-[border-color,background-color] hover:border-border hover:bg-background/36"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">{presetUi(preset.id).label}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{presetUi(preset.id).description}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{tr("Применить", "Use")}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="workspace-subtle rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {([
            {
              id: "basics",
              label: tr("1. Основа", "1. Basics"),
              description: tr("Имя, модель и назначение", "Name, model and purpose"),
            },
            {
              id: "behavior",
              label: tr("2. Поведение", "2. Behavior"),
              description: tr("Prompt и правила работы", "Prompt and operating rules"),
            },
            {
              id: "access",
              label: tr("3. Доступ", "3. Access"),
              description: tr("Инструменты, MCP и скиллы", "Tools, MCP and skills"),
            },
          ] as const).map((section) => {
            const active = editorSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setEditorSection(section.id)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/35 hover:text-foreground"
                }`}
              >
                <div className="text-xs font-medium">{section.label}</div>
                <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{section.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {editorSection === "basics" && (
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-4">
              <p className="enterprise-kicker">{tr("Основа", "Basics")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Дайте агенту понятное имя и короткое описание. Это профиль, который потом выбирают в pipeline nodes.", "Give the agent a clear name and a short description. This profile is later selected inside pipeline nodes.")}</p>
            </div>

            <div className="flex gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Иконка", "Icon")}</Label>
                <Input value={form.icon || "🤖"} onChange={(e) => set("icon", e.target.value)} className="h-11 w-16 rounded-md text-center text-xl" />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{tr("Название *", "Name *")}</Label>
                <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder={tr("Мой DevOps-агент", "My DevOps Agent")} className="h-11 rounded-md" />
              </div>
            </div>

            <div className="mt-4 space-y-1.5">
              <Label className="text-xs">{tr("Описание", "Description")}</Label>
              <Input
                value={form.description || ""}
                onChange={(e) => set("description", e.target.value)}
                placeholder={tr("Что делает этот агент...", "What this agent does...")}
                className="h-11 rounded-md"
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("LLM-модель", "LLM Model")}</Label>
                <Select value={form.model || "gemini-2.0-flash-exp"} onValueChange={(v) => set("model", v)}>
                  <SelectTrigger className="h-11 rounded-md text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LLM_MODELS.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr("Макс. итераций", "Max Iterations")}</Label>
                <Input
                  type="number"
                  value={form.max_iterations || 10}
                  onChange={(e) => set("max_iterations", parseInt(e.target.value) || 10)}
                  min={1}
                  max={50}
                  className="h-11 rounded-md text-xs"
                />
              </div>
            </div>
          </div>
          )}

          {editorSection === "behavior" && (
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-4">
              <p className="enterprise-kicker">{tr("Поведение", "Behavior")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Здесь только базовые рабочие инструкции. Повторяемые регламенты и ограничения лучше выносить в скиллы.", "Keep only the core operating instructions here. Reusable procedures and guardrails work better as skills.")}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{tr("System Prompt", "System Prompt")}</Label>
              <Textarea
                value={form.system_prompt || ""}
                onChange={(e) => set("system_prompt", e.target.value)}
                placeholder={tr("Вы DevOps-агент. Действуйте кратко и всегда проверяйте перед разрушительными действиями...", "You are a DevOps agent. Be concise and always verify before taking destructive actions...")}
                className="min-h-[120px] rounded-md text-xs resize-y"
                rows={5}
              />
            </div>

            <div className="mt-4 space-y-1.5">
              <Label className="text-xs">{tr("Инструкции / Правила", "Instructions / Rules")}</Label>
              <Textarea
                value={form.instructions || ""}
                onChange={(e) => set("instructions", e.target.value)}
                placeholder={tr("Всегда сначала запускай `df -h` для проверки диска. Никогда не запускай rm -rf...", "Always run `df -h` first to check disk space. Never run rm -rf...")}
                className="min-h-[140px] rounded-md text-xs resize-y"
                rows={6}
              />
            </div>
          </div>
          )}

          {editorSection === "access" && (
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-background/30 text-muted-foreground">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <p className="enterprise-kicker">{tr("Инструменты", "Tools")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{tr("Оставьте только те действия, которые реально нужны этому профилю. Чем уже доступ, тем проще контролировать поведение.", "Keep only the actions this profile truly needs. A narrower tool surface is easier to reason about and safer to operate.")}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ALL_TOOLS.map((tool) => (
                <label key={tool.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background/30 p-3 transition-colors hover:bg-background/40">
                  <Checkbox
                    checked={(form.allowed_tools || []).includes(tool.id)}
                    onCheckedChange={() => toggleTool(tool.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium">{toolText(tool.id).label}</div>
                    <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{toolText(tool.id).desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          )}

          {editorSection === "access" && mcpList.length > 0 && (
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-background/30 text-muted-foreground">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <p className="enterprise-kicker">{tr("MCP-серверы", "MCP Servers")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{tr("Подключайте только те сервисные поверхности, с которыми бот действительно должен работать.", "Attach only the service surfaces this bot should actually work with.")}</p>
              </div>
            </div>

            <div className="space-y-2">
              {mcpList.map((mcp) => (
                <label key={mcp.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-background/30 px-3 py-3 transition-colors hover:bg-background/40">
                  <Checkbox
                    checked={mcpIds.includes(mcp.id)}
                    onCheckedChange={() => toggleMcp(mcp.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium">{mcp.name}</span>
                      <span className="text-[10px] text-muted-foreground">{mcp.transport}</span>
                      {mcp.last_test_ok === true && <span className="text-[10px] text-muted-foreground">OK</span>}
                      {mcp.last_test_ok === false && <span className="text-[10px] text-red-300">ERR</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          )}

          {editorSection === "access" && skillList.length > 0 && (
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="max-w-lg">
                <p className="enterprise-kicker">{tr("Скиллы", "Skills")}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {tr("Подключайте скиллы только там, где нужен повторяемый процесс, pinned context или строгие guardrails.", "Attach skills only when the agent needs a repeatable process, pinned context, or strict guardrails.")}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-md px-3 text-[11px]" onClick={onOpenSkillCatalog}>
                <BookOpen className="h-3 w-3" />
                {tr("Открыть каталог", "Browse Catalog")}
              </Button>
            </div>

            <div className="space-y-2">
              {skillList.map((skill) => (
                <label key={skill.slug} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background/30 px-3 py-3 transition-colors hover:bg-background/40">
                  <Checkbox
                    checked={skillSlugs.includes(skill.slug)}
                    onCheckedChange={() => toggleSkill(skill.slug)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium">{skill.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{skill.slug}</span>
                      {skill.runtime_enforced && <span className="text-[10px] text-muted-foreground">{tr("runtime enforced", "runtime enforced")}</span>}
                      {skill.safety_level && <span className="text-[10px] text-muted-foreground">· {skill.safety_level}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {skill.service && <span className="text-[10px] text-muted-foreground">{skill.service}</span>}
                      {skill.category && <span className="text-[10px] text-muted-foreground">· {skill.category}</span>}
                    </div>
                    {skill.description && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{skill.description}</p>}
                    {skill.guardrail_summary?.length > 0 && (
                      <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{skill.guardrail_summary[0]}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-3">
              <p className="enterprise-kicker">{tr("Чеклист", "Checklist")}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {tr(
                  "Собирайте профиль по шагам: сначала смысл и модель, потом поведение, потом доступы. Так проще не выдать лишнее раньше времени.",
                  "Build the profile step by step: first purpose and model, then behavior, then access. It is easier to avoid granting too much too early.",
                )}
              </p>
            </div>
            <div className="space-y-2 text-xs">
              <div className={`rounded-md border px-3 py-2 ${editorSection === "basics" ? "border-border bg-background/45 text-foreground" : "border-border/70 bg-background/20 text-muted-foreground"}`}>
                {tr("1. Основа: имя, описание, модель, лимит итераций", "1. Basics: name, description, model, iteration limit")}
              </div>
              <div className={`rounded-md border px-3 py-2 ${editorSection === "behavior" ? "border-border bg-background/45 text-foreground" : "border-border/70 bg-background/20 text-muted-foreground"}`}>
                {tr("2. Поведение: системный prompt и рабочие правила", "2. Behavior: system prompt and working rules")}
              </div>
              <div className={`rounded-md border px-3 py-2 ${editorSection === "access" ? "border-border bg-background/45 text-foreground" : "border-border/70 bg-background/20 text-muted-foreground"}`}>
                {tr("3. Доступ: инструменты, MCP и скиллы", "3. Access: tools, MCP and skills")}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/24 p-4">
            <div className="mb-3">
              <p className="enterprise-kicker">{tr("Текущий профиль", "Current profile")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Перед сохранением быстро проверьте, что профиль не получил лишний доступ.", "Before saving, do a quick pass to make sure the profile did not get broader access than intended.")}</p>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
                <div className="text-[11px] font-medium text-muted-foreground">{tr("Выбранные инструменты", "Selected tools")}</div>
                <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  {selectedTools.length > 0 ? (
                    selectedTools.map((tool) => toolText(tool.id).label).join(" · ")
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{tr("Инструменты ещё не выбраны.", "No tools selected yet.")}</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
                <div className="text-[11px] font-medium text-muted-foreground">{tr("Подключённые MCP", "Attached MCP")}</div>
                <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                  {selectedMcpServers.length > 0 ? (
                    selectedMcpServers.map((mcp) => (
                      <div key={mcp.id} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-foreground">{mcp.name}</span>
                        <span className="text-muted-foreground">{mcp.transport}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{tr("MCP-серверы ещё не выбраны.", "No MCP servers selected yet.")}</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium text-muted-foreground">{tr("Скиллы и guardrails", "Skills and guardrails")}</div>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={onOpenSkillCatalog}>
                    <BookOpen className="h-3 w-3" />
                    {tr("Каталог", "Catalog")}
                  </Button>
                </div>
                <div className="space-y-2 text-[11px] text-muted-foreground">
                  {selectedSkills.length > 0 ? (
                    selectedSkills.map((skill) => (
                      <div key={skill.slug} className="rounded-lg border border-border/60 bg-background/24 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground">{skill.name}</span>
                          {skill.runtime_enforced && <span className="text-[10px] text-muted-foreground">{tr("enforced", "enforced")}</span>}
                          {skill.safety_level && <span className="text-[10px] text-muted-foreground">· {skill.safety_level}</span>}
                        </div>
                        {skill.guardrail_summary?.length > 0 && (
                          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{skill.guardrail_summary[0]}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{tr("Скиллы не выбраны. Если у бота есть строгий процесс работы, подключите его здесь.", "No skills selected. Attach them here if this bot must follow a strict operating playbook.")}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {editorSection === "access" && form.skill_errors && form.skill_errors.length > 0 && (
            <div className="rounded-md border border-red-500/30 bg-red-900/10 px-4 py-3">
              <p className="text-xs font-medium text-red-300">{tr("Проблемы конфигурации скиллов", "Skill configuration issues")}</p>
              <div className="mt-2 space-y-1">
                {form.skill_errors.map((item) => (
                  <p key={item} className="text-[11px] leading-5 text-red-200">{item}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="h-9 rounded-md px-4">{tr("Отмена", "Cancel")}</Button>
        <Button size="sm" onClick={() => onSave(form)} disabled={!form.name?.trim() || isPending} className="h-9 gap-1.5 rounded-md px-4">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {tr("Сохранить агента", "Save Agent")}
        </Button>
      </div>
    </div>
  );
}

export default function AgentConfigPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editAgent, setEditAgent] = useState<Partial<AgentConfig> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentConfig | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["studio", "agents"],
    queryFn: studioAgents.list,
  });
  const { data: skills = [] } = useQuery({
    queryKey: ["studio", "skills"],
    queryFn: studioSkills.list,
  });
  const agentsWithSkills = agents.filter((agent) => (agent.skills?.length || agent.skill_slugs?.length || 0) > 0).length;
  const agentsWithMcp = agents.filter((agent) => (agent.mcp_servers?.length || 0) > 0).length;
  const constrainedAgents = agents.filter((agent) => (agent.allowed_tools?.length || 0) <= 3).length;

  const createMutation = useMutation({
    mutationFn: (data: Partial<AgentConfig>) => studioAgents.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setEditAgent(null);
      toast({ description: tr("Агент создан", "Agent created") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AgentConfig> }) => studioAgents.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setEditAgent(null);
      toast({ description: tr("Агент обновлён", "Agent updated") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioAgents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setDeleteTarget(null);
      toast({ description: tr("Агент удалён", "Agent deleted") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const handleSave = (data: Partial<AgentConfig>) => {
    const payload: Partial<AgentConfig> = {
      ...data,
      skill_slugs: data.skill_slugs || data.skills?.map((skill) => skill.slug) || [],
    };
    if ((editAgent as AgentConfig)?.id) {
      updateMutation.mutate({ id: (editAgent as AgentConfig).id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <PageShell width="full" className="space-y-5">
      <section className="rounded-xl border border-border/70 bg-background/24 px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md" onClick={() => navigate("/studio")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Studio builder", "Studio builder")}</div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{tr("Конфиги агентов", "Agent Configs")}</h1>
              </div>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {tr(
                "Это библиотека переиспользуемых профилей для pipeline nodes. Делайте их узкими по доступу и понятными по назначению.",
                "This is a library of reusable profiles for pipeline nodes. Keep them narrow in access and clear in purpose.",
              )}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>{tr(`${agents.length} конфигов`, `${agents.length} configs`)}</span>
              <span>{tr(`${skills.length} skills в библиотеке`, `${skills.length} skills in library`)}</span>
              <span>{tr(`${agentsWithMcp} с MCP`, `${agentsWithMcp} with MCP`)}</span>
              <span>{tr(`${agentsWithSkills} со скиллами`, `${agentsWithSkills} with skills`)}</span>
              <span>{tr(`${constrainedAgents} узких профилей`, `${constrainedAgents} tightly scoped`)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-md px-3">
              <BookOpen className="h-3.5 w-3.5" />
              {tr("Каталог скиллов", "Skill Catalog")}
            </Button>
            <Button size="sm" onClick={() => setEditAgent({})} className="h-9 gap-1.5 rounded-md px-4">
              <Plus className="h-3.5 w-3.5" />
              {tr("Новый агент", "New Agent")}
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border/70 bg-background/24">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-medium text-foreground">{tr("Сохранённые профили", "Saved profiles")}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {tr(
              "Открывайте профиль, если нужно скорректировать prompt, сузить инструменты или подключить новый playbook через skill.",
              "Open a profile when you need to adjust the prompt, narrow its tools, or attach a new playbook through a skill.",
            )}
          </p>
        </div>
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {tr("Загрузка...", "Loading...")}
          </div>
        ) : agents.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              icon={<Bot className="h-5 w-5" />}
              title={tr("Пока нет ни одного профиля агента", "No agent profiles yet")}
              description={tr(
                "Создайте первый профиль, чтобы собрать в одном месте модель, prompt, инструменты, MCP и skills для будущих запусков.",
                "Create the first profile to gather the model, prompt, tools, MCP, and skills in one place for future runs.",
              )}
              actions={
                <>
                  <Button size="sm" onClick={() => setEditAgent({})} className="h-9 gap-1.5 rounded-md px-4">
                    <Plus className="h-3.5 w-3.5" />
                    {tr("Новый конфиг агента", "New Agent Config")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-md px-4">
                    <BookOpen className="h-3.5 w-3.5" />
                    {tr("Открыть Skill Catalog", "Open Skill Catalog")}
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {agents.map((agent) => (
              <div key={agent.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-transparent bg-background/30 text-xl text-muted-foreground">
                      <span>{agent.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-medium text-foreground">{agent.name}</h2>
                        <Badge variant="outline" className="rounded-full text-[10px]">{agent.model}</Badge>
                      </div>
                      {agent.description && <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{agent.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{agent.max_iterations} {tr("итераций", "iterations")}</span>
                        <span>{tr(`${agent.allowed_tools?.length || 0} инструментов`, `${agent.allowed_tools?.length || 0} tools`)}</span>
                        <span>{tr(`${agent.skill_slugs?.length || agent.skills?.length || 0} guardrails`, `${agent.skill_slugs?.length || agent.skills?.length || 0} guardrails`)}</span>
                        <span>{tr(`${agent.mcp_servers?.length || 0} MCP`, `${agent.mcp_servers?.length || 0} MCP`)}</span>
                      </div>
                      {agent.allowed_tools?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {agent.allowed_tools.slice(0, 4).map((t) => (
                            <span key={t} className="rounded-full bg-background/35 px-1.5 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                          ))}
                          {agent.allowed_tools.length > 4 && (
                            <span className="text-[9px] text-muted-foreground">+{agent.allowed_tools.length - 4} {tr("ещё", "more")}</span>
                          )}
                        </div>
                      )}
                      {agent.skill_errors?.length > 0 && (
                        <div className="mt-3 rounded-md border border-red-500/20 bg-red-900/10 px-3 py-2 text-[10px] text-red-200">
                          {agent.skill_errors[0]}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 lg:shrink-0">
                  <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-md px-3" onClick={() => setEditAgent(agent)}>
                    <Pencil className="h-3.5 w-3.5" />
                    {tr("Изменить", "Edit")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-9 gap-1.5 rounded-md px-3 text-muted-foreground">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                        {tr("Ещё", "More")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem className="text-red-300 focus:text-red-200" onClick={() => setDeleteTarget(agent)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        {tr("Удалить", "Delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Edit/Create Dialog */}
      <Dialog open={!!editAgent} onOpenChange={(o) => !o && setEditAgent(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-auto rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{(editAgent as AgentConfig)?.id ? tr("Изменить конфиг агента", "Edit Agent Config") : tr("Новый конфиг агента", "New Agent Config")}</DialogTitle>
          </DialogHeader>
          {editAgent && (
            <AgentForm
              initial={editAgent}
              onSave={handleSave}
              onCancel={() => setEditAgent(null)}
              onOpenSkillCatalog={() => navigate("/studio/skills")}
              isPending={createMutation.isPending || updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Удалить конфиг агента", "Delete Agent Config")}</DialogTitle>
            <DialogDescription>{tr(`Удалить "${deleteTarget?.name}"? Действие нельзя отменить.`, `Delete "${deleteTarget?.name}"? This cannot be undone.`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{tr("Отмена", "Cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {tr("Удалить", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
