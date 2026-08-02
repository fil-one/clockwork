import { notFound } from "next/navigation";

import { BrandLogo, Button, Input } from "@clockwork/ui";

import {
  demoAccessConfiguration,
  demoAccessSubmitRoute,
  safeDemoReturnPath,
} from "@/src/auth/demo-access";
import { brandAsset } from "@/src/features/shell/brand-assets";
import { t } from "@/src/i18n/en";

export const metadata = { title: "Demo access" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (!demoAccessConfiguration(process.env)) notFound();
  const query = await searchParams;
  const invalid = query.error === "1";
  return (
    <main className="access-main" id="main-content">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        <p className="eyebrow">{t("demo.access.eyebrow")}</p>
        <h1>{t("demo.access.title")}</h1>
        <p>{t("demo.access.description")}</p>
        <form action={demoAccessSubmitRoute} method="post">
          <input
            type="hidden"
            name="next"
            value={safeDemoReturnPath(query.next)}
          />
          <Input
            label={t("demo.access.password")}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            {...(invalid ? { error: t("demo.access.invalid") } : {})}
          />
          <Button type="submit">{t("demo.access.submit")}</Button>
        </form>
      </section>
    </main>
  );
}
