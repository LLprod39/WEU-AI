import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function ConditionNode({ data, selected }: NodeProps) {
  const d = data as Record<string, string>;
  const checkType = d?.check_type || "contains";
  const checkValue = d?.check_value;
  const desc = checkValue ? `${checkType}: "${checkValue.slice(0, 20)}"` : checkType;

  return (
    <NodeBase
      selected={selected}
      label={d?.label || "Condition"}
      icon="🔀"
      description={desc}
      hasSourceTrue
      hasSourceFalse
      accentColor="border-amber-500/40"
      status={d?.status}
    >
      <div className="flex justify-between text-[9px] text-muted-foreground px-1 mt-1">
        <span className="text-green-500 font-medium">TRUE</span>
        <span className="text-red-500 font-medium">FALSE</span>
      </div>
    </NodeBase>
  );
}
