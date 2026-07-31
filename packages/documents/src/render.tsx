import { createHash } from "node:crypto";

import { renderToBuffer } from "@react-pdf/renderer";

import { BrandedDocument, Text, View } from "./template";

export async function renderFoundationDocument(input: {
  title: string;
  reference: string;
  lines: readonly { label: string; value: string }[];
}) {
  const buffer = await renderToBuffer(
    <BrandedDocument title={input.title} reference={input.reference}>
      {input.lines.map((line) => (
        <View
          key={line.label}
          style={{ display: "flex", flexDirection: "row", marginBottom: 8 }}
        >
          <Text style={{ width: 150, fontWeight: 700 }}>{line.label}</Text>
          <Text>{line.value}</Text>
        </View>
      ))}
    </BrandedDocument>,
  );
  const bytes = new Uint8Array(buffer);
  return {
    bytes,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf" as const,
  };
}
