import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

const OUTPUT_META: Record<string, { label: string; icon: string; desc: string }> = {
  "output/report": { label: "Report", icon: "📋", desc: "Generate markdown report" },
  "output/webhook": { label: "Send Webhook", icon: "📤", desc: "POST results to URL" },
};

export function OutputNode({ data, selected, type }: NodeProps) {
  const meta = OUTPUT_META[type as string] || OUTPUT_META["output/report"];
  const d = data as Record<string, string>;
  const url = d?.url;

  return (
    <NodeBase
      selected={selected}
      label={d?.label || meta.label}
      icon={meta.icon}
      description={url ? url.slice(0, 40) : meta.desc}
      hasSource={true}
      accentColor="border-rose-500/40"
      status={d?.status}
    />
  );
}
