import { Activity, AlertTriangle, Server, Wifi, WifiOff } from "lucide-react";
import { fetchFrontendBootstrap } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHero, PageShell, SectionCard, StatusBadge } from "@/components/ui/page-shell";

function toRelativeTime(value: string | null): string {
  if (!value) return "just now";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Dashboard() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["frontend", "bootstrap"],
    queryFn: fetchFrontendBootstrap,
    staleTime: 20_000,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("dash.loading")}</div>;
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-destructive">{t("dash.error")}</div>;
  }

  const servers = data.servers || [];
  const online = servers.filter((server) => server.status === "online").length;
  const offline = servers.filter((server) => server.status === "offline").length;
  const unknown = servers.filter((server) => server.status === "unknown").length;

  const summaryRows = [
    { label: t("dash.total"), value: servers.length, icon: Server, tone: "info" as const },
    { label: t("dash.online"), value: online, icon: Wifi, tone: "success" as const },
    { label: t("dash.offline"), value: offline, icon: WifiOff, tone: offline > 0 ? ("danger" as const) : ("neutral" as const) },
    { label: t("dash.unknown"), value: unknown, icon: AlertTriangle, tone: unknown > 0 ? ("warning" as const) : ("neutral" as const) },
  ];

  return (
    <PageShell className="space-y-6">
      <PageHero
        kicker="Overview"
        title={t("dash.title")}
        description="A quiet summary of the server inventory and the latest activity. No extra telemetry, just what changed and where attention is needed."
        actions={
          <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl px-4" onClick={() => refetch()}>
            <Activity className={`h-3.5 w-3.5 ${isFetching ? "animate-pulse" : ""}`} />
            Refresh
          </Button>
        }
      />

      <SectionCard
        title="Server status"
        description="Compact inventory state across the servers visible to the current user."
        icon={<Server className="h-4 w-4 text-primary" />}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryRows.map((item) => (
            <div key={item.label} className="workspace-subtle rounded-2xl px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-foreground">{item.value}</div>
                </div>
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-3">
                <StatusBadge
                  label={item.label}
                  tone={
                    item.tone === "danger"
                      ? "danger"
                      : item.tone === "warning"
                        ? "warning"
                        : item.tone === "success"
                          ? "success"
                          : item.tone === "info"
                            ? "info"
                            : "neutral"
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={t("dash.activity")}
        description="Recent events from the accessible workspace."
        icon={<Activity className="h-4 w-4 text-primary" />}
      >
        {(data.recent_activity || []).length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="No recent activity"
            description="Activity items will appear here when operators interact with the workspace."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-background/30">
            <div className="divide-y divide-border/60">
              {(data.recent_activity || []).map((item) => (
                <div key={item.id} className="flex items-start gap-4 px-5 py-3.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/35">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{item.description || item.action}</p>
                    <p className="mt-1 text-xs font-mono text-muted-foreground">{item.entity_name || "-"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{toRelativeTime(item.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
