import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectChatMessage } from "@shared/types";
import { replaceTempMessage, upsertMessages } from "../src/lib/chat_messages.js";

const baseMessage = (overrides: Partial<ProjectChatMessage>): ProjectChatMessage => ({
  id: 1,
  role: "user",
  content: "hello",
  createdAt: new Date(0).toISOString(),
  kind: "message",
  ...overrides
});

test("upsertMessages updates existing message without duplication", () => {
  const original = baseMessage({ id: 42, content: "first" });
  const updated = baseMessage({ id: 42, content: "second" });

  const result = upsertMessages([original], [updated]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.content, "second");
});

test("replaceTempMessage swaps temp id for real message", () => {
  const temp = baseMessage({ id: -123, content: "temp" });
  const real = baseMessage({ id: 7, content: "real" });

  const result = replaceTempMessage([temp], -123, real);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, 7);
  assert.equal(result[0]?.content, "real");
});

test("non-SSE flow yields one user and one assistant message", () => {
  const temp = baseMessage({ id: -1, role: "user", content: "temp" });
  const user = baseMessage({ id: 100, role: "user", content: "user" });
  const assistant = baseMessage({ id: 101, role: "assistant", content: "assistant" });

  const withUser = replaceTempMessage([temp], -1, user);
  const withAssistant = upsertMessages(withUser, [assistant]);

  assert.equal(withAssistant.length, 2);
  assert.equal(withAssistant.filter((msg) => msg.role === "user").length, 1);
  assert.equal(withAssistant.filter((msg) => msg.role === "assistant").length, 1);
});
