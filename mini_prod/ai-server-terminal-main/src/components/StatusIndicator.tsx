import { cn } from "@/lib/utils";
import type { ServerStatus } from "@/lib/api";

const statusConfig: Record<ServerStatus, { color: string; label: string }> = {
  online: { color: "bg-success", label: "Online" },
  offline: { color: "bg-destructive", label: "Offline" },
  unknown: { color: "bg-warning", label: "Unknown" },
};

export function StatusIndicator({ status, showLabel = true }: { status: ServerStatus; showLabel?: boolean }) {
  const { color, label } = statusConfig[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full shrink-0", color, status === "online" && "animate-pulse-glow")} />
      {showLabel && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}
