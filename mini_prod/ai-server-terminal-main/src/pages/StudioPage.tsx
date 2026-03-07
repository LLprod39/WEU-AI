import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Play,
  Pencil,
  Copy,
  Trash2,
  Search,
  Workflow,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Bot,
  BookOpen,
  Server,
  Zap,
  Bell,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  MetricCard,
  MetricGrid,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  studioAgents,
  studioMCP,
  studioPipelines,
  studioSkills,
  studioTemplates,
  studioNotifications,
  type PipelineListItem,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function RunStatusBadge({ status, lang }: { status: string; lang: "ru" | "en" }) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const map: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    completed: { label: tr("Выполнен", "Completed"), icon: <CheckCircle2 className="h-3 w-3" />, variant: "default" },
    failed: { label: tr("Ошибка", "Failed"), icon: <XCircle className="h-3 w-3" />, variant: "destructive" },
    running: { label: tr("Выполняется", "Running"), icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" },
    pending: { label: tr("Ожидание", "Pending"), icon: <Clock className="h-3 w-3" />, variant: "outline" },
    stopped: { label: tr("Остановлен", "Stopped"), icon: <XCircle className="h-3 w-3" />, variant: "outline" },
  };
  const s = map[status] || { label: status, icon: null, variant: "outline" as const };
  return (
    <Badge variant={s.variant} className="flex items-center gap-1 text-xs">
      {s.icon}
      {s.label}
    </Badge>
  );
}

