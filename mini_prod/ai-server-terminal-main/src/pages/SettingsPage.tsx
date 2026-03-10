import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  Activity,
  Users,
  Shield,
  FolderOpen,
  RefreshCw,
  Save,
  Gauge,
  AlertTriangle,
  Search,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Eye,
  Key,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHero, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchModels,
  fetchSettings,
  fetchSettingsActivity,
  refreshModels,
  saveSettings,
  fetchMonitoringConfig,
  saveMonitoringConfig,
  fetchAuthSession,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function relativeTime(value: string, lang: "ru" | "en"): string {
  const d = new Date(value);
  const diff = Math.max(1, Math.floor((Date.now() - d.getTime()) / 60000));
  if (lang === "ru") {
    if (diff < 60) return `${diff} мин назад`;
    if (diff < 1440) return `${Math.floor(diff / 60)} ч назад`;
    return `${Math.floor(diff / 1440)} дн назад`;
  }
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

function statusBadge(status: string) {
  if (status === "success") return "bg-green-500/10 text-green-300";
  if (status === "error") return "bg-red-500/10 text-red-300";
  return "bg-background/35 text-muted-foreground";
}

function ThresholdSlider({ label, icon: Icon, warnValue, critValue, onWarnChange, onCritChange, unit = "%", lang }: {
  label: string;
  icon: React.ElementType;
  warnValue: number;
  critValue: number;
  onWarnChange: (v: number) => void;
  onCritChange: (v: number) => void;
  unit?: string;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  return (
    <div className="workspace-subtle space-y-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {tr("Предупреждение", "Warning")}
            </label>
            <span className="text-xs font-mono text-foreground">{warnValue}{unit}</span>
          </div>
          <input
            type="range"
            min={10}
            max={99}
            value={warnValue}
            onChange={(e) => onWarnChange(Number(e.target.value))}
            className="enterprise-range accent-yellow-500"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {tr("Критично", "Critical")}
            </label>
            <span className="text-xs font-mono text-foreground">{critValue}{unit}</span>
          </div>
          <input
            type="range"
            min={10}
            max={99}
            value={critValue}
            onChange={(e) => onCritChange(Number(e.target.value))}
            className="enterprise-range accent-red-500"
          />
        </div>
      </div>
    </div>
  );
}

const LLM_PROVIDERS = [
  { value: "grok", label: "Grok (xAI)" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "openai", label: "OpenAI" },
  { value: "claude", label: "Claude (Anthropic)" },
];

function PurposeModelSelector({
  label,
  description,
  provider,
  model,
  availableModels,
  onProviderChange,
  onModelChange,
  onRefresh,
  refreshing,
  lang,
}: {
  label: string;
  description: string;
  provider: string;
  model: string;
  availableModels: string[];
  onProviderChange: (p: string) => void;
  onModelChange: (m: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lang: "ru" | "en";
}) {
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  return (
    <div className="workspace-subtle space-y-3 rounded-2xl p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {tr("Провайдер", "Provider")}
          </label>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="enterprise-select"
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {tr("Модель", "Model")}
          </label>
          {availableModels.length > 0 ? (
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="enterprise-select"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <div className="flex gap-2">
              <Input value={model} onChange={(e) => onModelChange(e.target.value)} placeholder={tr("Введите модель или обновите список", "Enter model or refresh the list")} className="h-10 text-sm" />
              <Button size="sm" variant="outline" className="h-[38px] shrink-0 rounded-xl px-2.5" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          )}
        </div>
      </div>
      {availableModels.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-xl px-2 text-[10px] text-muted-foreground" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? "animate-spin" : ""}`} /> {tr("Обновить список", "Refresh list")}
          </Button>
        </div>
      )}
    </div>
  );
}

function AccessCard({
  icon: Icon,
  title,
  description,
  to,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link to={to} className="workspace-subtle group flex items-center gap-3 rounded-2xl p-4 hover:border-border/80 hover:bg-background/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-background/24 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
    </Link>
  );
}

export default function SettingsPage() {
  const { t, lang } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [monSaving, setMonSaving] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");

  const { data: authData } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: fetchAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  const isAdmin = authData?.user?.is_staff ?? false;

  const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useQuery({
    queryKey: ["settings", "config"],
    queryFn: fetchSettings,
    staleTime: 30_000,
  });

  const { data: modelsData } = useQuery({
    queryKey: ["settings", "models"],
    queryFn: fetchModels,
    staleTime: 30_000,
  });

  const { data: activityData } = useQuery({
    queryKey: ["settings", "activity"],
    queryFn: () => fetchSettingsActivity(50, 14),
    staleTime: 20_000,
  });

  const { data: monConfig } = useQuery({
    queryKey: ["settings", "monitoring"],
    queryFn: fetchMonitoringConfig,
    enabled: isAdmin,
    staleTime: 30_000,
  });

  const [provider, setProvider] = useState<string>("grok");
  const [model, setModel] = useState<string>("");

  // Purpose-based model state
  const [chatProvider, setChatProvider] = useState("grok");
  const [chatModel, setChatModel] = useState("");
  const [agentProvider, setAgentProvider] = useState("grok");
  const [agentModel, setAgentModel] = useState("");
  const [orchProvider, setOrchProvider] = useState("grok");
  const [orchModel, setOrchModel] = useState("");
  const [refreshingPurpose, setRefreshingPurpose] = useState<string | null>(null);

  // OpenAI reasoning effort
  const [reasoningEffort, setReasoningEffort] = useState<string>("low");

  const [cpuWarn, setCpuWarn] = useState(80);
  const [cpuCrit, setCpuCrit] = useState(95);
  const [memWarn, setMemWarn] = useState(85);
  const [memCrit, setMemCrit] = useState(95);
  const [diskWarn, setDiskWarn] = useState(80);
  const [diskCrit, setDiskCrit] = useState(90);

  useEffect(() => {
    const config = settingsData?.config;
    if (!config) return;
    const llmProviders = ["gemini", "grok", "openai", "claude"];
    const activeProvider = llmProviders.includes(config.internal_llm_provider || "")
      ? config.internal_llm_provider
      : llmProviders.includes(config.default_provider || "")
        ? config.default_provider
        : "grok";
    setProvider(activeProvider);
    if (activeProvider === "gemini") setModel(config.chat_model_gemini || "");
    else if (activeProvider === "openai") setModel(config.chat_model_openai || "");
    else if (activeProvider === "claude") setModel(config.chat_model_claude || "");
    else setModel(config.chat_model_grok || "");

    // Purpose-based
    setChatProvider(config.chat_llm_provider || activeProvider);
    setChatModel(config.chat_llm_model || "");
    setAgentProvider(config.agent_llm_provider || activeProvider);
    setAgentModel(config.agent_llm_model || "");
    setOrchProvider(config.orchestrator_llm_provider || activeProvider);
    setOrchModel(config.orchestrator_llm_model || "");
    setReasoningEffort(config.openai_reasoning_effort || "low");
  }, [settingsData]);

  useEffect(() => {
    if (!monConfig?.thresholds) return;
    setCpuWarn(monConfig.thresholds.cpu_warn);
    setCpuCrit(monConfig.thresholds.cpu_crit);
    setMemWarn(monConfig.thresholds.mem_warn);
    setMemCrit(monConfig.thresholds.mem_crit);
    setDiskWarn(monConfig.thresholds.disk_warn);
    setDiskCrit(monConfig.thresholds.disk_crit);
  }, [monConfig]);

  const getModelsForProvider = (p: string): string[] => {
    if (!modelsData) return [];
    if (p === "gemini") return modelsData.gemini || [];
    if (p === "openai") return modelsData.openai || [];
    if (p === "claude") return modelsData.claude || [];
    return modelsData.grok || [];
  };

  const availableModels = useMemo(() => getModelsForProvider(provider), [modelsData, provider]);

  const onRefreshPurpose = async (p: string) => {
    setRefreshingPurpose(p);
    try {
      await refreshModels(p as "gemini" | "grok" | "openai" | "claude");
      await queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
    } finally {
      setRefreshingPurpose(null);
    }
  };

  const onSavePurpose = async () => {
    setSaving(true);
    try {
      await saveSettings({
        chat_llm_provider: chatProvider,
        chat_llm_model: chatModel,
        agent_llm_provider: agentProvider,
        agent_llm_model: agentModel,
        orchestrator_llm_provider: orchProvider,
        orchestrator_llm_model: orchModel,
        // Keep internal_llm_provider in sync with chat provider for backward compat
        internal_llm_provider: chatProvider,
        openai_reasoning_effort: reasoningEffort,
      });
      await queryClient.invalidateQueries({ queryKey: ["settings", "config"] });
    } finally {
      setSaving(false);
    }
  };

  const filteredActivity = useMemo(() => {
    const events = activityData?.events || [];
    if (!activitySearch) return events;
    const q = activitySearch.toLowerCase();
    return events.filter(
      (e) =>
        e.username.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q),
    );
  }, [activityData, activitySearch]);

  const onSave = async () => {
    setSaving(true);
    try {
      const llmProviders = ["gemini", "grok", "openai", "claude"];
      const isLlmProvider = llmProviders.includes(provider);
      const payload: Record<string, unknown> = { default_provider: provider };

      // Update the selected model for this provider
      if (provider === "gemini") payload.chat_model_gemini = model;
      if (provider === "grok") payload.chat_model_grok = model;
      if (provider === "openai") payload.chat_model_openai = model;
      if (provider === "claude") payload.chat_model_claude = model;

      // Sync internal_llm_provider so terminal AI & agents use the chosen provider
      if (isLlmProvider) {
        payload.internal_llm_provider = provider;
        // Enable the selected provider and disable others
        payload.gemini_enabled = provider === "gemini";
        payload.grok_enabled = provider === "grok";
        payload.openai_enabled = provider === "openai";
        payload.claude_enabled = provider === "claude";
      }

      await saveSettings(payload);
      await queryClient.invalidateQueries({ queryKey: ["settings", "config"] });
    } finally {
      setSaving(false);
    }
  };

  const onRefreshModels = async () => {
    setRefreshing(true);
    try {
      await refreshModels(provider as "gemini" | "grok" | "openai" | "claude");
      await queryClient.invalidateQueries({ queryKey: ["settings", "models"] });
    } finally {
      setRefreshing(false);
    }
  };

  const onSaveMonitoring = async () => {
    setMonSaving(true);
    try {
      await saveMonitoringConfig({
        cpu_warn: cpuWarn,
        cpu_crit: cpuCrit,
        mem_warn: memWarn,
        mem_crit: memCrit,
        disk_warn: diskWarn,
        disk_crit: diskCrit,
      });
      await queryClient.invalidateQueries({ queryKey: ["settings", "monitoring"] });
    } finally {
      setMonSaving(false);
    }
  };

  if (settingsLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("loading")}</div>;
  }
  if (settingsError || !settingsData?.success) {
    return <div className="p-6 text-sm text-destructive">{t("set.error")}</div>;
  }

  const config = settingsData.config;
  const apiKeys = settingsData.api_keys as Record<string, boolean> | undefined;
  const configuredProviders = [
    config.gemini_enabled,
    config.grok_enabled,
    config.openai_enabled,
    config.claude_enabled,
  ].filter(Boolean).length;

  const monitoredServers = isAdmin ? monConfig?.stats?.monitored_servers || 0 : 0;

  return (
    <PageShell className="space-y-6">
      <PageHero
        kicker={tr("Workspace Settings", "Workspace Settings")}
        title={t("settings.title")}
        description={tr(
          "Тихий рабочий экран для AI, доступа, мониторинга и аудита. Только то, что реально помогает управлять системой.",
          "A quieter workspace for AI, access, monitoring and audit. Only the controls that actually help operate the system.",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={isAdmin ? tr("admin access", "admin access") : tr("operator access", "operator access")} tone="info" />
            <Button size="sm" variant="outline" className="gap-2 rounded-xl" onClick={() => queryClient.invalidateQueries({ queryKey: ["settings"] })}>
              <RefreshCw className="h-4 w-4" />
              {tr("Обновить", "Refresh")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={tr(`${configuredProviders} providers`, `${configuredProviders} providers`)} tone="neutral" />
        <StatusBadge label={tr(`${activityData?.summary?.total_events || 0} events`, `${activityData?.summary?.total_events || 0} events`)} tone="neutral" />
        {isAdmin && (
          <StatusBadge
            label={tr(`${monitoredServers} monitored`, `${monitoredServers} monitored`)}
            tone={monitoredServers > 0 ? "info" : "neutral"}
          />
        )}
        <StatusBadge label={isAdmin ? tr("admin access", "admin access") : tr("operator access", "operator access")} tone="neutral" />
      </div>

      <Tabs defaultValue="ai" className="space-y-5">
        <TabsList className="workspace-subtle h-auto w-full justify-start gap-2 overflow-x-auto rounded-2xl p-2">
          <TabsTrigger value="ai" className="gap-2 rounded-xl data-[state=active]:bg-card">
            <Bot className="h-4 w-4" /> {t("set.tab_ai")}
          </TabsTrigger>
          <TabsTrigger value="access" className="gap-2 rounded-xl data-[state=active]:bg-card">
            <Shield className="h-4 w-4" /> {t("set.tab_access")}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="monitoring" className="gap-2 rounded-xl data-[state=active]:bg-card">
              <Gauge className="h-4 w-4" /> {t("set.tab_monitoring")}
            </TabsTrigger>
          )}
          <TabsTrigger value="activity" className="gap-2 rounded-xl data-[state=active]:bg-card">
            <Activity className="h-4 w-4" /> {t("set.tab_activity")}
          </TabsTrigger>
        </TabsList>

        {/* ==================== AI TAB ==================== */}
        <TabsContent value="ai" className="space-y-5">
          <SectionCard
            title={tr("Базовая AI-конфигурация", "Base AI configuration")}
            icon={<Bot className="h-4 w-4 text-primary" />}
            description={tr("Один источник правды для дефолтного провайдера и модели.", "A single place for the default provider and model.")}
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("set.provider")}</label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="enterprise-select"
                  >
                    <option value="grok">Grok</option>
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("set.model")}</label>
                  {availableModels.length > 0 ? (
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="enterprise-select"
                    >
                      {availableModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-1.5">
                      <Input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={
                          provider === "claude" ? "claude-sonnet-4-6" :
                          provider === "gemini" ? "models/gemini-2.5-flash" :
                          provider === "openai" ? "gpt-4o" : "grok-3"
                        }
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" className="gap-1.5 rounded-xl px-4" onClick={onSave} disabled={saving}>
                  <Save className="h-3.5 w-3.5" /> {saving ? t("set.saving") : t("set.save")}
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 rounded-xl" onClick={onRefreshModels} disabled={refreshing}>
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> {t("set.refresh_models")}
                </Button>
              </div>
            </div>
          </SectionCard>

          {/* Purpose-based model settings */}
          <SectionCard
            title={tr("Модели по назначению", "Models by purpose")}
            icon={<Cpu className="h-4 w-4 text-primary" />}
            description={tr("Отдельные профили для чата, агентов и оркестратора.", "Separate profiles for chat, agents, and orchestrator.")}
          >
            <div className="space-y-4">
              <PurposeModelSelector
                label={tr("Чат / Терминальный AI", "Chat / Terminal AI")}
                description={tr("Используется в терминальном AI и пользовательском чате.", "Used by terminal AI and user-facing chat.")}
                provider={chatProvider}
                model={chatModel}
                availableModels={getModelsForProvider(chatProvider)}
                onProviderChange={(p) => { setChatProvider(p); setChatModel(""); }}
                onModelChange={setChatModel}
                onRefresh={() => onRefreshPurpose(chatProvider)}
                refreshing={refreshingPurpose === chatProvider}
                lang={lang}
              />
              <PurposeModelSelector
                label={tr("Агенты (ReAct / Full)", "Agents (ReAct / Full)")}
                description={tr("Используется во время выполнения задач и работы с инструментами.", "Used while agents execute tasks and tools.")}
                provider={agentProvider}
                model={agentModel}
                availableModels={getModelsForProvider(agentProvider)}
                onProviderChange={(p) => { setAgentProvider(p); setAgentModel(""); }}
                onModelChange={setAgentModel}
                onRefresh={() => onRefreshPurpose(agentProvider)}
                refreshing={refreshingPurpose === agentProvider}
                lang={lang}
              />
              <PurposeModelSelector
                label={tr("Оркестратор (Pipeline)", "Orchestrator (Pipeline)")}
                description={tr("Используется для планирования и синтеза в многоагентных сценариях.", "Used for planning and synthesis in multi-agent flows.")}
                provider={orchProvider}
                model={orchModel}
                availableModels={getModelsForProvider(orchProvider)}
                onProviderChange={(p) => { setOrchProvider(p); setOrchModel(""); }}
                onModelChange={setOrchModel}
                onRefresh={() => onRefreshPurpose(orchProvider)}
                refreshing={refreshingPurpose === orchProvider}
                lang={lang}
              />
              <div className="workspace-subtle rounded-2xl p-4">
                <div className="mb-3">
                  <p className="text-sm font-medium text-foreground">{tr("Уровень рассуждения OpenAI", "OpenAI reasoning effort")}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {tr("Настройка reasoning для Responses API: none, low, medium или high.", "Reasoning setting for the Responses API: none, low, medium, or high.")}
                  </p>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">{tr("Параметр модели", "Model parameter")}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {tr("Меняйте только если хотите явно управлять глубиной рассуждения.", "Adjust only when you want explicit control over reasoning depth.")}
                    </p>
                  </div>
                  <select
                    value={reasoningEffort}
                    onChange={(e) => setReasoningEffort(e.target.value)}
                    className="enterprise-select shrink-0"
                  >
                    <option value="">{tr("— авто (модель решает)", "— auto (model decides)")}</option>
                    <option value="none">{tr("none — без мышления", "none — no reasoning")}</option>
                    <option value="low">{tr("low — минимум", "low — minimum")}</option>
                    <option value="medium">{tr("medium — баланс", "medium — balanced")}</option>
                    <option value="high">{tr("high — глубоко", "high — deep")}</option>
                  </select>
                </div>
              </div>

              <Button size="sm" className="gap-1.5 rounded-xl px-4" onClick={onSavePurpose} disabled={saving}>
                <Save className="h-3.5 w-3.5" /> {saving ? t("set.saving") : tr("Сохранить настройки моделей", "Save model settings")}
              </Button>
            </div>
          </SectionCard>

          {apiKeys && isAdmin && (
            <SectionCard title={tr("Состояние платформы", "Platform status")} icon={<Key className="h-4 w-4 text-primary" />} description={tr("Ключи провайдеров и доменная авторизация без лишнего шума.", "Provider keys and domain auth, without extra noise.")}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { name: "Gemini", key: "gemini_set", enabled: config.gemini_enabled },
                  { name: "Grok", key: "grok_set", enabled: config.grok_enabled },
                  { name: "OpenAI", key: "openai_set", enabled: config.openai_enabled },
                  { name: "Claude", key: "claude_set", enabled: config.claude_enabled },
                ].map((p) => (
                  <div key={p.name} className="workspace-subtle flex items-center gap-3 rounded-2xl px-3 py-3">
                    <div className={`h-2 w-2 rounded-full ${apiKeys[p.key] ? "bg-green-400" : "bg-red-400"}`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {apiKeys[p.key] ? t("set.key_set") : t("set.key_missing")}
                        {p.enabled ? ` · ${t("set.enabled")}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {isAdmin && config.domain_auth_enabled !== undefined && (
            <SectionCard title={t("set.domain_auth")} icon={<Globe className="h-4 w-4 text-primary" />} description={t("set.domain_auth_desc")}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="workspace-subtle rounded-2xl px-3 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase">{t("set.status")}</p>
                  <p className="text-sm font-medium text-foreground">{config.domain_auth_enabled ? t("set.enabled") : t("set.disabled")}</p>
                </div>
                <div className="workspace-subtle rounded-2xl px-3 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase">{tr("Заголовок", "Header")}</p>
                  <p className="text-sm font-mono text-foreground">{config.domain_auth_header || "REMOTE_USER"}</p>
                </div>
                <div className="workspace-subtle rounded-2xl px-3 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase">{t("set.auto_create")}</p>
                  <p className="text-sm font-medium text-foreground">{config.domain_auth_auto_create ? tr("Да", "Yes") : tr("Нет", "No")}</p>
                </div>
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* ==================== ACCESS TAB ==================== */}
        <TabsContent value="access" className="space-y-5">
          <SectionCard title={tr("Доступ и структура", "Access and structure")} icon={<Shield className="h-4 w-4 text-primary" />} description={tr("Три прямых входа в управление пользователями, группами и разрешениями.", "Three direct entry points for users, groups, and permissions.")}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <AccessCard icon={Users} title={t("settings.users")} description={t("set.users_desc")} to="/settings/users" />
              <AccessCard icon={FolderOpen} title={t("settings.groups")} description={t("set.groups_desc")} to="/settings/groups" />
              <AccessCard icon={Shield} title={t("settings.permissions")} description={t("set.perms_desc")} to="/settings/permissions" />
            </div>
          </SectionCard>
        </TabsContent>

        {/* ==================== MONITORING TAB ==================== */}
        {isAdmin && (
          <TabsContent value="monitoring" className="space-y-5">
            {monConfig && (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={tr(`${monConfig.stats.monitored_servers} серверов`, `${monConfig.stats.monitored_servers} servers`)} tone="info" />
                <StatusBadge label={tr(`${monConfig.stats.total_checks} проверок`, `${monConfig.stats.total_checks} checks`)} tone="neutral" />
                <StatusBadge label={tr(`${monConfig.stats.active_alerts} активных алертов`, `${monConfig.stats.active_alerts} active alerts`)} tone={monConfig.stats.active_alerts > 0 ? "danger" : "success"} />
                <StatusBadge label={tr(`последняя проверка ${monConfig.stats.last_check_at ? relativeTime(monConfig.stats.last_check_at, lang) : "—"}`, `last check ${monConfig.stats.last_check_at ? relativeTime(monConfig.stats.last_check_at, lang) : "—"}`)} tone="neutral" />
              </div>
            )}

            <SectionCard title={t("set.mon_thresholds")} icon={<Gauge className="h-4 w-4 text-primary" />} description={t("set.mon_thresholds_desc")}>
              <div className="space-y-4">
                <ThresholdSlider
                  label={tr("Нагрузка CPU", "CPU Load")}
                  icon={Cpu}
                  warnValue={cpuWarn}
                  critValue={cpuCrit}
                  onWarnChange={setCpuWarn}
                  onCritChange={setCpuCrit}
                  lang={lang}
                />
                <ThresholdSlider
                  label={tr("Память (RAM)", "Memory (RAM)")}
                  icon={MemoryStick}
                  warnValue={memWarn}
                  critValue={memCrit}
                  onWarnChange={setMemWarn}
                  onCritChange={setMemCrit}
                  lang={lang}
                />
                <ThresholdSlider
                  label={tr("Использование диска", "Disk Usage")}
                  icon={HardDrive}
                  warnValue={diskWarn}
                  critValue={diskCrit}
                  onWarnChange={setDiskWarn}
                  onCritChange={setDiskCrit}
                  lang={lang}
                />

                <div className="flex items-center gap-3 pt-2">
                  <Button size="sm" className="gap-1.5 rounded-xl px-4" onClick={onSaveMonitoring} disabled={monSaving}>
                    <Save className="h-3.5 w-3.5" /> {monSaving ? t("set.saving") : t("set.save_thresholds")}
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t("set.mon_how")} icon={<Eye className="h-4 w-4 text-primary" />} description={t("set.mon_how_desc")}>
              <div className="space-y-3 text-sm text-muted-foreground">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/60 bg-background/24 p-4 space-y-2">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{t("set.mon_quick")}</p>
                    <p className="text-xs">{t("set.mon_quick_desc")}</p>
                    <div className="space-y-1 font-mono text-[11px] text-foreground/70">
                      <p>cat /proc/loadavg</p>
                      <p>free -m | grep Mem</p>
                      <p>df -h / | tail -1</p>
                      <p>cat /proc/uptime</p>
                      <p>ps aux --no-headers | wc -l</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-background/24 p-4 space-y-2">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{t("set.mon_deep")}</p>
                    <p className="text-xs">{t("set.mon_deep_desc")}</p>
                    <div className="space-y-1 font-mono text-[11px] text-foreground/70">
                      <p>systemctl list-units --state=failed</p>
                      <p>journalctl -p 3 --since '10 min ago'</p>
                      <p>dmesg --level=err,crit</p>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("set.mon_run_hint")}
                </p>
              </div>
            </SectionCard>
          </TabsContent>
        )}

        {/* ==================== ACTIVITY TAB ==================== */}
        <TabsContent value="activity" className="space-y-5">
          <SectionCard title={t("set.activity_log")} icon={<Activity className="h-4 w-4 text-primary" />} description={t("set.activity_desc")}>
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("set.activity_search")}
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {activityData?.summary && (
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={`${activityData.summary.total_events} ${t("set.events")}`} tone="info" />
                  <StatusBadge label={`${activityData.summary.total_users} ${t("set.unique_users")}`} tone="neutral" />
                </div>
              )}

              <div className="max-h-[500px] overflow-y-auto divide-y divide-border rounded-2xl border border-border overflow-hidden">
                {filteredActivity.length === 0 && (
                  <p className="text-sm text-muted-foreground p-6 text-center">{t("set.no_activity")}</p>
                )}
                {filteredActivity.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/15 transition-colors">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-background/30 text-[10px] font-medium text-muted-foreground">
                      {log.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{log.username}</span>
                        <span className={`rounded-full px-2 py-1 text-[9px] font-medium ${statusBadge(log.status)}`}>
                          {log.status}
                        </span>
                        <span className="rounded-full bg-background/35 px-2 py-1 text-[10px] text-muted-foreground">
                          {log.category}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {log.description || log.action}
                        {log.entity_name ? ` · ${log.entity_name}` : ""}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(log.created_at, lang)}</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
