import { type NodeProps } from "@xyflow/react";
import { NodeBase } from "./NodeBase";

export function TelegramNode({ data, selected }: NodeProps) {
  const d = data as Record<string, unknown>;
  const chatId = d?.chat_id as string | undefined;
  return (
    <NodeBase
      selected={selected}
      label={(d?.label as string) || "Telegram"}
      icon="📱"
      description={chatId ? `Chat: ${chatId}` : "Configure bot token & chat ID"}
      accentColor="border-sky-500/40"
      hasSource={true}
      status={d?.status as string | undefined}
    />
  );
}
