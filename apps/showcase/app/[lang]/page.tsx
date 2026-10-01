"use client";
import { useI18n } from "../../components/i18n-provider";
import Link from "next/link";
import { Header, Footer } from "../../components/chrome";
import { Arrow, Check, StageLine, Symbol } from "../../components/icons";
import { getCapabilities, sandboxOrigin } from "../../lib/content";

export default function Home() {
  const { t, href, money } = useI18n();
  const capabilities = getCapabilities(t);
  return (
    <>
      <Header />
      <main id="main">
        <section className="hero container">
          <div className="hero-copy">
            <h1>
              {t("sales.every.deal.138f9")}
              <br />
              {t("sales.every.handoff.5fb84")}
              <br />
              <span>{t("sales.connected.5a61f")}</span>
            </h1>
            <p className="hero-description">
              {t("sales.one.clear.path.from.a.customer.3dff4")}
            </p>
            <div className="hero-actions">
              <Link className="button" href={href("/tour")}>
                {t("sales.follow.a.deal.707f8")}
                <Arrow />
              </Link>
              <a className="text-link" href={href(`${sandboxOrigin}/demo`)}>
                {t("sales.explore.the.full.operational.sandbox.7e481")}
                <Arrow diagonal />
              </a>
            </div>
            <div className="hero-note">
              <span>{t("sales.3.minute.interactive.tour.845f9")}</span>
            </div>
          </div>
          <div
            className="hero-visual"
            aria-label={t(
              "sales.illustration.of.a.connected.sample.order.2b5b7",
            )}
          >
            <div className="deal-card">
              <div className="deal-top">
                <span className="avatar">M</span>
                <div>
                  <strong>Meridian Archive Labs</strong>
                  <span>
                    {t("sales.committed.storage.annual.agreement.0d0ee")}
                  </span>
                </div>
                <span className="status-pill">
                  <Check /> {t("sales.accepted.a00fb")}
                </span>
              </div>
              <div className="deal-amount">
                <span>{t("sales.annual.contract.value.9b9d7")}</span>
                <strong>{money(54000)}</strong>
              </div>
              <div className="deal-facts">
                <div>
                  <span>{t("sales.capacity.ae65d")}</span>
                  <strong>{t("sales.1.pb.bdad8")}</strong>
                </div>
                <div>
                  <span>{t("sales.term.c6f3b")}</span>
                  <strong>{t("sales.12.months.5f58b")}</strong>
                </div>
                <div>
                  <span>{t("sales.quote.eb4cd")}</span>
                  <strong>CW-1042</strong>
                </div>
              </div>
              <StageLine />
            </div>
            <div className="handoff-stack">
              <div>
                <span className="mini-icon">
                  <Symbol kind="control" />
                </span>
                <div>
                  <strong>{t("sales.finance.approved.the.terms.0bee4")}</strong>
                </div>
              </div>
              <div>
                <span className="mini-icon blue">
                  <Symbol kind="connect" />
                </span>
                <div>
                  <strong>
                    {t("sales.operations.has.the.next.step.07fcd")}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="value-strip">
          <div className="value-grid container">
            <div>
              <h2>{t("sales.move.deals.forward.b6691")}</h2>
              <p>{t("sales.give.every.person.a.clear.next.1ca8e")}</p>
            </div>
            <div>
              <h2>{t("sales.keep.the.terms.intact.c4609")}</h2>
              <p>
                {t("sales.carry.approved.pricing.and.decisions.into.1f706")}
              </p>
            </div>
            <div>
              <h2>{t("sales.know.what.needs.attention.c5e62")}</h2>
              <p>
                {t("sales.see.blocked.orders.outstanding.invoices.and.f5ec1")}
              </p>
            </div>
          </div>
        </section>
        <section className="section capabilities container" id="capabilities">
          <div className="section-heading">
            <div>
              <h2>{t("sales.explore.what.s.here.5eeb8")}</h2>
            </div>
          </div>
          <div className="capability-grid">
            {capabilities.map((item, index) => (
              <article className="capability-card" key={item.title}>
                <div className="capability-top">
                  <Symbol
                    kind={
                      (
                        [
                          "quote",
                          "control",
                          "partner",
                          "bill",
                          "clock",
                          "connect",
                        ] as const
                      )[index] ?? "quote"
                    }
                  />
                </div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <a href={href(item.href)} className="text-link">
                  {item.label}
                  <Arrow />
                </a>
              </article>
            ))}
          </div>
        </section>
        <section className="connected-section" id="connected">
          <div className="container">
            <div className="section-heading">
              <div>
                <h2>{t("sales.connected.heading")}</h2>
                <p className="integration-availability">
                  {t("sales.direction.not.a.release.promise.live.efa06")}
                </p>
              </div>
              <div>
                <p>
                  {t(
                    "sales.connect.commercial.intent.to.actual.delivery.cfda7",
                  )}
                </p>
              </div>
            </div>
            <div className="integration-map">
              <div className="system-card">
                <h3>Fil One Commerce</h3>
                <ul>
                  <li>{t("sales.customer.and.partner.relationships.2adce")}</li>
                  <li>{t("sales.approved.pricing.and.order.terms.f30d4")}</li>
                  <li>{t("sales.billing.and.commercial.history.79259")}</li>
                </ul>
              </div>
              <div className="connection-bridge">
                <span>{t("sales.approved.orders.34ea2")}</span>
                <Arrow />
                <div className="connection-line" />
                <span>{t("sales.service.status.usage.993d5")}</span>
                <span className="reverse-arrow">
                  <Arrow />
                </span>
              </div>
              <div className="system-card platform">
                <h3>Fil One</h3>
                <ul>
                  <li>{t("sales.existing.organizations.and.tenants.5611d")}</li>
                  <li>
                    {t("sales.provisioned.storage.and.entitlements.e89a8")}
                  </li>
                  <li>{t("sales.actual.usage.and.resource.state.7772b")}</li>
                </ul>
              </div>
            </div>
            <div className="phase-grid">
              <article>
                <h3>{t("sales.bring.existing.accounts.together.014cc")}</h3>
                <p>
                  {t(
                    "sales.map.identities.and.organizations.so.customers.6df98",
                  )}
                </p>
              </article>
              <article>
                <h3>{t("sales.follow.confirmed.delivery.70ae3")}</h3>
                <p>{t("sales.send.approved.orders.to.fil.one.83d67")}</p>
              </article>
              <article>
                <h3>{t("sales.grow.the.routes.to.market.09b53")}</h3>
                <p>{t("sales.proposed.next.steps.include.co.branded.14792")}</p>
              </article>
            </div>
            <div className="integration-bottom">
              <Link
                className="button button-light"
                href={href("/tour?mode=connected&step=3")}
              >
                {t("sales.preview.the.connection.a2e06")}
                <Arrow />
              </Link>
            </div>
          </div>
        </section>
        <section className="section container" id="audiences">
          <div className="section-heading">
            <div>
              <h2>{t("sales.go.deeper.where.it.matters.49e90")}</h2>
            </div>
            <p>{t("sales.the.full.sandbox.is.available.for.79214")}</p>
          </div>
          <div className="audience-grid">
            {[
              {
                kind: "quote" as const,
                name: t("sales.for.customers.f5029"),
                body: t("sales.review.quotes.accept.terms.and.follow.78365"),
                persona: "directBuyer",
                link: t("sales.explore.customer.workspace.ef8c9"),
              },
              {
                kind: "partner" as const,
                name: t("sales.for.partners.0f82e"),
                body: t(
                  "sales.register.opportunities.prepare.resale.quotes.and.81219",
                ),
                persona: "reseller",
                link: t("sales.explore.partner.workspace.bce90"),
              },
              {
                kind: "control" as const,
                name: t("sales.for.fil.one.teams.5285f"),
                body: t(
                  "sales.review.exceptions.manage.pricing.policy.and.a815d",
                ),
                persona: "financeApprover",
                link: t("sales.explore.finance.workspace.e92e5"),
              },
            ].map((item) => (
              <article className="audience-card" key={item.name}>
                <Symbol kind={item.kind} />
                <h3>{item.name}</h3>
                <p>{item.body}</p>
                <a
                  href={href(
                    `${sandboxOrigin}/demo/persona?persona=${item.persona}`,
                  )}
                  className="text-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.link}
                  <Arrow diagonal />
                </a>
              </article>
            ))}
          </div>
        </section>
        <section className="closing container">
          <div>
            <h2>
              {t("sales.follow.one.deal.bf7e8")}
              <br />
              {t("sales.see.the.possibility.fedcd")}
            </h2>
          </div>
          <div>
            <Link href={href("/tour")} className="button">
              {t("sales.take.the.interactive.tour.d4bb9")}
              <Arrow />
            </Link>
            <a
              href="https://www.fil.one/contact"
              className="text-link"
              target="_blank"
              rel="noreferrer"
            >
              {t("sales.discuss.a.fil.one.pilot.28ae4")}
              <Arrow diagonal />
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