function PipelineCard({
  pipeline,
  onEdit,
  onRun,
  onClone,
  onDelete,
  lang,
}: {
  pipeline: PipelineListItem;
  onEdit: () => void;
  onRun: () => void;
  onClone: () => void;
  onDelete: () => void;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const updatedAgo = (() => {
    const diff = Date.now() - new Date(pipeline.updated_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return tr("только что", "just now");
    if (m < 60) return lang === "ru" ? `${m} мин назад` : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return lang === "ru" ? `${h} ч назад` : `${h}h ago`;
    return lang === "ru" ? `${Math.floor(h / 24)} дн назад` : `${Math.floor(h / 24)}d ago`;
  })();

  return (
    <Card className="group overflow-hidden rounded-md border-border bg-card transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-none">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/10 text-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <span>{pipeline.icon || "⚡"}</span>
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base leading-tight">{pipeline.name}</CardTitle>
              {pipeline.description && (
                <CardDescription className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                  {pipeline.description}
                </CardDescription>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/60 p-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={onEdit} title={tr("Редактировать", "Edit")}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={onClone} title={tr("Клонировать", "Clone")}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-destructive hover:text-destructive" onClick={onDelete} title={tr("Удалить", "Delete")}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Workflow className="h-3 w-3" />
            {pipeline.node_count} {tr("нод", "nodes")}
          </span>
          <span>·</span>
          <span>{updatedAgo}</span>
        </div>

        {pipeline.tags && pipeline.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pipeline.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border/70 pt-3">
          {pipeline.last_run ? (
            <RunStatusBadge status={pipeline.last_run.status} lang={lang} />
          ) : (
            <span className="text-[11px] text-muted-foreground">{tr("Ни разу не запускался", "Never run")}</span>
          )}
          <Button size="sm" className="h-8 gap-1.5 rounded-md px-3 text-[11px]" onClick={onRun}>
            <Play className="h-3 w-3" />
            {tr("Запустить", "Run")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreatePipelineDialog({
  open,
  onClose,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("⚡");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string; icon: string }) =>
      studioPipelines.create({ ...data, nodes: [], edges: [] }),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      toast({ description: tr(`Пайплайн "${pipeline.name}" создан`, `Pipeline "${pipeline.name}" created`) });
      onClose();
      navigate(`/studio/pipeline/${pipeline.id}`);
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-md border-border bg-background/95">
        <DialogHeader>
          <DialogTitle>{tr("Новый пайплайн", "New Pipeline")}</DialogTitle>
          <DialogDescription>{tr("Создайте новый пайплайн автоматизации DevOps", "Create a new DevOps automation pipeline")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-16 text-center text-xl"
              placeholder="⚡"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("Название пайплайна", "Pipeline name")}
              className="flex-1"
              autoFocus
            />
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tr("Описание (необязательно)", "Description (optional)")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tr("Отмена", "Cancel")}</Button>
          <Button
            onClick={() => createMutation.mutate({ name, description, icon })}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {tr("Создать и открыть", "Create & Edit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StudioPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PipelineListItem | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: pipelines = [], isLoading } = useQuery({
    queryKey: ["studio", "pipelines", search],
    queryFn: () => studioPipelines.list(search || undefined),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["studio", "templates"],
    queryFn: studioTemplates.list,
  });

  const { data: agentConfigs = [] } = useQuery({
    queryKey: ["studio", "agents"],
    queryFn: studioAgents.list,
  });

  const { data: skills = [] } = useQuery({
    queryKey: ["studio", "skills"],
    queryFn: studioSkills.list,
  });

  const { data: mcpServers = [] } = useQuery({
    queryKey: ["studio", "mcp"],
    queryFn: studioMCP.list,
  });

  // Check if notifications are configured (to show a warning badge)
  const { data: notifCfg } = useQuery({
    queryKey: ["studio", "notifications"],
    queryFn: studioNotifications.get,
  });
  const notifUnconfigured =
    !notifCfg?.telegram_bot_token?.trim() && !notifCfg?.smtp_user?.trim();
  const runningPipelines = pipelines.filter((item) => item.last_run?.status === "running").length;
  const failingPipelines = pipelines.filter((item) => item.last_run?.status === "failed").length;
  const readyTemplates = templates.length;
  const builderAssets = agentConfigs.length + skills.length + mcpServers.length;

  const runMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.run(id),
    onSuccess: (run) => {
      toast({ description: tr(`Пайплайн запущен (запуск #${run.id})`, `Pipeline started (run #${run.id})`) });
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const cloneMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.clone(id),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      toast({ description: tr(`Клонирован как "${pipeline.name}"`, `Cloned as "${pipeline.name}"`) });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      setDeleteTarget(null);
      toast({ description: tr("Пайплайн удалён", "Pipeline deleted") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const useTemplateMutation = useMutation({
    mutationFn: (slug: string) => studioTemplates.use(slug),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      toast({ description: tr(`Создано из шаблона: "${pipeline.name}"`, `Created from template: "${pipeline.name}"`) });
      navigate(`/studio/pipeline/${pipeline.id}`);
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  return (
    <PageShell className="space-y-8">
      <PageHero
        kicker={tr("Build Layer", "Build Layer")}
        title={tr("Студия автоматизации", "Automation Studio")}
        description={tr(
          "Слой конструирования для управляемой автоматизации: подключайте capability-источники, упаковывайте поведение в skills и agent configs, а затем собирайте из них pipelines и runs.",
          "The builder layer for controlled automation: connect capability sources, package behavior into skills and agent configs, then compose pipelines and runs on top.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/runs")} className="h-9 gap-1.5 rounded-xl px-3">
              <Clock className="h-3.5 w-3.5" />
              {tr("Запуски", "Runs")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/agents")} className="h-9 gap-1.5 rounded-xl px-3">
              <Bot className="h-3.5 w-3.5" />
              {tr("Agent Configs", "Agent Configs")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-xl px-3">
              <BookOpen className="h-3.5 w-3.5" />
              {tr("Skills", "Skills")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/mcp")} className="h-9 gap-1.5 rounded-xl px-3">
              <Server className="h-3.5 w-3.5" />
              {tr("MCP Registry", "MCP Registry")}
            </Button>
            <Button
              variant={notifUnconfigured ? "destructive" : "outline"}
              size="sm"
              onClick={() => navigate("/studio/notifications")}
              className="h-9 gap-1.5 rounded-xl px-3"
              title={notifUnconfigured ? tr("Уведомления не настроены — нажмите для настройки", "Notifications not configured — click to set up") : tr("Настройки уведомлений", "Notification settings")}
            >
              {notifUnconfigured ? <AlertCircle className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
              {tr("Уведомления", "Notifications")}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-xl px-4">
              <Plus className="h-3.5 w-3.5" />
              {tr("Новый пайплайн", "New Pipeline")}
            </Button>
          </div>
        }
      >
        <MetricGrid>
          <MetricCard
            label={tr("Pipelines", "Pipelines")}
            value={pipelines.length}
            description={tr("Исполняемые автоматизации, которые операторы реально запускают.", "Executable automations operators can actually run.")}
            icon={<Workflow className="h-5 w-5 text-primary" />}
            tone="info"
          />
          <MetricCard
            label={tr("Runtime pressure", "Runtime pressure")}
            value={runningPipelines}
            description={
              failingPipelines > 0
                ? tr(`${failingPipelines} запусков требуют внимания прямо сейчас.`, `${failingPipelines} runs currently need attention.`)
                : tr("Сбоев по последним run snapshots не обнаружено.", "No failing run snapshots are visible right now.")
            }
            icon={<Clock className="h-5 w-5 text-amber-300" />}
            tone={failingPipelines > 0 ? "danger" : "success"}
          />
          <MetricCard
            label={tr("Builder assets", "Builder assets")}
            value={builderAssets}
            description={tr(
              `${mcpServers.length} MCP, ${skills.length} skills, ${agentConfigs.length} agent configs.`,
              `${mcpServers.length} MCP services, ${skills.length} skills, ${agentConfigs.length} agent configs.`,
            )}
            icon={<BookOpen className="h-5 w-5 text-sky-300" />}
            tone="info"
          />
          <MetricCard
            label={tr("Templates", "Templates")}
            value={readyTemplates}
            description={tr("Быстрые заготовки для типовых automation tracks.", "Quick blueprints for common automation tracks.")}
            icon={<Zap className="h-5 w-5 text-violet-300" />}
          />
        </MetricGrid>
      </PageHero>

      <SectionCard
        title={tr("Studio architecture", "Studio architecture")}
        description={tr(
          "Если эта цепочка считывается за 3 секунды, весь продукт становится понятнее: capability sources сначала, executable runs в самом конце.",
          "If this chain reads in 3 seconds, the whole product becomes clearer: capability sources first, executable runs last.",
        )}
        icon={<Workflow className="h-4 w-4 text-primary" />}
        actions={
          <div className="relative w-full min-w-[260px] sm:w-[340px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("Поиск пайплайнов по названию, описанию или тегу", "Search pipelines by name, description, or tag")}
              className="h-10 rounded-xl border-border bg-background/70 pl-10 text-sm"
            />
          </div>
        }
      >
        <div className="grid gap-3 lg:grid-cols-5">
          {[
            { title: "MCP Registry", desc: tr("Подключённые capability-источники и внешние tool-services.", "Connected capability sources and external tool services."), value: mcpServers.length, icon: <Server className="h-4 w-4 text-primary" />, href: "/studio/mcp" },
            { title: "Skills", desc: tr("Политики, playbooks и domain behavior для управляемого поведения агентов.", "Policies, playbooks, and domain behavior for controlled agent behavior."), value: skills.length, icon: <BookOpen className="h-4 w-4 text-sky-300" />, href: "/studio/skills" },
            { title: "Agent Configs", desc: tr("Переиспользуемые профили агента: prompts, tools, MCP и guardrails.", "Reusable agent profiles: prompts, tools, MCP, and guardrails."), value: agentConfigs.length, icon: <Bot className="h-4 w-4 text-violet-300" />, href: "/studio/agents" },
            { title: "Pipelines", desc: tr("Исполняемые последовательности automation-нод, которые собирают builder layer в рабочий сценарий.", "Executable automation graphs that compose the builder layer into a runnable workflow."), value: pipelines.length, icon: <Workflow className="h-4 w-4 text-amber-300" />, href: "/studio" },
            { title: "Runs", desc: tr("Операторская инспекция исполнения: timeline, outputs, errors, final report.", "Operator-side execution inspection: timeline, outputs, errors, and final report."), value: runningPipelines, icon: <Clock className="h-4 w-4 text-emerald-300" />, href: "/studio/runs" },
          ].map((item) => (
            <button
              key={item.title}
              onClick={() => navigate(item.href)}
              className="enterprise-stat flex h-full flex-col items-start gap-3 rounded-[1rem] p-4 text-left transition-colors hover:border-primary/35 hover:bg-background/45"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background/35">
                {item.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.desc}</div>
              </div>
              <div className="mt-auto flex items-center gap-2">
                <StatusBadge label={item.value} tone="info" />
                <span className="text-xs text-muted-foreground">{tr("open", "open")}</span>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="space-y-8">
        {/* Templates section (only show when no search) */}
        {!search && templates.length > 0 && pipelines.length === 0 && (
          <section className="space-y-3">
            <div className="enterprise-kicker flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              {tr("Быстрые шаблоны", "Quick Start Templates")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {(templates as Array<Record<string, string>>).map((t) => (
                <button
                  key={t.slug}
                  onClick={() => useTemplateMutation.mutate(t.slug)}
                  className="enterprise-panel rounded-md p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-muted/20"
                >
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-md border border-primary/15 bg-primary/10 text-2xl">
                    {t.icon}
                  </div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{t.description}</div>
                  <Badge variant="secondary" className="mt-3 rounded-full text-[10px]">{t.category}</Badge>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Pipelines */}
        <section className="space-y-3">
          {!search && pipelines.length > 0 && (
            <h2 className="enterprise-kicker flex items-center gap-2 text-muted-foreground">
              <Workflow className="h-3.5 w-3.5" />
              {tr("Мои пайплайны", "My Pipelines")}
            </h2>
          )}

          {isLoading ? (
            <div className="enterprise-panel flex h-40 items-center justify-center rounded-md text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {tr("Загрузка...", "Loading...")}
            </div>
          ) : pipelines.length === 0 && !search ? (
            <EmptyState
              icon={<Workflow className="h-5 w-5" />}
              title={tr("Reusable automation workflows are empty", "Reusable automation workflows are empty")}
              description={tr(
                "Pipeline — это исполняемая последовательность automation-нод. Соберите первый workflow вручную или стартуйте с шаблона, чтобы сразу получить runnable control surface.",
                "A pipeline is an executable automation graph. Build the first workflow manually or start from a template to get a runnable control surface immediately.",
              )}
              actions={
                <>
                  <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-xl px-4">
                    <Plus className="h-3.5 w-3.5" />
                    {tr("Новый пайплайн", "New Pipeline")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-xl px-4">
                    <BookOpen className="h-3.5 w-3.5" />
                    {tr("Открыть Skills", "Open Skills")}
                  </Button>
                </>
              }
              hint={tr(
                "Частая цепочка старта: подключите MCP service → добавьте skill → упакуйте в Agent Config → соберите Pipeline → проверьте результат в Runs.",
                "Typical startup path: connect an MCP service -> add a skill -> package it into an Agent Config -> compose a Pipeline -> inspect the result in Runs.",
              )}
            />
          ) : pipelines.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title={tr("По этому запросу пайплайны не найдены", "No pipelines match this query")}
              description={tr(
                `Поиск не нашёл pipeline для "${search}". Попробуйте тег, часть имени или откройте шаблоны, чтобы собрать новый workflow.`,
                `Search did not find a pipeline for \"${search}\". Try a tag, part of a name, or open templates to assemble a new workflow.`,
              )}
              actions={
                <>
                  <Button size="sm" variant="outline" onClick={() => setSearch("")} className="h-9 rounded-xl px-4">
                    {tr("Сбросить поиск", "Clear search")}
                  </Button>
                  <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 rounded-xl px-4">
                    {tr("Новый пайплайн", "New Pipeline")}
                  </Button>
                </>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pipelines.map((p) => (
                <PipelineCard
                  key={p.id}
                  pipeline={p}
                  onEdit={() => navigate(`/studio/pipeline/${p.id}`)}
                  onRun={() => runMutation.mutate(p.id)}
                  onClone={() => cloneMutation.mutate(p.id)}
                  onDelete={() => setDeleteTarget(p)}
                  lang={lang}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create dialog */}
      <CreatePipelineDialog open={showCreate} onClose={() => setShowCreate(false)} lang={lang} />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Удалить пайплайн", "Delete Pipeline")}</DialogTitle>
            <DialogDescription>
              {tr(`Удалить "${deleteTarget?.name}"? Действие нельзя отменить.`, `Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{tr("Отмена", "Cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {tr("Удалить", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
