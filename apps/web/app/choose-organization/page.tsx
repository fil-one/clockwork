import { EmptyState } from "@clockwork/ui";

import { chooseCommerceAccount } from "@/src/auth/actions";
import { getOrganizationChoices } from "@/src/features/shell/route-session";
import { t } from "@/src/i18n/en";

export default async function ChooseOrganizationPage() {
  const memberships = await getOrganizationChoices();
  return (
    <main className="app-shell">
      <h1>{t("app.account.choose.title")}</h1>
      <p>{t("app.account.choose.description")}</p>
      {memberships.length ? (
        <ul aria-label="Authorized organizations">
          {memberships.map((membership) => (
            <li key={membership.organizationId}>
              <form action={chooseCommerceAccount}>
                <input
                  type="hidden"
                  name="accountId"
                  value={membership.accountId}
                />
                <button type="submit">
                  <strong>{membership.accountName}</strong>
                  <span>{membership.organizationName}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No authorized organizations"
          description="Your authenticated identity has no active commerce membership. Ask an organization administrator for access."
        />
      )}
    </main>
  );
}
