import { Button, EmptyState } from "@clockwork/ui";

import { chooseCommerceAccount } from "@/src/auth/actions";
import { signOutCommerceSession } from "@/src/auth/sign-out";
import { getOrganizationChoices } from "@/src/features/shell/route-session";
import { t } from "@/src/i18n/en";

export default async function ChooseOrganizationPage() {
  const memberships = await getOrganizationChoices();
  return (
    <main className="permission-view" id="main-content">
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
          title={t("app.account.choose.empty.title")}
          description={t("app.account.choose.empty.description")}
          action={
            <form action={signOutCommerceSession}>
              <Button type="submit" variant="secondary">
                {t("app.signOut")}
              </Button>
            </form>
          }
        />
      )}
    </main>
  );
}
