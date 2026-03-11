import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Save, X, Loader2, Bot, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { studioAgents, studioMCP, studioServers, studioSkills, type AgentConfig } from "@/lib/api";

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

function AgentForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial: Partial<AgentConfig>;
  onSave: (data: Partial<AgentConfig>) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
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
  const { data: skills = [] } = useQuery({ queryKey: ["studio", "skills"], queryFn: studioSkills.list });

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

  const toggleSkill = (slug: string) => {
    const next = (form.skill_slugs || []).includes(slug)
      ? (form.skill_slugs || []).filter((item) => item !== slug)
      : [...(form.skill_slugs || []), slug];
    set("skill_slugs", next);
  };

  const toggleServerScope = (serverId: number) => {
    const ids = (form.server_scope || []).map((server) => (typeof server === "number" ? server : server.id));
    const next = ids.includes(serverId) ? ids.filter((id) => id !== serverId) : [...ids, serverId];
    set("server_scope", next as unknown as AgentConfig["server_scope"]);
  };

  const mcpIds = (form.mcp_servers || []).map((m) => (typeof m === "number" ? m : m.id));
  const serverScopeIds = (form.server_scope || []).map((server) => (typeof server === "number" ? server : server.id));

  return (
    <div className="space-y-5">
      {/* Name + Icon */}
      <div className="flex gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Icon</Label>
          <Input value={form.icon || "🤖"} onChange={(e) => set("icon", e.target.value)} className="w-14 text-center text-xl" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Name *</Label>
          <Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="My DevOps Agent" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Input value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What this agent does..." />
      </div>

      {/* LLM Model + Iterations */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">LLM Model</Label>
          <Select value={form.model || "gemini-2.0-flash-exp"} onValueChange={(v) => set("model", v)}>
            <SelectTrigger className="h-8 text-xs">
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
          <Label className="text-xs">Max Iterations</Label>
          <Input
            type="number"
            value={form.max_iterations || 10}
            onChange={(e) => set("max_iterations", parseInt(e.target.value) || 10)}
            min={1}
            max={50}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <Label className="text-xs">System Prompt</Label>
        <Textarea
          value={form.system_prompt || ""}
          onChange={(e) => set("system_prompt", e.target.value)}
          placeholder="You are a DevOps agent. Be concise and always verify before taking destructive actions..."
          className="text-xs resize-none"
          rows={3}
        />
      </div>

      {/* Instructions */}
      <div className="space-y-1.5">
        <Label className="text-xs">Instructions / Rules</Label>
        <Textarea
          value={form.instructions || ""}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="Always run `df -h` first to check disk space. Never run rm -rf..."
          className="text-xs resize-none"
          rows={3}
        />
      </div>

      {/* Tools */}
      <div className="space-y-2">
        <Label className="text-xs">Allowed Tools</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {ALL_TOOLS.map((tool) => (
            <label key={tool.id} className="flex items-start gap-2 cursor-pointer p-2 rounded border border-border hover:bg-muted/30 transition-colors">
              <Checkbox
                checked={(form.allowed_tools || []).includes(tool.id)}
                onCheckedChange={() => toggleTool(tool.id)}
                className="mt-0.5"
              />
              <div>
                <div className="text-xs font-medium">{tool.label}</div>
                <div className="text-[10px] text-muted-foreground">{tool.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* MCP Servers */}
      {mcpList.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">MCP Servers</Label>
          <p className="text-[10px] text-muted-foreground">
            Attached MCP servers become callable tools for this agent during pipeline runs.
          </p>
          <div className="space-y-1">
            {mcpList.map((mcp) => (
              <label key={mcp.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded border border-border hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={mcpIds.includes(mcp.id)}
                  onCheckedChange={() => toggleMcp(mcp.id)}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{mcp.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{mcp.transport}</span>
                </div>
                {mcp.last_test_ok === true && <Badge variant="default" className="text-[9px] px-1 py-0">OK</Badge>}
                {mcp.last_test_ok === false && <Badge variant="destructive" className="text-[9px] px-1 py-0">ERR</Badge>}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Skills / Policies</Label>
          <p className="text-[10px] text-muted-foreground">
            Skills pin service context, guardrails, and runtime policy that travel with this agent into runs.
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {skills.map((skill) => (
              <label key={skill.slug} className="flex items-start gap-2 cursor-pointer rounded border border-border px-2 py-2 hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={(form.skill_slugs || []).includes(skill.slug)}
                  onCheckedChange={() => toggleSkill(skill.slug)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{skill.name}</span>
                    {skill.service ? <Badge variant="outline" className="text-[9px]">{skill.service}</Badge> : null}
                    {skill.runtime_enforced ? <Badge variant="secondary" className="text-[9px]">runtime</Badge> : null}
                    {skill.safety_level ? <Badge variant="outline" className="text-[9px]">{skill.safety_level}</Badge> : null}
                  </div>
                  {skill.description ? <p className="mt-1 text-[10px] text-muted-foreground">{skill.description}</p> : null}
                  {skill.guardrail_summary?.length ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {skill.guardrail_summary.slice(0, 2).join(" • ")}
                    </p>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
          {form.skill_errors?.length ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <p className="text-[11px] font-medium text-amber-300">Skill warnings</p>
              <div className="mt-1 space-y-1">
                {form.skill_errors.map((error) => (
                  <p key={error} className="text-[10px] text-amber-200">{error}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Server Scope */}
      {servers.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Server Scope</Label>
          <p className="text-[10px] text-muted-foreground">
            Leave empty to allow all accessible servers. Select servers to hard-scope this agent.
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {servers.map((server) => (
              <label key={server.id} className="flex items-center gap-2 cursor-pointer rounded border border-border px-2 py-1.5 hover:bg-muted/30 transition-colors">
                <Checkbox
                  checked={serverScopeIds.includes(server.id)}
                  onCheckedChange={() => toggleServerScope(server.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{server.name}</div>
                  <div className="text-[10px] text-muted-foreground">{server.host}</div>
                </div>
              </label>
            ))}
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
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(form)} disabled={!form.name?.trim() || isPending} className="gap-1.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Agent
        </Button>
      </div>
    </div>
  );
}

export default function AgentConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editAgent, setEditAgent] = useState<Partial<AgentConfig> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentConfig | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["studio", "agents"],
    queryFn: studioAgents.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<AgentConfig>) => studioAgents.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setEditAgent(null);
      toast({ description: "Agent created" });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AgentConfig> }) => studioAgents.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setEditAgent(null);
      toast({ description: "Agent updated" });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => studioAgents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studio", "agents"] });
      setDeleteTarget(null);
      toast({ description: "Agent deleted" });
    },
    onError: (err: Error) => toast({ variant: "destructive", description: err.message }),
  });

  const handleSave = (data: Partial<AgentConfig>) => {
    if ((editAgent as AgentConfig)?.id) {
      updateMutation.mutate({ id: (editAgent as AgentConfig).id, data });
    } else {
      createMutation.mutate(data);
    }
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
                <Bot className="h-5 w-5 text-primary" />
                Agent Configs
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">Reusable agent configurations for pipeline nodes</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setEditAgent({})} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Agent
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading...
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 border border-dashed border-border rounded-lg text-center">
            <Bot className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="font-medium text-sm">No agent configs yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Create a reusable agent configuration</p>
            <Button size="sm" onClick={() => setEditAgent({})} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New Agent Config
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {agents.map((agent) => (
              <Card key={agent.id} className="group hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{agent.icon}</span>
                      <CardTitle className="text-sm">{agent.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditAgent(agent)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(agent)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {agent.description && <p className="text-xs text-muted-foreground">{agent.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">{agent.model}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{agent.max_iterations} iter</Badge>
                    {agent.mcp_servers?.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{agent.mcp_servers.length} MCP</Badge>
                    )}
                    {agent.skill_slugs?.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{agent.skill_slugs.length} skills</Badge>
                    )}
                    {agent.server_scope?.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">{agent.server_scope.length} scoped servers</Badge>
                    )}
                  </div>
                  {agent.skill_errors?.length ? (
                    <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                      {agent.skill_errors.slice(0, 2).map((error) => (
                        <p key={error} className="text-[10px] text-amber-200">{error}</p>
                      ))}
                    </div>
                  ) : null}
                  {agent.skills?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.skills.slice(0, 3).map((skill) => (
                        <span key={skill.slug} className="text-[9px] bg-muted/60 rounded px-1 py-0.5 text-muted-foreground">
                          {skill.name}
                        </span>
                      ))}
                      {agent.skills.length > 3 ? (
                        <span className="text-[9px] text-muted-foreground">+{agent.skills.length - 3} more</span>
                      ) : null}
                    </div>
                  )}
                  {agent.allowed_tools?.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {agent.allowed_tools.slice(0, 4).map((t) => (
                        <span key={t} className="text-[9px] bg-muted/60 rounded px-1 py-0.5 text-muted-foreground">{t}</span>
                      ))}
                      {agent.allowed_tools.length > 4 && (
                        <span className="text-[9px] text-muted-foreground">+{agent.allowed_tools.length - 4} more</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={!!editAgent} onOpenChange={(o) => !o && setEditAgent(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{(editAgent as AgentConfig)?.id ? "Edit Agent Config" : "New Agent Config"}</DialogTitle>
          </DialogHeader>
          {editAgent && (
            <AgentForm
              initial={editAgent}
              onSave={handleSave}
              onCancel={() => setEditAgent(null)}
              isPending={createMutation.isPending || updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Agent Config</DialogTitle>
            <DialogDescription>Delete "{deleteTarget?.name}"? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
