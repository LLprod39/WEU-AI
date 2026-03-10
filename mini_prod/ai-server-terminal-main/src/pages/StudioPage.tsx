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
  ArrowRight,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageShell, SectionCard } from "@/components/ui/page-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type TemplateItem = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
};

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

function QuickActionCard({
  icon,
  title,
  description,
  actionLabel,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="workspace-subtle flex h-full flex-col items-start gap-4 rounded-[1.15rem] p-4 text-left transition-colors hover:border-primary/35 hover:bg-background/45"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70 bg-background/35">
          {icon}
        </div>
        {badge ? <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">{badge}</Badge> : null}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
      <div className="mt-auto inline-flex items-center gap-2 text-xs font-medium text-primary">
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
}

function BuilderLinkCard({
  icon,
  title,
  meta,
  onClick,
  warning,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  onClick: () => void;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
        warning
          ? "border-amber-500/30 bg-amber-500/8 hover:bg-amber-500/12"
          : "border-border/80 bg-background/30 hover:bg-background/45"
      }`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/35">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{meta}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function PipelineCard({
  pipeline,
  onOpen,
  onRun,
  onClone,
  onDelete,
  lang,
}: {
  pipeline: PipelineListItem;
  onOpen: () => void;
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
    <Card className="overflow-hidden border-border/75 bg-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-xl">
            <span>{pipeline.icon || "⚡"}</span>
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base leading-tight">{pipeline.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-[12px] leading-5">
              {pipeline.description || tr("Без описания", "No description")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
            {pipeline.node_count} {tr("нод", "nodes")}
          </Badge>
          {pipeline.last_run ? (
            <RunStatusBadge status={pipeline.last_run.status} lang={lang} />
          ) : (
            <span>{tr("Ни разу не запускался", "Never run")}</span>
          )}
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

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <Button size="sm" className="h-8 gap-1.5 rounded-xl px-3 text-[11px]" onClick={onOpen}>
            <Pencil className="h-3.5 w-3.5" />
            {tr("Открыть", "Open")}
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl px-3 text-[11px]" onClick={onRun}>
            <Play className="h-3 w-3" />
            {tr("Запустить", "Run")}
          </Button>
          <Button size="icon" variant="ghost" className="ml-auto h-8 w-8 rounded-xl" onClick={onClone} title={tr("Клонировать", "Clone")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl text-destructive hover:text-destructive" onClick={onDelete} title={tr("Удалить", "Delete")}>
            <Trash2 className="h-3.5 w-3.5" />
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
      <DialogContent className="max-w-md rounded-3xl border-border bg-background/95">
        <DialogHeader>
          <DialogTitle>{tr("Новый пайплайн", "New Pipeline")}</DialogTitle>
          <DialogDescription>{tr("Минимальная заготовка, которую можно сразу открыть в редакторе.", "A minimal pipeline you can open in the editor right away.")}</DialogDescription>
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
            placeholder={tr("Короткое описание", "Short description")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tr("Отмена", "Cancel")}</Button>
          <Button
            onClick={() => createMutation.mutate({ name, description, icon })}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {tr("Создать и открыть", "Create & Open")}
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

  const { data: notifCfg } = useQuery({
    queryKey: ["studio", "notifications"],
    queryFn: studioNotifications.get,
  });

  const notifUnconfigured =
    !notifCfg?.telegram_bot_token?.trim() && !notifCfg?.smtp_user?.trim();
  const runningPipelines = pipelines.filter((item) => item.last_run?.status === "running").length;
  const failingPipelines = pipelines.filter((item) => item.last_run?.status === "failed").length;
  const featuredTemplates = (templates as TemplateItem[]).slice(0, 3);
  const formatUpdatedAgo = (value: string) => {
    const diff = Date.now() - new Date(value).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return tr("только что", "just now");
    if (mins < 60) return lang === "ru" ? `${mins} мин назад` : `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return lang === "ru" ? `${hours} ч назад` : `${hours}h ago`;
    return lang === "ru" ? `${Math.floor(hours / 24)} дн назад` : `${Math.floor(hours / 24)}d ago`;
  };

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
    <PageShell width="full" className="space-y-4">
      <section className="workspace-panel px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="enterprise-kicker">{tr("Studio", "Studio")}</div>
            <h1 className="text-[1.4rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[1.7rem]">
              {tr("Студия", "Studio")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {tr(
                "Сначала откройте нужный пайплайн. Инструменты сборки держите справа как вторичный слой, а не как основную нагрузку страницы.",
                "Start by opening the pipeline you need. Keep the builder tools on the right as a secondary layer instead of the page's main load.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1 sm:w-[320px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr("Поиск по названию, описанию или тегу", "Search by name, description, or tag")}
                className="h-9 rounded-xl border-border bg-background/55 pl-10 text-sm"
              />
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-xl px-4">
              <Plus className="h-3.5 w-3.5" />
              {tr("Новый пайплайн", "New Pipeline")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/runs")} className="h-9 gap-1.5 rounded-xl px-3">
              <Clock className="h-3.5 w-3.5" />
              {tr("Запуски", "Runs")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
            {pipelines.length} {tr("пайплайнов", "pipelines")}
          </Badge>
          {runningPipelines > 0 ? (
            <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
              {runningPipelines} {tr("выполняются", "running")}
            </Badge>
          ) : null}
          {failingPipelines > 0 ? (
            <Badge variant="destructive" className="rounded-full px-2.5 py-1 text-[11px]">
              {failingPipelines} {tr("требуют внимания", "need attention")}
            </Badge>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard
          title={search ? tr("Search results", "Search results") : tr("Pipelines", "Pipelines")}
          description={
            search
              ? tr(`Результаты по запросу "${search}".`, `Results for "${search}".`)
              : tr("Главный рабочий список. Откройте пайплайн, запустите его или быстро клонируйте.", "The main working list. Open a pipeline, run it, or clone it quickly.")
          }
          icon={<Workflow className="h-4 w-4 text-primary" />}
        >
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {tr("Загрузка...", "Loading...")}
            </div>
          ) : pipelines.length === 0 && !search ? (
            <EmptyState
              icon={<Workflow className="h-5 w-5" />}
              title={tr("Пока нет пайплайнов", "No pipelines yet")}
              description={tr(
                "Создайте новый пайплайн или используйте шаблон, чтобы получить первую рабочую точку входа.",
                "Create a new pipeline or use a template to get your first working entry point.",
              )}
              actions={
                <>
                  <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-xl px-4">
                    <Plus className="h-3.5 w-3.5" />
                    {tr("Новый пайплайн", "New Pipeline")}
                  </Button>
                  {featuredTemplates[0] ? (
                    <Button size="sm" variant="outline" onClick={() => useTemplateMutation.mutate(featuredTemplates[0].slug)} className="h-9 gap-1.5 rounded-xl px-4">
                      <Zap className="h-3.5 w-3.5" />
                      {tr("Использовать шаблон", "Use template")}
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : pipelines.length === 0 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title={tr("Ничего не найдено", "Nothing found")}
              description={tr(
                "Попробуйте сократить запрос или очистить поиск.",
                "Try a shorter query or clear the search.",
              )}
              actions={
                <Button size="sm" variant="outline" onClick={() => setSearch("")} className="h-9 rounded-xl px-4">
                  {tr("Сбросить поиск", "Clear search")}
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/75 bg-background/30">
              <div className="divide-y divide-border/70">
                {pipelines.map((pipeline) => (
                  <div key={pipeline.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background/35 text-lg">
                          {pipeline.icon || "⚡"}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{pipeline.name}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {pipeline.description || tr("Без описания", "No description")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {pipeline.last_run ? (
                          <RunStatusBadge status={pipeline.last_run.status} lang={lang} />
                        ) : (
                          <span>{tr("Ни разу не запускался", "Never run")}</span>
                        )}
                        <span>{formatUpdatedAgo(pipeline.updated_at)}</span>
                        {pipeline.tags?.slice(0, 1).map((tag) => (
                          <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button size="sm" className="h-8 gap-1.5 rounded-xl px-3 text-[11px]" onClick={() => navigate(`/studio/pipeline/${pipeline.id}`)}>
                        <Pencil className="h-3.5 w-3.5" />
                        {tr("Открыть", "Open")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl px-3 text-[11px]" onClick={() => runMutation.mutate(pipeline.id)}>
                        <Play className="h-3 w-3" />
                        {tr("Запустить", "Run")}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xl" title={tr("Действия", "Actions")}>
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => cloneMutation.mutate(pipeline.id)}>
                            <Copy className="mr-2 h-4 w-4" />
                            {tr("Клонировать", "Clone")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(pipeline)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {tr("Удалить", "Delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title={tr("Start", "Start")}
            description={tr("Ежедневные действия без перегрузки.", "Daily actions without extra screen noise.")}
            icon={<Workflow className="h-4 w-4 text-primary" />}
          >
            <div className="space-y-2">
              <BuilderLinkCard
                icon={<Plus className="h-4 w-4 text-primary" />}
                title={tr("Создать новый пайплайн", "Create a new pipeline")}
                meta={tr("Пустой workflow для ручной сборки", "Blank workflow for manual assembly")}
                onClick={() => setShowCreate(true)}
              />
              <BuilderLinkCard
                icon={<Clock className="h-4 w-4 text-primary" />}
                title={tr("Проверить запуски", "Check runs")}
                meta={
                  runningPipelines > 0 || failingPipelines > 0
                    ? tr(`${runningPipelines} выполняются, ${failingPipelines} требуют внимания`, `${runningPipelines} running, ${failingPipelines} need attention`)
                    : tr("Открыть историю запусков", "Open run history")
                }
                onClick={() => navigate("/studio/runs")}
              />
              {featuredTemplates[0] ? (
                <BuilderLinkCard
                  icon={<Zap className="h-4 w-4 text-primary" />}
                  title={tr("Стартовать с шаблона", "Start from a template")}
                  meta={featuredTemplates[0].name}
                  onClick={() => useTemplateMutation.mutate(featuredTemplates[0].slug)}
                />
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title={tr("Builder layer", "Builder layer")}
            description={tr("Открывайте только когда готовите инструменты для пайплайнов.", "Open only when preparing tools for pipelines.")}
            icon={<BookOpen className="h-4 w-4 text-primary" />}
          >
            <div className="space-y-2">
              <BuilderLinkCard
                icon={<Bot className="h-4 w-4 text-primary" />}
                title={tr("Agent Configs", "Agent Configs")}
                meta={tr(`${agentConfigs.length} конфигов`, `${agentConfigs.length} configs`)}
                onClick={() => navigate("/studio/agents")}
              />
              <BuilderLinkCard
                icon={<BookOpen className="h-4 w-4 text-primary" />}
                title={tr("Skills", "Skills")}
                meta={tr(`${skills.length} skill entries`, `${skills.length} skill entries`)}
                onClick={() => navigate("/studio/skills")}
              />
              <BuilderLinkCard
                icon={<Server className="h-4 w-4 text-primary" />}
                title={tr("MCP Registry", "MCP Registry")}
                meta={tr(`${mcpServers.length} capability sources`, `${mcpServers.length} capability sources`)}
                onClick={() => navigate("/studio/mcp")}
              />
              <BuilderLinkCard
                icon={notifUnconfigured ? <AlertCircle className="h-4 w-4 text-amber-300" /> : <Bell className="h-4 w-4 text-primary" />}
                title={tr("Notifications", "Notifications")}
                meta={
                  notifUnconfigured
                    ? tr("Уведомления ещё не настроены", "Notifications are not configured yet")
                    : tr("Каналы уведомлений доступны", "Notification channels are configured")
                }
                onClick={() => navigate("/studio/notifications")}
                warning={notifUnconfigured}
              />
            </div>
          </SectionCard>
        </div>
      </div>

      <CreatePipelineDialog open={showCreate} onClose={() => setShowCreate(false)} lang={lang} />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-3xl border-border bg-background/95">
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
              {deleteMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {tr("Удалить", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
