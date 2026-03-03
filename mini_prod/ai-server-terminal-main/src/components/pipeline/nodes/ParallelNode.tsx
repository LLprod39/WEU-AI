import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function ParallelNode({ data, selected }: NodeProps) {
  const d = data as Record<string, string>;
  return (
    <NodeBase
      selected={selected}
      label={d?.label || "Parallel"}
      icon="⚡"
      description="Run next nodes in parallel"
      accentColor="border-orange-500/40"
      status={d?.status}
    />
  );
}
