// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { contractToday } from "@clockwork/domain/contract-terms";

import { getTranslations } from "@/src/i18n/server";
import { contractRegisterReader } from "@/src/features/internal-ops/contracts/demo-access";
import { contractStaff } from "@/src/features/internal-ops/contracts/server";
import { loadOwnHandoffs } from "@/src/features/internal-ops/handoff/server";
import { loadSalesHome } from "@/src/features/internal-ops/sales-home/server-loader";

import { appLink, compact, defineTool } from "../tool";

export const whoami = defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "The Fil One Commerce staff member this token acts as: name, email, roles, permissions, and the token's scope and expiry. Call this first to see what the other tools will allow.",
  input: {},
  access: "read",
  run: (_args, { session }) =>
    Promise.resolve({
      user: {
        id: session.userId,
        name: session.profile.name,
        email: session.profile.email,
      },
      roles: session.roles,
      permissions: session.permissions,
      // Whether commerce records the person as MFA-enrolled; a token request
      // is never a fresh verification.
      mfaEnrolled: session.mfaVerified,
      token: {
        id: session.accessToken.id,
        name: session.accessToken.name,
        scope: session.accessToken.scope,
        expiresAt: session.accessToken.expiresAt,
      },
    }),
});

export const homeSummary = defineTool({
  name: "home_summary",
  title: "Home summary",
  description:
    "What the staff Home page shows this person: counts of their own and the team's MNDAs, contracts and partner next steps by what they are waiting on, renewal notices coming due, and their open handoff requests. Each row links to the filtered list in the app.",
  input: {},
  access: "read",
  run: async (_args, context) => {
    const { session } = context;
    // Home is a staff surface: its messages are English in every language.
    const [t, sections, renewals, handoffs] = await Promise.all([
      getTranslations(),
      loadSalesHome({
        userId: session.userId,
        permissions: session.permissions,
        demo: false,
        now: new Date(),
      }),
      contractStaff("contract:read")
        .then((reader) =>
          contractRegisterReader(reader).renewalSummary(
            contractToday(new Date()),
          ),
        )
        .catch(() => null),
      loadOwnHandoffs(),
    ]);
    return {
      sections: sections.map((section) => ({
        section: t(section.heading),
        ...(section.rows === null
          ? { unavailable: true }
          : {
              rows: section.rows.map((row) =>
                compact({
                  item: t(row.title),
                  mine: row.mine,
                  team: row.team,
                  attention: row.attention,
                  link: row.href ? appLink(context, row.href) : undefined,
                  teamLink: row.teamHref
                    ? appLink(context, row.teamHref)
                    : undefined,
                }),
              ),
            }),
      })),
      ...(renewals
        ? {
            renewalNotices: {
              ...renewals,
              link: appLink(context, "/internal/contracts/notices"),
            },
          }
        : {}),
      ...(handoffs
        ? {
            myHandoffs: handoffs
              .filter(
                ({ status }) => status === "open" || status === "in_progress",
              )
              .map((request) => ({
                id: request.id,
                counterparty: request.counterpartyLegalName,
                status: request.status,
                assignee: request.assigneeName,
                createdAt: request.createdAt,
              })),
          }
        : {}),
    };
  },
});
