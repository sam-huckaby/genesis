import type { ProjectChatMessage } from "@shared/types";

export function upsertMessages(
  prev: ProjectChatMessage[],
  nextMessages: ProjectChatMessage[]
) {
  if (nextMessages.length === 0) {
    return prev;
  }
  const next = [...prev];
  nextMessages.forEach((message) => {
    const index = next.findIndex((msg) => msg.id === message.id);
    if (index === -1) {
      next.push(message);
    } else {
      next[index] = { ...next[index], ...message };
    }
  });
  return next;
}

export function replaceTempMessage(
  prev: ProjectChatMessage[],
  tempId: number,
  message: ProjectChatMessage
) {
  const next = prev.filter((msg) => msg.id !== tempId);
  const index = next.findIndex((msg) => msg.id === message.id);
  if (index === -1) {
    return [...next, message];
  }
  next[index] = { ...next[index], ...message };
  return next;
}
