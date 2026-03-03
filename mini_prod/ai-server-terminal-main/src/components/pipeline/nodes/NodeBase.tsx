import { type ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface NodeBaseProps {
  selected?: boolean;
  label: string;
  icon: string;
  description?: string;
  status?: string;
  hasSource?: boolean;
  hasTarget?: boolean;
  hasSourceTrue?: boolean;
  hasSourceFalse?: boolean;
  accentColor?: string;
  children?: ReactNode;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
  if (status === "completed") return <CheckCircle2 className="h-3 w-3 text-green-500" />;
  if (status === "failed") return <XCircle className="h-3 w-3 text-red-500" />;
  if (status === "pending") return <Clock className="h-3 w-3 text-muted-foreground" />;
  return null;
}

export function NodeBase({
  selected,
  label,
  icon,
  description,
  status,
  hasSource = true,
  hasTarget = true,
  hasSourceTrue,
  hasSourceFalse,
  accentColor = "border-border",
  children,
}: NodeBaseProps) {
  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card shadow-sm min-w-[180px] max-w-[260px] transition-all",
        selected ? "border-primary shadow-md shadow-primary/10" : accentColor,
        status === "running" && "border-blue-500/60",
        status === "completed" && "border-green-500/60",
        status === "failed" && "border-red-500/60",
      )}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background hover:!bg-primary transition-colors"
        />
      )}

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base shrink-0">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground truncate">{label}</span>
              {status && <StatusIcon status={status} />}
            </div>
            {description && (
              <span className="text-[10px] text-muted-foreground line-clamp-1">{description}</span>
            )}
          </div>
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>

      {hasSourceTrue && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="true"
          style={{ left: "35%" }}
          className="!w-3 !h-3 !bg-green-500/70 !border-2 !border-background hover:!bg-green-500 transition-colors"
        />
      )}
      {hasSourceFalse && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="false"
          style={{ left: "65%" }}
          className="!w-3 !h-3 !bg-red-500/70 !border-2 !border-background hover:!bg-red-500 transition-colors"
        />
      )}
      {hasSource && !hasSourceTrue && !hasSourceFalse && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-muted-foreground/50 !border-2 !border-background hover:!bg-primary transition-colors"
        />
      )}
    </div>
  );
}
