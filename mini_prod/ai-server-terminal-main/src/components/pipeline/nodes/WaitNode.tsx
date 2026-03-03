import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function WaitNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  const minutes = d?.wait_minutes as number | undefined;
  return (
    <NodeBase
      selected={selected}
      label={(d?.label as string) || "Wait"}
      icon="⏱️"
      description={minutes ? `Pause for ${minutes} minute(s)` : "Configure wait duration"}
      accentColor="border-orange-500/40"
      status={d?.status as string | undefined}
    />
  );
}
