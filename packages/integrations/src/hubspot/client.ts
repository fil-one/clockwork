import {
  HubSpotIdSchema,
  hubspotLimits,
  type HubSpotAssociation,
  type HubSpotCompany,
  type HubSpotContact,
  type HubSpotDeal,
  type HubSpotFile,
  type HubSpotFileAvailability,
  type HubSpotNote,
  type HubSpotObjectType,
  type HubSpotOwner,
  type HubSpotPipeline,
  type HubSpotPortal,
  type HubSpotPropertyDefinition,
} from "@clockwork/contracts";
import { z } from "zod";

/**
 * The HubSpot read boundary. It only reads: no CRM write scope is requested
 * or used, and nothing here changes a HubSpot record. Callers decide which
 * properties to ask for from the administrator-approved scope; the adapter
 * never widens a request.
 */
export interface HubSpotReader {
  portal(): Promise<HubSpotPortal>;
  properties(
    objectType: HubSpotObjectType,
  ): Promise<HubSpotPropertyDefinition[]>;
  owners(): Promise<HubSpotOwner[]>;
  pipelines(): Promise<HubSpotPipeline[]>;
  searchCompanies(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }): Promise<HubSpotCompany[]>;
  searchDeals(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }): Promise<HubSpotDeal[]>;
  companies(
    ids: readonly string[],
    properties: readonly string[],
  ): Promise<HubSpotCompany[]>;
  deals(
    ids: readonly string[],
    properties: readonly string[],
  ): Promise<HubSpotDeal[]>;
  contacts(
    ids: readonly string[],
    properties: readonly string[],
  ): Promise<HubSpotContact[]>;
  /** Associated records with their labels, up to `hubspotLimits.associations`. */
  associations(
    from: "company" | "deal",
    id: string,
    to: "company" | "deal" | "contact" | "note",
  ): Promise<HubSpotAssociation[]>;
  /** Deal → company associations for many deals at once. */
  dealCompanies(
    dealIds: readonly string[],
  ): Promise<ReadonlyMap<string, HubSpotAssociation[]>>;
  notes(ids: readonly string[]): Promise<HubSpotNote[]>;
  /** File metadata, or `null` when the file is missing or unreadable. */
  file(id: string, noteId: string): Promise<HubSpotFile | null>;
  /** A file's bytes, refused above `maxBytes`. */
  download(id: string, maxBytes: number): Promise<Uint8Array>;
  /** One page of a pipeline's deals in the given stages. */
  pipelineDeals(input: {
    pipelineId: string;
    stageIds: readonly string[];
    properties: readonly string[];
    after: string | null;
    limit: number;
  }): Promise<{ deals: HubSpotDeal[]; next: string | null; total: number }>;
}

/**
 * `code` is a HubSpot error code from `hubspotErrorCodes`; pages word it. The
 * provider's own message never reaches a reader.
 */
export class HubSpotError extends Error {
  public constructor(
    public readonly code:
      | "HUBSPOT_NOT_CONFIGURED"
      | "HUBSPOT_UNAVAILABLE"
      | "HUBSPOT_RATE_LIMITED"
      | "HUBSPOT_RECORD_NOT_FOUND"
      | "HUBSPOT_SCOPE_DENIED"
      | "HUBSPOT_DOCUMENT_UNAVAILABLE"
      | "HUBSPOT_DOCUMENT_INVALID",
    public readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "HubSpotError";
  }
}

const API_ORIGIN = "https://api.hubapi.com";
const TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 4 * 1_048_576;
const BATCH = 100;
const PDF = new TextEncoder().encode("%PDF-");

/** Hosts HubSpot serves signed file downloads from. */
const downloadHost =
  /(?:^|\.)(?:hubspot\.com|hubspot\.net|hubapi\.com|hubspotusercontent(?:-[a-z0-9]+)?\.(?:com|net))$/;

const nullableText = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((value) =>
    value === undefined || value === null || value === ""
      ? null
      : String(value),
  );
const ObjectSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  properties: z.record(z.string(), nullableText).default({}),
  updatedAt: z.string().optional(),
  archived: z.boolean().optional(),
});
type ObjectRow = z.infer<typeof ObjectSchema>;
const PagingSchema = z
  .object({ next: z.object({ after: z.string() }).optional() })
  .optional();

const prop = (row: ObjectRow, name: string) => row.properties[name] ?? null;

function extra(
  row: ObjectRow,
  properties: readonly string[],
  base: readonly string[],
): Record<string, string | null> {
  return Object.fromEntries(
    properties
      .filter((name) => !base.includes(name))
      .map((name) => [name, prop(row, name)]),
  );
}

