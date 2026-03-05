import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, X, Loader2, Server, CheckCircle2, XCircle, RefreshCw, ArrowLeft, Zap, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

function TestIndicator({ ok, error }: { ok: boolean | null; error: string }) {
  if (ok === null) return null;
  if (ok) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  return (
    <div className="flex items-center gap-1.5">
      <XCircle className="h-4 w-4 text-red-500" />
      {error && <span className="text-xs text-red-500 truncate max-w-[120px]" title={error}>{error.slice(0, 30)}</span>}
    </div>
  );
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
    Object.entries(initial.env || {}).map(([k, v]) => `${k}=${v}`).join("\n"),
  );

  const set = (key: keyof MCPServer, val: unknown) => setForm((f) => ({ ...f, [key]: val }));

  const handleSave = () => {
    const args = argsText.split("\n").map((s) => s.trim()).filter(Boolean);
    const envLines = envText.split("\n").map((s) => s.trim()).filter(Boolean);
    const env: Record<string, string> = {};
    for (const line of envLines) {
      const idx = line.indexOf("=");
      if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1);
    }
    onSave({ ...form, args, env });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">{tr("Название *", "Name *")}</Label>
          <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="GitHub MCP" />
        </div>
        <div className="w-32 space-y-1.5">
          <Label className="text-xs">{tr("Транспорт", "Transport")}</Label>
          <Select value={form.transport || "stdio"} onValueChange={(v) => set("transport", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="sse">{tr("SSE (HTTP)", "SSE (HTTP)")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{tr("Описание", "Description")}</Label>
        <Input value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder={tr("Что даёт этот MCP...", "What this MCP provides...")} />
      </div>

      {form.transport === "stdio" ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("Команда", "Command")}</Label>
            <Input value={form.command || ""} onChange={(e) => set("command", e.target.value)} placeholder="npx" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("Аргументы (по одному на строку)", "Arguments (one per line)")}</Label>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={`-y\n@modelcontextprotocol/server-github`}
              className="font-mono text-xs resize-none"
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("Переменные окружения (KEY=value, по одной на строку)", "Environment Variables (KEY=value, one per line)")}</Label>
            <Textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_..."
              className="font-mono text-xs resize-none"
              rows={3}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs">{tr("SSE URL", "SSE URL")}</Label>
          <Input value={form.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://mcp.example.com/sse" className="font-mono text-sm" />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{tr("Отмена", "Cancel")}</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.name?.trim() || isPending} className="gap-1.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
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
  const healthyCount = mcpList.filter((mcp) => mcp.last_test_ok === true).length;
  const failedCount = mcpList.filter((mcp) => mcp.last_test_ok === false).length;

  const createMutation = useMutation({
    mutationFn: (data: Partial<MCPServer>) => studioMCP.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: tr("MCP-сервер добавлен", "MCP server added") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MCPServer> }) => studioMCP.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: tr("MCP-сервер обновлён", "MCP server updated") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioMCP.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setDeleteTarget(null);
      toast({ description: tr("MCP-сервер удалён", "MCP server removed") });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => studioMCP.test(id),
    onSuccess: (res, id) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setTestingId(null);
      if (res.ok) toast({ description: tr("Подключение успешно", "Connection OK") });
      else toast({ variant: "destructive", description: tr(`Тест завершился ошибкой: ${res.error}`, `Test failed: ${res.error}`) });
    },
    onError: (err: Error) => {
      setTestingId(null);
      toast({ variant: "destructive", description: err.message });
    },
  });

  const handleSave = (data: Partial<MCPServer>) => {
    if ((editMcp as MCPServer)?.id) {
      updateMutation.mutate({ id: (editMcp as MCPServer).id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleUseTemplate = (tpl: MCPTemplate) => {
    setEditMcp({
      name: tpl.name,
      description: tpl.description,
      transport: tpl.transport,
      command: tpl.command,
      args: tpl.args,
      env: tpl.env,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-6">
        <div className="enterprise-panel rounded-md px-6 py-6 md:px-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-md" onClick={() => navigate("/studio")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="enterprise-kicker">{tr("Model Context Protocol", "Model Context Protocol")}</span>
              </div>
              <div className="space-y-2">
                <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-foreground md:text-[2rem]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                  {tr("MCP Реестр", "MCP Registry")}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
                  {tr(
                    "Управляйте реестром MCP-серверов: подключение, проверка состояния и централизованное использование в агентах и пайплайнах.",
                    "Manage an MCP server registry: connection setup, health checks, and centralized use in agents and pipelines.",
                  )}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Серверы", "Servers")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{mcpList.length}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Настроенные MCP-эндпоинты в текущем рабочем пространстве.", "Configured MCP endpoints in the current workspace.")}</p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Состояние", "Health")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{healthyCount}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {failedCount > 0
                      ? tr(`Успешных тестов · ${failedCount} требуют внимания`, `Passing tests · ${failedCount} need attention`)
                      : tr("Успешных тестов · ошибок не зафиксировано", "Passing tests · no failed checks recorded")}
                    .
                  </p>
                </div>
                <div className="enterprise-stat rounded-md px-4 py-3">
                  <p className="enterprise-kicker text-[9px] text-primary/70">{tr("Шаблоны", "Templates")}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{templates.length}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{tr("Стартовые шаблоны для популярных MCP-интеграций.", "Starter definitions for common MCP integrations.")}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Button size="sm" onClick={() => setEditMcp({})} className="h-9 gap-1.5 rounded-md px-4">
                <Plus className="h-3.5 w-3.5" />
                {tr("Добавить MCP-сервер", "Add MCP Server")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-8">
        <Tabs defaultValue="mine">
          <TabsList className="mb-4 rounded-md border border-border bg-card/70 p-1">
            <TabsTrigger value="mine">{tr("Мои серверы", "My Servers")} ({mcpList.length})</TabsTrigger>
            <TabsTrigger value="templates">{tr("Шаблоны", "Templates")} ({templates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="mine">
            {isLoading ? (
              <div className="enterprise-panel flex h-40 items-center justify-center rounded-md text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {tr("Загрузка...", "Loading...")}
              </div>
            ) : mcpList.length === 0 ? (
              <div className="enterprise-panel flex h-56 flex-col items-center justify-center rounded-md border border-dashed border-border text-center">
                <Server className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="font-medium text-sm">{tr("MCP-серверов пока нет", "No MCP servers yet")}</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">{tr("Добавьте MCP-сервер или начните с шаблона", "Add an MCP server or start from a template")}</p>
                <Button size="sm" onClick={() => setEditMcp({})} className="h-9 gap-1.5 rounded-md px-4">
                  <Plus className="h-3.5 w-3.5" />
                  {tr("Добавить MCP-сервер", "Add MCP Server")}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mcpList.map((mcp) => (
                  <Card key={mcp.id} className="group overflow-hidden rounded-md border-border bg-card transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-none">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {mcp.name}
                            <Badge variant="secondary" className="text-[9px] font-mono">{mcp.transport}</Badge>
                          </CardTitle>
                          {mcp.description && <CardDescription className="text-xs mt-1">{mcp.description}</CardDescription>}
                        </div>
                        <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/60 p-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg"
                            onClick={() => { setTestingId(mcp.id); testMutation.mutate(mcp.id); }}
                            title={tr("Проверить подключение", "Test connection")}
                            disabled={testingId === mcp.id}
                          >
                            {testingId === mcp.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg" onClick={() => setEditMcp(mcp)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-destructive hover:text-destructive" onClick={() => setDeleteTarget(mcp)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      {mcp.transport === "stdio" ? (
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                          {mcp.command} {(mcp.args || []).join(" ").slice(0, 40)}
                        </div>
                      ) : (
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                          {mcp.url}
                        </div>
                      )}
                      <div className="flex items-center gap-2 border-t border-border/70 pt-3">
                        <TestIndicator ok={mcp.last_test_ok} error={mcp.last_test_error} />
                        {mcp.last_test_at && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {tr("проверено", "tested")} {new Date(mcp.last_test_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(templates as MCPTemplate[]).map((tpl) => (
                <Card
                  key={tpl.slug}
                  className="cursor-pointer overflow-hidden rounded-md border-border bg-card transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-none"
                  onClick={() => handleUseTemplate(tpl)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/15 bg-primary/10 text-xl">
                        <span>{tpl.icon}</span>
                      </div>
                      <div>
                        <CardTitle className="text-sm">{tpl.name}</CardTitle>
                        <CardDescription className="text-xs">{tpl.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                      {tpl.transport === "stdio" ? `${tpl.command} ${(tpl.args || []).join(" ").slice(0, 35)}` : tpl.slug}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3">
                      <Badge variant="outline" className="text-[9px]">{tpl.transport}</Badge>
                      <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-md text-xs" onClick={() => handleUseTemplate(tpl)}>
                        <Zap className="h-3 w-3" />
                        {tr("Использовать", "Use")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={!!editMcp} onOpenChange={(o) => !o && setEditMcp(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{(editMcp as MCPServer)?.id ? tr("Изменить MCP-сервер", "Edit MCP Server") : tr("Добавить MCP-сервер", "Add MCP Server")}</DialogTitle>
          </DialogHeader>
          {editMcp && (
            <MCPForm
              initial={editMcp}
              onSave={handleSave}
              onCancel={() => setEditMcp(null)}
              isPending={createMutation.isPending || updateMutation.isPending}
              lang={lang}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm rounded-md border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{tr("Удалить MCP-сервер", "Remove MCP Server")}</DialogTitle>
            <DialogDescription>{tr(`Удалить "${deleteTarget?.name}"?`, `Remove "${deleteTarget?.name}"?`)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{tr("Отмена", "Cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {tr("Удалить", "Remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

