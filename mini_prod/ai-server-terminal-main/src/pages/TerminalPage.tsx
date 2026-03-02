import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { XTerminal, type TerminalConnectionStatus, type TerminalHandle, type AiExecutionMode } from "@/components/terminal/XTerminal";
import { AiPanel, type AiMessage, type AiCommand } from "@/components/terminal/AiPanel";
import { fetchFrontendBootstrap, type FrontendServer } from "@/lib/api";
import { Bot, Maximize, Copy, Search, X, Plus, Wifi, Server, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useQuery } from "@tanstack/react-query";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface Tab {
  id: string;
  serverId: number;
  name: string;
  status: "connected" | "connecting" | "error";
}

let _idSeq = 0;
function nextId() { return String(++_idSeq); }

function mapStatus(s: TerminalConnectionStatus): Tab["status"] {
  if (s === "connected") return "connected";
  if (s === "connecting") return "connecting";
  return "error";
}

function findServer(servers: FrontendServer[], id: number) {
  return servers.find((s) => s.id === id);
}

// ─── Server Picker Modal ──────────────────────────────────────────────────────

interface ServerPickerProps {
  servers: FrontendServer[];
  open: boolean;
  onClose: () => void;
  onSelect: (server: FrontendServer) => void;
  usedServerIds: Set<number>;
}

