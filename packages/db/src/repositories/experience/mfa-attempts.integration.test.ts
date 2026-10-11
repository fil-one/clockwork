import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { createRuntimeDatabase } from "../../client";
import { claimMfaAttempt, claimMfaPreparationAttempt } from "./mfa";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const keys: string[] = [];
function user() {
  const id = `user_${randomUUID().replaceAll("-", "")}`;
  keys.push(id, `mfa-prepare:${id}`);
  return id;
}
afterAll(async () => {
  await client`delete from experience_mfa_attempts where workos_user_id=any(${keys})`;
  await client.end();
});
async function budget(key: string) {
  const [row] = await client<{ attempts: number; window_started_at: Date }[]>`
    select attempts,window_started_at from experience_mfa_attempts where workos_user_id=${key}`;
  if (!row) throw new Error("Expected durable budget");
  return row;
}

it("keeps preparation independent without spending or resetting an existing verification window", async () => {
  const id = user();
  expect(await claimMfaAttempt(db, id)).toBe(true);
  expect(await claimMfaAttempt(db, id)).toBe(true);
  const original = await budget(id);
  for (let attempt = 0; attempt < 5; attempt += 1)
    expect(await claimMfaPreparationAttempt(db, id)).toBe(true);
  expect(await claimMfaPreparationAttempt(db, id)).toBe(false);
  expect(await budget(id)).toEqual(original);
  for (let attempt = 0; attempt < 3; attempt += 1)
    expect(await claimMfaAttempt(db, id)).toBe(true);
  expect(await claimMfaAttempt(db, id)).toBe(false);
  expect((await budget(id)).attempts).toBe(5);
  expect((await budget(`mfa-prepare:${id}`)).attempts).toBe(5);
});

it("admits at most five concurrent claims in each independent budget", async () => {
  const id = user();
  const [preparation, verification] = await Promise.all([
    Promise.all(
      Array.from({ length: 20 }, () => claimMfaPreparationAttempt(db, id)),
    ),
    Promise.all(Array.from({ length: 20 }, () => claimMfaAttempt(db, id))),
  ]);
  expect(preparation.filter(Boolean)).toHaveLength(5);
  expect(verification.filter(Boolean)).toHaveLength(5);
  expect((await budget(`mfa-prepare:${id}`)).attempts).toBe(5);
  expect((await budget(id)).attempts).toBe(5);
});

it("renews an expired preparation window without reopening exhausted code verification", async () => {
  const id = user();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await claimMfaPreparationAttempt(db, id);
    await claimMfaAttempt(db, id);
  }
  const original = await budget(id);
  await client`update experience_mfa_attempts set window_started_at=now()-interval '11 minutes' where workos_user_id=${`mfa-prepare:${id}`}`;
  expect(await claimMfaPreparationAttempt(db, id)).toBe(true);
  expect((await budget(`mfa-prepare:${id}`)).attempts).toBe(1);
  expect(await claimMfaAttempt(db, id)).toBe(false);
  expect(await budget(id)).toEqual(original);
});
