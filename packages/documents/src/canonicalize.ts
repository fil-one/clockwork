import { createHash } from "node:crypto";

interface ParsedPdfObject {
  body: Buffer;
  number: number;
}

const REFERENCE_PATTERN = /(\d+)\s+0\s+R/g;

function stableObjectKey(object: ParsedPdfObject): string {
  const body = object.body
    .toString("latin1")
    .replaceAll(REFERENCE_PATTERN, "REF");
  return createHash("sha256").update(body, "latin1").digest("hex");
}

function parseClassicXref(source: Buffer): {
  header: Buffer;
  objects: ReadonlyMap<number, ParsedPdfObject>;
  trailer: string;
} {
  const sourceText = source.toString("latin1");
  const startXrefMatch = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(sourceText);
  if (!startXrefMatch?.[1]) {
    throw new Error("React PDF output is missing a classic startxref marker");
  }
  const xrefOffset = Number.parseInt(startXrefMatch[1], 10);
  const xrefText = source.subarray(xrefOffset).toString("latin1");
  const xrefHeader = /^xref\r?\n0\s+(\d+)\r?\n/.exec(xrefText);
  if (!xrefHeader?.[1]) {
    throw new Error(
      "React PDF output does not use the expected classic xref table",
    );
  }
  const objectCount = Number.parseInt(xrefHeader[1], 10);
  const trailerIndex = xrefText.indexOf("trailer", xrefHeader[0].length);
  if (trailerIndex < 0) {
    throw new Error("React PDF output is missing its trailer");
  }
  const xrefRows = xrefText
    .slice(xrefHeader[0].length, trailerIndex)
    .trim()
    .split(/\r?\n/)
    .slice(0, objectCount);
  const offsets = new Map<number, number>();
  for (let number = 1; number < objectCount; number += 1) {
    const row = xrefRows[number];
    const match = row ? /^(\d{10})\s+\d{5}\s+n\s*$/.exec(row) : null;
    if (match?.[1]) {
      offsets.set(number, Number.parseInt(match[1], 10));
    }
  }
  if (offsets.size === 0) {
    throw new Error("React PDF output xref does not contain active objects");
  }

  const physicalOffsets = [...offsets.entries()].sort(
    (left, right) => left[1] - right[1],
  );
  const objects = new Map<number, ParsedPdfObject>();
  for (const [index, [number, offset]] of physicalOffsets.entries()) {
    const nextOffset = physicalOffsets[index + 1]?.[1] ?? xrefOffset;
    const region = source.subarray(offset, nextOffset);
    const objectHeader = new RegExp(`^${number}\\s+0\\s+obj\\r?\\n`).exec(
      region.toString("latin1"),
    );
    const endObject = region.lastIndexOf("endobj");
    if (!objectHeader || endObject < 0) {
      throw new Error(`React PDF object ${number} could not be parsed`);
    }
    objects.set(number, {
      body: region.subarray(objectHeader[0].length, endObject),
      number,
    });
  }

  const trailerMatch = /trailer\s*(<<[\s\S]*?>>)\s*startxref/.exec(xrefText);
  if (!trailerMatch?.[1]) {
    throw new Error("React PDF trailer dictionary could not be parsed");
  }
  const firstObjectOffset = physicalOffsets[0]?.[1];
  if (firstObjectOffset === undefined) {
    throw new Error("React PDF output contains no serializable objects");
  }
  return {
    header: source.subarray(0, firstObjectOffset),
    objects,
    trailer: trailerMatch[1],
  };
}

function referencedObjects(body: Buffer): readonly number[] {
  const source = dictionaryPortion(body).toString("latin1");
  return [...source.matchAll(REFERENCE_PATTERN)].flatMap((match) =>
    match[1] ? [Number.parseInt(match[1], 10)] : [],
  );
}

function dictionaryPortion(body: Buffer): Buffer {
  const source = body.toString("latin1");
  const stream = /\r?\nstream\r?\n/.exec(source);
  return stream?.index === undefined ? body : body.subarray(0, stream.index);
}

