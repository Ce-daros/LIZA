import assert from "node:assert/strict";
import test from "node:test";
import { InboundQueue } from "./inbound-queue.js";

test("runs enqueued tasks strictly in submission order", async () => {
  const queue = new InboundQueue();
  const order: number[] = [];

  queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(1);
  }, () => {});
  queue.enqueue(() => {
    order.push(2);
  }, () => {});
  queue.enqueue(() => {
    order.push(3);
  }, () => {});

  await queue.idle();
  assert.deepEqual(order, [1, 2, 3]);
});

test("a task error is reported via onError and does not stop the next task", async () => {
  const queue = new InboundQueue();
  const errors: unknown[] = [];
  const ran: string[] = [];

  queue.enqueue(() => { ran.push("first"); }, () => {});
  queue.enqueue(() => { throw new Error("boom"); }, (e) => errors.push(e));
  queue.enqueue(() => { ran.push("third"); }, () => {});

  await queue.idle();

  assert.deepEqual(ran, ["first", "third"]);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal((errors[0] as Error).message, "boom");
});

test("an onError that throws does not stop later tasks", async () => {
  const queue = new InboundQueue();
  const ran: string[] = [];

  queue.enqueue(() => { throw new Error("boom"); }, () => { throw new Error("handler boom"); });
  queue.enqueue(() => { ran.push("second"); }, () => {});

  await queue.idle();
  assert.deepEqual(ran, ["second"]);
});

test("idle() resolves immediately when no tasks have been enqueued", async () => {
  const queue = new InboundQueue();

  await Promise.race([
    queue.idle(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("idle() did not resolve")), 50)),
  ]);
});

test("idle() resolves only after every enqueued task has settled", async () => {
  const queue = new InboundQueue();
  let finished = false;

  queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    finished = true;
  }, () => {});

  await queue.idle();
  assert.equal(finished, true);
});

test("errors thrown from an async task are also surfaced via onError", async () => {
  const queue = new InboundQueue();
  const errors: unknown[] = [];

  queue.enqueue(async () => {
    throw new Error("async boom");
  }, (e) => errors.push(e));

  await queue.idle();
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /async boom/);
});