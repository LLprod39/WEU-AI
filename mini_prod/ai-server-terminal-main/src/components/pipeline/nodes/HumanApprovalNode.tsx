import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function HumanApprovalNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  const toEmail = d?.to_email as string | undefined;
  const tgChatId = d?.tg_chat_id as string | undefined;
  const timeout = d?.timeout_minutes as number | undefined;

  const desc = [
    toEmail && `✉️ ${toEmail}`,
    tgChatId && `📱 TG`,
    timeout && `⏰ ${timeout}min timeout`,
  ]
    .filter(Boolean)
    .join(" · ") || "Configure email / Telegram";

  return (
    <NodeBase
      selected={selected}
      label={(d?.label as string) || "Human Approval"}
      icon="👤"
      description={desc}
      accentColor="border-yellow-500/40"
      status={d?.status as string | undefined}
    />
  );
}
