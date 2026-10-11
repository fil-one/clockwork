"use server";

import { z, ZodError } from "zod";
import {
  TemplateContentSchema,
  type TemplateContent,
} from "@clockwork/contracts";
import {
  specimenTemplateInput,
  templateFromContent,
} from "@clockwork/documents";
import { contractToday } from "@clockwork/domain/contract-terms";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import { failure } from "../contracts/action-result";
import type { TemplateIssue } from "./model";
import {
  contractTemplateRepository,
  demoTemplateRecords,
  templateAdmin,
  templateAdminWriter,
} from "./server";

/** What a template action returns. An invalid template lists its issues. */
export type TemplateActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; issues?: TemplateIssue[] };

async function run<T>(
  operation: () => Promise<T>,
): Promise<TemplateActionResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof ZodError)
      return {
        ok: false,
        code: "CONTRACT_TEMPLATE_INVALID",
        issues: error.issues.map((issue) => ({
          path: issue.path.map((part) =>
            typeof part === "number" ? part : String(part),
          ),
          message: issue.message,
        })),
      };
    const { code } = failure(error);
    return { ok: false, code };
  }
}

/** The largest template file the store reads: far beyond any agreement, and
 * inside Next's 1 MB server action body limit. */
const templateFileLimit = 900_000;

const revisioned = z.object({
  id: z.uuid(),
  revision: z.int().min(1),
});

/**
 * Reads a template file and checks it, without saving: the content as it
 * would be stored, and which version of which template it would become.
 */
export async function checkTemplateFile(text: unknown) {
  return run(async () => {
    const { demo } = await templateAdmin();
    let raw: unknown;
    try {
      const file = z.string().parse(text);
      // Within the server action body limit, with room for the request.
      if (file.length > templateFileLimit)
        throw new Error("CONTRACT_TEMPLATE_TOO_LARGE");
      raw = JSON.parse(file);
    } catch (error) {
      if (
        error instanceof ZodError ||
        (error instanceof Error &&
          error.message === "CONTRACT_TEMPLATE_TOO_LARGE")
      )
        throw error;
      throw new Error("CONTRACT_TEMPLATE_JSON");
    }
    const content = TemplateContentSchema.parse(raw);
    const versions = demo
      ? demoTemplateRecords()
      : await contractTemplateRepository().list();
    const existing = versions.filter((row) => row.key === content.id);
    return {
      content,
      nextVersion: Math.max(0, ...existing.map((row) => row.version)) + 1,
      activeVersion:
        existing.find((row) => row.status === "active")?.versionLabel ?? null,
    };
  });
}

/** Saves content as a new draft version, from a file, a blank start or a
 * copy. A retried call with the same id returns the same draft. */
export async function createTemplateDraft(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const input = z
      .object({
        id: z.uuid(),
        origin: z.enum(["blank", "import"]),
        content: z.unknown(),
      })
      .strict()
      .parse(raw);
    const draft = await contractTemplateRepository().createDraft(
      input.content,
      actor,
      input.origin,
      input.id,
    );
    return { id: draft.id };
  });
}

/** A new draft version with the content of an existing version. */
export async function duplicateTemplateVersion(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const { id } = z.object({ id: z.uuid() }).strict().parse(raw);
    const repository = contractTemplateRepository();
    const source = await repository.get(id);
    const draft = await repository.createDraft(
      source.content,
      actor,
      "duplicate",
    );
    return { id: draft.id };
  });
}

export async function saveTemplateDraft(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const input = revisioned
      .extend({ content: z.unknown() })
      .strict()
      .parse(raw);
    const saved = await contractTemplateRepository().updateDraft(
      input.id,
      input.revision,
      input.content,
      actor,
    );
    return { revision: saved.revision, contentHash: saved.contentHash };
  });
}

/** Puts the version into use and records who did. The version in use
 * before it is retired; contracts already prepared keep their version. */
export async function activateTemplateVersion(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const input = revisioned.strict().parse(raw);
    const row = await contractTemplateRepository().activate(
      input.id,
      input.revision,
      actor,
    );
    return { revision: row.revision };
  });
}

export async function retireTemplateVersion(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const input = revisioned.strict().parse(raw);
    const row = await contractTemplateRepository().retire(
      input.id,
      input.revision,
      actor,
    );
    return { revision: row.revision };
  });
}

export async function discardTemplateDraft(raw: unknown) {
  return run(async () => {
    const { actor } = await templateAdminWriter();
    const input = revisioned.strict().parse(raw);
    await contractTemplateRepository().discard(input.id, input.revision, actor);
    return null;
  });
}

/**
 * A specimen PDF of template content, saved or not: every optional section
 * in, and every field filled with its default or a visible sample. Nothing
 * is stored. Works in the guided demo.
 */
export async function renderTemplateSpecimen(raw: unknown) {
  return run(async () => {
    await templateAdmin();
    const content: TemplateContent = TemplateContentSchema.parse(raw);
    const template = templateFromContent(content, "specimen");
    const rendered = await template.render(
      specimenTemplateInput(template, contractToday(demoNow())),
    );
    return {
      pdf: rendered.bytes.toString("base64"),
      pages: rendered.pages,
      fileName: `Specimen - ${content.name}.pdf`,
    };
  });
}
