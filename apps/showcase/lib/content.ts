import type { Translator } from "./i18n";
export const sandboxOrigin = "https://clockwork-commerce-demo.netlify.app";
export const repository = "https://github.com/fil-one/clockwork";
export const getDescription = (t: Translator) =>
  t("sales.see.how.fil.one.commerce.connects.d507b");
export const getStages = (t: Translator) =>
  [
    t("sales.quote.eb4cd"),
    t("sales.approve.6007a"),
    t("sales.accept.89713"),
    t("sales.activate.24433"),
    t("sales.bill.e5178"),
  ] as const;
export const getCapabilities = (t: Translator) =>
  [
    {
      title: t("sales.quotes.orders.0ef2f"),
      detail: t("sales.carry.agreed.pricing.and.terms.from.23bb8"),
      href: "/tour?step=0",
      label: t("sales.follow.a.deal.707f8"),
    },
    {
      title: t("sales.pricing.approvals.d7854"),
      detail: t(
        "sales.review.pricing.exceptions.retain.approved.economics.0d65f",
      ),
      href: "/tour?step=1",
      label: t("sales.review.an.approval.26592"),
    },
    {
      title: t("sales.partner.commerce.91650"),
      detail: t("sales.explore.deal.registration.resale.quotes.private.9f266"),
      href: "/#audiences",
      label: t("sales.explore.partner.workflows.e1655"),
    },
    {
      title: t("sales.billing.collections.249f8"),
      detail: t("sales.trace.invoices.payment.evidence.corrections.and.9dbf5"),
      href: "/tour?step=4",
      label: t("sales.see.connected.billing.c8ff3"),
    },
    {
      title: t("sales.payg.trial.controls.d5a3b"),
      detail: t(
        "sales.explore.versioned.policies.usage.rating.simulations.649ca",
      ),
      href: `${sandboxOrigin}/demo/persona?persona=financeApprover`,
      label: t("sales.open.finance.sandbox.f7625"),
    },
    {
      title: t("sales.live.fil.one.connection.6a81a"),
      detail: t("sales.link.existing.accounts.confirm.real.provisioning.56ddb"),
      href: "/#connected",
      label: t("sales.see.the.integration.plan.5d46c"),
    },
  ] as const;
