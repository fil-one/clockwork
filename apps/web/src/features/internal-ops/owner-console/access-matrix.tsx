"use client";

import {
  assistedSessionWithheldPermissions,
  permissions,
  rolePermissions,
  sideRoles,
  type Permission,
  type Role,
} from "@clockwork/contracts";

import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { permissionLabels, staffRoleLabels } from "../team/model";
import styles from "./owner-console.module.css";

const otherRoleLabels: Readonly<Record<string, MessageId>> = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
  partner_admin: "role.partnerAdmin",
  partner_seller: "role.partnerSeller",
};

/**
 * The column groups: who may hold each role. Channel and referral partners
 * hold the same two roles, so they share a group; the one difference is
 * stated under the table.
 */
const groups: readonly { label: MessageId; roles: readonly Role[] }[] = [
  { label: "operations.owner.matrix.side.filOne", roles: sideRoles.fil_one },
  { label: "operations.owner.matrix.side.customer", roles: sideRoles.customer },
  {
    label: "operations.owner.matrix.side.partner",
    roles: sideRoles.channel_partner,
  },
];

function Granted() {
  return (
    <svg
      className={styles.check}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Which role allows what, read from the same table the server enforces. Read
 * only: roles are changed per person on the Team page.
 */
export function AccessMatrix() {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const roleLabel = (role: string) => {
    const label = staffRoleLabels[role] ?? otherRoleLabels[role];
    return label ? t(label) : role;
  };
  const holds = (role: Role, permission: Permission) =>
    (rolePermissions[role] as readonly Permission[]).includes(permission);
  const assisted = new Intl.ListFormat(locale, {
    // The labels contain "and" themselves, so the list does not add another.
    style: "short",
    type: "unit",
  }).format(
    assistedSessionWithheldPermissions.map((permission) =>
      t(permissionLabels[permission]),
    ),
  );
  return (
    <>
      <div
        className={styles.tableRegion}
        role="region"
        aria-label={t("operations.owner.matrix.caption")}
        tabIndex={0}
      >
        <table className={`${styles.table} ${styles.matrix}`}>
          <caption className="cw-sr-only">
            {t("operations.owner.matrix.caption")}
          </caption>
          <thead>
            <tr>
              <td />
              {groups.map((group) => (
                <th
                  key={group.label}
                  scope="colgroup"
                  colSpan={group.roles.length}
                  className={styles.groupHeader}
                >
                  {t(group.label)}
                </th>
              ))}
            </tr>
            <tr>
              <th scope="col">{t("operations.owner.matrix.permission")}</th>
              {groups.flatMap((group) =>
                group.roles.map((role) => (
                  <th key={role} scope="col" className={styles.roleHeader}>
                    {roleLabel(role)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission}>
                <th scope="row">{t(permissionLabels[permission])}</th>
                {groups.flatMap((group) =>
                  group.roles.map((role) => (
                    <td key={role} className={styles.cell}>
                      {holds(role, permission) ? <Granted /> : null}
                      <span className="cw-sr-only">
                        {t(
                          holds(role, permission)
                            ? "operations.owner.matrix.yes"
                            : "operations.owner.matrix.no",
                        )}
                      </span>
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles.footnotes}>
        <li>{t("operations.owner.matrix.referral")}</li>
        <li>
          {t("operations.owner.matrix.assisted", { permissions: assisted })}
        </li>
      </ul>
    </>
  );
}
