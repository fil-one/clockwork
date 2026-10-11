import type { ContractTemplateRepository } from "@clockwork/db";
import {
  templateFromContent,
  type ContractTemplateSource,
} from "@clockwork/documents";

/**
 * Templates from the template store: the active version of each, bound to
 * the renderer under its version label.
 */
export function storedTemplateSource(
  repository: Pick<ContractTemplateRepository, "listActive" | "active">,
): ContractTemplateSource {
  const bind = (row: {
    versionLabel: string;
    content: Parameters<typeof templateFromContent>[0];
  }) => templateFromContent(row.content, row.versionLabel);
  const active = async (id: string) => {
    const row = await repository.active(id);
    if (!row) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    return bind(row);
  };
  return {
    listActive: async () => (await repository.listActive()).map(bind),
    active,
    // A form built for a version that was replaced, or retired with no
    // replacement, asks the seller to reload either way.
    version: async (id, version) => {
      const row = await repository.active(id);
      if (!row || row.versionLabel !== version)
        throw new Error("CONTRACT_TEMPLATE_VERSION_CHANGED");
      return bind(row);
    },
  };
}
