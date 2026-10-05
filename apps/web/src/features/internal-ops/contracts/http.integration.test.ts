// Node runtime, as in production: the real multipart parser and stream limit.
import { expect, it } from "vitest";
import { contractDocumentMaxBytes } from "@clockwork/contracts";
import {
  itemField,
  readUploadForm,
  uploadedPdf,
  withDocumentSlot,
} from "./http";

const request = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://commerce.fil.one/upload", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);

it("parses one PDF and its details from a multipart upload", async () => {
  const form = new FormData();
  form.set("item", JSON.stringify({ title: "Deck" }));
  form.set(
    "file",
    new File(["%PDF-1.7\nx"], "Fil One deck.pdf", { type: "application/pdf" }),
  );
  const parsed = await readUploadForm(request(form));
  expect(itemField(parsed)).toEqual({ title: "Deck" });
  const file = await uploadedPdf(parsed);
  expect(file.fileName).toBe("Fil One deck.pdf");
  const long = new FormData();
  long.set(
    "file",
    new File(["%PDF-1.7"], `${"L".repeat(240)}.pdf`, {
      type: "application/pdf",
    }),
  );
  const fitted = await uploadedPdf(await readUploadForm(request(long)));
  expect(fitted.fileName.length).toBeLessThanOrEqual(200);
  expect(fitted.fileName.endsWith(".pdf")).toBe(true);
  expect(Buffer.from(file.bytes).toString()).toBe("%PDF-1.7\nx");
});

it.each([
  ["no", {}],
  ["an understated", { "content-length": "1024" }],
])(
  "stops reading a body that grows past the limit with %s declared length",
  async (_label, declared: Record<string, string>) => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        if (sent > contractDocumentMaxBytes + 4 * chunk.length)
          controller.close();
        else controller.enqueue(chunk);
      },
    });
    await expect(
      readUploadForm(
        request(stream, {
          ...declared,
          "content-type": "multipart/form-data; boundary=x",
        }),
      ),
    ).rejects.toThrow("DOCUMENT_TOO_LARGE");
    expect(sent).toBeLessThan(contractDocumentMaxBytes + 4 * chunk.length);
  },
);

it("refuses bodies that are not multipart forms", async () => {
  await expect(
    readUploadForm(request("{}", { "content-type": "application/json" })),
  ).rejects.toThrow("UPLOAD_INVALID");
  const form = new FormData();
  form.set("item", "{not json");
  await expect(readUploadForm(request(form)).then(itemField)).rejects.toThrow(
    "UPLOAD_INVALID",
  );
});

it("runs at most three document operations at once and refuses a long queue", async () => {
  let running = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const task = () =>
    withDocumentSlot(
      () =>
        new Promise<void>((resolve) => {
          running += 1;
          peak = Math.max(peak, running);
          releases.push(() => {
            running -= 1;
            resolve();
          });
        }),
    );
  const accepted = Array.from({ length: 23 }, task);
  await expect(task()).rejects.toThrow("DOCUMENT_BUSY");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(running).toBe(3);
  while (releases.length) {
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.all(accepted);
  expect(peak).toBe(3);
  await expect(withDocumentSlot(() => Promise.resolve("free"))).resolves.toBe(
    "free",
  );
});