const companyBase = [
  "name",
  "domain",
  "website",
  "country",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
];
const dealBase = [
  "dealname",
  "amount",
  "deal_currency_code",
  "closedate",
  "pipeline",
  "dealstage",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
];

function toCompany(
  row: ObjectRow,
  properties: readonly string[],
): HubSpotCompany {
  return {
    id: row.id,
    name: prop(row, "name"),
    domain: prop(row, "domain"),
    website: prop(row, "website"),
    country: prop(row, "country"),
    ownerId: prop(row, "hubspot_owner_id"),
    updatedAt: prop(row, "hs_lastmodifieddate") ?? row.updatedAt ?? null,
    archived: row.archived ?? false,
    properties: extra(row, properties, companyBase),
  };
}

function toDeal(row: ObjectRow, properties: readonly string[]): HubSpotDeal {
  return {
    id: row.id,
    name: prop(row, "dealname"),
    pipelineId: prop(row, "pipeline"),
    stageId: prop(row, "dealstage"),
    amount: prop(row, "amount"),
    currency: prop(row, "deal_currency_code"),
    closeDate: prop(row, "closedate"),
    ownerId: prop(row, "hubspot_owner_id"),
    updatedAt: prop(row, "hs_lastmodifieddate") ?? row.updatedAt ?? null,
    archived: row.archived ?? false,
    properties: extra(row, properties, dealBase),
  };
}

function toContact(row: ObjectRow): HubSpotContact {
  return {
    id: row.id,
    firstName: prop(row, "firstname"),
    lastName: prop(row, "lastname"),
    email: prop(row, "email"),
    jobTitle: prop(row, "jobtitle"),
    updatedAt: prop(row, "lastmodifieddate") ?? row.updatedAt ?? null,
  };
}

const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

/**
 * Note bodies are HTML. Commerce keeps plain text only: block ends become
 * line breaks, every tag is dropped, a few entities are decoded, and the
 * result is bounded. Nothing is rewritten beyond that.
 */
