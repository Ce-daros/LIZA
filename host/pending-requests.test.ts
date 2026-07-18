import assert from "node:assert/strict";
import test from "node:test";
import { PendingRequests, type PendingRequest } from "./pending-requests.js";

interface Captured {
  reject(error: Error): void;
}

function capture(): { entry: PendingRequest; captured: { value: Error | undefined } } {
  const captured = { value: undefined as Error | undefined };
  return {
    captured,
    entry: { reject: (error) => { captured.value = error; } },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("take() clears the timer so the entry does not fire on timeout", async () => {
  const reqs = new PendingRequests<Captured>(20);
  const { entry, captured } = capture();
  reqs.add(1, "DOS command", entry);

  assert.equal(reqs.get(1), entry);
  assert.equal(reqs.take(1), entry);
  assert.equal(reqs.get(1), undefined);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(captured.value, undefined, "take() must clear the timer");
});

test("fires the full timeout message when the entry is not taken", async () => {
  const reqs = new PendingRequests<Captured>(20);
  const { entry, captured } = capture();
  reqs.add(7, "DOS file operation", entry);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(captured.value, "expected timeout to fire");
  assert.equal(
    captured.value!.message,
    "DOS file operation timed out after 20 ms without a response from the DOS guest; it may be busy or stuck",
  );
  assert.equal(reqs.get(7), undefined, "timed-out entry must be removed from the map");
});

test("get() does not clear the timer, so take() is required to disarm", async () => {
  const reqs = new PendingRequests<Captured>(20);
  const { entry, captured } = capture();
  reqs.add(1, "DOS command", entry);

  assert.equal(reqs.get(1), entry);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(captured.value, "get() must not clear the timer");
});

test("rejectAll() rejects every pending entry with the same message and clears the map", () => {
  const reqs = new PendingRequests<Captured>(10_000);
  const errors: Error[] = [];
  const a: Captured = { reject: (e) => errors.push(e) };
  const b: Captured = { reject: (e) => errors.push(e) };
  reqs.add(1, "op", a);
  reqs.add(2, "op", b);

  reqs.rejectAll("peer closed");

  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.message === "peer closed"));
  assert.equal(reqs.get(1), undefined);
  assert.equal(reqs.get(2), undefined);
});

test("unref()'d timers do not block process exit", async () => {
  const reqs = new PendingRequests<Captured>(5);
  const { entry } = capture();
  reqs.add(1, "DOS command", entry);
  await flush();
});