function ServerPicker({ servers, open, onClose, onSelect, usedServerIds }: ServerPickerProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = search.toLowerCase().trim();
  const filtered = servers.filter((s) => {
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.username.toLowerCase().includes(q) ||
      (s.group_name || "").toLowerCase().includes(q)
    );
  });

  const groups = new Map<string, FrontendServer[]>();
  for (const s of filtered) {
    const gn = s.group_name || "Без группы";
    if (!groups.has(gn)) groups.set(gn, []);
    groups.get(gn)!.push(s);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Выбор сервера</h2>
              <p className="text-xs text-muted-foreground">{servers.length} серверов доступно</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border/60 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени, хосту, группе..."
              className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Server list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Server className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">Серверы не найдены</p>
              {search && <p className="text-xs text-muted-foreground/60 mt-1">Попробуйте изменить поисковый запрос</p>}
            </div>
          ) : (
            Array.from(groups.entries()).map(([groupName, groupServers]) => (
              <div key={groupName}>
                <div className="px-5 py-1.5 bg-secondary/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0">
                  {groupName} ({groupServers.length})
                </div>
                {groupServers.map((s) => {
                  const isUsed = usedServerIds.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => { onSelect(s); onClose(); }}
                      disabled={isUsed}
                      className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors border-b border-border/30 ${
                        isUsed
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-primary/5 active:bg-primary/10"
                      }`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                        s.server_type === "rdp" ? "bg-blue-500/10" : "bg-primary/10"
                      }`}>
                        {s.server_type === "rdp"
                          ? <Monitor className="h-4 w-4 text-blue-500" />
                          : <Server className="h-4 w-4 text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                          <StatusIndicator
                            status={s.status === "online" ? "online" : s.status === "offline" ? "offline" : "unknown"}
                            showLabel={false}
                          />
                          {isUsed && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">открыт</span>}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {s.username}@{s.host}:{s.port}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">{s.server_type}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const requestedId = useMemo(() => Number(id || 0), [id]);
  const terminalRef = useRef<TerminalHandle | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["frontend", "bootstrap"],
    queryFn: fetchFrontendBootstrap,
    staleTime: 20_000,
  });

  const servers = data?.servers || [];
  const defaultServer = findServer(servers, requestedId) || servers[0];

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  useEffect(() => {
    if (!defaultServer || tabs.length > 0) return;
    const firstId = nextId();
    setTabs([{ id: firstId, serverId: defaultServer.id, name: defaultServer.name, status: "connecting" }]);
    setActiveTabId(firstId);
  }, [defaultServer, tabs.length]);

  useEffect(() => {
    if (tabs.length && (!activeTabId || !tabs.some((t) => t.id === activeTabId))) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const activeServer = activeTab ? findServer(servers, activeTab.serverId) : null;

  // ── Server picker ─────────────────────────────────────────────────────────
  const [showServerPicker, setShowServerPicker] = useState(false);
  const usedServerIds = useMemo(() => new Set(tabs.map((t) => t.serverId)), [tabs]);

  const addTab = useCallback(() => {
    if (!servers.length) return;
    setShowServerPicker(true);
  }, [servers.length]);

  const handleServerSelect = useCallback((server: FrontendServer) => {
    const tabId = nextId();
    setTabs((p) => [...p, { id: tabId, serverId: server.id, name: server.name, status: "connecting" }]);
    setActiveTabId(tabId);
  }, []);

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (activeTabId === tabId) setActiveTabId(next[0].id);
  };

  const updateTabStatus = useCallback((status: TerminalConnectionStatus) => {
    setActiveTabId((cur) => {
      setTabs((prev) => prev.map((t) => t.id === cur ? { ...t, status: mapStatus(status) } : t));
      return cur;
    });
  }, []);

  // ── AI state ──────────────────────────────────────────────────────────────
  const [showAi, setShowAi] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [executionMode, setExecutionMode] = useState<AiExecutionMode>(() => {
    try {
      const stored = localStorage.getItem("ai_execution_mode");
      if (stored === "fast" || stored === "step" || stored === "auto") return stored;
    } catch { /* noop */ }
    return "auto";
  });

  const handleModeChange = useCallback((mode: AiExecutionMode) => {
    setExecutionMode(mode);
    try { localStorage.setItem("ai_execution_mode", mode); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    setAiMessages([]);
    setIsAiGenerating(false);
  }, [activeTab?.serverId]);

  const handleClearChat = useCallback(() => {
    setAiMessages([]);
    setIsAiGenerating(false);
  }, []);

  // ── AI panel resize ───────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(380);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const startDrag = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    e.preventDefault();
  }, [panelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const diff = dragStartX.current - e.clientX;
      setPanelWidth(Math.max(260, Math.min(720, dragStartWidth.current + diff)));
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── WebSocket events from terminal ────────────────────────────────────────
  const handleWsEvent = useCallback((payload: Record<string, unknown>) => {
    const type = String(payload.type || "");

    if (type === "ai_status") {
      const s = String(payload.status || "");
      setIsAiGenerating(s === "thinking" || s === "running");
      return;
    }

    if (type === "ai_response") {
      const text = String(payload.assistant_text || payload.message || "");
      const mode = String(payload.mode || "answer") as AiMessage["mode"];
      const rawCmds = (payload.commands as AiCommand[] | undefined) || [];
      setAiMessages((prev) => [...prev, {
        id: nextId(),
        role: "assistant",
        type: rawCmds.length > 0 ? "commands" : "text",
        content: text,
        commands: rawCmds.map((c) => ({ ...c, status: (c.status || "pending") as AiCommand["status"] })),
        mode,
      }]);
      return;
    }

    if (type === "ai_command_status") {
      const cmdId = Number(payload.id);
      const status = String(payload.status || "done") as AiCommand["status"];
      const exit_code = payload.exit_code !== undefined ? Number(payload.exit_code) : undefined;
      setAiMessages((prev) => prev.map((msg) => {
        if (msg.type !== "commands" || !msg.commands?.some((c) => c.id === cmdId)) return msg;
        return { ...msg, commands: msg.commands.map((c) => c.id === cmdId ? { ...c, status, exit_code } : c) };
      }));
      return;
    }

    if (type === "ai_report") {
      const report = String(payload.report || "");
      const status = String(payload.status || "ok") as AiMessage["reportStatus"];
      if (report) {
        setAiMessages((prev) => [...prev, { id: nextId(), role: "assistant", type: "report", content: report, reportStatus: status }]);
      }
      return;
    }

    if (type === "ai_question") {
      const qId = String(payload.q_id || "");
      const question = String(payload.question || "");
      const cmd = payload.cmd ? String(payload.cmd) : undefined;
      const exitCode = payload.exit_code !== undefined ? Number(payload.exit_code) : undefined;
      setAiMessages((prev) => [...prev, {
        id: nextId(), role: "system", type: "question", content: question,
        qId, question, questionCmd: cmd, questionExitCode: exitCode,
      }]);
      setShowAi(true);
      return;
    }

    if (type === "ai_install_progress") {
      const cmd = String(payload.cmd || "");
      const elapsed = Number(payload.elapsed || 0);
      const outputTail = String(payload.output_tail || "");
      setAiMessages((prev) => {
        let found = false;
        const updated = prev.map((m) => {
          if (m.type === "progress" && m.progressCmd === cmd) {
            found = true;
            return { ...m, progressElapsed: elapsed, progressTail: outputTail };
          }
          return m;
        });
        if (found) return updated;
        return [...prev, {
          id: nextId(), role: "system", type: "progress", content: cmd,
          progressCmd: cmd, progressElapsed: elapsed, progressTail: outputTail,
        }];
      });
      return;
    }

    if (type === "ai_recovery") {
      setAiMessages((prev) => [...prev, {
        id: nextId(), role: "system", type: "recovery",
        content: String(payload.why || ""),
        recoveryOriginal: String(payload.original_cmd || ""),
        recoveryNew: String(payload.new_cmd || ""),
        recoveryWhy: String(payload.why || ""),
      }]);
      return;
    }

    if (type === "ai_error") {
      setIsAiGenerating(false);
      setAiMessages((prev) => [...prev, {
        id: nextId(), role: "system", type: "text", content: String(payload.message || "AI error"),
      }]);
      return;
    }

    if (type === "status" && String(payload.status) === "connected") {
      setIsAiGenerating(false);
    }
  }, []);

  // ── AI interaction callbacks ──────────────────────────────────────────────
  const handleSendAi = useCallback((text: string) => {
    if (!text.trim()) return;
    setAiMessages((prev) => [...prev, { id: nextId(), role: "user", type: "text", content: text }]);
    setIsAiGenerating(true);
    terminalRef.current?.sendAiRequest(text, executionMode);
  }, [executionMode]);

  const handleStopAi = useCallback(() => {
    setIsAiGenerating(false);
    terminalRef.current?.stopAi();
  }, []);

  const handleConfirm = useCallback((id: number) => {
    terminalRef.current?.sendAiConfirm(id);
  }, []);

  const handleCancel = useCallback((id: number) => {
    terminalRef.current?.sendAiCancel(id);
  }, []);

  const handleReply = useCallback((qId: string, text: string) => {
    terminalRef.current?.sendAiReply(qId, text);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Загрузка...</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">Ошибка загрузки данных терминала.</div>;
  if (!activeTab || !activeServer) return <div className="p-6 text-sm text-muted-foreground">Сервер не найден или недоступен.</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 pt-2 bg-background border-b border-border overflow-x-auto shrink-0">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTabId(tab.id)}
            className={`group flex items-center gap-2 px-3 py-2 text-sm rounded-t-md border border-b-0 transition-colors shrink-0 ${
              tab.id === activeTabId
                ? "bg-card border-border text-foreground"
                : "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}>
            <StatusIndicator
              status={tab.status === "connected" ? "online" : tab.status === "error" ? "offline" : "unknown"}
              showLabel={false} />
            <span className="truncate max-w-32">{tab.name}</span>
            {tabs.length > 1 && (
              <span role="button" aria-label={`Close ${tab.name}`}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity">
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <button onClick={addTab}
          className="flex items-center gap-1 px-2.5 py-2 text-muted-foreground hover:text-primary transition-colors shrink-0 text-xs"
          aria-label="Add tab" title="Подключить сервер">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wifi className="h-3.5 w-3.5 text-success" />
          <span className="font-medium">{activeServer.name}</span>
          <span className="font-mono text-muted-foreground/70">{activeServer.host}:{activeServer.port}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {([
            { icon: Search, label: "Search", action: () => {} },
            { icon: Copy,   label: "Copy",   action: () => document.execCommand("copy") },
            { icon: Maximize, label: "Fullscreen", action: () => document.documentElement.requestFullscreen?.() },
          ] as const).map(({ icon: Icon, label, action }) => (
            <Button key={label} size="sm" variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={action} aria-label={label}>
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
          <Button size="sm" variant={showAi ? "default" : "ghost"}
            className={`h-7 gap-1 text-xs px-2 ${showAi ? "" : "text-muted-foreground hover:text-primary"}`}
            onClick={() => setShowAi((v) => !v)}>
            <Bot className="h-3.5 w-3.5" /> AI
            {aiMessages.length > 0 && !showAi && (
              <span className="ml-0.5 h-4 w-4 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
                {aiMessages.length > 9 ? "9+" : aiMessages.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Terminal */}
        <div className="flex-1 min-h-0 bg-terminal-bg p-1">
          <XTerminal
            key={activeServer.id}
            ref={terminalRef}
            serverId={activeServer.id}
            onStatusChange={updateTabStatus}
            onError={(msg) => setAiMessages((prev) => [...prev, { id: nextId(), role: "system", type: "text", content: msg }])}
            onEvent={handleWsEvent}
          />
        </div>

        {/* AI panel with drag-to-resize handle */}
        {showAi && (
          <div className="relative flex shrink-0 min-h-0 border-l border-border" style={{ width: panelWidth }}>
            <div
              onMouseDown={startDrag}
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 select-none"
              title="Перетащите для изменения ширины"
            />
            <div className="flex-1 min-h-0 overflow-hidden">
              <AiPanel
                onClose={() => setShowAi(false)}
                onSend={handleSendAi}
                onStop={handleStopAi}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                onReply={handleReply}
                onClearChat={handleClearChat}
                messages={aiMessages}
                isGenerating={isAiGenerating}
                executionMode={executionMode}
                onModeChange={handleModeChange}
              />
            </div>
          </div>
        )}
      </div>

      {/* Server Picker Modal */}
      <ServerPicker
        servers={servers}
        open={showServerPicker}
        onClose={() => setShowServerPicker(false)}
        onSelect={handleServerSelect}
        usedServerIds={usedServerIds}
      />
    </div>
  );
}
