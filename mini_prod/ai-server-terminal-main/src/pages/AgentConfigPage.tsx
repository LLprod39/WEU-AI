import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Save, Loader2, Bot, ArrowLeft, BookOpen, Server, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  MetricCard,
  MetricGrid,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    requiredSkills: ["keycloak-safety", "keycloak-test-profile"],
    patch: {
      name: "Keycloak TEST Bot",
      description: "Service bot for Keycloak TEST tasks with enforced profile guardrails.",
      system_prompt: "You are a cautious Keycloak operator. Work only through attached MCP tools and stop instead of guessing.",
      instructions: "Before mutating anything, read the relevant skills, confirm the environment, discover the exact target, then verify the final state.",
      allowed_tools: ["report", "ask_user", "analyze_output"],
      skill_slugs: ["keycloak-safety", "keycloak-test-profile"],
    },
  },
  {
    id: "keycloak-prod",
    label: "Keycloak PROD Bot",
    description: "Production Keycloak bot with pinned profile and stricter safety posture.",
    requiredSkills: ["keycloak-safety", "keycloak-prod-profile"],
    patch: {
      name: "Keycloak PROD Bot",
      description: "Production Keycloak bot with enforced profile pinning and mandatory preflight guardrails.",
      system_prompt: "You are a production Keycloak operator. Be deterministic, conservative, and stop whenever a target is ambiguous.",
      instructions: "Read the attached skills before service-specific changes. Resolve exact targets, run preflight before mutations, and verify everything after changes.",
      allowed_tools: ["report", "ask_user", "analyze_output"],
      skill_slugs: ["keycloak-safety", "keycloak-prod-profile"],
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
  const availablePresets = BOT_STARTER_PRESETS.filter((preset) => preset.requiredSkills.every((slug) => skillList.some((skill) => skill.slug === slug)));
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
      <div className="enterprise-panel rounded-md px-4 py-4">
        <p className="enterprise-kicker">{tr("Гид по сборке агента", "Agent Assembly Guide")}</p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="enterprise-stat rounded-md px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Профиль", "Profile")}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{tr("Начните с пресета или опишите бота вручную.", "Start from a preset or describe the bot plainly.")}</p>
          </div>
          <div className="enterprise-stat rounded-md px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Доступ", "Access")}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{tr("Подключайте только те MCP и инструменты, которые реально нужны.", "Attach only the MCP servers and tools the bot truly needs.")}</p>
          </div>
          <div className="enterprise-stat rounded-md px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Плейбук", "Playbook")}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{tr("Добавьте скиллы, чтобы бот следовал корпоративному процессу, а не импровизировал.", "Add skill packs so the bot follows your company workflow, not guesswork.")}</p>
          </div>
          <div className="enterprise-stat rounded-md px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Ограничения", "Guardrails")}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{tr("Проверьте runtime-политику перед сохранением продакшн-конфига.", "Review runtime enforcement before saving the config into production use.")}</p>
          </div>
        </div>
      </div>

      {availablePresets.length > 0 && (
        <div className="rounded-md border border-border bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs">{tr("Стартовые пресеты", "Starter Presets")}</Label>
              <p className="mt-1 text-[11px] text-muted-foreground">{tr("Используйте их как безопасную базу для типовых корпоративных ботов.", "Use these as a safe baseline for common enterprise bots.")}</p>
            </div>
            <Badge variant="secondary" className="rounded-full text-[10px]">
              {availablePresets.length} {tr("доступно", "available")}
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {availablePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className="rounded-md border border-border bg-background/50 px-3 py-3 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-muted/20"
              >
                <p className="text-xs font-medium">{presetUi(preset.id).label}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{presetUi(preset.id).description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-card/70 p-4">
            <div className="mb-4">
              <p className="enterprise-kicker">{tr("Профиль бота", "Bot Profile")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Идентичность, модель и рабочий профиль, который бот будет держать между запусками.", "Identity, model choice, and the operating profile this bot should keep across runs.")}</p>
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

          <div className="rounded-md border border-border bg-card/70 p-4">
            <div className="mb-4">
              <p className="enterprise-kicker">{tr("Контракт поведения", "Behavior Contract")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tr("Держите промпты операционными и предсказуемыми. Жёсткие правила выносите в скиллы.", "Keep prompts clean and operational. Put hard workflow rules into skills whenever possible.")}</p>
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

          <div className="rounded-md border border-border bg-card/70 p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-primary/15 bg-primary/10">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="enterprise-kicker">{tr("Доступ к инструментам", "Tool Access")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{tr("Сужайте зону действий. Самый надёжный корпоративный бот — тот, который не может выйти за рамки.", "Reduce the action surface. The most reliable enterprise bot is the one that cannot overreach.")}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ALL_TOOLS.map((tool) => (
                <label key={tool.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/45 p-3 transition-colors hover:bg-muted/20">
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
        </div>

        <div className="space-y-4">
          {mcpList.length > 0 && (
            <div className="rounded-md border border-border bg-card/70 p-4">
              <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-primary/15 bg-primary/10">
                  <Server className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="enterprise-kicker">{tr("MCP-серверы", "MCP Servers")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{tr("Подключённые серверы дают доступ к реальным сервисным инструментам для запусков пайплайнов.", "Attached servers expose the real service tools this bot may call during pipeline runs.")}</p>
                </div>
              </div>

              <div className="space-y-2">
                {mcpList.map((mcp) => (
                  <label key={mcp.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background/45 px-3 py-3 transition-colors hover:bg-muted/20">
                    <Checkbox
                      checked={mcpIds.includes(mcp.id)}
                      onCheckedChange={() => toggleMcp(mcp.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{mcp.name}</span>
                        <span className="text-[10px] text-muted-foreground">{mcp.transport}</span>
                      </div>
                    </div>
                    {mcp.last_test_ok === true && <Badge variant="default" className="text-[9px] px-1.5 py-0">OK</Badge>}
                    {mcp.last_test_ok === false && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">ERR</Badge>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {skillList.length > 0 && (
            <div className="rounded-md border border-border bg-card/70 p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="max-w-lg">
                  <p className="enterprise-kicker">{tr("Пакеты скиллов", "Skill Packs")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {tr("Скиллы обучают бота корпоративному плейбуку. Сначала агент видит каталог, затем при необходимости открывает полный скилл.", "Skills teach the bot your company playbook. The agent sees a catalog first, then opens the full skill on demand.")}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    {tr("Когда подключен хотя бы один скилл, рантайм автоматически включает внутренние действия `list_skills` и `read_skill`.", "When at least one skill is attached, runtime automatically enables the internal `list_skills` and `read_skill` actions.")}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-md px-3 text-[11px]" onClick={onOpenSkillCatalog}>
                  <BookOpen className="h-3 w-3" />
                  {tr("Открыть каталог", "Browse Catalog")}
                </Button>
              </div>

              <div className="space-y-2">
                {skillList.map((skill) => (
                  <label key={skill.slug} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/45 px-3 py-3 transition-colors hover:bg-muted/20">
                    <Checkbox
                      checked={skillSlugs.includes(skill.slug)}
                      onCheckedChange={() => toggleSkill(skill.slug)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium">{skill.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{skill.slug}</span>
                        {skill.runtime_enforced && <Badge variant="secondary" className="text-[9px]">{tr("runtime enforced", "runtime enforced")}</Badge>}
                        {skill.safety_level && <Badge variant="outline" className="text-[9px]">{skill.safety_level}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {skill.service && <span className="text-[10px] text-muted-foreground">{skill.service}</span>}
                        {skill.category && <span className="text-[10px] text-muted-foreground">· {skill.category}</span>}
                      </div>
                      {skill.description && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{skill.description}</p>}
                      {skill.ui_hint && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{skill.ui_hint}</p>}
                      {skill.recommended_tools?.length > 0 && (
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          {tr("Рекомендуемые инструменты агента", "Recommended agent tools")}: {skill.recommended_tools.join(", ")}
                        </p>
                      )}
                      {skill.guardrail_summary?.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {skill.guardrail_summary.map((item) => (
                            <p key={item} className="text-[10px] text-muted-foreground">• {item}</p>
                          ))}
                        </div>
                      )}
                      {skill.tags?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {skill.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectedSkills.length > 0 && (
            <div className="rounded-md border border-border bg-card/70 p-4">
              <div className="mb-4">
                <p className="enterprise-kicker">{tr("Предпросмотр ограничений", "Guardrails Preview")}</p>
                <p className="mt-2 text-sm text-muted-foreground">{tr("Эти policy-пакеты будут идти вместе с агентом в каждый подключённый узел пайплайна.", "These policy packs will travel with the agent into every attached pipeline node.")}</p>
              </div>

              <div className="space-y-2">
                {selectedSkills.map((skill) => (
                  <div key={skill.slug} className="rounded-md border border-border bg-background/45 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium">{skill.name}</p>
                      {skill.runtime_enforced && <Badge variant="secondary" className="text-[9px]">{tr("enforced", "enforced")}</Badge>}
                      {skill.safety_level && <Badge variant="outline" className="text-[9px]">{skill.safety_level}</Badge>}
                    </div>
                    {skill.guardrail_summary?.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {skill.guardrail_summary.map((item) => (
                          <p key={item} className="text-[10px] text-muted-foreground">• {item}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {form.skill_errors && form.skill_errors.length > 0 && (
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
    <PageShell className="space-y-6">
      <PageHero
        kicker={tr("Reusable Bot Profiles", "Reusable Bot Profiles")}
        title={tr("Конфиги агентов", "Agent Configs")}
        description={
          <>
            {tr(
              "Упаковывайте prompts, tools, MCP-серверы и skills в переиспользуемые bot profiles, которые затем подключаются к pipeline nodes.",
              "Package prompts, tools, MCP servers, and skills into reusable bot profiles that are later attached to pipeline nodes.",
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => navigate("/studio")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <StatusBadge label={tr("builder layer", "builder layer")} tone="info" />
              <span>{tr("Это не runtime fleet page. Живые исполнения находятся в /agents.", "This is not the runtime fleet page. Live executions live in /agents.")}</span>
            </div>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-xl px-3">
              <BookOpen className="h-3.5 w-3.5" />
              {tr("Каталог скиллов", "Skill Catalog")}
            </Button>
            <Button size="sm" onClick={() => setEditAgent({})} className="h-9 gap-1.5 rounded-xl px-4">
              <Plus className="h-3.5 w-3.5" />
              {tr("Новый агент", "New Agent")}
            </Button>
          </div>
        }
      >
        <MetricGrid>
          <MetricCard
            label={tr("Configs", "Configs")}
            value={agents.length}
            description={tr("Сохранённые agent profiles в текущем пространстве Studio.", "Saved agent profiles in the current Studio workspace.")}
            icon={<Bot className="h-5 w-5 text-primary" />}
            tone="info"
          />
          <MetricCard
            label={tr("Connected to MCP", "Connected to MCP")}
            value={agentsWithMcp}
            description={tr("Конфиги, уже связанные с рабочими MCP-service surfaces.", "Configs already bound to live MCP service surfaces.")}
            icon={<Server className="h-5 w-5 text-sky-300" />}
            tone="info"
          />
          <MetricCard
            label={tr("With Skills", "With Skills")}
            value={agentsWithSkills}
            description={tr("Профили, уже использующие корпоративные playbook-ограничения.", "Profiles already using corporate playbook constraints.")}
            icon={<BookOpen className="h-5 w-5 text-violet-300" />}
            tone="warning"
          />
          <MetricCard
            label={tr("Tightly scoped", "Tightly scoped")}
            value={constrainedAgents}
            description={tr("Конфиги с минимальной инструментальной поверхностью.", "Configs with a narrow tool surface.")}
            icon={<Shield className="h-5 w-5 text-emerald-300" />}
            tone="success"
          />
        </MetricGrid>
      </PageHero>

      <SectionCard
        title={tr("How this layer fits", "How this layer fits")}
        description={tr(
          "Agent Configs sit between Skills/MCP and Pipelines. They are reusable execution profiles, not daily operator controls.",
          "Agent Configs sit between Skills/MCP and Pipelines. They are reusable execution profiles, not daily operator controls.",
        )}
        icon={<Bot className="h-4 w-4 text-primary" />}
      >
        {isLoading ? (
          <div className="enterprise-panel flex h-40 items-center justify-center rounded-md text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {tr("Загрузка...", "Loading...")}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-5 w-5" />}
            title={tr("No reusable agent profiles yet", "No reusable agent profiles yet")}
            description={tr(
              "Создайте config, чтобы упаковать prompts, tools, MCP-services и skills в переиспользуемый bot profile для pipelines.",
              "Create a config to package prompts, tools, MCP services, and skills into a reusable bot profile for pipelines.",
            )}
            actions={
              <>
                <Button size="sm" onClick={() => setEditAgent({})} className="h-9 gap-1.5 rounded-xl px-4">
                  <Plus className="h-3.5 w-3.5" />
                  {tr("Новый конфиг агента", "New Agent Config")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-xl px-4">
                  <BookOpen className="h-3.5 w-3.5" />
                  {tr("Открыть Skill Catalog", "Open Skill Catalog")}
                </Button>
              </>
            }
            hint={tr(
              "Частая последовательность: MCP service -> Skill -> Agent Config -> Pipeline node -> Run inspection.",
              "Common build order: MCP service -> Skill -> Agent Config -> Pipeline node -> Run inspection.",
            )}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <Card key={agent.id} className="group overflow-hidden rounded-md border-border bg-card transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/15 bg-primary/10 text-xl">
                        <span>{agent.icon}</span>
                      </div>
                      <div>
                        <CardTitle className="text-sm">{agent.name}</CardTitle>
                        <p className="mt-1 text-[11px] text-muted-foreground">{agent.max_iterations} {tr("итераций", "iterations")} · {agent.model}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/60 p-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => setEditAgent(agent)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive hover:text-destructive" onClick={() => setDeleteTarget(agent)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {agent.description && <p className="text-[12px] leading-5 text-muted-foreground">{agent.description}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="rounded-full text-[10px]">{agent.max_iterations} {tr("итерац.", "iter")}</Badge>
                    {agent.mcp_servers?.length > 0 && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">{agent.mcp_servers.length} MCP</Badge>
                    )}
                    {agent.skills?.length > 0 && (
                      <Badge variant="secondary" className="rounded-full text-[10px]">{agent.skills.length} {tr("скиллов", "skills")}</Badge>
                    )}
                  </div>
                  {agent.allowed_tools?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.allowed_tools.slice(0, 4).map((t) => (
                        <span key={t} className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                      ))}
                      {agent.allowed_tools.length > 4 && (
                        <span className="text-[9px] text-muted-foreground">+{agent.allowed_tools.length - 4} {tr("ещё", "more")}</span>
                      )}
                    </div>
                  )}
                  {agent.skill_errors?.length > 0 && (
                    <div className="rounded-md border border-red-500/20 bg-red-900/10 px-3 py-2 text-[10px] text-red-200">
                      {agent.skill_errors[0]}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </SectionCard>

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
