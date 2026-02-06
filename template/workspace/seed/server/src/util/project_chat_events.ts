type ProjectChatEvent = {
  type: "tool_created" | "tool_updated" | "assistant_message";
  message: {
    id: number;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    kind?: "message" | "tool";
    status?: "running" | "done" | "error";
    toolName?: string | null;
    toolMeta?: string | null;
  };
};

type Listener = (event: ProjectChatEvent) => void;

const listeners = new Map<number, Set<Listener>>();

export function publishProjectChatEvent(projectId: number, event: ProjectChatEvent) {
  const projectListeners = listeners.get(projectId);
  if (!projectListeners) {
    return;
  }
  projectListeners.forEach((listener) => listener(event));
}

export function subscribeProjectChatEvents(projectId: number, listener: Listener) {
  const projectListeners = listeners.get(projectId) ?? new Set<Listener>();
  projectListeners.add(listener);
  listeners.set(projectId, projectListeners);
  return () => {
    projectListeners.delete(listener);
    if (projectListeners.size === 0) {
      listeners.delete(projectId);
    }
  };
}
