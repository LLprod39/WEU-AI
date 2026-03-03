import { Server, Activity, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { fetchFrontendBootstrap } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";

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
  const { data, isLoading, error } = useQuery({
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t("dash.title")}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.labelKey}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{t(stat.labelKey)}</span>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">{t("dash.activity")}</h2>
        </div>
        <div className="divide-y divide-border">
          {(data.recent_activity || []).map((item) => (
            <div key={item.id} className="flex items-center gap-4 px-4 py-3">
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
