// Node runtime, as in production: the real multipart parser and stream limit.
import { expect, it } from "vitest";
import { contractDocumentMaxBytes } from "@clockwork/contracts";
import { itemField, readUploadForm, uploadedPdf } from "./http";

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
  expect(Buffer.from(file.bytes).toString()).toBe("%PDF-1.7\nx");
});

it("stops reading a body that grows past the limit without a declared length", async () => {
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
      request(stream, { "content-type": "multipart/form-data; boundary=x" }),
    ),
  ).rejects.toThrow("DOCUMENT_TOO_LARGE");
  expect(sent).toBeLessThan(contractDocumentMaxBytes + 4 * chunk.length);
});

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
