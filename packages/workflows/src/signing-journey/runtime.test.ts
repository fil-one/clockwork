import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { withSigningJourneyHandlers, retrySigningMail } from "./runtime";
const service = vi.hoisted(() => ({
  synchronize: vi.fn().mockResolvedValue(undefined),
  deliver: vi.fn().mockResolvedValue({ delivered: 1 }),
}));
vi.mock("./environment", () => ({
  environmentSigningJourney: () => ({ service }),
}));
it("consumes real MNDA/contract event names, preserves staff handlers, and binds manual reminders to their provider", async () => {
  const previous = vi.fn().mockResolvedValue(undefined);
  const handlers = withSigningJourneyHandlers(
    new Map([["contract.reminded", previous]]),
    {} as never,
    {},
  );
  const eventId = randomUUID(),
    id = randomUUID(),
    providerId = randomUUID();
  const delivery = {
    eventId,
    messageId: randomUUID(),
    topic: "contract.reminded",
    idempotencyKey: "test",
    payload: {
      aggregateId: id,
      occurredAt: new Date().toISOString(),
      data: { providerId },
    },
  };
  for (const topic of [
    "mnda.sent",
    "mnda.completed",
    "contract.signing_sent",
    "contract.signing_completed",
    "contract.signer_correction_refused",
    "contract.reminded",
  ])
    expect(handlers.has(topic)).toBe(true);
  await handlers.get("contract.reminded")?.(delivery);
  expect(previous).toHaveBeenCalledWith(delivery);
  expect(service.synchronize).toHaveBeenLastCalledWith(
    "contract",
    id,
    eventId,
    providerId,
  );
  service.synchronize.mockClear();
  await handlers.get("contract.reminded")?.({
    ...delivery,
    payload: { ...delivery.payload, data: {} },
  });
  expect(service.synchronize).not.toHaveBeenCalled();
  expect(await retrySigningMail()).toEqual({ delivered: 1 });
});
