import type { Metadata } from "next";
import type { ReactNode } from "react";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getRouteSession } from "@/src/features/shell/route-session";
import type { MessageId } from "@/src/i18n";
import { loadPartnerRecords } from "@/src/features/experience-server/portal-view-loader";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import {
  getFormattingLocale,
  getLocale,
  getTranslations,
} from "@/src/i18n/server";

import {
  PartnerCollection,
  PartnerSurfacePermission,
} from "./partner-collection";
import { partnerSurfaces, type PartnerSurfaceKey } from "./partner-data";
import {
  NoPartnerMembership,
  partnerRouteMembership,
} from "./partner-membership";
import { roleCanUseSurface } from "./partner-rules";
import { canReadPartnerChannel } from "./partner-access";
import { demoCreatedRegistrations } from "./demo-deal-registration";
import { demoCreatedPartnerQuotes } from "./demo-partner-quote";
import { demoPartnerBrandRecords } from "./demo-partner-brand";
import {
  demoPartnerCollectionRenewalContext,
  demoPartnerRenewalRecords,
} from "./demo-partner-renewal";

/** The browser title for a partner page, in the reader's language. */
export async function partnerPageMetadata(title: MessageId): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(title) };
}

/** The browser title for a partner collection, from its own heading. */
export function partnerSurfaceMetadata(
  surface: PartnerSurfaceKey,
): Promise<Metadata> {
  return partnerPageMetadata(partnerSurfaces[surface].title);
}

export async function PartnerCollectionRoute({
  surface,
  actions,
}: {
  surface: PartnerSurfaceKey;
  /**
   * Server-backed action for this surface, supplied by the route so the panel
   * carries the route's own permission gate rather than a second guess at it.
   */
  actions?: ReactNode;
}) {
  const session = await getRouteSession("partner");
  const partnerMembership = partnerRouteMembership(session);
  if (!partnerMembership) return <NoPartnerMembership />;
  const config = partnerSurfaces[surface];
  const assistedInternal = Boolean(session.assistedSession);
  if (
    !canReadPartnerChannel(session.roles, surface, assistedInternal) ||
    (!assistedInternal && !roleCanUseSurface(session.roles, config.roles))
  )
    return <PartnerSurfacePermission />;
  const projection = await loadPartnerRecords(surface);
  const demoState = demoDeployIdentityEnabled(process.env)
    ? await configuredDemoStateStore().read()
    : undefined;
  // Records the demo created are worded here, for this reader, exactly as the
  // loader words the projected ones: same language, same formatting tag.
  const reader = {
    t: await getTranslations(),
    locale: await getLocale(),
    formatting: await getFormattingLocale(),
  };
  const projectedRecords =
    demoState && surface === "renewals"
      ? demoPartnerRenewalRecords(
          demoState,
          partnerMembership.accountId,
          projection.records,
          reader,
        )
      : projection.records;
  const createdRecords = !demoState
    ? []
    : surface === "registrations"
      ? demoCreatedRegistrations(demoState, partnerMembership.accountId, reader)
      : surface === "quotes"
        ? demoCreatedPartnerQuotes(
            demoState,
            partnerMembership.accountId,
            reader,
          )
        : surface === "brand"
          ? demoPartnerBrandRecords(
              demoState,
              partnerMembership.accountId,
              reader,
            )
          : [];
  const renewalContext =
    demoState && surface === "renewals" && projectedRecords[0]
      ? demoPartnerCollectionRenewalContext(
          projectedRecords[0].recordKey ?? projectedRecords[0].id,
        )
      : undefined;
  return (
    <PartnerCollection
      surface={surface}
      config={{
        ...config,
        records: [...createdRecords, ...projectedRecords],
      }}
      roles={session.roles}
      partnerName={partnerMembership.accountName}
      // The loader has always returned these. This route dropped them and
      // rendered the rows as current; the reader had no way to know otherwise.
      //
      // `truncated` is the third of them and says something `stale` cannot:
      // rows are missing, so the result count and the facet choices below
      // describe a prefix. The loader stopped raising this as an error
      // precisely so the read would succeed -- succeeding silently would just
      // move the defect from a refused route to a wrong page.
      freshness={{
        generatedAt: projection.generatedAt,
        partial: projection.truncated,
        stale: projection.stale,
      }}
      formatting={{ locale: session.locale, timeZone: session.timeZone }}
      {...(renewalContext ? { renewalContext } : {})}
      {...(actions ? { actions } : {})}
    />
  );
}