function rewriteReferences(
  source: string,
  numberMap: ReadonlyMap<number, number>,
): string {
  return source.replaceAll(REFERENCE_PATTERN, (reference, number: string) => {
    const replacement = numberMap.get(Number.parseInt(number, 10));
    if (!replacement) {
      throw new Error(`React PDF references missing object ${number}`);
    }
    return `${replacement} 0 R`;
  });
}

function rewriteObjectBody(
  body: Buffer,
  numberMap: ReadonlyMap<number, number>,
): Buffer {
  const source = body.toString("latin1");
  const stream = /\r?\nstream\r?\n/.exec(source);
  if (stream?.index === undefined) {
    return Buffer.from(rewriteReferences(source, numberMap), "latin1");
  }
  return Buffer.concat([
    Buffer.from(
      rewriteReferences(source.slice(0, stream.index), numberMap),
      "latin1",
    ),
    body.subarray(stream.index),
  ]);
}

/**
 * PDFKit may allocate page and content objects in a different internal order
 * while producing the same visible multi-page document. This canonical pass
 * traverses the page tree in semantic order, renumbers indirect objects, and
 * rebuilds the classic xref table so identical input always yields identical
 * bytes. It intentionally accepts only the pinned React PDF/PDFKit output.
 */
export function canonicalizeReactPdf(bytes: Uint8Array): Uint8Array {
  const parsed = parseClassicXref(Buffer.from(bytes));
  const rootMatch = /\/Root\s+(\d+)\s+0\s+R/.exec(parsed.trailer);
  if (!rootMatch?.[1]) {
    throw new Error("React PDF trailer is missing its root object");
  }
  const infoMatch = /\/Info\s+(\d+)\s+0\s+R/.exec(parsed.trailer);
  const ordered: ParsedPdfObject[] = [];
  const visited = new Set<number>();

  const visit = (number: number): void => {
    if (visited.has(number)) return;
    const object = parsed.objects.get(number);
    if (!object) {
      throw new Error(`React PDF graph is missing object ${number}`);
    }
    visited.add(number);
    ordered.push(object);
    for (const reference of referencedObjects(object.body)) visit(reference);
  };

  visit(Number.parseInt(rootMatch[1], 10));
  if (infoMatch?.[1]) visit(Number.parseInt(infoMatch[1], 10));
  const unreachable = [...parsed.objects.values()]
    .filter((object) => !visited.has(object.number))
    .sort((left, right) => {
      const keyOrder = stableObjectKey(left).localeCompare(
        stableObjectKey(right),
      );
      return keyOrder || left.number - right.number;
    });
  for (const object of unreachable) visit(object.number);

  const numberMap = new Map(
    ordered.map((object, index) => [object.number, index + 1]),
  );
  const chunks: Buffer[] = [parsed.header];
  const offsets: number[] = [0];
  let byteLength = parsed.header.length;
  for (const [index, object] of ordered.entries()) {
    const number = index + 1;
    offsets[number] = byteLength;
    const serialized = Buffer.concat([
      Buffer.from(`${number} 0 obj\n`, "latin1"),
      rewriteObjectBody(object.body, numberMap),
      Buffer.from("endobj\n", "latin1"),
    ]);
    chunks.push(serialized);
    byteLength += serialized.length;
  }

  const xrefOffset = byteLength;
  const xrefRows = [
    "xref",
    `0 ${ordered.length + 1}`,
    "0000000000 65535 f ",
    ...offsets
      .slice(1)
      .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n `),
  ];
  const trailer = rewriteReferences(parsed.trailer, numberMap).replace(
    /\/Size\s+\d+/,
    `/Size ${ordered.length + 1}`,
  );
  chunks.push(
    Buffer.from(
      `${xrefRows.join("\n")}\ntrailer\n${trailer}\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "latin1",
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}
