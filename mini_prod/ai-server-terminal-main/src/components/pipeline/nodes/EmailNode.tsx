import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function EmailNode({ data, selected }: NodeProps) {
  const d = data as Record<string, string>;
  const label = d?.label || "Send Email";
  const toEmail = d?.to_email;

  return (
    <NodeBase
      selected={selected}
      label={label}
      icon="✉️"
      description={toEmail ? `To: ${toEmail}` : "Configure recipient email"}
      accentColor="border-sky-500/40"
      hasSource={true}
      status={d?.status}
    />
  );
}
