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
  Server,
  BookOpen,
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
import { studioPipelines, studioTemplates, studioNotifications, type PipelineListItem } from "@/lib/api";

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    completed: { label: "Completed", icon: <CheckCircle2 className="h-3 w-3" />, variant: "default" },
    failed: { label: "Failed", icon: <XCircle className="h-3 w-3" />, variant: "destructive" },
    running: { label: "Running", icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" },
    pending: { label: "Pending", icon: <Clock className="h-3 w-3" />, variant: "outline" },
    stopped: { label: "Stopped", icon: <XCircle className="h-3 w-3" />, variant: "outline" },
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
}: {
  pipeline: PipelineListItem;
  onOpen: () => void;
  onRun: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const updatedAgo = (() => {
    const diff = Date.now() - new Date(pipeline.updated_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })();

  return (
    <Card className="group hover:border-primary/50 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl shrink-0">{pipeline.icon || "⚡"}</span>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight truncate">{pipeline.name}</CardTitle>
              {pipeline.description && (
                <CardDescription className="text-xs mt-0.5 line-clamp-2">{pipeline.description}</CardDescription>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClone} title="Clone">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Workflow className="h-3 w-3" />
            {pipeline.node_count} nodes
          </span>
          <span>·</span>
          <span>{updatedAgo}</span>
        </div>

        {pipeline.tags && pipeline.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pipeline.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          {pipeline.last_run ? (
            <RunStatusBadge status={pipeline.last_run.status} />
          ) : (
            <span className="text-xs text-muted-foreground">Never run</span>
          )}
          <Button size="sm" className="h-7 text-xs gap-1" onClick={onRun}>
            <Play className="h-3 w-3" />
            Run
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
}: {
  open: boolean;
  onClose: () => void;
}) {
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
      toast({ description: `Pipeline "${pipeline.name}" created` });
      onClose();
      navigate(`/studio/pipeline/${pipeline.id}`);
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Pipeline</DialogTitle>
          <DialogDescription>Create a new DevOps automation pipeline</DialogDescription>
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
              placeholder="Pipeline name"
              className="flex-1"
              autoFocus
            />
          </div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate({ name, description, icon })}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create & Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StudioPage() {
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

  const runMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.run(id),
    onSuccess: (run) => {
      toast({ description: `Pipeline started (run #${run.id})` });
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const cloneMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.clone(id),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      toast({ description: `Cloned as "${pipeline.name}"` });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioPipelines.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      setDeleteTarget(null);
      toast({ description: "Pipeline deleted" });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const useTemplateMutation = useMutation({
    mutationFn: (slug: string) => studioTemplates.use(slug),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "pipelines"] });
      toast({ description: `Created from template: "${pipeline.name}"` });
      navigate(`/studio/pipeline/${pipeline.id}`);
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              Agent Studio
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Build and run DevOps automation pipelines</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/runs")} className="gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Runs
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/agents")} className="gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              Agents
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/skills")} className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Skills
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/mcp")} className="gap-1.5">
              <Server className="h-3.5 w-3.5" />
              MCP Hub
            </Button>
            <Button
              variant={notifUnconfigured ? "destructive" : "outline"}
              size="sm"
              onClick={() => navigate("/studio/notifications")}
              className="gap-1.5 relative"
              title={notifUnconfigured ? "Notifications not configured — click to set up" : "Notification settings"}
            >
              {notifUnconfigured ? (
                <AlertCircle className="h-3.5 w-3.5" />
              ) : (
                <Bell className="h-3.5 w-3.5" />
              )}
              Notifications
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Pipeline
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/studio/runs")} className="h-9 gap-1.5 rounded-xl px-3">
              <Clock className="h-3.5 w-3.5" />
              {tr("Запуски", "Runs")}
            </Button>
          </div>
        </div>

        <div className="mt-3 relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pipelines..."
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Templates section (only show when no search) */}
        {!search && templates.length > 0 && pipelines.length === 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" />
              QUICK START TEMPLATES
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {(templates as Array<Record<string, string>>).map((t) => (
                <button
                  key={t.slug}
                  onClick={() => useTemplateMutation.mutate(t.slug)}
                  className="text-left p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors"
                >
                  <div className="text-2xl mb-2">{t.icon}</div>
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>
                  <Badge variant="secondary" className="text-[10px] mt-2">{t.category}</Badge>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Pipelines */}
        <section>
          {!search && pipelines.length > 0 && (
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Workflow className="h-3.5 w-3.5" />
              MY PIPELINES
            </h2>
          )}

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
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          ) : pipelines.length === 0 && !search ? (
            <div className="flex flex-col items-center justify-center h-52 text-center border border-dashed border-border rounded-lg">
              <Workflow className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="font-medium text-sm">No pipelines yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Create your first pipeline or start from a template
              </p>
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New Pipeline
              </Button>
            </div>
          ) : pipelines.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No pipelines match "{search}"</div>
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
                />
              ))}
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

      {/* Create dialog */}
      <CreatePipelineDialog open={showCreate} onClose={() => setShowCreate(false)} />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
