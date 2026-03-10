import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { studioMCP, type MCPServer } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface MCPTemplate {
  slug: string;
  name: string;
  description: string;
  transport: "stdio" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  icon: string;
}

function previewConnection(server: Pick<MCPServer, "transport" | "command" | "args" | "url">) {
  if (server.transport === "stdio") {
    return [server.command, ...(server.args || [])].filter(Boolean).join(" ");
  }
  return server.url || "https://...";
}

function MCPForm({
  initial,
  onSave,
  onCancel,
  isPending,
  lang,
}: {
  initial: Partial<MCPServer>;
  onSave: (data: Partial<MCPServer>) => void;
  onCancel: () => void;
  isPending: boolean;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const [form, setForm] = useState<Partial<MCPServer>>({
    name: "",
    description: "",
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    url: "",
    ...initial,
  });
  const [argsText, setArgsText] = useState((initial.args || []).join("\n"));
  const [envText, setEnvText] = useState(
    Object.entries(initial.env || {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );

  const set = (key: keyof MCPServer, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const args = argsText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const env: Record<string, string> = {};

    for (const line of envText.split("\n").map((item) => item.trim()).filter(Boolean)) {
      const idx = line.indexOf("=");
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
    }

    onSave({ ...form, args, env });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
        <div className="space-y-2">
          <Label>{tr("Название", "Name")}</Label>
          <Input
            value={form.name || ""}
            onChange={(event) => set("name", event.target.value)}
            placeholder="GitHub MCP"
          />
        </div>
        <div className="space-y-2">
          <Label>{tr("Транспорт", "Transport")}</Label>
          <Select value={form.transport || "stdio"} onValueChange={(value) => set("transport", value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="sse">SSE (HTTP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{tr("Описание", "Description")}</Label>
        <Input
          value={form.description || ""}
          onChange={(event) => set("description", event.target.value)}
          placeholder={tr("Коротко: что даёт этот MCP", "Short note about what this MCP provides")}
        />
      </div>

      {form.transport === "stdio" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{tr("Команда", "Command")}</Label>
            <Input
              value={form.command || ""}
              onChange={(event) => set("command", event.target.value)}
              placeholder="npx"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>{tr("Аргументы", "Arguments")}</Label>
            <Textarea
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
              placeholder={`-y\n@modelcontextprotocol/server-github`}
              rows={5}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>{tr("Переменные окружения", "Environment variables")}</Label>
            <Textarea
              value={envText}
              onChange={(event) => setEnvText(event.target.value)}
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..."
              rows={4}
              className="font-mono text-xs"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{tr("SSE URL", "SSE URL")}</Label>
          <Input
            value={form.url || ""}
            onChange={(event) => set("url", event.target.value)}
            placeholder="https://mcp.example.com/sse"
            className="font-mono"
          />
        </div>
      )}

      <div className="workspace-subtle rounded-2xl px-4 py-3 text-sm leading-6 text-muted-foreground">
        {tr(
          "Сначала можно использовать готовый шаблон, а потом поправить команду или env вручную.",
          "A template is usually the fastest start, then you can adjust the command or env manually.",
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          {tr("Отмена", "Cancel")}
        </Button>
        <Button onClick={handleSave} disabled={!form.name?.trim() || isPending} className="gap-2">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {tr("Сохранить", "Save")}
        </Button>
      </div>
    </div>
  );
}

export default function MCPHubPage() {
  const { lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editMcp, setEditMcp] = useState<Partial<MCPServer> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MCPServer | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const { data: mcpList = [], isLoading } = useQuery({
    queryKey: ["studio", "mcp"],
    queryFn: studioMCP.list,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["studio", "mcp", "templates"],
    queryFn: studioMCP.templates,
  });

  const healthyCount = mcpList.filter((item) => item.last_test_ok === true).length;
  const failedCount = mcpList.filter((item) => item.last_test_ok === false).length;

  const createMutation = useMutation({
    mutationFn: (data: Partial<MCPServer>) => studioMCP.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: tr("MCP-сервер добавлен", "MCP server added") });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MCPServer> }) => studioMCP.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: tr("MCP-сервер обновлён", "MCP server updated") });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioMCP.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setDeleteTarget(null);
      toast({ description: tr("MCP-сервер удалён", "MCP server removed") });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => studioMCP.test(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setTestingId(null);
      if (result.ok) toast({ description: tr("Подключение успешно", "Connection OK") });
      else toast({ variant: "destructive", description: result.error || tr("Проверка завершилась ошибкой", "Test failed") });
    },
    onError: (error: Error) => {
      setTestingId(null);
      toast({ variant: "destructive", description: error.message });
    },
  });

  const handleSave = (data: Partial<MCPServer>) => {
    if ((editMcp as MCPServer)?.id) {
      updateMutation.mutate({ id: (editMcp as MCPServer).id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleUseTemplate = (template: MCPTemplate) => {
    setEditMcp({
      name: template.name,
      description: template.description,
      transport: template.transport,
      command: template.command,
      args: template.args,
      env: template.env,
    });
  };

  return (
    <PageShell className="space-y-5">
      <section className="workspace-panel px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="enterprise-kicker">{tr("MCP Registry", "MCP Registry")}</div>
            <h1 className="text-[1.7rem] font-semibold tracking-[-0.05em] text-foreground">
              {tr("Подключения MCP", "MCP connections")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {tr(
                "Это реестр capability-серверов. Сначала подключите источник здесь, потом прикрепляйте его к agent config или pipeline.",
                "This is the registry of capability servers. Connect the source here first, then attach it to an agent config or pipeline.",
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/studio")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {tr("Назад в Studio", "Back to Studio")}
            </Button>
            <Button onClick={() => setEditMcp({})} className="gap-2">
              <Plus className="h-4 w-4" />
              {tr("Добавить MCP", "Add MCP")}
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="workspace-chip">
            <Server className="h-3.5 w-3.5" />
            {tr("Подключений", "Connections")}: {mcpList.length}
          </span>
          <span className="workspace-chip">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            {tr("Работают", "Healthy")}: {healthyCount}
          </span>
          <span className="workspace-chip">
            <XCircle className="h-3.5 w-3.5 text-red-300" />
            {tr("Требуют внимания", "Need attention")}: {failedCount}
          </span>
          <span className="workspace-chip">
            <Zap className="h-3.5 w-3.5" />
            {tr("Шаблонов", "Templates")}: {(templates as MCPTemplate[]).length}
          </span>
        </div>
      </section>

      <SectionCard
        title={tr("Реестр", "Registry")}
        description={tr(
          "Сначала просматривайте свои подключения, затем при необходимости стартуйте с шаблона.",
          "Review your existing connections first, then start from a template when needed.",
        )}
        icon={<Server className="h-4 w-4 text-primary" />}
      >
        <Tabs defaultValue="mine">
          <TabsList className="mb-4 rounded-xl border border-border bg-background/50 p-1">
            <TabsTrigger value="mine" className="rounded-lg">
              {tr("Подключения", "Connections")} ({mcpList.length})
            </TabsTrigger>
            <TabsTrigger value="templates" className="rounded-lg">
              {tr("Шаблоны", "Templates")} ({(templates as MCPTemplate[]).length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-0">
            {isLoading ? (
              <div className="flex h-28 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {tr("Загрузка...", "Loading...")}
              </div>
            ) : mcpList.length === 0 ? (
              <EmptyState
                icon={<Server className="h-5 w-5" />}
                title={tr("Пока нет MCP-подключений", "No MCP connections yet")}
                description={tr(
                  "Добавьте сервер вручную или возьмите шаблон как отправную точку.",
                  "Add a server manually or use a template as a starting point.",
                )}
                actions={
                  <Button onClick={() => setEditMcp({})} className="gap-2">
                    <Plus className="h-4 w-4" />
                    {tr("Добавить MCP", "Add MCP")}
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[1.25rem] border border-border/70">
                <div className="grid gap-3 border-b border-border/70 bg-background/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_200px_auto]">
                  <div>{tr("Подключение", "Connection")}</div>
                  <div>{tr("Запуск / URL", "Launch / URL")}</div>
                  <div>{tr("Последняя проверка", "Last test")}</div>
                  <div>{tr("Действия", "Actions")}</div>
                </div>

                {mcpList.map((mcp) => {
                  const testTone =
                    mcp.last_test_ok === true ? "success" : mcp.last_test_ok === false ? "danger" : "neutral";

                  return (
                    <div
                      key={mcp.id}
                      className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_200px_auto]"
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{mcp.name}</div>
                          <StatusBadge label={mcp.transport} tone="info" dot={false} />
                          {mcp.is_shared ? <StatusBadge label={tr("Shared", "Shared")} dot={false} /> : null}
                        </div>
                        {mcp.description ? (
                          <p className="text-sm leading-6 text-muted-foreground">{mcp.description}</p>
                        ) : (
                          <p className="text-sm leading-6 text-muted-foreground">
                            {tr("Описание не добавлено.", "No description provided.")}
                          </p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="rounded-xl border border-border/70 bg-background/35 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                          {previewConnection(mcp)}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <StatusBadge
                          label={
                            mcp.last_test_ok === true
                              ? tr("Работает", "Healthy")
                              : mcp.last_test_ok === false
                                ? tr("Ошибка", "Failed")
                                : tr("Не проверялся", "Not tested")
                          }
                          tone={testTone}
                        />
                        {mcp.last_test_error ? (
                          <p className="text-xs leading-5 text-muted-foreground">{mcp.last_test_error}</p>
                        ) : null}
                        {mcp.last_test_at ? (
                          <p className="text-xs text-muted-foreground">
                            {tr("Проверено", "Tested")}: {new Date(mcp.last_test_at).toLocaleString()}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-start gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          onClick={() => {
                            setTestingId(mcp.id);
                            testMutation.mutate(mcp.id);
                          }}
                          disabled={testingId === mcp.id}
                        >
                          {testingId === mcp.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {tr("Проверить", "Test")}
                        </Button>
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => setEditMcp(mcp)}>
                          <Pencil className="h-4 w-4" />
                          {tr("Изменить", "Edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(mcp)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {tr("Удалить", "Remove")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-0">
            {(templates as MCPTemplate[]).length === 0 ? (
              <EmptyState
                icon={<Zap className="h-5 w-5" />}
                title={tr("Шаблоны пока недоступны", "Templates are not available yet")}
                description={tr(
                  "Когда шаблоны появятся, их можно будет использовать как быстрый старт для типовых MCP-серверов.",
                  "When templates are available, you can use them as a quick start for common MCP servers.",
                )}
              />
            ) : (
              <div className="overflow-hidden rounded-[1.25rem] border border-border/70">
                {(templates as MCPTemplate[]).map((template) => (
                  <div
                    key={template.slug}
                    className="grid gap-4 border-b border-border/70 px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/40 text-lg">
                        {template.icon}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">{template.name}</div>
                          <StatusBadge label={template.transport} tone="info" dot={false} />
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{template.description}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-background/35 px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
                      {template.transport === "stdio"
                        ? [template.command, ...(template.args || [])].filter(Boolean).join(" ")
                        : template.slug}
                    </div>

                    <div className="flex items-start justify-start lg:justify-end">
                      <Button size="sm" onClick={() => handleUseTemplate(template)} className="gap-2">
                        <Zap className="h-4 w-4" />
                        {tr("Использовать шаблон", "Use template")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SectionCard>

      <Dialog open={!!editMcp} onOpenChange={(open) => !open && setEditMcp(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto rounded-3xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>
              {(editMcp as MCPServer)?.id
                ? tr("Изменить MCP-подключение", "Edit MCP connection")
                : tr("Добавить MCP-подключение", "Add MCP connection")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                "Сохраните описание, чтобы потом быстрее находить и подключать этот capability source.",
                "Save a short description so this capability source is easier to find later.",
              )}
            </DialogDescription>
          </DialogHeader>
          {editMcp ? (
            <MCPForm
              initial={editMcp}
              onSave={handleSave}
              onCancel={() => setEditMcp(null)}
              isPending={createMutation.isPending || updateMutation.isPending}
              lang={lang}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-3xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Удалить MCP-подключение", "Remove MCP connection")}</DialogTitle>
            <DialogDescription>
              {tr(`Удалить "${deleteTarget?.name}"?`, `Remove "${deleteTarget?.name}"?`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {tr("Отмена", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tr("Удалить", "Remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