export function hubspotNoteText(html: string | null): string {
  if (!html) return "";
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (match, name: string) =>
      Object.hasOwn(entities, name.toLowerCase())
        ? (entities[name.toLowerCase()] ?? match)
        : match,
    )
    .split("\n")
    .map((line) =>
      [...line]
        .filter((c) => {
          const code = c.charCodeAt(0);
          return code >= 32 && code !== 127;
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > hubspotLimits.noteBodyCharacters
    ? `${text.slice(0, hubspotLimits.noteBodyCharacters).trimEnd()}…`
    : text;
}

const AssociationRowSchema = z.object({
  toObjectId: z.union([z.string(), z.number()]).transform(String),
  associationTypes: z
    .array(z.object({ label: z.string().nullable().optional() }))
    .default([]),
});

function association(row: z.infer<typeof AssociationRowSchema>) {
  return {
    id: row.toObjectId,
    labels: [
      ...new Set(
        row.associationTypes
          .map((type) => type.label?.trim() ?? "")
          .filter(Boolean),
      ),
    ],
  } satisfies HubSpotAssociation;
}

const objectPath: Readonly<
  Record<"company" | "deal" | "contact" | "note", string>
> = {
  company: "companies",
  deal: "deals",
  contact: "contacts",
  note: "notes",
};

function fileAvailability(file: {
  extension: string | null;
  size: number | null;
  archived: boolean;
}): HubSpotFileAvailability {
  if (file.archived) return "unreadable";
  if ((file.extension ?? "").toLowerCase() !== "pdf") return "unsupported_type";
  if (file.size !== null && file.size > hubspotLimits.documentBytes)
    return "too_large";
  return "available";
}

export interface HttpHubSpotReaderOptions {
  /** A private-app access token with read scopes only. */
  accessToken: string;
  fetch?: typeof fetch;
  /** Tests only; production always talks to `https://api.hubapi.com`. */
  origin?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** HubSpot's public API over HTTPS with a server-side private-app token. */
export class HttpHubSpotReader implements HubSpotReader {
  private readonly fetcher: typeof fetch;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  public constructor(private readonly options: HttpHubSpotReaderOptions) {
    const token = options.accessToken.trim();
    if (!token || /[\r\n\s]/.test(token))
      throw new HubSpotError("HUBSPOT_NOT_CONFIGURED");
    this.fetcher = (options.fetch ?? fetch).bind(globalThis);
    this.origin = options.origin ?? API_ORIGIN;
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(this.origin))
      throw new HubSpotError("HUBSPOT_NOT_CONFIGURED");
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One request with a bounded retry: a throttled or failing call waits for
   * HubSpot's Retry-After (at most two seconds) and tries once more.
   */
  private async json<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.send(method, path, body);
      if (response.ok) return schema.parse(await this.readJson(response));
      void response.body?.cancel().catch(() => {});
      const retryAfterMs = Math.min(
        Number(response.headers.get("retry-after") ?? "1") * 1000 || 1000,
        30_000,
      );
      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt === 0 && retryAfterMs <= 2000) {
        await this.sleep(retryAfterMs);
        continue;
      }
      if (response.status === 429)
        throw new HubSpotError("HUBSPOT_RATE_LIMITED", retryAfterMs);
      if (response.status === 404)
        throw new HubSpotError("HUBSPOT_RECORD_NOT_FOUND");
      if (response.status === 401 || response.status === 403)
        throw new HubSpotError("HUBSPOT_SCOPE_DENIED");
      throw new HubSpotError("HUBSPOT_UNAVAILABLE");
    }
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    body: unknown,
  ): Promise<Response> {
    if (!path.startsWith("/") || path.includes(".."))
      throw new HubSpotError("HUBSPOT_UNAVAILABLE");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${this.origin}${path}`, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.accessToken.trim()}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new HubSpotError("HUBSPOT_UNAVAILABLE", undefined, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const bytes = await readBounded(response, MAX_JSON_BYTES);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
      throw new HubSpotError("HUBSPOT_UNAVAILABLE", undefined, {
        cause: error,
      });
    }
  }

  async portal(): Promise<HubSpotPortal> {
    const details = await this.json(
      "GET",
      "/account-info/v3/details",
      z.object({
        portalId: z.union([z.string(), z.number()]).transform(String),
        uiDomain: z.string().default("app.hubspot.com"),
        timeZone: z.string().nullable().optional(),
        companyCurrency: z.string().nullable().optional(),
      }),
    );
    return {
      portalId: details.portalId,
      uiDomain: details.uiDomain,
      timeZone: details.timeZone ?? null,
      companyCurrency: details.companyCurrency ?? null,
    };
  }

  async properties(
    objectType: HubSpotObjectType,
  ): Promise<HubSpotPropertyDefinition[]> {
    const result = await this.json(
      "GET",
      `/crm/v3/properties/${objectPath[objectType]}`,
      z.object({
        results: z.array(
          z.object({
            name: z.string(),
            label: z.string().default(""),
            type: z.string().default("string"),
            fieldType: z.string().default("text"),
            hidden: z.boolean().optional(),
            calculated: z.boolean().optional(),
            hubspotDefined: z.boolean().optional(),
            dataSensitivity: z.string().optional(),
            sensitiveDataCategories: z.array(z.string()).optional(),
            options: z
              .array(z.object({ label: z.string(), value: z.string() }))
              .default([]),
          }),
        ),
      }),
    );
    return result.results
      .filter((property) => !property.hidden)
      .map((property) => ({
        objectType,
        name: property.name,
        label: property.label || property.name,
        type: property.type,
        fieldType: property.fieldType,
        options: property.options.slice(0, 200),
        sensitive:
          (property.dataSensitivity !== undefined &&
            property.dataSensitivity !== "non_sensitive") ||
          (property.sensitiveDataCategories?.length ?? 0) > 0,
        hubspotDefined: property.hubspotDefined ?? false,
        calculated: property.calculated ?? false,
      }));
  }

  async owners(): Promise<HubSpotOwner[]> {
    const owners: HubSpotOwner[] = [];
    // Departed owners stay readable as source context, so both lists load.
    for (const archived of [false, true]) {
      let after: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const query: string = `limit=100&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
        const result = await this.json(
          "GET",
          `/crm/v3/owners?${query}`,
          z.object({
            results: z.array(
              z.object({
                id: z.union([z.string(), z.number()]).transform(String),
                email: z.string().nullable().optional(),
                firstName: z.string().nullable().optional(),
                lastName: z.string().nullable().optional(),
              }),
            ),
            paging: PagingSchema,
          }),
        );
        for (const owner of result.results)
          owners.push({
            id: owner.id,
            name:
              [owner.firstName, owner.lastName]
                .filter(Boolean)
                .join(" ")
                .trim() ||
              owner.email ||
              owner.id,
            email: owner.email ?? null,
            archived,
          });
        after = result.paging?.next?.after ?? null;
        if (!after) break;
      }
    }
    return owners;
  }

  async pipelines(): Promise<HubSpotPipeline[]> {
    const result = await this.json(
      "GET",
      "/crm/v3/pipelines/deals",
      z.object({
        results: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            displayOrder: z.number().default(0),
            archived: z.boolean().optional(),
            stages: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                displayOrder: z.number().default(0),
                archived: z.boolean().optional(),
                metadata: z
                  .object({
                    isClosed: z.union([z.string(), z.boolean()]).optional(),
                  })
                  .passthrough()
                  .default({}),
              }),
            ),
          }),
        ),
      }),
    );
    return result.results
      .filter((pipeline) => !pipeline.archived)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((pipeline) => ({
        id: pipeline.id,
        label: pipeline.label,
        displayOrder: pipeline.displayOrder,
        stages: pipeline.stages
          .filter((stage) => !stage.archived)
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((stage) => ({
            id: stage.id,
            label: stage.label,
            displayOrder: stage.displayOrder,
            closed: String(stage.metadata.isClosed) === "true",
          })),
      }));
  }

  private async search(
    objectType: "company" | "deal",
    body: Record<string, unknown>,
  ) {
    return this.json(
      "POST",
      `/crm/v3/objects/${objectPath[objectType]}/search`,
      z.object({
        total: z.number().default(0),
        results: z.array(ObjectSchema),
        paging: PagingSchema,
      }),
      body,
    );
  }

  async searchCompanies(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }): Promise<HubSpotCompany[]> {
    const result = await this.search("company", {
      query: input.query.slice(0, 100),
      limit: Math.min(input.limit, hubspotLimits.searchResults),
      properties: input.properties,
    });
    return result.results.map((row) => toCompany(row, input.properties));
  }

  async searchDeals(input: {
    query: string;
    properties: readonly string[];
    limit: number;
  }): Promise<HubSpotDeal[]> {
    const result = await this.search("deal", {
      query: input.query.slice(0, 100),
      limit: Math.min(input.limit, hubspotLimits.searchResults),
      properties: input.properties,
    });
    return result.results.map((row) => toDeal(row, input.properties));
  }

  private async batchRead(
    objectType: "company" | "deal" | "contact" | "note",
    ids: readonly string[],
    properties: readonly string[],
  ): Promise<ObjectRow[]> {
    const valid = [...new Set(ids)].filter(
      (id) => HubSpotIdSchema.safeParse(id).success,
    );
    const rows: ObjectRow[] = [];
    for (let index = 0; index < valid.length; index += BATCH) {
      const result = await this.json(
        "POST",
        `/crm/v3/objects/${objectPath[objectType]}/batch/read`,
        z.object({ results: z.array(ObjectSchema) }),
        {
          properties,
          inputs: valid.slice(index, index + BATCH).map((id) => ({ id })),
        },
      );
      rows.push(...result.results);
    }
    return rows;
  }

  async companies(ids: readonly string[], properties: readonly string[]) {
    return (await this.batchRead("company", ids, properties)).map((row) =>
      toCompany(row, properties),
    );
  }

  async deals(ids: readonly string[], properties: readonly string[]) {
    return (await this.batchRead("deal", ids, properties)).map((row) =>
      toDeal(row, properties),
    );
  }

  async contacts(ids: readonly string[], properties: readonly string[]) {
    return (await this.batchRead("contact", ids, properties)).map(toContact);
  }

  async associations(
    from: "company" | "deal",
    id: string,
    to: "company" | "deal" | "contact" | "note",
  ): Promise<HubSpotAssociation[]> {
    HubSpotIdSchema.parse(id);
    const result = await this.json(
      "GET",
      `/crm/v4/objects/${objectPath[from]}/${id}/associations/${objectPath[to]}?limit=${hubspotLimits.associations}`,
      z.object({ results: z.array(AssociationRowSchema) }),
    );
    return result.results.slice(0, hubspotLimits.associations).map(association);
  }

  async dealCompanies(
    dealIds: readonly string[],
  ): Promise<ReadonlyMap<string, HubSpotAssociation[]>> {
    const map = new Map<string, HubSpotAssociation[]>();
    const ids = [...new Set(dealIds)];
    for (let index = 0; index < ids.length; index += BATCH) {
      const result = await this.json(
        "POST",
        "/crm/v4/associations/deals/companies/batch/read",
        z.object({
          results: z.array(
            z.object({
              from: z.object({
                id: z.union([z.string(), z.number()]).transform(String),
              }),
              to: z.array(AssociationRowSchema).default([]),
            }),
          ),
        }),
        { inputs: ids.slice(index, index + BATCH).map((id) => ({ id })) },
      );
      for (const row of result.results)
        map.set(
          row.from.id,
          row.to.slice(0, hubspotLimits.associations).map(association),
        );
    }
    return map;
  }

  async notes(ids: readonly string[]): Promise<HubSpotNote[]> {
    const rows = await this.batchRead("note", ids, [
      "hs_note_body",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_attachment_ids",
    ]);
    return rows.map((row) => ({
      id: row.id,
      body: hubspotNoteText(prop(row, "hs_note_body")),
      ownerId: prop(row, "hubspot_owner_id"),
      timestamp: prop(row, "hs_timestamp"),
      attachmentIds: (prop(row, "hs_attachment_ids") ?? "")
        .split(";")
        .map((value) => value.trim())
        .filter((value) => HubSpotIdSchema.safeParse(value).success)
        .slice(0, 20),
    }));
  }

  async file(id: string, noteId: string): Promise<HubSpotFile | null> {
    HubSpotIdSchema.parse(id);
    try {
      const file = await this.json(
        "GET",
        `/files/v3/files/${id}`,
        z.object({
          id: z.union([z.string(), z.number()]).transform(String),
          name: z.string().default(""),
          extension: z.string().nullable().optional(),
          size: z.number().nullable().optional(),
          updatedAt: z.string().nullable().optional(),
          archived: z.boolean().optional(),
        }),
      );
      const extension = file.extension ?? null;
      const size = file.size ?? null;
      return {
        id: file.id,
        name:
          [file.name, extension].filter(Boolean).join(".").slice(0, 255) ||
          `${file.id}.pdf`,
        extension,
        size,
        updatedAt: file.updatedAt ?? null,
        availability: fileAvailability({
          extension,
          size,
          archived: file.archived ?? false,
        }),
        noteId,
      };
    } catch (error) {
      if (
        error instanceof HubSpotError &&
        ["HUBSPOT_RECORD_NOT_FOUND", "HUBSPOT_SCOPE_DENIED"].includes(
          error.code,
        )
      )
        return null;
      throw error;
    }
  }

  /**
   * The bytes of a retained document. A short-lived signed URL is used only
   * to fetch them now; it is never stored or shown in place of the document.
   */
  async download(id: string, maxBytes: number): Promise<Uint8Array> {
    HubSpotIdSchema.parse(id);
    const signed = await this.json(
      "GET",
      `/files/v3/files/${id}/signed-url?expirationSeconds=300`,
      z.object({ url: z.string() }),
    );
    let url: URL;
    try {
      url = new URL(signed.url);
    } catch {
      throw new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE");
    }
    if (url.protocol !== "https:" || !downloadHost.test(url.hostname))
      throw new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      // The signed URL carries its own authorization; the token stays here.
      const response = await this.fetcher(url, {
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE");
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new HubSpotError("HUBSPOT_DOCUMENT_INVALID");
      }
      const bytes = await readBounded(
        response,
        maxBytes,
        "HUBSPOT_DOCUMENT_INVALID",
      );
      if (!startsWith(bytes, PDF))
        throw new HubSpotError("HUBSPOT_DOCUMENT_INVALID");
      return bytes;
    } catch (error) {
      if (error instanceof HubSpotError) throw error;
      throw new HubSpotError("HUBSPOT_DOCUMENT_UNAVAILABLE", undefined, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async pipelineDeals(input: {
    pipelineId: string;
    stageIds: readonly string[];
    properties: readonly string[];
    after: string | null;
    limit: number;
  }) {
    const filters: Record<string, unknown>[] = [
      { propertyName: "pipeline", operator: "EQ", value: input.pipelineId },
    ];
    if (input.stageIds.length)
      filters.push({
        propertyName: "dealstage",
        operator: "IN",
        values: input.stageIds,
      });
    const result = await this.search("deal", {
      filterGroups: [{ filters }],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      properties: input.properties,
      limit: Math.min(input.limit, 100),
      ...(input.after ? { after: input.after } : {}),
    });
    return {
      deals: result.results.map((row) => toDeal(row, input.properties)),
      next: result.paging?.next?.after ?? null,
      total: result.total,
    };
  }
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

async function readBounded(
  response: Response,
  maxBytes: number,
  code:
    "HUBSPOT_UNAVAILABLE" | "HUBSPOT_DOCUMENT_INVALID" = "HUBSPOT_UNAVAILABLE",
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new HubSpotError(code);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
