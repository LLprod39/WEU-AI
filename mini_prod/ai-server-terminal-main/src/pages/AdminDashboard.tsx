import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ElementType } from "react";
import {
  fetchAdminDashboard,
  fetchAdminUsersSessions,
  type AdminDashboardData,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  Users,
  Server,
  Terminal,
  RefreshCw,
  ShieldAlert,
  DollarSign,
  ArrowRight,
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SummaryRow({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        {hint ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</div> : null}
      </div>
      <StatusBadge label={value} tone={tone} dot={false} className="shrink-0" />
    </div>
  );
}

function LoadRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: ElementType;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/35">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm text-foreground">{Math.round(value)}%</div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { lang, t } = useI18n();
  const tr = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const queryClient = useQueryClient();

  const { data: dashData, isLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: fetchAdminDashboard,
    refetchInterval: 15_000,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: fetchAdminUsersSessions,
    refetchInterval: 30_000,
  });

  if (isLoading || !dashData?.data) {
    return <div className="p-6 text-sm text-muted-foreground">{t("dash.loading")}</div>;
  }

  const d: AdminDashboardData = dashData.data;
  const sessions = sessionsData?.sessions || [];
  const totalCost = Object.values(d.api_usage).reduce((sum, usage) => sum + (usage.cost_usd || 0), 0);
  const hasAttention = d.active_alerts_count > 0 || d.fleet_health.unreachable > 0 || d.agents.failed_24h > 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  return (
    <PageShell className="space-y-6">
      <PageHero
        kicker={tr("Administrative Control Plane", "Administrative Control Plane")}
        title={t("adash.title")}
        description={tr(
          "Спокойный обзор платформы: что требует внимания, кто сейчас в системе и как выглядит состояние флота без лишней визуализации.",
          "A calmer platform overview: what needs attention, who is active, and what the fleet state looks like without dashboard noise.",
        )}
        actions={
          <Button size="sm" variant="outline" className="h-9 gap-2 rounded-xl px-4" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            {t("udash.refresh")}
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <SectionCard
          title={tr("Attention first", "Attention first")}
          description={tr(
            "Очередь приоритетов для администратора: инциденты, недоступность и проблемные агентные запуски.",
            "The administrator priority queue: incidents, reachability problems, and failing agent runs.",
          )}
          icon={<ShieldAlert className="h-4 w-4 text-red-300" />}
        >
          <div className="space-y-3">
            <SummaryRow
              label={tr("Immediate issues", "Immediate issues")}
              value={d.active_alerts_count + d.fleet_health.unreachable + d.agents.failed_24h}
              hint={tr(
                `${d.active_alerts_count} активных алертов, ${d.fleet_health.unreachable} недоступных серверов, ${d.agents.failed_24h} неуспешных запусков за 24 часа.`,
                `${d.active_alerts_count} active alerts, ${d.fleet_health.unreachable} unreachable servers, ${d.agents.failed_24h} failed runs in the last 24h.`,
              )}
              tone={hasAttention ? "danger" : "success"}
            />
            {(d.alerts || []).length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-5 w-5" />}
                title={tr("Критичных алертов нет", "No critical alerts right now")}
                description={tr(
                  "Срочных инфраструктурных проблем не видно. Ниже остаются только операционные сводки.",
                  "No urgent infrastructure issues are visible. The remaining sections are operational summaries.",
                )}
              />
            ) : (
              <div className="space-y-2">
                {(d.alerts || []).slice(0, 6).map((alert, index) => (
                  <div key={`${alert.server}-${alert.title}-${index}`} className="rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={alert.severity === "critical" ? "danger" : "warning"}
                            label={alert.severity === "critical" ? "critical" : "warning"}
                          />
                          <p className="text-sm font-medium text-foreground">{alert.title}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {alert.server} · {alert.type}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">{relativeTime(alert.time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Platform snapshot", "Platform snapshot")}
          description={tr(
            "Короткая сводка по платформе без перегруженных KPI-блоков.",
            "A short platform summary without oversized KPI blocks.",
          )}
          icon={<Activity className="h-4 w-4 text-primary" />}
        >
          <div className="space-y-3">
            <SummaryRow
              label={tr("Version", "Version")}
              value={d.app_version}
              hint={tr("Текущая версия платформы.", "Current platform version.")}
              tone="info"
            />
            <SummaryRow
              label={tr("Operators online", "Operators online")}
              value={d.online_users.count}
              hint={tr("Пользователи с активной сессией прямо сейчас.", "Users with an active session right now.")}
              tone="success"
            />
            <SummaryRow
              label={tr("Runtime load", "Runtime load")}
              value={d.terminals.active + d.agents.running}
              hint={tr(
                `${d.terminals.active} терминалов и ${d.agents.running} агентов в рантайме.`,
                `${d.terminals.active} terminals and ${d.agents.running} running agents.`,
              )}
              tone="info"
            />
            <SummaryRow
              label={tr("AI spend today", "AI spend today")}
              value={`$${totalCost.toFixed(2)}`}
              hint={tr(
                `${d.api_calls_today} вызовов провайдеров и ${d.ai.requests_today} AI-запросов за сегодня.`,
                `${d.api_calls_today} provider calls and ${d.ai.requests_today} AI requests today.`,
              )}
              tone="warning"
            />
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title={tr("Fleet health", "Fleet health")}
          description={tr(
            "Сводка по состоянию серверного флота и средней нагрузке.",
            "Fleet state and average load at a glance.",
          )}
          icon={<Server className="h-4 w-4 text-primary" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryRow label="Healthy" value={d.fleet_health.healthy} tone="success" />
            <SummaryRow label="Warning" value={d.fleet_health.warning} tone={d.fleet_health.warning > 0 ? "warning" : "neutral"} />
            <SummaryRow label="Critical" value={d.fleet_health.critical} tone={d.fleet_health.critical > 0 ? "danger" : "neutral"} />
            <SummaryRow label="Unreachable" value={d.fleet_health.unreachable} tone={d.fleet_health.unreachable > 0 ? "danger" : "neutral"} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <LoadRow label="CPU" value={d.fleet_health.avg_cpu} icon={Cpu} />
            <LoadRow label="RAM" value={d.fleet_health.avg_memory} icon={MemoryStick} />
            <LoadRow label="Disk" value={d.fleet_health.avg_disk} icon={HardDrive} />
          </div>
        </SectionCard>

        <SectionCard
          title={tr("Provider usage", "Provider usage")}
          description={tr(
            "Кто несёт LLM-нагрузку и сколько это стоит сегодня.",
            "Which providers are carrying LLM load and what that costs today.",
          )}
          icon={<DollarSign className="h-4 w-4 text-amber-300" />}
        >
          <div className="space-y-3">
            {Object.entries(d.api_usage).map(([provider, usage]) => (
              <div key={provider} className="rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium uppercase tracking-[0.08em] text-foreground">{provider}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(usage.input_tokens || 0).toLocaleString()} in / {(usage.output_tokens || 0).toLocaleString()} out
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-foreground">{usage.calls}</div>
                    <div className="mt-1 text-xs text-amber-300">${(usage.cost_usd || 0).toFixed(4)}</div>
                  </div>
                </div>
                <div className="mt-3">
                  <StatusBadge tone={d.providers[provider]?.enabled ? "success" : "neutral"} label={d.providers[provider]?.enabled ? "enabled" : "off"} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title={tr("Online operators", "Online operators")}
          description={tr(
            "Кто сейчас работает в системе и держит живые пользовательские сессии.",
            "Who is active in the system and holding live user sessions.",
          )}
          icon={<Users className="h-4 w-4 text-emerald-300" />}
        >
          {sessions.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={tr("Сейчас никто не онлайн", "No operators online right now")}
              description={tr(
                "Пользовательских сессий не видно. Если это неожиданно, проверьте доступность логина.",
                "No user sessions are visible. If this is unexpected, verify login availability.",
              )}
            />
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div key={session.user_id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{session.username}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {session.is_staff ? tr("admin", "admin") : tr("operator", "operator")} · {session.today_actions} {tr("actions", "actions")}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{session.active_terminals} {tr("terminals", "terminals")}</div>
                    <div className="mt-1">{session.last_action}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={tr("Runtime surfaces", "Runtime surfaces")}
          description={tr(
            "Где прямо сейчас идёт живая операторская работа: терминалы и агентный рантайм.",
            "Where live operator work is happening right now: terminals and the agent runtime.",
          )}
          icon={<Terminal className="h-4 w-4 text-sky-300" />}
        >
          <div className="space-y-3">
            <SummaryRow
              label={tr("Running agents", "Running agents")}
              value={d.agents.running}
              hint={tr("Активные agent-run процессы в текущий момент.", "Live agent-run processes right now.")}
              tone="info"
            />
            <SummaryRow
              label={tr("Open terminals", "Open terminals")}
              value={d.terminals.active}
              hint={tr("Открытые SSH/RDP-сессии под наблюдением платформы.", "Open SSH/RDP sessions currently seen by the platform.")}
              tone="info"
            />

            {d.terminals.connections.length === 0 ? (
              <EmptyState
                icon={<Terminal className="h-5 w-5" />}
                title={tr("Живых терминалов нет", "No live terminals right now")}
                description={tr(
                  "Когда операторы откроют SSH или RDP, здесь появится краткая сводка по активным подключениям.",
                  "When operators open SSH or RDP sessions, this block will show a live summary of active connections.",
                )}
              />
            ) : (
              <div className="space-y-2">
                {d.terminals.connections.map((connection, index) => (
                  <div key={`${connection.user}-${connection.server}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/30 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{connection.user}</div>
                      <div className="text-xs text-muted-foreground">{connection.server}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{relativeTime(connection.connected_at)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/30 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{tr("Need the builder layer?", "Need the builder layer?")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tr(
                    "Для конфигов, skills и пайплайнов переходите в Studio. Этот экран только про текущее состояние платформы.",
                    "Use Studio for configs, skills, and pipelines. This screen is only about current platform state.",
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" className="gap-2 rounded-xl" asChild>
                <a href="/studio">
                  Studio
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    </PageShell>
  );
}
