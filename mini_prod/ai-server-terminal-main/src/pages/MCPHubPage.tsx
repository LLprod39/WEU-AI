import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, X, Loader2, Server, CheckCircle2, XCircle, RefreshCw, ArrowLeft, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { studioMCP, type MCPServer } from "@/lib/api";

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
}: {
  initial: Partial<MCPServer>;
  onSave: (data: Partial<MCPServer>) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
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
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Name *</Label>
          <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="GitHub MCP" />
        </div>
        <div className="w-32 space-y-1.5">
          <Label className="text-xs">Transport</Label>
          <Select value={form.transport || "stdio"} onValueChange={(v) => set("transport", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="sse">SSE (HTTP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Input value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What this MCP provides..." />
      </div>

      {form.transport === "stdio" ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Command</Label>
            <Input value={form.command || ""} onChange={(e) => set("command", e.target.value)} placeholder="npx" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Arguments (one per line)</Label>
            <Textarea
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
              placeholder={`-y\n@modelcontextprotocol/server-github`}
              rows={5}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Environment Variables (KEY=value, one per line)</Label>
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
        <div className="space-y-1.5">
          <Label className="text-xs">SSE URL</Label>
          <Input value={form.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://mcp.example.com/sse" className="font-mono text-sm" />
        </div>
      )}

      <div className="workspace-subtle rounded-2xl px-4 py-3 text-sm leading-6 text-muted-foreground">
        {tr(
          "Сначала можно использовать готовый шаблон, а потом поправить команду или env вручную.",
          "A template is usually the fastest start, then you can adjust the command or env manually.",
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.name?.trim() || isPending} className="gap-1.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function MCPHubPage() {
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

  const createMutation = useMutation({
    mutationFn: (data: Partial<MCPServer>) => studioMCP.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: "MCP server added" });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MCPServer> }) => studioMCP.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setEditMcp(null);
      toast({ description: "MCP server updated" });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioMCP.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setDeleteTarget(null);
      toast({ description: "MCP server removed" });
    },
    onError: (error: Error) => toast({ variant: "destructive", description: error.message }),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => studioMCP.test(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["studio", "mcp"] });
      setTestingId(null);
      if (res.ok) toast({ description: "Connection OK" });
      else toast({ variant: "destructive", description: `Test failed: ${res.error}` });
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
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate("/studio")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                MCP Hub
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">Manage your Model Context Protocol servers</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setEditMcp({})} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add MCP Server
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="mine">
          <TabsList className="mb-4">
            <TabsTrigger value="mine">My Servers ({mcpList.length})</TabsTrigger>
            <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading...
              </div>
            ) : mcpList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-52 border border-dashed border-border rounded-lg text-center">
                <Server className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="font-medium text-sm">No MCP servers yet</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Add an MCP server or start from a template</p>
                <Button size="sm" onClick={() => setEditMcp({})} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add MCP Server
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mcpList.map((mcp) => (
                  <Card key={mcp.id} className="group hover:border-primary/50 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm flex items-center gap-2">
                            {mcp.name}
                            <Badge variant="secondary" className="text-[9px] font-mono">{mcp.transport}</Badge>
                          </CardTitle>
                          {mcp.description && <CardDescription className="text-xs mt-0.5">{mcp.description}</CardDescription>}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => { setTestingId(mcp.id); testMutation.mutate(mcp.id); }}
                            title="Test connection"
                            disabled={testingId === mcp.id}
                          >
                            {testingId === mcp.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditMcp(mcp)}>
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(mcp)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {mcp.transport === "stdio" ? (
                        <div className="text-xs font-mono bg-muted/40 rounded px-2 py-1 truncate text-muted-foreground">
                          {mcp.command} {(mcp.args || []).join(" ").slice(0, 40)}
                        </div>
                      ) : (
                        <div className="text-xs font-mono bg-muted/40 rounded px-2 py-1 truncate text-muted-foreground">
                          {mcp.url}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <TestIndicator ok={mcp.last_test_ok} error={mcp.last_test_error} />
                        {mcp.last_test_at && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            tested {new Date(mcp.last_test_at).toLocaleDateString()}
                          </span>
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

          <TabsContent value="templates">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(templates as MCPTemplate[]).map((tpl) => (
                <Card
                  key={tpl.slug}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleUseTemplate(tpl)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{tpl.icon}</span>
                      <div>
                        <CardTitle className="text-sm">{tpl.name}</CardTitle>
                        <CardDescription className="text-xs">{tpl.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-xs font-mono bg-muted/40 rounded px-2 py-1 truncate text-muted-foreground">
                      {tpl.transport === "stdio" ? `${tpl.command} ${(tpl.args || []).join(" ").slice(0, 35)}` : tpl.slug}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="outline" className="text-[9px]">{tpl.transport}</Badge>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => handleUseTemplate(tpl)}>
                        <Zap className="h-3 w-3" />
                        Use
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{(editMcp as MCPServer)?.id ? "Edit MCP Server" : "Add MCP Server"}</DialogTitle>
          </DialogHeader>
          {editMcp ? (
            <MCPForm
              initial={editMcp}
              onSave={handleSave}
              onCancel={() => setEditMcp(null)}
              isPending={createMutation.isPending || updateMutation.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove MCP Server</DialogTitle>
            <DialogDescription>Remove "{deleteTarget?.name}"?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
