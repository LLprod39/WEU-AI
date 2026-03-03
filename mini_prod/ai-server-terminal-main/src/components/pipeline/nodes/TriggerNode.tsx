import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

const TRIGGER_META: Record<string, { label: string; icon: string; description: string }> = {
  "trigger/manual": { label: "Manual Trigger", icon: "▶️", description: "Run manually" },
  "trigger/webhook": { label: "Webhook", icon: "🔗", description: "Receive HTTP POST" },
  "trigger/schedule": { label: "Schedule", icon: "⏰", description: "Cron expression" },
};

export function TriggerNode({ data, selected, type }: NodeProps) {
  const meta = TRIGGER_META[type as string] || TRIGGER_META["trigger/manual"];
  const cron = (data as Record<string, string>)?.cron_expression;
  const label = (data as Record<string, string>)?.label || meta.label;

  return (
    <NodeBase
      selected={selected}
      label={label}
      icon={meta.icon}
      description={cron ? `cron: ${cron}` : meta.description}
      hasTarget={false}
      accentColor="border-emerald-500/40"
      status={(data as Record<string, string>)?.status}
    />
  );
}
