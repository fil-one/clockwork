"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  hubspotBaseProperties,
  type HubSpotConnectionRecord,
  type HubSpotObjectType,
  type HubSpotOwner,
  type HubSpotPipeline,
  type HubSpotPortal,
  type HubSpotPropertyDefinition,
  type PartnerOwnerOption,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  Fieldset,
  InlineNotice,
  Select,
  StatusBadge,
} from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import { disconnectHubSpot, saveHubSpotConnection } from "./actions";
import { hubspotErrorMessage } from "./model";
import styles from "./hubspot.module.css";

const objectLabels: Readonly<Record<HubSpotObjectType, MessageId>> = {
  company: "operations.hubspot.settings.companies",
  deal: "operations.hubspot.settings.deals",
  contact: "operations.hubspot.settings.contacts",
};

/**
 * Connecting HubSpot is an administrator's explicit decision: the portal the
 * token reaches, the Commerce audience that may read its data, which data,
 * and whose HubSpot owner becomes which Commerce owner. Nothing is read for
 * anyone else until this is saved, and a disconnect stops it again.
 */
export function HubSpotSettings({
  portal,
  portalError,
  active,
  latest,
  catalog,
  staff,
  canManage,
}: {
  portal: HubSpotPortal | null;
  portalError: string | null;
  active: HubSpotConnectionRecord | null;
  latest: HubSpotConnectionRecord | null;
  catalog: {
    properties: readonly HubSpotPropertyDefinition[];
    pipelines: readonly HubSpotPipeline[];
    owners: readonly HubSpotOwner[];
  } | null;
  staff: readonly PartnerOwnerOption[];
  canManage: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [scope, setScope] = useState(() => ({
    company: [...(active?.scope.company ?? [])],
    deal: [...(active?.scope.deal ?? [])],
    contact: [...(active?.scope.contact ?? [])],
    notes: active?.scope.notes ?? false,
    files: active?.scope.files ?? false,
  }));
  const [pipelineId, setPipelineId] = useState(active?.defaultPipelineId ?? "");
  const [mappings, setMappings] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (active?.ownerMappings ?? []).map((row) => [
        row.hubspotOwnerId,
        row.staffId,
      ]),
    ),
  );
  const portalMismatch = Boolean(
    active && portal && active.portalId !== portal.portalId,
  );
  const editable = canManage && Boolean(portal) && !portalMismatch;

  function save() {
    setFailure(null);
    setSaved(null);
    if (!portal) return;
    startTransition(async () => {
      const result = await saveHubSpotConnection({
        ...(active ? { expectedVersion: active.version } : {}),
        portalId: portal.portalId,
        audienceAccepted: accepted,
        scope,
        defaultPipelineId: pipelineId,
        ownerMappings: Object.entries(mappings)
          .filter(([, staffId]) => staffId)
          .map(([hubspotOwnerId, staffId]) => ({ hubspotOwnerId, staffId })),
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (!result.ok) {
        setFailure(
          result.code === "INVALID_INPUT" && !accepted
            ? "HUBSPOT_DECISION_REQUIRED"
            : result.code,
        );
        return;
      }
      setAccepted(false);
      setSaved(
        active
          ? t("operations.hubspot.settings.saved")
          : t("operations.hubspot.settings.activated"),
      );
      router.refresh();
    });
  }

  function disconnect() {
    if (!active) return;
    setFailure(null);
    startTransition(async () => {
      const result = await disconnectHubSpot({
        expectedVersion: active.version,
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      setConfirmDisconnect(false);
      if (!result.ok) {
        setFailure(result.code);
        return;
      }
      setSaved(t("operations.hubspot.settings.disconnected"));
      router.refresh();
    });
  }

  const toggle = (objectType: HubSpotObjectType, name: string, on: boolean) =>
    setScope((current) => ({
      ...current,
      [objectType]: on
        ? [...current[objectType], name]
        : current[objectType].filter((value) => value !== name),
    }));

  return (
    <div className={styles.form}>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {saved ?? ""}
      </p>
      {saved ? <InlineNotice tone="success" title={saved} /> : null}
      {failure ? (
        <InlineNotice
          tone="danger"
          live="assertive"
          title={t(hubspotErrorMessage(failure))}
        />
      ) : null}

      <section className={styles.card} aria-labelledby="hubspot-connection">
        <div className={styles.cardHeading}>
          <h2 id="hubspot-connection">
            {t("operations.hubspot.settings.connection")}
          </h2>
          <StatusBadge tone={active && !portalMismatch ? "success" : "neutral"}>
            {t(
              active
                ? portalMismatch
                  ? "operations.hubspot.settings.statusMismatch"
                  : "operations.hubspot.settings.statusActive"
                : "operations.hubspot.settings.statusOff",
            )}
          </StatusBadge>
        </div>
        <dl className={styles.facts}>
          <dt>{t("operations.hubspot.settings.token")}</dt>
          <dd>
            {portal
              ? t("operations.hubspot.settings.tokenReaches", {
                  portal: portal.portalId,
                  domain: portal.uiDomain,
                })
              : portalError
                ? t(hubspotErrorMessage(portalError))
                : t("operations.hubspot.settings.tokenMissing")}
          </dd>
          {active ? (
            <>
              <dt>{t("operations.hubspot.settings.approvedBy")}</dt>
              <dd>
                {active.approvedByName} ·{" "}
                <LocalTimestamp value={active.approvedAt} locale={locale} />
              </dd>
              <dt>{t("operations.hubspot.settings.portal")}</dt>
              <dd>{active.portalId}</dd>
            </>
          ) : latest ? (
            <>
              <dt>{t("operations.hubspot.settings.previous")}</dt>
              <dd>
                {t("operations.hubspot.settings.previousBody", {
                  portal: latest.portalId,
                })}
              </dd>
            </>
          ) : null}
          {portal && catalog ? (
            <>
              <dt>{t("operations.hubspot.settings.check")}</dt>
              <dd>
                {t("operations.hubspot.settings.checkPassed", {
                  properties: catalog.properties.length,
                  pipelines: catalog.pipelines.length,
                })}
              </dd>
            </>
          ) : null}
        </dl>
        <p className={styles.secondary}>
          {t("operations.hubspot.settings.tokenHelp")}
        </p>
        {portalMismatch ? (
          <InlineNotice
            tone="warning"
            title={t("operations.hubspot.state.portalTitle")}
            description={t("operations.hubspot.settings.mismatchBody")}
          />
        ) : null}
      </section>

      {portal && catalog ? (
        <>
          <Fieldset
            legend={t("operations.hubspot.settings.scope")}
            description={t("operations.hubspot.settings.scopeBody")}
            className={styles.card}
          >
            {(["company", "deal", "contact"] as const).map((objectType) => {
              const properties = catalog.properties.filter(
                (property) => property.objectType === objectType,
              );
              return (
                <Fieldset key={objectType} legend={t(objectLabels[objectType])}>
                  <p className={styles.secondary}>
                    {t("operations.hubspot.settings.always", {
                      names: hubspotBaseProperties[objectType].join(", "),
                    })}
                  </p>
                  <div className={styles.scopeGroup}>
                    {properties.map((property) => (
                      <Checkbox
                        key={property.name}
                        label={property.label}
                        description={
                          property.sensitive
                            ? t("operations.hubspot.settings.sensitive")
                            : property.name
                        }
                        disabled={!editable || property.sensitive}
                        checked={
                          !property.sensitive &&
                          scope[objectType].includes(property.name)
                        }
                        onChange={(event) =>
                          toggle(
                            objectType,
                            property.name,
                            event.currentTarget.checked,
                          )
                        }
                      />
                    ))}
                  </div>
                </Fieldset>
              );
            })}
            <Fieldset legend={t("operations.hubspot.settings.activity")}>
              <Checkbox
                label={t("operations.hubspot.settings.notes")}
                description={t("operations.hubspot.settings.notesHelp")}
                checked={scope.notes}
                disabled={!editable}
                onChange={(event) =>
                  setScope((current) => ({
                    ...current,
                    notes: event.currentTarget.checked,
                  }))
                }
              />
              <Checkbox
                label={t("operations.hubspot.settings.files")}
                description={t("operations.hubspot.settings.filesHelp")}
                checked={scope.files}
                disabled={!editable}
                onChange={(event) =>
                  setScope((current) => ({
                    ...current,
                    files: event.currentTarget.checked,
                  }))
                }
              />
            </Fieldset>
            <p className={styles.secondary}>
              {t("operations.hubspot.settings.neverImported")}
            </p>
          </Fieldset>

          <section className={styles.card} aria-labelledby="hubspot-defaults">
            <h2 id="hubspot-defaults">
              {t("operations.hubspot.settings.defaults")}
            </h2>
            <Select
              label={t("operations.hubspot.settings.pipeline")}
              value={pipelineId}
              disabled={!editable}
              onChange={(event) => setPipelineId(event.currentTarget.value)}
              options={[
                {
                  value: "",
                  label: t("operations.hubspot.settings.pipelineFirst"),
                },
                ...catalog.pipelines.map((pipeline) => ({
                  value: pipeline.id,
                  label: pipeline.label,
                })),
              ]}
            />
            <Fieldset
              legend={t("operations.hubspot.settings.owners")}
              description={t("operations.hubspot.settings.ownersBody")}
            >
              <div className={styles.fields}>
                {catalog.owners.map((owner) => (
                  <Select
                    key={owner.id}
                    label={owner.name}
                    help={owner.email ?? undefined}
                    value={mappings[owner.id] ?? ""}
                    disabled={!editable}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setMappings((current) => ({
                        ...current,
                        [owner.id]: value,
                      }));
                    }}
                    options={[
                      {
                        value: "",
                        label: t("operations.hubspot.settings.notMapped"),
                      },
                      ...staff.map((member) => ({
                        value: member.id,
                        label: member.name,
                      })),
                    ]}
                  />
                ))}
              </div>
            </Fieldset>
          </section>

          <section className={styles.card} aria-labelledby="hubspot-audience">
            <h2 id="hubspot-audience">
              {t("operations.hubspot.settings.audience")}
            </h2>
            <p className={styles.muted}>
              {t("operations.hubspot.settings.audienceBody")}
            </p>
            <Checkbox
              label={t("operations.hubspot.settings.accept")}
              description={t("operations.hubspot.settings.acceptHelp")}
              checked={accepted}
              disabled={!editable}
              onChange={(event) => setAccepted(event.currentTarget.checked)}
            />
            <div className={styles.actions}>
              <Button
                type="button"
                onClick={save}
                disabled={!editable || !accepted || pending}
              >
                {active
                  ? t("operations.hubspot.settings.save")
                  : t("operations.hubspot.settings.activate")}
              </Button>
              {active && canManage ? (
                confirmDisconnect ? (
                  <span className={styles.actions} role="group">
                    <span className={styles.secondary} role="alert">
                      {t("operations.hubspot.settings.disconnectConfirm")}
                    </span>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={disconnect}
                      disabled={pending}
                    >
                      {t("operations.hubspot.settings.disconnect")}
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => setConfirmDisconnect(false)}
                    >
                      {t("operations.hubspot.cancel.keep")}
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    {t("operations.hubspot.settings.disconnect")}
                  </Button>
                )
              ) : null}
            </div>
            <p className={styles.secondary}>
              {t("operations.hubspot.settings.disconnectHelp")}
            </p>
          </section>
        </>
      ) : active && canManage ? (
        <section className={styles.card} aria-labelledby="hubspot-disconnect">
          <h2 id="hubspot-disconnect">
            {t("operations.hubspot.settings.disconnect")}
          </h2>
          <p className={styles.muted}>
            {t("operations.hubspot.settings.disconnectHelp")}
          </p>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="danger"
              onClick={disconnect}
              disabled={pending}
            >
              {t("operations.hubspot.settings.disconnect")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
