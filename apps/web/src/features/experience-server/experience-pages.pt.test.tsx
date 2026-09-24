import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectionRecord } from "./model";

const mocks = vi.hoisted(() => ({
  getRouteRoles: vi.fn(),
  loadPortalRecords: vi.fn(),
}));

// These pages render on the server with the reader's translator. Here the
// reader chose Brazilian Portuguese.
vi.mock("@/src/i18n/server", async () => {
  const { translatorFor } = await import("@/src/i18n/catalogs");
  return {
    getTranslations: () => Promise.resolve(translatorFor("pt")),
    getLocale: () => Promise.resolve("pt"),
    getFormattingLocale: () => Promise.resolve("pt-BR"),
  };
});
vi.mock("@/src/features/shell/route-session", () => ({
  getRouteRoles: mocks.getRouteRoles,
}));
vi.mock("./portal-view-loader", () => ({
  loadPortalRecords: mocks.loadPortalRecords,
}));
vi.mock("./projection-action-buttons", () => ({
  ProjectionActionButtons: () => <span>ações</span>,
}));
vi.mock("./artifact-delivery-list", () => ({
  ArtifactDeliveryList: () => <p>documentos</p>,
}));
vi.mock("./evidence-upload-control", () => ({
  EvidenceUploadControl: ({ label }: { label?: string }) => (
    <span>{label ?? "evidências"}</span>
  ),
}));

import { InternalProjectionPage } from "./internal-projection-page";
import { ProjectionDetailPage } from "./projection-detail-page";

function queueRecord(): ProjectionRecord {
  return {
    id: "projection-queue",
    recordKey: "queue-legal-meridian",
    aggregateType: "exception_case",
    aggregateId: "aggregate-queue",
    accountId: null,
    audience: "internal",
    channel: "queues",
    version: 3,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:01:00.000Z",
    stale: false,
    data: {
      title: "Revisão de contrato do cliente · Meridian",
      reference: "queue-legal-meridian",
      statusLabel: "Versão desatualizada · revisão jurídica",
      status: "pending",
      risk: "high",
      tone: "danger",
      owner: "Imani Ross",
      valueSort: 12,
      nextAction: "Restaurar a versão 2 antes de decidir",
      context: [{ label: "Conta", value: "Meridian Archive Labs, Inc." }],
      allowedActions: ["review_exception"],
    },
  };
}

beforeEach(() => {
  mocks.getRouteRoles.mockResolvedValue(["internal_operator"]);
  mocks.loadPortalRecords.mockResolvedValue({
    records: [queueRecord()],
    generatedAt: "2026-08-01T12:00:00.000Z",
    stale: true,
  });
});

describe("experience pages in Portuguese", () => {
  it("renders the record detail without English or glued fragments", async () => {
    render(
      await ProjectionDetailPage({
        audience: "internal",
        channel: "queues",
        title: "Registro da fila",
        description: "Revise a atualização dos dados e as evidências.",
        recordKey: "queue-legal-meridian",
      }),
    );

    expect(screen.getByText("Espaço de trabalho do operador")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Os dados operacionais precisam ser atualizados.",
    );
    const ledger = screen.getByRole("region", { name: "Registro da fila" });
    expect(
      within(ledger).getByRole("heading", { name: "Registros autorizados" }),
    ).toBeVisible();
    expect(ledger).toHaveTextContent("1 registro · dados operacionais atuais");
    // The label and the key used to be concatenated: "Referênciaqueue-…".
    expect(ledger).toHaveTextContent(
      "Referência queue-legal-meridian · versão 3",
    );
    expect(ledger).toHaveTextContent(
      "Versão desatualizada · revisão jurídica · Risco alto",
    );
    // Named facts in Portuguese; sort keys and styling are not facts.
    expect(within(ledger).getByText("Responsável")).toBeVisible();
    expect(within(ledger).getByText("Conta")).toBeVisible();
    expect(within(ledger).queryByText("valueSort")).toBeNull();
    expect(ledger).toHaveTextContent("Próximo passo");
    expect(ledger).not.toHaveTextContent(
      /Operator|workspace|Authorized|Next step|System record|Status Label/u,
    );
  });

  it("renders the operator queue table in Portuguese", async () => {
    render(
      await InternalProjectionPage({
        channel: "approvals",
        title: "Decisões de aprovação",
        description: "Registre uma aprovação autorizada.",
      }),
    );

    expect(screen.getByText("Espaço de trabalho do operador")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^Alguns registros precisam ser atualizados · em /u,
    );
    for (const header of [
      "Registro",
      "Status",
      "Responsável",
      "Próxima tarefa",
      "Ações",
    ])
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    expect(screen.getByText("Anexar evidências de aprovação")).toBeVisible();
  });
});
