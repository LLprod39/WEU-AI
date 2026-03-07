import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  TrendingUp,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  ShieldAlert,
  DollarSign,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  MetricCard,
  MetricGrid,
  PageGrid,
  PageHero,
  PageShell,
  SectionCard,
  StatusBadge,
} from "@/components/ui/page-shell";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

function GaugeCompact({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  const color = value >= 90 ? "text-red-400" : value >= 75 ? "text-amber-300" : "text-emerald-300";
  const bar = value >= 90 ? "bg-red-500" : value >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="w-10 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/80">
        <div className={bar} style={{ width: `${Math.min(value, 100)}%`, height: "100%" }} />
      </div>
      <span className={`w-10 text-right text-xs font-mono ${color}`}>{Math.round(value)}%</span>
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
  const hourlyData = (d.hourly_activity || []).map((item) => ({
    hour: new Date(item.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    count: item.count,
  }));
  const hasAttention = d.active_alerts_count > 0 || d.fleet_health.unreachable > 0 || d.agents.failed_24h > 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  return (
    <PageShell>
      <PageHero
        kicker={tr("Administrative Control Plane", "Administrative Control Plane")}
        title={t("adash.title")}
        description={
          <>
            {tr(
              "Первый экран для операторов и администраторов: видно текущее состояние платформы, проблемные зоны и следующий приоритетный шаг.",
              "The first screen for operators and administrators: what is happening now, where the problems are, and what to do next.",
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge
                tone={hasAttention ? "danger" : "success"}
                label={
                  hasAttention
                    ? tr("attention required", "attention required")
                    : tr("stable now", "stable now")
                }
              />
              <span>{tr(`Версия ${d.app_version}`, `Version ${d.app_version}`)}</span>
            </div>
          </>
        }
        actions={
          <Button size="sm" variant="outline" className="h-9 gap-2 rounded-xl px-4" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            {t("udash.refresh")}
          </Button>
        }
      >
        <MetricGrid>
          <MetricCard
            label={tr("Attention required", "Attention required")}
            value={d.active_alerts_count + d.fleet_health.unreachable + d.agents.failed_24h}
            description={tr(
              `${d.active_alerts_count} активных алертов, ${d.fleet_health.unreachable} недоступных серверов, ${d.agents.failed_24h} неуспешных агентных запусков за 24 часа.`,
              `${d.active_alerts_count} active alerts, ${d.fleet_health.unreachable} unreachable servers, ${d.agents.failed_24h} failed agent runs in the last 24h.`,
            )}
            icon={<ShieldAlert className="h-5 w-5 text-red-300" />}
            tone={hasAttention ? "danger" : "success"}
          />
          <MetricCard
            label={tr("Global health", "Global health")}
            value={`${d.servers.active}/${d.servers.total}`}
            description={tr(
              `${d.online_users.count} пользователей онлайн и ${d.fleet_health.healthy} серверов в healthy-состоянии.`,
              `${d.online_users.count} users online and ${d.fleet_health.healthy} servers in a healthy state.`,
            )}
            icon={<Server className="h-5 w-5 text-primary" />}
            tone="info"
          />
          <MetricCard
            label={tr("Operational load", "Operational load")}
            value={d.terminals.active + d.agents.running}
            description={tr(
              `${d.terminals.active} активных терминалов и ${d.agents.running} запущенных агентов прямо сейчас.`,
              `${d.terminals.active} active terminals and ${d.agents.running} running agents right now.`,
            )}
            icon={<Activity className="h-5 w-5 text-sky-300" />}
            tone="info"
          />
          <MetricCard
            label={tr("AI spend today", "AI spend today")}
            value={`$${totalCost.toFixed(2)}`}
            description={tr(
              `${d.api_calls_today} вызовов провайдеров и ${d.ai.requests_today} AI-запросов за сегодня.`,
              `${d.api_calls_today} provider calls and ${d.ai.requests_today} AI requests recorded today.`,
            )}
            icon={<DollarSign className="h-5 w-5 text-amber-300" />}
            tone="warning"
          />
        </MetricGrid>
      </PageHero>

      <PageGrid sidebar>
        <div className="space-y-5">
          <SectionCard
            title={tr("Attention required", "Attention required")}
            description={tr(
              "Проблемы, которые стоит разобрать в первую очередь. Это блок про приоритет, а не про всю телеметрию сразу.",
              "Issues to review first. This block is about priority, not every telemetry point at once.",
            )}
            icon={<ShieldAlert className="h-4 w-4 text-red-300" />}
          >
            {(d.alerts || []).length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-5 w-5" />}
                title={tr("Критичных алертов нет", "No critical alerts right now")}
                description={tr(
                  "Платформа не сообщает о срочных инфраструктурных проблемах. Следующий шаг: просмотрите операционную активность и usage-метрики ниже.",
                  "The platform is not reporting urgent infrastructure issues. Next step: review operational activity and usage metrics below.",
                )}
              />
            ) : (
              <div className="space-y-3">
                {(d.alerts || []).slice(0, 6).map((alert, index) => (
                  <div key={`${alert.server}-${alert.title}-${index}`} className="rounded-xl border border-border bg-background/35 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={alert.severity === "critical" ? "danger" : "warning"}
                            label={alert.severity === "critical" ? "critical" : "warning"}
                          />
                          <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {alert.server} · {alert.type}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">{relativeTime(alert.time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={tr("Operational activity", "Operational activity")}
            description={tr(
              "Недавние действия пользователей и ритм активности помогают быстро понять, это локальная ошибка или системный всплеск.",
              "Recent user actions and the activity rhythm help distinguish a local failure from a broader spike.",
            )}
            icon={<TrendingUp className="h-4 w-4 text-primary" />}
          >
            <div className="space-y-5">
              {hourlyData.length > 0 && (
                <div className="h-36 rounded-xl border border-border bg-background/35 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyData}>
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={28} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          fontSize: "11px",
                          padding: "8px 10px",
                        }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-border/80 bg-background/35">
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>{tr("User", "User")}</th>
                      <th>{tr("Action", "Action")}</th>
                      <th>{tr("When", "When")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent_activity.slice(0, 8).map((item, index) => (
                      <tr key={`${item.user}-${item.time}-${index}`}>
                        <td className="font-medium text-foreground">{item.user}</td>
                        <td className="text-muted-foreground">{item.action}</td>
                        <td className="text-muted-foreground">{relativeTime(item.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard
            title={tr("Global health", "Global health")}
            description={tr(
              "Сводка по доступности и усреднённой нагрузке флота. Это отвечает на вопрос, стабильна ли сама инфраструктурная база.",
              "Fleet reachability and average load. This answers whether the infrastructure base itself is stable.",
            )}
            icon={<Server className="h-4 w-4 text-primary" />}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Healthy</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{d.fleet_health.healthy}</div>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Degraded</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{d.fleet_health.warning}</div>
                </div>
                <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Critical</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{d.fleet_health.critical}</div>
                </div>
                <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Unreachable</div>
                  <div className="mt-2 text-2xl font-semibold text-foreground">{d.fleet_health.unreachable}</div>
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-border bg-background/35 p-4">
                <GaugeCompact label="CPU" value={d.fleet_health.avg_cpu} icon={Cpu} />
                <GaugeCompact label="RAM" value={d.fleet_health.avg_memory} icon={MemoryStick} />
                <GaugeCompact label="Disk" value={d.fleet_health.avg_disk} icon={HardDrive} />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title={tr("Cost and provider usage", "Cost and provider usage")}
            description={tr(
              "Кто потребляет LLM-вызовы и какие провайдеры реально используются сегодня.",
              "Which providers are carrying the workload and what the spend profile looks like today.",
            )}
            icon={<DollarSign className="h-4 w-4 text-amber-300" />}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(d.api_usage).map(([provider, usage]) => (
                <div key={provider} className="rounded-xl border border-border bg-background/35 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-foreground uppercase tracking-[0.08em]">{provider}</div>
                    <StatusBadge tone={d.providers[provider]?.enabled ? "success" : "neutral"} label={d.providers[provider]?.enabled ? "enabled" : "off"} />
                  </div>
                  <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">{usage.calls}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {(usage.input_tokens || 0).toLocaleString()} in / {(usage.output_tokens || 0).toLocaleString()} out
                  </div>
                  <div className="mt-2 text-xs font-semibold text-amber-300">${(usage.cost_usd || 0).toFixed(4)}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </PageGrid>

      <PageGrid>
        <SectionCard
          title={tr("Online operators", "Online operators")}
          description={tr(
            "Кто сейчас работает в системе и кто держит активные терминальные сессии.",
            "Who is active in the system right now and who is holding live terminal sessions.",
          )}
          icon={<Users className="h-4 w-4 text-emerald-300" />}
        >
          {sessions.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={tr("Сейчас никто не онлайн", "No operators online right now")}
              description={tr(
                "Пользовательских сессий не видно. Если это неожиданно, проверьте SSO и доступность логина.",
                "No user sessions are visible. If this is unexpected, verify SSO and login availability.",
              )}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-background/35">
              <table className="enterprise-table">
                <thead>
                  <tr>
                    <th>{tr("Operator", "Operator")}</th>
                    <th>{tr("Last action", "Last action")}</th>
                    <th>{tr("Today", "Today")}</th>
                    <th>{tr("Terminals", "Terminals")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.user_id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                            {session.username.slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{session.username}</div>
                            <div className="text-xs text-muted-foreground">{session.is_staff ? tr("admin", "admin") : tr("operator", "operator")}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-muted-foreground">{session.last_action}</td>
                      <td className="text-muted-foreground">{session.today_actions}</td>
                      <td className="text-muted-foreground">{session.active_terminals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={tr("Runtime surfaces", "Runtime surfaces")}
          description={tr(
            "Где прямо сейчас идёт живая операторская работа: терминалы и агентный рантайм.",
            "Where live operator activity is happening right now: terminals and the agent runtime.",
          )}
          icon={<Terminal className="h-4 w-4 text-sky-300" />}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background/35 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Running agents", "Running agents")}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{d.agents.running}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{tr("Активные agent-run процессы в текущий момент.", "Live agent-run processes at the current moment.")}</div>
              </div>
              <div className="rounded-xl border border-border bg-background/35 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr("Terminals open", "Terminals open")}</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{d.terminals.active}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{tr("Открытые SSH/RDP-сессии под наблюдением платформы.", "Open SSH/RDP sessions currently seen by the platform.")}</div>
              </div>
            </div>

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
                  <div key={`${connection.user}-${connection.server}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/35 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{connection.user}</div>
                      <div className="text-xs text-muted-foreground">{connection.server}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{relativeTime(connection.connected_at)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-border bg-background/35 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-foreground">{tr("Need the builder layer?", "Need the builder layer?")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tr(
                    "Для конфигов, skills и пайплайнов переходите в Studio. Этот экран про управление текущим состоянием платформы.",
                    "Use Studio for configs, skills, and pipelines. This screen is for managing the platform's current state.",
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
      </PageGrid>
    </PageShell>
  );
}
