import type { OtlpConfiguration } from "./otlp";
import type { TelemetrySpanRecord } from "./telemetry";

/** Minimal OTLP trace protobuf encoder for the fields emitted by Clockwork. */
export function encodeOtlpTraceRequest(
  configuration: OtlpConfiguration,
  spans: readonly TelemetrySpanRecord[],
): ArrayBuffer {
  const resource = messageField(
    1,
    concat(
      Object.entries({
        "service.name": configuration.serviceName,
        ...configuration.resourceAttributes,
      }).map(([key, value]) => messageField(1, keyValue(key, value))),
    ),
  );
  const scope = messageField(1, stringField(1, "@clockwork/integrations"));
  const scopeSpans = concat([
    scope,
    ...spans.map((span) => messageField(2, encodeSpan(span))),
  ]);
  const resourceSpans = concat([resource, messageField(2, scopeSpans)]);
  return new Uint8Array(messageField(1, resourceSpans)).buffer;
}

function encodeSpan(span: TelemetrySpanRecord): Uint8Array {
  return concat([
    bytesField(1, hexBytes(span.traceId)),
    bytesField(2, hexBytes(span.spanId)),
    ...(span.parentSpanId ? [bytesField(4, hexBytes(span.parentSpanId))] : []),
    stringField(5, span.name),
    varintField(6, 1n),
    fixed64Field(7, BigInt(span.startTimeUnixNano)),
    fixed64Field(8, BigInt(span.endTimeUnixNano)),
    ...Object.entries({
      "clockwork.boundary": span.boundary,
      ...span.attributes,
    }).map(([key, value]) => messageField(9, keyValue(key, value))),
    fixed32Field(16, span.traceFlags === "01" ? 1 : 0),
    messageField(15, varintField(3, span.status === "ok" ? 1n : 2n)),
  ]);
}

function keyValue(key: string, value: string | number | boolean): Uint8Array {
  return concat([stringField(1, key), messageField(2, anyValue(value))]);
}

function anyValue(value: string | number | boolean): Uint8Array {
  if (typeof value === "string") return stringField(1, value);
  if (typeof value === "boolean") return varintField(2, value ? 1n : 0n);
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return concat([tag(4, 1), new Uint8Array(buffer)]);
}

function stringField(field: number, value: string): Uint8Array {
  return bytesField(field, new TextEncoder().encode(value));
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return concat([tag(field, 2), varint(BigInt(value.byteLength)), value]);
}

function messageField(field: number, value: Uint8Array): Uint8Array {
  return bytesField(field, value);
}

function varintField(field: number, value: bigint): Uint8Array {
  return concat([tag(field, 0), varint(value)]);
}

function fixed64Field(field: number, value: bigint): Uint8Array {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, value, true);
  return concat([tag(field, 1), new Uint8Array(buffer)]);
}

function fixed32Field(field: number, value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  return concat([tag(field, 5), new Uint8Array(buffer)]);
}

function tag(field: number, wire: 0 | 1 | 2 | 5): Uint8Array {
  return varint(BigInt((field << 3) | wire));
}

function varint(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("OTLP_PROTOBUF_NEGATIVE_VARINT");
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function hexBytes(value: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/.test(value))
    throw new Error("OTLP_TRACE_IDENTIFIER_INVALID");
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}
