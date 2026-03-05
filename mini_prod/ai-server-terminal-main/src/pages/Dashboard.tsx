import { Server, Activity, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { fetchFrontendBootstrap } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

function toRelativeTime(value: string | null): string {
  if (!value) return "just now";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour ago`;
  const days = Math.floor(hours / 24);
  return `${days} day ago`;
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
  const stats = [
    { labelKey: "dash.total", value: servers.length, icon: Server, color: "text-primary" },
    { labelKey: "dash.online", value: servers.filter((s) => s.status === "online").length, icon: Wifi, color: "text-success" },
    {
      labelKey: "dash.offline",
      value: servers.filter((s) => s.status === "offline").length,
      icon: WifiOff,
      color: "text-destructive",
    },
    {
      labelKey: "dash.unknown",
      value: servers.filter((s) => s.status === "unknown").length,
      icon: AlertTriangle,
      color: "text-warning",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <div className="enterprise-panel rounded-2xl px-6 py-6 md:px-7">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="enterprise-kicker">Overview</div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[2rem]">{t("dash.title")}</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
                Quick health snapshot for the accessible server inventory and the latest operational activity.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-9 gap-1.5 rounded-xl px-4" onClick={() => refetch()}>
            <Activity className={`h-3.5 w-3.5 ${isFetching ? "animate-pulse" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.labelKey}
            className="enterprise-stat rounded-2xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{t(stat.labelKey)}</span>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">{t("dash.activity")}</h2>
        </div>
        <div className="divide-y divide-border/60">
          {(data.recent_activity || []).map((item) => (
            <div key={item.id} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1">
                <p className="text-sm text-foreground">{item.description || item.action}</p>
                <p className="text-xs text-muted-foreground font-mono">{item.entity_name || "-"}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{toRelativeTime(item.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

