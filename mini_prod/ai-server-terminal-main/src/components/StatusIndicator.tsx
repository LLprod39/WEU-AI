import { cn } from "@/lib/utils";
import type { ServerStatus } from "@/lib/api";

const statusConfig: Record<ServerStatus, { color: string; label: string }> = {
  online: { color: "bg-success", label: "Healthy" },
  offline: { color: "bg-destructive", label: "Failed" },
  unknown: { color: "bg-warning", label: "Unknown" },
};

export function StatusIndicator({ status, showLabel = true }: { status: ServerStatus; showLabel?: boolean }) {
  const { color, label } = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        status === "online" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        status === "offline" && "border-red-500/25 bg-red-500/10 text-red-300",
        status === "unknown" && "border-amber-500/25 bg-amber-500/10 text-amber-300",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", color, status === "online" && "animate-pulse-glow")} />
      {showLabel && <span>{label}</span>}
    </span>
  );
}
