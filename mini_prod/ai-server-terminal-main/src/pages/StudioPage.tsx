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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { studioPipelines, studioTemplates, studioNotifications, type PipelineListItem } from "@/lib/api";
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
    <div className="flex flex-col h-full">
      <div className="px-6 py-6">
        <div className="enterprise-panel rounded-md px-6 py-6 md:px-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="enterprise-kicker">{tr("Операционный центр", "Operations Center")}</div>
              <div className="space-y-2">
                <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground md:text-[2rem]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <Workflow className="h-5 w-5 text-primary" />
                  </div>
                  {tr("Студия автоматизации", "Automation Studio")}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
                  {tr(
                    "Проектируйте рабочие процессы, подключайте MCP-сервисы и запускайте контролируемую автоматизацию в едином интерфейсе.",
                    "Design workflows, attach MCP services, and run controlled automation from a single operational interface.",
                  )}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Пайплайны", "Pipelines")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{pipelines.length}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Переиспользуемые workflow в текущем рабочем пространстве.", "Reusable workflows in the current workspace.")}</p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Рантайм", "Runtime")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{runningPipelines}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {failingPipelines > 0
                      ? tr(`Сейчас выполняются · ${failingPipelines} требуют внимания`, `Running now · ${failingPipelines} need attention`)
                      : tr("Сейчас выполняются · сбоев не обнаружено", "Running now · no failed runs detected")}
                    .
                  </p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Шаблоны", "Templates")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{readyTemplates}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Быстрые шаблоны для типовых сценариев автоматизации.", "Quick-start blueprints for common automation tracks.")}</p>
                </div>
              </div>
            </div>

            <div className="flex w-full max-w-xl flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <Button variant="outline" size="sm" onClick={() => navigate("/studio/runs")} className="h-9 gap-1.5 rounded-md px-3">
                  <Clock className="h-3.5 w-3.5" />
                  {tr("Запуски", "Runs")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/studio/agents")} className="h-9 gap-1.5 rounded-md px-3">
                  <Bot className="h-3.5 w-3.5" />
                  {tr("Агенты", "Agents")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/studio/skills")} className="h-9 gap-1.5 rounded-md px-3">
                  <BookOpen className="h-3.5 w-3.5" />
                  {tr("Библиотека", "Library")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/studio/mcp")} className="h-9 gap-1.5 rounded-md px-3">
                  <Server className="h-3.5 w-3.5" />
                  {tr("MCP Реестр", "MCP Registry")}
                </Button>
                <Button
                  variant={notifUnconfigured ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => navigate("/studio/notifications")}
                  className="h-9 gap-1.5 rounded-md px-3"
                  title={notifUnconfigured ? tr("Уведомления не настроены — нажмите для настройки", "Notifications not configured — click to set up") : tr("Настройки уведомлений", "Notification settings")}
                >
                  {notifUnconfigured ? <AlertCircle className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                  {tr("Уведомления", "Notifications")}
                </Button>
                <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-md px-4">
                  <Plus className="h-3.5 w-3.5" />
                  {tr("Новый пайплайн", "New Pipeline")}
                </Button>
              </div>

              <div className="relative w-full xl:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tr("Поиск пайплайнов по названию, описанию или тегу", "Search pipelines by name, description, or tag")}
                  className="h-11 rounded-md border-border bg-background/70 pl-10 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8">
        <div className="space-y-8">
        {/* Templates section (only show when no search) */}
        {!search && templates.length > 0 && pipelines.length === 0 && (
          <section>
            <h2 className="enterprise-kicker mb-3 flex items-center gap-2 text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              {tr("Быстрые шаблоны", "Quick Start Templates")}
            </h2>
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
        <section>
          {!search && pipelines.length > 0 && (
            <h2 className="enterprise-kicker mb-3 flex items-center gap-2 text-muted-foreground">
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
            <div className="enterprise-panel flex h-56 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
              <Workflow className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-sm">{tr("Пайплайнов пока нет", "No pipelines yet")}</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                {tr("Создайте первый пайплайн или начните с шаблона", "Create your first pipeline or start from a template")}
              </p>
              <Button size="sm" onClick={() => setShowCreate(true)} className="h-9 gap-1.5 rounded-md px-4">
                <Plus className="h-3.5 w-3.5" />
                {tr("Новый пайплайн", "New Pipeline")}
              </Button>
            </div>
          ) : pipelines.length === 0 ? (
            <div className="enterprise-panel rounded-md py-12 text-center text-sm text-muted-foreground">
              {tr(`По запросу "${search}" пайплайны не найдены`, `No pipelines match "${search}"`)}
            </div>
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
    </div>
  );
}

