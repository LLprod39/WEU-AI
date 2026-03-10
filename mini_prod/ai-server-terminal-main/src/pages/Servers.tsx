import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addServerGroupMember,
  bulkUpdateServers,
  clearMasterPassword,
  createServer,
  createServerGroup,
  createServerKnowledge,
  createServerShare,
  deleteServer,
  deleteServerGroup,
  deleteServerKnowledge,
  executeServerCommand,
  fetchFrontendBootstrap,
  fetchServerDetails,
  getGlobalServerContext,
  getGroupServerContext,
  getMasterPasswordStatus,
  listServerKnowledge,
  listServerShares,
  revealServerPassword,
  removeServerGroupMember,
  revokeServerShare,
  saveGlobalServerContext,
  saveGroupServerContext,
  setMasterPassword,
  subscribeServerGroup,
  testServer,
  updateServer,
  updateServerGroup,
  updateServerKnowledge,
  type FrontendServer,
  type ServerGroupRole,
} from "@/lib/api";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useI18n } from "@/lib/i18n";
import {
  Terminal,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  Plug,
  Sparkles,
  Layers,
  WandSparkles,
  Clock3,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  FilterBar,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface ServerForm {
  name: string;
  server_type: "ssh" | "rdp";
  host: string;
  port: number;
  username: string;
  auth_method: "password" | "key" | "key_password";
  key_path: string;
  password: string;
  tags: string;
  notes: string;
  group_id: number | null;
  is_active: boolean;
}

interface ShareItem {
  id: number;
  user_id: number;
  username: string;
  email: string;
  share_context: boolean;
  expires_at: string | null;
  created_at: string | null;
  is_active: boolean;
}

interface KnowledgeItem {
  id: number;
  title: string;
  content: string;
  category: string;
  category_label: string;
  updated_at: string | null;
  is_active: boolean;
}

type AdvancedTab = "access" | "knowledge" | "context" | "security" | "execute";

function initialForm(): ServerForm {
  return {
    name: "",
    server_type: "ssh",
    host: "",
    port: 22,
    username: "root",
    auth_method: "password",
    key_path: "",
    password: "",
    tags: "",
    notes: "",
    group_id: null,
    is_active: true,
  };
}

function asPayload(form: ServerForm) {
  return {
    name: form.name,
    server_type: form.server_type,
    host: form.host,
    port: form.port,
    username: form.username,
    auth_method: form.auth_method,
    key_path: form.key_path,
    password: form.password,
    tags: form.tags,
    notes: form.notes,
    group_id: form.group_id,
    is_active: form.is_active,
  };
}

function toJson(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as Record<string, string>;
}

function formatCommandOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "(no output)";

  const value = output as Record<string, unknown>;
  const stdout = typeof value.stdout === "string" ? value.stdout : "";
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  const exitCode = value.exit_code;

  if (stdout || stderr || exitCode !== undefined) {
    const parts: string[] = [];
    if (stdout) parts.push(`STDOUT:\n${stdout}`);
    if (stderr) parts.push(`STDERR:\n${stderr}`);
    if (exitCode !== undefined) parts.push(`EXIT CODE: ${String(exitCode)}`);
    return parts.join("\n\n");
  }

  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function relativeTime(value: string | null): string {
  if (!value) return "—";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Servers() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>("access");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "unknown">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "owned" | "shared">("all");
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupColor, setGroupColor] = useState("#3b82f6");
  const [groupSaving, setGroupSaving] = useState(false);
  const [bulkGroupId, setBulkGroupId] = useState("__keep__");
  const [bulkTags, setBulkTags] = useState("");
  const [bulkActive, setBulkActive] = useState("__keep__");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<FrontendServer | null>(null);
  const [form, setForm] = useState<ServerForm>(initialForm());
  const [saving, setSaving] = useState(false);
  const [serverDeleteTarget, setServerDeleteTarget] = useState<FrontendServer | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [groupRenameTarget, setGroupRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [groupRenameValue, setGroupRenameValue] = useState("");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedServer, setAdvancedServer] = useState<FrontendServer | null>(null);
  const [advancedLoading, setAdvancedLoading] = useState(false);

  const [shares, setShares] = useState<ShareItem[]>([]);
  const [shareUser, setShareUser] = useState("");
  const [shareContext, setShareContext] = useState(true);
  const [shareExpiresAt, setShareExpiresAt] = useState("");

  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [knowledgeCategory, setKnowledgeCategory] = useState("other");
  const [knowledgeEditingId, setKnowledgeEditingId] = useState<number | null>(null);
  const [knowledgeDeleteTarget, setKnowledgeDeleteTarget] = useState<KnowledgeItem | null>(null);
  const [knowledgeEditTarget, setKnowledgeEditTarget] = useState<KnowledgeItem | null>(null);
  const [knowledgeEditTitle, setKnowledgeEditTitle] = useState("");
  const [knowledgeEditContent, setKnowledgeEditContent] = useState("");

  const [globalRules, setGlobalRules] = useState("");
  const [globalForbidden, setGlobalForbidden] = useState("");
  const [globalRequired, setGlobalRequired] = useState("");
  const [globalEnvJson, setGlobalEnvJson] = useState("{}");

  const [groupRules, setGroupRules] = useState("");
  const [groupForbidden, setGroupForbidden] = useState("");
  const [groupEnvJson, setGroupEnvJson] = useState("{}");
  const [groupMemberUser, setGroupMemberUser] = useState("");
  const [groupMemberRole, setGroupMemberRole] = useState<ServerGroupRole>("member");
  const [groupRemoveUserId, setGroupRemoveUserId] = useState("");

  const [masterPassword, setMasterPasswordText] = useState("");
  const [hasMasterPassword, setHasMasterPassword] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState("");

  const [execCommand, setExecCommand] = useState("hostname");
  const [execResult, setExecResult] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["frontend", "bootstrap"],
    queryFn: fetchFrontendBootstrap,
    staleTime: 20_000,
  });

  const servers = data?.servers || [];
  const groups = data?.groups || [];
  const onlineCount = servers.filter((server) => server.status === "online").length;
  const sharedCount = servers.filter((server) => server.is_shared).length;
  const groupCount = groups.filter((group) => group.id !== null).length;

  const filtered = useMemo(() => {
    return servers.filter((server) => {
      const q = search.trim().toLowerCase();
      if (q && !server.name.toLowerCase().includes(q) && !server.host.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && server.status !== statusFilter) return false;
      if (groupFilter !== "all" && server.group_name !== groupFilter) return false;
      if (scopeFilter === "owned" && server.is_shared) return false;
      if (scopeFilter === "shared" && !server.is_shared) return false;
      return true;
    });
  }, [groupFilter, scopeFilter, search, servers, statusFilter]);

  const visibleGroups = useMemo(() => {
    return Array.from(new Set(servers.map((server) => server.group_name).filter(Boolean))).sort();
  }, [servers]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedServerId(null);
      return;
    }
    if (!selectedServerId || !filtered.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(filtered[0].id);
    }
  }, [filtered, selectedServerId]);

  const selectedServer =
    filtered.find((server) => server.id === selectedServerId) ||
    servers.find((server) => server.id === selectedServerId) ||
    null;

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ["frontend", "bootstrap"] });
    await queryClient.invalidateQueries({ queryKey: ["settings", "activity"] });
  };

  const openCreate = () => {
    setEditingServer(null);
    setForm(initialForm());
    setDialogOpen(true);
  };

  const openEdit = async (server: FrontendServer) => {
    setEditingServer(server);
    const details = await fetchServerDetails(server.id);
    setForm({
      name: details.name,
      server_type: details.server_type,
      host: details.host,
      port: details.port,
      username: details.username,
      auth_method: details.auth_method,
      key_path: details.key_path || "",
      password: "",
      tags: details.tags || "",
      notes: details.notes || "",
      group_id: details.group_id,
      is_active: details.is_active,
    });
    setDialogOpen(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      if (editingServer) await updateServer(editingServer.id, asPayload(form));
      else await createServer(asPayload(form));
      setDialogOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (server: FrontendServer) => {
    await deleteServer(server.id);
    await reload();
  };

  const onTest = async (server: FrontendServer) => {
    const result = await testServer(server.id, {});
    if (result.success) {
      toast({ description: `Connection successful for ${server.name}` });
    } else {
      toast({
        variant: "destructive",
        description: `Connection failed: ${result.error || "unknown error"}`,
      });
    }
    await reload();
  };

  const onCreateGroup = async () => {
    if (!groupName.trim()) return;
    setGroupSaving(true);
    try {
      await createServerGroup({
        name: groupName.trim(),
        description: groupDescription.trim(),
        color: groupColor,
      });
      setGroupName("");
      setGroupDescription("");
      setGroupColor("#3b82f6");
      await reload();
    } finally {
      setGroupSaving(false);
    }
  };

  const onRenameGroup = async (groupId: number, name: string) => {
    if (!name.trim()) return;
    await updateServerGroup(groupId, { name: name.trim() });
    await reload();
  };

  const onDeleteGroup = async (groupId: number, name: string) => {
    await deleteServerGroup(groupId);
    await reload();
  };

  const onBulkUpdateFiltered = async () => {
    if (!filtered.length) return;
    const payload: {
      server_ids: number[];
      group_id?: number | null;
      tags?: string;
      is_active?: boolean;
    } = { server_ids: filtered.map((s) => s.id) };

    if (bulkGroupId !== "__keep__") {
      payload.group_id = bulkGroupId === "__none__" ? null : Number(bulkGroupId);
    }
    if (bulkTags.trim()) {
      payload.tags = bulkTags.trim();
    }
    if (bulkActive !== "__keep__") {
      payload.is_active = bulkActive === "active";
    }

    if (Object.keys(payload).length === 1) {
      toast({
        variant: "destructive",
        description: "Set at least one field for bulk update",
      });
      return;
    }

    setBulkSaving(true);
    try {
      await bulkUpdateServers(payload);
      await reload();
    } finally {
      setBulkSaving(false);
    }
  };

  const openAdvanced = async (server: FrontendServer) => {
    setAdvancedServer(server);
    setAdvancedOpen(true);
    setAdvancedLoading(true);
    setAdvancedTab("access");
    setExecResult("");
    setRevealedPassword("");
    setKnowledgeEditingId(null);
    setGroupMemberUser("");
    setGroupRemoveUserId("");
    try {
      const [sharesResp, knowledgeResp, globalCtx, masterStatus] = await Promise.all([
        listServerShares(server.id).catch(() => ({ success: false, shares: [] })),
        listServerKnowledge(server.id).catch(() => ({ success: false, items: [], categories: [] })),
        getGlobalServerContext().catch(() => null),
        getMasterPasswordStatus().catch(() => ({ has_master_password: false })),
      ]);
      setShares(sharesResp.success ? sharesResp.shares : []);
      setKnowledge((knowledgeResp.items || []) as KnowledgeItem[]);
      setHasMasterPassword(Boolean(masterStatus.has_master_password));

      if (globalCtx) {
        setGlobalRules(globalCtx.rules || "");
        setGlobalForbidden((globalCtx.forbidden_commands || []).join("\n"));
        setGlobalRequired((globalCtx.required_checks || []).join("\n"));
        setGlobalEnvJson(JSON.stringify(globalCtx.environment_vars || {}, null, 2));
      }

      if (server.group_id) {
        const groupCtx = await getGroupServerContext(server.group_id).catch(() => null);
        if (groupCtx) {
          setGroupRules(groupCtx.rules || "");
          setGroupForbidden((groupCtx.forbidden_commands || []).join("\n"));
          setGroupEnvJson(JSON.stringify(groupCtx.environment_vars || {}, null, 2));
        }
      } else {
        setGroupRules("");
        setGroupForbidden("");
        setGroupEnvJson("{}");
      }
    } finally {
      setAdvancedLoading(false);
    }
  };

  const refreshShares = async () => {
    if (!advancedServer) return;
    const resp = await listServerShares(advancedServer.id);
    setShares(resp.shares || []);
  };

  const refreshKnowledge = async () => {
    if (!advancedServer) return;
    const resp = await listServerKnowledge(advancedServer.id);
    setKnowledge((resp.items || []) as KnowledgeItem[]);
  };

  const onShareCreate = async () => {
    if (!advancedServer || !shareUser.trim()) return;
    await createServerShare(advancedServer.id, {
      user: shareUser.trim(),
      share_context: shareContext,
      expires_at: shareExpiresAt ? new Date(shareExpiresAt).toISOString() : null,
    });
    setShareUser("");
    setShareExpiresAt("");
    await refreshShares();
  };

  const onShareRevoke = async (shareId: number) => {
    if (!advancedServer) return;
    await revokeServerShare(advancedServer.id, shareId);
    await refreshShares();
  };

  const onKnowledgeCreate = async () => {
    if (!advancedServer || !knowledgeTitle.trim() || !knowledgeContent.trim()) return;
    await createServerKnowledge(advancedServer.id, {
      title: knowledgeTitle.trim(),
      content: knowledgeContent.trim(),
      category: knowledgeCategory,
      is_active: true,
    });
    setKnowledgeTitle("");
    setKnowledgeContent("");
    await refreshKnowledge();
  };

  const onKnowledgeDelete = async (id: number) => {
    if (!advancedServer) return;
    await deleteServerKnowledge(advancedServer.id, id);
    if (knowledgeEditingId === id) setKnowledgeEditingId(null);
    await refreshKnowledge();
  };

  const onKnowledgeEdit = async (item: KnowledgeItem, title: string, content: string) => {
    if (!advancedServer) return;
    await updateServerKnowledge(advancedServer.id, item.id, {
      title: title.trim(),
      content: content.trim(),
      category: item.category,
      is_active: item.is_active,
    });
    setKnowledgeEditingId(null);
    await refreshKnowledge();
  };

  const onKnowledgeToggle = async (item: KnowledgeItem) => {
    if (!advancedServer) return;
    await updateServerKnowledge(advancedServer.id, item.id, { is_active: !item.is_active });
    await refreshKnowledge();
  };

  const onSaveGlobalContext = async () => {
    let env: Record<string, string>;
    try {
      env = toJson(globalEnvJson);
    } catch {
      toast({
        variant: "destructive",
        description: "Invalid global context JSON",
      });
      return;
    }
    await saveGlobalServerContext({
      rules: globalRules,
      forbidden_commands: globalForbidden,
      required_checks: globalRequired,
      environment_vars: env,
    });
    toast({ description: "Global context saved" });
  };

  const onSaveGroupContext = async () => {
    if (!advancedServer?.group_id) return;
    let env: Record<string, string>;
    try {
      env = toJson(groupEnvJson);
    } catch {
      toast({
        variant: "destructive",
        description: "Invalid group context JSON",
      });
      return;
    }
    await saveGroupServerContext(advancedServer.group_id, {
      rules: groupRules,
      forbidden_commands: groupForbidden,
      environment_vars: env,
    });
    toast({ description: "Group context saved" });
  };

  const onAddGroupMember = async () => {
    if (!advancedServer?.group_id || !groupMemberUser.trim()) return;
    await addServerGroupMember(advancedServer.group_id, { user: groupMemberUser.trim(), role: groupMemberRole });
    setGroupMemberUser("");
    toast({ description: "Group member updated" });
  };

  const onRemoveGroupMember = async () => {
    if (!advancedServer?.group_id || !groupRemoveUserId.trim()) return;
    const userId = Number(groupRemoveUserId);
    if (!Number.isFinite(userId) || userId <= 0) {
      toast({
        variant: "destructive",
        description: "Invalid user id",
      });
      return;
    }
    await removeServerGroupMember(advancedServer.group_id, userId);
    setGroupRemoveUserId("");
    toast({ description: "Group member removed" });
  };

  const onSetMasterPassword = async () => {
    if (!masterPassword.trim()) return;
    await setMasterPassword(masterPassword.trim());
    setHasMasterPassword(true);
    toast({ description: "Master password stored in session" });
  };

  const onClearMasterPassword = async () => {
    await clearMasterPassword();
    setHasMasterPassword(false);
    toast({ description: "Master password cleared from session" });
  };

  const onRevealPassword = async () => {
    if (!advancedServer) return;
    const resp = await revealServerPassword(advancedServer.id, masterPassword.trim());
    if (resp.success) setRevealedPassword(resp.password || "");
    else {
      toast({
        variant: "destructive",
        description: resp.error || "Failed to reveal password",
      });
    }
  };

  const onExecuteCommand = async () => {
    if (!advancedServer || !execCommand.trim()) return;
    const resp = await executeServerCommand(advancedServer.id, execCommand, "");
    if (resp.success) setExecResult(formatCommandOutput(resp.output));
    else setExecResult(`ERROR: ${resp.error || "Unknown error"}`);
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("srv.loading")}</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">{t("srv.error")}</div>;

  return (
    <PageShell width="full" className="space-y-5">
      <section className="workspace-panel px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="enterprise-kicker">Servers</div>
            <h1 className="text-[1.4rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[1.7rem]">
              {t("srv.title")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Find a server first. Open the workspace second. Use the side panel only when you need management or access controls.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/servers/hub">
              <Button size="sm" variant="outline" className="h-9 gap-2 rounded-xl px-3">
                <Terminal className="h-4 w-4" />
                Open terminal hub
              </Button>
            </Link>
            <Button size="sm" variant="outline" className="h-9 gap-2 rounded-xl px-3" onClick={reload}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" className="h-9 gap-2 rounded-xl px-4" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("srv.add")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge label={`${servers.length} total`} tone="info" />
          <StatusBadge label={`${filtered.length} visible`} tone="neutral" />
          <StatusBadge label={`${onlineCount} online`} tone="success" />
          <StatusBadge label={`${groupCount} groups`} tone="neutral" />
          <StatusBadge label={`${sharedCount} shared`} tone="warning" />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <SectionCard
          title="Inventory"
          description="The list stays simple. Select a row to get actions and deeper controls on the right."
          icon={<Server className="h-4 w-4 text-primary" />}
        >
          <div className="space-y-4">
            <FilterBar>
              <div className="flex flex-col gap-3">
                <div className="text-xs text-muted-foreground">
                  Showing {filtered.length} of {servers.length} servers
                </div>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                  <div className="relative min-w-[240px] flex-1 xl:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t("srv.search")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full rounded-xl pl-9"
                    />
                  </div>
                  <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="enterprise-select min-w-[180px]">
                    <option value="all">All groups</option>
                    {visibleGroups.map((groupName) => (
                      <option key={groupName} value={groupName}>
                        {groupName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                    className="enterprise-select min-w-[160px]"
                  >
                    <option value="all">All statuses</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                    <option value="unknown">Unknown</option>
                  </select>
                  <select
                    value={scopeFilter}
                    onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
                    className="enterprise-select min-w-[160px]"
                  >
                    <option value="all">All scope</option>
                    <option value="owned">Owned</option>
                    <option value="shared">Shared</option>
                  </select>
                </div>
                {(search || groupFilter !== "all" || statusFilter !== "all" || scopeFilter !== "all") && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
                    <span>Filters are active for this view.</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg px-2 text-xs"
                      onClick={() => {
                        setSearch("");
                        setGroupFilter("all");
                        setStatusFilter("all");
                        setScopeFilter("all");
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            </FilterBar>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<Server className="h-5 w-5" />}
                title="No servers in this view"
                description="Change the filters or add a new server."
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        setSearch("");
                        setGroupFilter("all");
                        setStatusFilter("all");
                        setScopeFilter("all");
                      }}
                    >
                      Clear filters
                    </Button>
                    <Button size="sm" className="rounded-xl" onClick={openCreate}>
                      <Plus className="h-4 w-4" />
                      {t("srv.add")}
                    </Button>
                  </>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/75 bg-background/30">
                <div className="hidden grid-cols-[minmax(0,2fr)_140px_120px_140px] gap-3 border-b border-border/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
                  <div>Server</div>
                  <div>Group</div>
                  <div>Status</div>
                  <div>Last activity</div>
                </div>
                <div className="divide-y divide-border/70">
                  {filtered.map((server) => {
                    const selected = server.id === selectedServerId;
                    return (
                      <button
                        key={server.id}
                        type="button"
                        onClick={() => setSelectedServerId(server.id)}
                        className={`w-full text-left transition-colors ${selected ? "bg-primary/8" : "hover:bg-background/45"}`}
                      >
                        <div className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,2fr)_140px_120px_140px] md:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-semibold text-foreground">{server.name}</div>
                              {server.is_shared ? <StatusBadge label="shared" tone="warning" /> : null}
                            </div>
                            <div className="mt-1 truncate text-xs font-mono text-muted-foreground">
                              {server.host}:{server.port}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {server.username} · {server.server_type.toUpperCase()}
                            </div>
                          </div>
                          <div className="text-sm text-foreground">{server.group_name || "Ungrouped"}</div>
                          <div className="flex items-center gap-2">
                            <StatusIndicator status={server.status} />
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock3 className="h-4 w-4" />
                            {relativeTime(server.last_connected)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title={selectedServer ? selectedServer.name : "Selected server"}
            description={
              selectedServer
                ? `${selectedServer.username}@${selectedServer.host}:${selectedServer.port}`
                : "Choose a server from the inventory to open or manage it."
            }
            icon={<Sparkles className="h-4 w-4 text-primary" />}
          >
            {selectedServer ? (
              <div className="space-y-4">
                <div className="workspace-subtle space-y-3 rounded-2xl px-3 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <StatusIndicator status={selectedServer.status} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Group</span>
                    <span className="font-medium text-foreground">{selectedServer.group_name || "Ungrouped"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Access</span>
                    <span className="font-medium text-foreground">
                      {selectedServer.is_shared ? "Shared" : "Owned"}
                      {selectedServer.share_context_enabled ? " + context" : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Last activity</span>
                    <span className="font-medium text-foreground">{relativeTime(selectedServer.last_connected)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link to={`/servers/${selectedServer.id}/terminal`}>
                    <Button size="sm" className="h-9 gap-1.5 rounded-xl px-4">
                      <Terminal className="h-4 w-4" />
                      Open terminal
                    </Button>
                  </Link>
                  <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl px-4" onClick={() => openAdvanced(selectedServer)}>
                    <Sparkles className="h-4 w-4" />
                    Details
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl px-3">
                        <MoreHorizontal className="h-4 w-4" />
                        More
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {selectedServer.rdp ? (
                        <DropdownMenuItem asChild>
                          <Link to={`/servers/${selectedServer.id}/rdp`} className="flex w-full items-center gap-2">
                            <Monitor className="h-4 w-4" />
                            Open RDP
                          </Link>
                        </DropdownMenuItem>
                      ) : null}
                      {selectedServer.can_edit ? (
                        <>
                          <DropdownMenuItem onClick={() => onTest(selectedServer)}>
                            <Plug className="mr-2 h-4 w-4" />
                            Test
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(selectedServer)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setServerDeleteTarget(selectedServer)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Server className="h-5 w-5" />}
                title="No server selected"
                description="Select an item in the inventory to open a terminal, test connectivity, or manage sharing."
              />
            )}
          </SectionCard>

          <Collapsible open={groupsOpen} onOpenChange={setGroupsOpen}>
            <SectionCard
              title={t("srv.groups")}
              description="Groups stay available, but they no longer interrupt the main inventory flow."
              icon={<Layers className="h-4 w-4 text-primary" />}
              actions={
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 rounded-xl px-2 text-xs">
                    {groupsOpen ? "Hide" : "Show"}
                    <ChevronDown className={`h-4 w-4 transition-transform ${groupsOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
              }
            >
              <CollapsibleContent className="space-y-4">
                <div className="grid grid-cols-1 gap-2">
                  <Input placeholder={t("srv.group_name")} value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                  <Input
                    placeholder={t("srv.description")}
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Input type="color" value={groupColor} onChange={(e) => setGroupColor(e.target.value)} className="h-10 w-16 rounded-xl p-1" />
                    <Button className="h-10 flex-1 rounded-xl" onClick={onCreateGroup} disabled={!groupName.trim() || groupSaving}>
                      {groupSaving ? "..." : t("srv.create_group")}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  {groups
                    .filter((g) => g.id !== null)
                    .map((g) => (
                      <div key={g.id!} className="workspace-subtle space-y-3 rounded-2xl px-4 py-3">
                        <div className="text-sm">
                          <div className="font-medium text-foreground">{g.name}</div>
                          <span className="text-xs text-muted-foreground">{g.server_count} servers</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => subscribeServerGroup(g.id!, "follow")}>
                            Follow
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => subscribeServerGroup(g.id!, "favorite")}>
                            Favorite
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setGroupRenameTarget({ id: g.id!, name: g.name }); setGroupRenameValue(g.name); }}>
                            Rename
                          </Button>
                          <Button size="sm" variant="destructive" className="rounded-xl" onClick={() => setGroupDeleteTarget({ id: g.id!, name: g.name })}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </CollapsibleContent>
            </SectionCard>
          </Collapsible>

          <Collapsible open={bulkOpen} onOpenChange={setBulkOpen}>
            <SectionCard
              title={`Bulk update (${filtered.length})`}
              description="This works only on the current filtered view, so you always know exactly what will be changed."
              icon={<WandSparkles className="h-4 w-4 text-primary" />}
              actions={
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 rounded-xl px-2 text-xs">
                    {bulkOpen ? "Hide" : "Show"}
                    <ChevronDown className={`h-4 w-4 transition-transform ${bulkOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
              }
            >
              <CollapsibleContent className="space-y-3">
                <select
                  value={bulkGroupId}
                  onChange={(e) => setBulkGroupId(e.target.value)}
                  className="enterprise-select"
                >
                  <option value="__keep__">Keep group</option>
                  <option value="__none__">Remove group</option>
                  {groups
                    .filter((g) => g.id !== null)
                    .map((g) => (
                      <option key={g.id!} value={g.id!}>
                        {g.name}
                      </option>
                    ))}
                </select>
                <Input placeholder="Tags (comma separated)" value={bulkTags} onChange={(e) => setBulkTags(e.target.value)} />
                <select
                  value={bulkActive}
                  onChange={(e) => setBulkActive(e.target.value)}
                  className="enterprise-select"
                >
                  <option value="__keep__">Keep active state</option>
                  <option value="active">Set active</option>
                  <option value="inactive">Set inactive</option>
                </select>
                <Button className="rounded-xl" onClick={onBulkUpdateFiltered} disabled={bulkSaving || !filtered.length}>
                  {bulkSaving ? "Applying..." : "Apply Bulk Update"}
                </Button>
              </CollapsibleContent>
            </SectionCard>
          </Collapsible>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{editingServer ? t("srv.edit_server") : t("srv.create_server")}</DialogTitle>
            <DialogDescription>{t("srv.server_settings")}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs text-muted-foreground">{t("srv.name")} *</Label>
                <Input placeholder="e.g. prod-web-01" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("srv.host")} *</Label>
                <Input placeholder="192.168.1.10" value={form.host} onChange={(e) => setForm((s) => ({ ...s, host: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("srv.port")}</Label>
                <Input type="number" value={form.port} onChange={(e) => setForm((s) => ({ ...s, port: Number(e.target.value) || 22 }))} className="bg-secondary/50" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("srv.username")} *</Label>
                <Input placeholder="ubuntu" value={form.username} onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <select
                  value={form.server_type}
                  onChange={(e) => setForm((s) => ({ ...s, server_type: e.target.value as "ssh" | "rdp" }))}
                  className="enterprise-select"
                >
                  <option value="ssh">SSH</option>
                  <option value="rdp">RDP</option>
                </select>
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Authentication</Label>
                <div className="flex gap-2">
                  {(["password", "key", "key_password"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm((s) => ({ ...s, auth_method: m }))}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${form.auth_method === m ? "bg-primary/15 border-primary text-primary" : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {m === "password" ? "Password" : m === "key" ? "SSH Key" : "Key + Pass"}
                    </button>
                  ))}
                </div>
              </div>

              {form.auth_method !== "password" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("srv.key_path")}</Label>
                  <Input placeholder="/home/user/.ssh/id_rsa" value={form.key_path} onChange={(e) => setForm((s) => ({ ...s, key_path: e.target.value }))} className="bg-secondary/50" />
                </div>
              )}
              {form.auth_method !== "key" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{t("srv.password")}</Label>
                  <Input
                    type="password"
                    placeholder={editingServer ? "Leave empty to keep" : ""}
                    value={form.password}
                    onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                    className="bg-secondary/50"
                  />
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("srv.groups")}</Label>
                <select
                  value={form.group_id ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, group_id: e.target.value ? Number(e.target.value) : null }))}
                  className="enterprise-select"
                >
                  <option value="">{t("srv.no_group")}</option>
                  {groups
                    .filter((g) => g.id !== null)
                    .map((g) => (
                      <option key={g.id!} value={g.id!}>{g.name}</option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("srv.tags")}</Label>
                <Input placeholder="web, production" value={form.tags} onChange={(e) => setForm((s) => ({ ...s, tags: e.target.value }))} className="bg-secondary/50" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs text-muted-foreground">{t("srv.notes")}</Label>
                <Input placeholder="..." value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} className="bg-secondary/50" />
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              {t("srv.cancel")}
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving || !form.name || !form.host || !form.username}>
              {saving ? t("srv.saving") : editingServer ? t("srv.update") : t("srv.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="max-w-5xl rounded-2xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>{t("srv.advanced")}: {advancedServer?.name || "Server"}</DialogTitle>
            <DialogDescription>{t("srv.sharing")}</DialogDescription>
          </DialogHeader>

          <DialogBody className={advancedLoading ? "py-8" : "max-h-[65vh] overflow-y-auto p-0"}>
          {advancedLoading ? (
              <div className="text-sm text-muted-foreground text-center">{t("loading")}</div>
          ) : (
              <Tabs value={advancedTab} onValueChange={(v) => setAdvancedTab(v as AdvancedTab)}>
                <div className="sticky top-0 z-10 bg-card border-b border-border px-6 pt-4 pb-0">
                  <TabsList className="w-full justify-start">
                    <TabsTrigger value="access">{t("srv.access")}</TabsTrigger>
                    <TabsTrigger value="knowledge">{t("srv.knowledge")}</TabsTrigger>
                    <TabsTrigger value="context">{t("srv.context")}</TabsTrigger>
                    <TabsTrigger value="security">{t("srv.security")}</TabsTrigger>
                    <TabsTrigger value="execute">{t("srv.execute")}</TabsTrigger>
                  </TabsList>
                </div>

                <div className="px-6 py-5">

                <TabsContent value="access" className="mt-0 space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.server_sharing")}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{t("srv.username")}</Label>
                        <Input placeholder="username / email / id" value={shareUser} onChange={(e) => setShareUser(e.target.value)} className="bg-secondary/50 h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Expires</Label>
                        <Input type="datetime-local" value={shareExpiresAt} onChange={(e) => setShareExpiresAt(e.target.value)} className="bg-secondary/50 h-9" />
                      </div>
                      <div className="flex items-end">
                        <label className="text-xs flex items-center gap-2 h-9 text-muted-foreground">
                          <input type="checkbox" checked={shareContext} onChange={(e) => setShareContext(e.target.checked)} className="rounded" />
                          {t("srv.share_context")}
                        </label>
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" className="w-full h-9" onClick={onShareCreate}>{t("srv.share")}</Button>
                      </div>
                    </div>
                  </div>
                  {shares.length > 0 && (
                    <div className="space-y-2">
                      {shares.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-secondary/10">
                          <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                            {(s.username || "U").slice(0, 1).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{s.username}</p>
                            <p className="text-xs text-muted-foreground">{s.email || "—"} · {s.is_active ? "active" : "expired"}</p>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onShareRevoke(s.id)}>
                            {t("srv.revoke")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="knowledge" className="mt-0 space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.ai_memory")}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Input placeholder="Title" value={knowledgeTitle} onChange={(e) => setKnowledgeTitle(e.target.value)} className="bg-secondary/50 h-9" />
                      <Input placeholder="Content" value={knowledgeContent} onChange={(e) => setKnowledgeContent(e.target.value)} className="bg-secondary/50 h-9" />
                      <select
                        value={knowledgeCategory}
                        onChange={(e) => setKnowledgeCategory(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="system">System</option>
                        <option value="services">Services</option>
                        <option value="network">Network</option>
                        <option value="security">Security</option>
                        <option value="performance">Performance</option>
                        <option value="storage">Storage</option>
                        <option value="packages">Packages</option>
                        <option value="config">Config</option>
                        <option value="issues">Issues</option>
                        <option value="solutions">Solutions</option>
                        <option value="other">Other</option>
                      </select>
                      <Button size="sm" className="h-9" onClick={onKnowledgeCreate}>{t("srv.add_entry")}</Button>
                    </div>
                  </div>
                  {knowledge.length > 0 && (
                    <div className="space-y-2">
                      {knowledge.map((k) => (
                        <div key={k.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-secondary/10">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{k.title}</p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${k.is_active ? "bg-green-500/15 text-green-400" : "bg-secondary text-muted-foreground"}`}>
                                {k.category_label}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{k.content}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onKnowledgeToggle(k)}>
                              {k.is_active ? t("srv.disable") : t("srv.enable")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setKnowledgeEditingId(k.id); setKnowledgeEditTarget(k); setKnowledgeEditTitle(k.title); setKnowledgeEditContent(k.content); }}>
                              {t("srv.edit")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setKnowledgeDeleteTarget(k)}>
                              {t("srv.delete")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="context" className="mt-0 space-y-5">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.global_context")}</h3>
                    <div className="space-y-2">
                      <Textarea className="min-h-16 bg-secondary/50 text-sm" value={globalRules} onChange={(e) => setGlobalRules(e.target.value)} placeholder="Global rules" />
                      <Textarea className="min-h-16 bg-secondary/50 text-sm" value={globalForbidden} onChange={(e) => setGlobalForbidden(e.target.value)} placeholder="Forbidden commands (one per line)" />
                      <Textarea className="min-h-16 bg-secondary/50 text-sm" value={globalRequired} onChange={(e) => setGlobalRequired(e.target.value)} placeholder="Required checks (one per line)" />
                      <Textarea className="min-h-16 bg-secondary/50 text-sm font-mono" value={globalEnvJson} onChange={(e) => setGlobalEnvJson(e.target.value)} placeholder='{"KEY": "value"}' />
                    </div>
                    <Button size="sm" onClick={onSaveGlobalContext}>{t("srv.save_global")}</Button>
                  </div>

                  {advancedServer?.group_id && (
                    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.group_context")}</h3>
                      <div className="space-y-2">
                        <Textarea className="min-h-16 bg-secondary/50 text-sm" value={groupRules} onChange={(e) => setGroupRules(e.target.value)} placeholder="Group rules" />
                        <Textarea className="min-h-16 bg-secondary/50 text-sm" value={groupForbidden} onChange={(e) => setGroupForbidden(e.target.value)} placeholder="Forbidden commands (one per line)" />
                        <Textarea className="min-h-16 bg-secondary/50 text-sm font-mono" value={groupEnvJson} onChange={(e) => setGroupEnvJson(e.target.value)} placeholder='{"KEY": "value"}' />
                      </div>
                      <Button size="sm" onClick={onSaveGroupContext}>{t("srv.save_group")}</Button>

                      <div className="border-t border-border pt-3 mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                        <Input placeholder="username/email" value={groupMemberUser} onChange={(e) => setGroupMemberUser(e.target.value)} className="bg-secondary/50 h-9" />
                        <select
                          value={groupMemberRole}
                          onChange={(e) => setGroupMemberRole(e.target.value as ServerGroupRole)}
                          className="flex h-9 w-full rounded-md border border-input bg-secondary/50 px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <Button size="sm" className="h-9" onClick={onAddGroupMember}>{t("srv.add_member")}</Button>
                        <Button size="sm" variant="outline" className="h-9" onClick={() => subscribeServerGroup(advancedServer.group_id!, "follow")}>{t("srv.follow_group")}</Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Input placeholder="user id" value={groupRemoveUserId} onChange={(e) => setGroupRemoveUserId(e.target.value)} className="bg-secondary/50 h-9" />
                        <Button size="sm" variant="outline" className="h-9 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={onRemoveGroupMember}>{t("srv.remove_member")}</Button>
                        <Button size="sm" variant="outline" className="h-9" onClick={() => subscribeServerGroup(advancedServer.group_id!, "favorite")}>{t("srv.fav_group")}</Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="security" className="mt-0 space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.master_pw")}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Master Password</Label>
                        <Input type="password" value={masterPassword} onChange={(e) => setMasterPasswordText(e.target.value)} className="bg-secondary/50 h-9" />
                      </div>
                      <Button size="sm" className="h-9" onClick={onSetMasterPassword}>{t("srv.set_mp")}</Button>
                      <Button size="sm" variant="outline" className="h-9" onClick={onClearMasterPassword}>{t("srv.clear_mp")}</Button>
                      <div className="text-xs text-muted-foreground flex items-center h-9">
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${hasMasterPassword ? "bg-green-400" : "bg-muted-foreground"}`} />
                        {hasMasterPassword ? "Set" : "Not set"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.reveal_pw")}</h3>
                    <div className="flex gap-2 items-end">
                      <Button size="sm" className="h-9" onClick={onRevealPassword}>{t("srv.reveal_pw")}</Button>
                      <Input value={revealedPassword} readOnly className="bg-secondary/50 h-9 font-mono" placeholder="•••" />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="execute" className="mt-0 space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{t("srv.exec_cmd")}</h3>
                    <div className="flex gap-2">
                      <Input value={execCommand} onChange={(e) => setExecCommand(e.target.value)} className="bg-secondary/50 h-9 font-mono" />
                      <Button size="sm" className="h-9 px-6" onClick={onExecuteCommand}>{t("srv.run")}</Button>
                    </div>
                    {execResult && (
                      <Textarea className="min-h-32 bg-background font-mono text-xs border-border" value={execResult} readOnly />
                    )}
                  </div>
                </TabsContent>

                </div>
              </Tabs>
          )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!groupRenameTarget}
        onOpenChange={(open) => {
          if (!open) {
            setGroupRenameTarget(null);
            setGroupRenameValue("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
            <DialogDescription>Update the display name for this server group.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Group name</Label>
              <Input value={groupRenameValue} onChange={(e) => setGroupRenameValue(e.target.value)} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGroupRenameTarget(null); setGroupRenameValue(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!groupRenameTarget) return;
                void onRenameGroup(groupRenameTarget.id, groupRenameValue);
                setGroupRenameTarget(null);
                setGroupRenameValue("");
              }}
              disabled={!groupRenameValue.trim()}
            >
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!knowledgeEditTarget}
        onOpenChange={(open) => {
          if (!open) {
            setKnowledgeEditTarget(null);
            setKnowledgeEditTitle("");
            setKnowledgeEditContent("");
            setKnowledgeEditingId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl rounded-2xl border-border bg-background/95">
          <DialogHeader>
            <DialogTitle>Edit knowledge entry</DialogTitle>
            <DialogDescription>Adjust the title and content stored for this server knowledge item.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input value={knowledgeEditTitle} onChange={(e) => setKnowledgeEditTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Content</Label>
              <Textarea value={knowledgeEditContent} onChange={(e) => setKnowledgeEditContent(e.target.value)} className="min-h-36" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setKnowledgeEditTarget(null);
                setKnowledgeEditTitle("");
                setKnowledgeEditContent("");
                setKnowledgeEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!knowledgeEditTarget) return;
                void onKnowledgeEdit(knowledgeEditTarget, knowledgeEditTitle, knowledgeEditContent);
                setKnowledgeEditTarget(null);
                setKnowledgeEditTitle("");
                setKnowledgeEditContent("");
              }}
              disabled={!knowledgeEditTitle.trim() || !knowledgeEditContent.trim()}
            >
              Save entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={!!serverDeleteTarget}
        onOpenChange={(open) => {
          if (!open) setServerDeleteTarget(null);
        }}
        title="Delete server"
        description={serverDeleteTarget ? `Delete server "${serverDeleteTarget.name}" from the infrastructure inventory?` : ""}
        confirmLabel="Delete server"
        onConfirm={() => {
          if (!serverDeleteTarget) return;
          void onDelete(serverDeleteTarget);
          setServerDeleteTarget(null);
        }}
      />

      <ConfirmActionDialog
        open={!!groupDeleteTarget}
        onOpenChange={(open) => {
          if (!open) setGroupDeleteTarget(null);
        }}
        title="Delete group"
        description={groupDeleteTarget ? `Delete group "${groupDeleteTarget.name}" and remove it from the server catalog?` : ""}
        confirmLabel="Delete group"
        onConfirm={() => {
          if (!groupDeleteTarget) return;
          void onDeleteGroup(groupDeleteTarget.id, groupDeleteTarget.name);
          setGroupDeleteTarget(null);
        }}
      />

      <ConfirmActionDialog
        open={!!knowledgeDeleteTarget}
        onOpenChange={(open) => {
          if (!open) setKnowledgeDeleteTarget(null);
        }}
        title="Delete knowledge entry"
        description={knowledgeDeleteTarget ? `Delete knowledge entry "${knowledgeDeleteTarget.title}" from this server?` : ""}
        confirmLabel="Delete entry"
        onConfirm={() => {
          if (!knowledgeDeleteTarget) return;
          void onKnowledgeDelete(knowledgeDeleteTarget.id);
          setKnowledgeDeleteTarget(null);
        }}
      />
    </PageShell>
  );
}
