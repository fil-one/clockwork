"use client";
import { useI18n } from "./i18n-provider";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Arrow, Check, Symbol } from "./icons";
import { getStages, sandboxOrigin } from "../lib/content";
import {
  economics,
  initialScenario,
  parseStep,
  restoreScenario,
  scenarioKey,
  scenarioReducer,
  getScenes,
} from "../lib/scenario";
import type { ScenarioAction } from "../lib/scenario";

export function Tour() {
  const { t, href, money, number, percent } = useI18n();
  const stages = getStages(t);
  const scenes = getScenes(t);
  const params = useSearchParams();
  const router = useRouter();
  const step = parseStep(params.get("step"));
  const connected = params.get("mode") === "connected";
  const scene = scenes[step] ?? scenes[0];
  const [state, setState] = useState(initialScenario);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [share, setShare] = useState<"idle" | "copied" | "manual">("idle");
  const [resetPrompt, setResetPrompt] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [recap, setRecap] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const recapHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (recap) recapHeading.current?.focus();
  }, [recap]);
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    try {
      setState(restoreScenario(sessionStorage.getItem(scenarioKey)));
    } catch {
      setStorageAvailable(false);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(scenarioKey, JSON.stringify(state));
    } catch {
      setStorageAvailable(false);
    }
  }, [state, ready]);
  useEffect(() => {
    if (previousStep.current !== step) {
      heading.current?.focus();
      previousStep.current = step;
      setAccepted(false);
      setRecap(false);
      setResetPrompt(false);
      setShare("idle");
    }
  }, [step]);
  function dispatch(action: ScenarioAction) {
    setState((current) => scenarioReducer(current, action));
  }
  function navigate(next: number, mode = connected) {
    router.push(href(`/tour?step=${next}${mode ? "&mode=connected" : ""}`), {
      scroll: false,
    });
  }
  function reset() {
    dispatch({ type: "reset" });
    setAccepted(false);
    setRecap(false);
    setResetPrompt(false);
    navigate(0, false);
  }
  async function copyLink() {
    const url = new URL(
      href(`/tour?step=${step}${connected ? "&mode=connected" : ""}`),
      window.location.origin,
    ).href;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      setShare("copied");
    } catch {
      setShare("manual");
    }
  }
  const totals = economics(state.capacity);
  const done = state.completed > step;
  const needsPreparation = state.completed < step;
  const requested = state.provisioning === "requested";
  const attention = state.provisioning === "attention";
  const history = [
    t("sales.quote.cw.1042.prepared.f631d"),
    t("sales.finance.approved.pricing.snapshot.d7ae2"),
    t("sales.customer.accepted.order.fo.1042.7cea7"),
    t("sales.sample.service.confirmed.active.f4d85"),
    t("sales.sample.payment.recorded.9ccdc"),
  ].slice(0, state.completed);
  const submit = () =>
    step === 3
      ? dispatch({ type: "request" })
      : dispatch({ type: "complete", step });
  return (
    <div className="tour-container container">
      <div className="tour-topline">
        <Link href={href("/")} className="text-link">
          <span aria-hidden="true" className="back-arrow">
            ←
          </span>{" "}
          {t("sales.overview.d4b1e")}
        </Link>
        <div className="tour-utilities">
          <button onClick={() => void copyLink()} className="utility-button">
            {share === "copied"
              ? t("sales.link.copied.d1286")
              : t("sales.share.this.step.25c20")}
          </button>
          <button
            className="utility-button"
            onClick={() => setResetPrompt(!resetPrompt)}
            aria-expanded={resetPrompt}
          >
            {t("sales.restart.tour.d530e")}
          </button>
        </div>
      </div>
      <div role="status" className="sr-only">
        {share === "copied" ? t("sales.step.link.copied.it.opens.a.0975b") : ""}
      </div>
      {share === "manual" && (
        <div className="inline-notice">
          <label htmlFor="share-url">
            {t("sales.copy.this.link.to.share.the.93086")}
          </label>
          <input
            id="share-url"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
      {resetPrompt && (
        <div className="reset-notice">
          <p>{t("sales.restart.this.sample.deal.this.clears.f28ae")}</p>
          <button className="button button-small" onClick={reset}>
            {t("sales.restart.my.sample.68f9d")}
          </button>
          <button
            className="utility-button"
            onClick={() => setResetPrompt(false)}
          >
            {t("sales.keep.exploring.5dac0")}
          </button>
        </div>
      )}
      <div className="tour-heading">
        <div>
          <h1>{t("sales.your.front.row.seat.to.a.ef705")}</h1>
        </div>
      </div>
      <nav className="tour-progress" aria-label={t("sales.tour.scenes.1292e")}>
        {stages.map((stage, index) => (
          <button
            key={stage}
            className={`tour-stage ${step === index ? "selected" : ""} ${state.completed > index ? "complete" : ""}`}
            onClick={() => navigate(index)}
            aria-current={step === index ? "step" : undefined}
          >
            <span>{state.completed > index ? <Check /> : `0${index + 1}`}</span>
            <strong>{stage}</strong>
            <small className="sr-only">
              {state.completed > index
                ? t("sales.sample.completed.ac5e3")
                : step === index
                  ? t("sales.viewing.now.1d8a8")
                  : t("sales.explore.scene.1951c")}
            </small>
          </button>
        ))}
      </nav>
      <div className="tour-grid">
        <aside className="tour-guide">
          <h2 tabIndex={-1} ref={heading}>
            {scene.title}
          </h2>
          <p>{scene.intro}</p>
          <div className="mode-selector">
            <div role="group" aria-label={t("sales.experience.mode.f362c")}>
              <button
                aria-pressed={!connected}
                onClick={() => navigate(step, false)}
              >
                {t("sales.demo.today.a668f")}
              </button>
              <button
                aria-pressed={connected}
                onClick={() => navigate(step, true)}
              >
                {t("sales.with.fil.one.64901")}
              </button>
            </div>
          </div>
          {connected && (
            <div className="future-note">
              <strong>{t("sales.planned.integration.preview.c2d0c")}</strong>
              <p>
                {step < 3
                  ? t(
                      "sales.the.planned.connection.links.this.commercial.03660",
                    )
                  : t("sales.in.the.planned.connection.fil.one.d7178")}
              </p>
              <a href={href("/#connected")}>
                {t("sales.see.scope.and.dependencies.debf6")}
                <Arrow />
              </a>
            </div>
          )}
          <div className="guide-navigation">
            <button
              onClick={() => navigate(step - 1)}
              disabled={step === 0}
              className="utility-button"
            >
              {t("sales.previous.43556")}
            </button>
            {step < 4 && (
              <button
                onClick={() => navigate(step + 1)}
                className="utility-button"
              >
                {t("sales.explore.next.scene.8aa12")}
              </button>
            )}
          </div>
        </aside>
        <div className="workspace-column">
          <section
            className="sample-workspace"
            aria-label={t("sales.sample.workspace.value.c1feb", {
              stage: stages[step] ?? stages[0],
            })}
          >
            <div className="workspace-top">
              <span className="workspace-brand">
                Fil One <span>Commerce</span>
              </span>
            </div>
            <div className="role-bar">
              <span className="role-avatar">{scene.person.slice(0, 1)}</span>
              <span>
                <strong>{scene.role}</strong>
                <small>{scene.person}</small>
              </span>
            </div>
            <div className="workspace-body" key={`${step}-${connected}`}>
              <div className="record-heading">
                <div>
                  <p className="context-label">Meridian Archive Labs</p>
                  <h3>
                    {
                      [
                        t("sales.committed.storage.quote.8ee4a"),
                        t("sales.commercial.review.68a64"),
                        t("sales.review.your.quote.42ca4"),
                        t("sales.service.activation.61f47"),
                        t("sales.first.monthly.invoice.887c8"),
                      ][step]
                    }
                  </h3>
                </div>
                <span
                  className={`record-status ${done ? "success" : attention && step === 3 ? "warning" : ""}`}
                >
                  {done
                    ? [
                        t("sales.prepared.37932"),
                        t("sales.approved.87b42"),
                        t("sales.accepted.a00fb"),
                        t("sales.active.simulated.09c68"),
                        t("sales.paid.simulated.ae56e"),
                      ][step]
                    : [
                        t("sales.draft.ebf12"),
                        t("sales.review.required.f0742"),
                        t("sales.ready.to.accept.ec9c6"),
                        attention
                          ? t("sales.needs.attention.c1ebc")
                          : requested
                            ? t("sales.awaiting.confirmation.d0ae0")
                            : t("sales.not.requested.2bb18"),
                        t("sales.awaiting.payment.7c278"),
                      ][step]}
                </span>
              </div>
              <div className="record-reference">
                <span>
                  {step < 3
                    ? t("sales.quote.cw.1042.d6237")
                    : step === 3
                      ? t("sales.order.fo.1042.d83dc")
                      : t("sales.invoice.inv.1042.01.37b9d")}
                </span>
                <span>{t("sales.usd.sample.economics.49657")}</span>
              </div>
              {needsPreparation ? (
                <div className="prepare-state">
                  <Symbol kind="quote" />
                  <h4>{t("sales.jump.straight.into.this.scene.bb87a")}</h4>
                  <p>{t("sales.load.the.preceding.steps.as.a.c5502")}</p>
                  <button
                    className="button"
                    disabled={!ready}
                    onClick={() => dispatch({ type: "prepare", step })}
                  >
                    {t("sales.load.sample.at.this.step.71de4")}
                    <Arrow />
                  </button>
                </div>
              ) : (
                <>
                  {step === 0 && (
                    <>
                      <div className="capacity-control">
                        <div>
                          <label htmlFor="capacity">
                            {t("sales.committed.storage.881cb")}
                          </label>
                          <strong>
                            {t("sales.value.tb.428f9", {
                              capacity: number(state.capacity),
                            })}
                          </strong>
                        </div>
                        <input
                          id="capacity"
                          type="range"
                          min="100"
                          max="2000"
                          step="100"
                          value={state.capacity}
                          disabled={done}
                          onChange={(event) =>
                            dispatch({
                              type: "capacity",
                              value: Number(event.currentTarget.value),
                            })
                          }
                        />
                        <div className="range-labels">
                          <span>{t("sales.100.tb.15642")}</span>
                          <span>{t("sales.2.000.tb.2e3b5")}</span>
                        </div>
                      </div>
                      <div className="sample-terms">
                        <div>
                          <span>{t("sales.agreement.term.4a423")}</span>
                          <strong>{t("sales.12.months.5f58b")}</strong>
                        </div>
                        <div>
                          <span>{t("sales.billing.frequency.9ae4c")}</span>
                          <strong>{t("sales.monthly.9b11f")}</strong>
                        </div>
                      </div>
                      <div className="price-breakdown">
                        <div>
                          <span>{t("sales.sample.list.price.ff4ba")}</span>
                          <span>
                            {t("sales.value.tb.month.6b1bc", {
                              rate: money(5, 2),
                            })}
                          </span>
                        </div>
                        <div>
                          <span>{t("sales.requested.discount.ee48a")}</span>
                          <span>{percent(0.1)}</span>
                        </div>
                        <div className="total">
                          <span>{t("sales.annual.contract.value.9b9d7")}</span>
                          <strong>{money(totals.annual)}</strong>
                        </div>
                      </div>
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <div className="review-alert">
                        <Symbol kind="control" />
                        <div>
                          <strong>
                            {t("sales.a.decision.before.the.deal.moves.db6cb")}
                          </strong>
                          <p>
                            {t(
                              "sales.10.requested.discount.5.sample.self.b76cc",
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="review-grid">
                        <div>
                          <span>{t("sales.monthly.commitment.249eb")}</span>
                          <strong>{money(totals.monthly)}</strong>
                        </div>
                        <div>
                          <span>{t("sales.annual.contract.value.9b9d7")}</span>
                          <strong>{money(totals.annual)}</strong>
                        </div>
                      </div>
                      <dl className="record-details">
                        <div>
                          <dt>{t("sales.capacity.ae65d")}</dt>
                          <dd>
                            {t("sales.value.tb.428f9", {
                              capacity: number(state.capacity),
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("sales.approved.rate.if.accepted.242b5")}</dt>
                          <dd>
                            {t("sales.value.tb.month.6b1bc", {
                              rate: money(4.5, 2),
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("sales.decision.owner.ebbd3")}</dt>
                          <dd>{t("sales.mateo.finance.79530")}</dd>
                        </div>
                        <div>
                          <dt>{t("sales.sample.rationale.fb4ee")}</dt>
                          <dd>{t("sales.annual.committed.capacity.68f9f")}</dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <div className="customer-summary">
                        <Symbol kind="quote" />
                        <span>
                          {t("sales.your.annual.storage.agreement.9bc93")}
                        </span>
                        <strong>
                          {money(totals.annual)}
                          <small>{t("sales.usd.year.dafb7")}</small>
                        </strong>
                        <p>
                          {t("sales.value.tb.12.months.billed.monthly.0f99c", {
                            capacity: number(state.capacity),
                            amount: money(totals.monthly),
                          })}
                        </p>
                      </div>
                      <dl className="record-details">
                        <div>
                          <dt>{t("sales.seller.01498")}</dt>
                          <dd>{t("sales.fil.one.illustrative.cd2cd")}</dd>
                        </div>
                        <div>
                          <dt>{t("sales.commercial.approval.1dd8f")}</dt>
                          <dd>{t("sales.recorded.by.finance.6ebe5")}</dd>
                        </div>
                        <div>
                          <dt>{t("sales.after.acceptance.cdc90")}</dt>
                          <dd>{t("sales.order.sent.to.operations.da22d")}</dd>
                        </div>
                      </dl>
                      {!done && (
                        <label className="accept-check">
                          <input
                            type="checkbox"
                            checked={accepted}
                            onChange={(event) =>
                              setAccepted(event.currentTarget.checked)
                            }
                          />
                          <span>
                            {t(
                              "sales.i.have.reviewed.this.fictional.quote.aabd3",
                            )}
                          </span>
                        </label>
                      )}
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <div className="service-flow">
                        <div className="service-node">
                          <Symbol kind="quote" />
                          <strong>{t("sales.order.fo.1042.d83dc")}</strong>
                          <span>
                            {t("sales.value.tb.committed.7f725", {
                              capacity: number(state.capacity),
                            })}
                          </span>
                        </div>
                        <Arrow />
                        <div
                          className={`service-node ${done ? "confirmed" : ""}`}
                        >
                          <Symbol kind="connect" />
                          <strong>
                            {connected
                              ? t("sales.fil.one.platform.4b2e7")
                              : t("sales.demo.provider.a21ba")}
                          </strong>
                          <span>
                            {done
                              ? t("sales.service.confirmed.c7b48")
                              : requested
                                ? t("sales.request.received.4f227")
                                : attention
                                  ? t("sales.confirmation.delayed.90a49")
                                  : t("sales.ready.for.request.27877")}
                          </span>
                        </div>
                      </div>
                      <div className="provision-state">
                        <span
                          className={`provision-dot ${done ? "green" : ""}`}
                        />
                        <div>
                          <strong>
                            {done
                              ? t("sales.active.service.simulated.acf72")
                              : attention
                                ? t(
                                    "sales.waiting.for.a.confirmed.result.17b26",
                                  )
                                : requested
                                  ? t(
                                      "sales.request.accepted.service.is.not.active.e5950",
                                    )
                                  : t(
                                      "sales.an.accepted.order.is.ready.for.defc6",
                                    )}
                          </strong>
                          <p>
                            {done
                              ? t(
                                  "sales.the.confirmed.sample.entitlement.matches.the.112db",
                                )
                              : attention
                                ? t(
                                    "sales.operations.owns.the.exception.retry.the.ca063",
                                  )
                                : requested
                                  ? t(
                                      "sales.confirm.the.simulated.result.below.to.faea0",
                                    )
                                  : t(
                                      "sales.send.a.sample.request.then.confirm.d50a4",
                                    )}
                          </p>
                        </div>
                      </div>
                      {attention && (
                        <div className="exception-note">
                          {t("sales.recovery.case.linked.to.fo.1042.5cbf9")}
                        </div>
                      )}
                      <dl className="record-details">
                        <div>
                          <dt>{t("sales.commercial.source.3eaed")}</dt>
                          <dd>CW-1042 → FO-1042</dd>
                        </div>
                        <div>
                          <dt>{t("sales.entitlement.0d8f0")}</dt>
                          <dd>
                            {t("sales.value.tb.12.months.07e7a", {
                              capacity: number(state.capacity),
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("sales.provider.effect.e7fd6")}</dt>
                          <dd>
                            {connected
                              ? t(
                                  "sales.planned.integration.simulated.here.5454a",
                                )
                              : t("sales.simulated.only.bacfb")}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {step === 4 && (
                    <>
                      <div className="invoice-summary">
                        <div>
                          <span>
                            {done
                              ? t("sales.payment.recorded.00335")
                              : t("sales.amount.due.66681")}
                          </span>
                          <strong>{money(totals.monthly)}</strong>
                        </div>
                        <span className="invoice-period">
                          {t("sales.month.1.of.12.f57b1")}
                        </span>
                      </div>
                      <dl className="record-details">
                        <div>
                          <dt>{t("sales.committed.storage.881cb")}</dt>
                          <dd>
                            {t("sales.value.tb.value.877c5", {
                              capacity: number(state.capacity),
                              rate: money(4.5, 2),
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("sales.monthly.subtotal.f981c")}</dt>
                          <dd>{money(totals.monthly)}</dd>
                        </div>
                        <div>
                          <dt>{t("sales.tax.47e28")}</dt>
                          <dd>
                            {t("sales.excluded.from.this.illustration.75aa1")}
                          </dd>
                        </div>
                        <div>
                          <dt>{t("sales.balance.remaining.4cba0")}</dt>
                          <dd>{money(done ? 0 : totals.monthly)}</dd>
                        </div>
                      </dl>
                      <div className="invoice-chain">
                        <span>{t("sales.quote.cw.1042.d6237")}</span>
                        <Arrow />
                        <span>{t("sales.order.fo.1042.d83dc")}</span>
                        <Arrow />
                        <span>INV-1042-01</span>
                      </div>
                    </>
                  )}
                  {done ? (
                    <div className="action-result" role="status">
                      <Check />
                      <div>
                        <strong>{scene.result}</strong>
                        {state.seeded && (
                          <span>
                            {t(
                              "sales.this.scenario.includes.prepared.sample.history.3a222",
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="workspace-actions">
                      {step === 3 && requested ? (
                        <>
                          <button
                            className="button"
                            onClick={() => dispatch({ type: "confirm" })}
                          >
                            {t("sales.confirm.simulated.activation.b2bb2")}
                            <Check />
                          </button>
                          <button
                            className="text-link"
                            onClick={() => dispatch({ type: "delay" })}
                          >
                            {t("sales.try.a.delayed.confirmation.952c2")}
                          </button>
                        </>
                      ) : (
                        <button
                          className="button"
                          disabled={!ready || (step === 2 && !accepted)}
                          onClick={submit}
                        >
                          {attention && step === 3
                            ? t("sales.retry.simulated.service.request.b95ed")
                            : scene.action}
                          <Arrow />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
          <div className="tour-bottom-bar">
            <span>
              {t(
                state.seeded
                  ? "sales.progress.prepared"
                  : "sales.sample.actions.completed.value.5.a491d",
                { count: number(state.completed) },
              )}
            </span>
            {done && (
              <button
                className="button button-small"
                onClick={() =>
                  step === 4 ? setRecap(true) : navigate(step + 1)
                }
              >
                {scene.next}
                <Arrow />
              </button>
            )}
          </div>
          {recap && (
            <section
              className="tour-recap"
              aria-label={t("sales.tour.takeaway.c633e")}
            >
              <h2 tabIndex={-1} ref={recapHeading}>
                {t("sales.one.deal.a.complete.commercial.story.21776")}
              </h2>
              <p>
                {t("sales.you.followed.value.of.sample.annual.38ba7", {
                  amount: money(totals.annual),
                })}
              </p>
              <div>
                <span>
                  <Check /> {t("sales.clear.handoffs.9f6c3")}
                </span>
                <span>
                  <Check /> {t("sales.retained.terms.35f48")}
                </span>
                <span>
                  <Check /> {t("sales.traceable.outcomes.99df9")}
                </span>
              </div>
              <p>{t("sales.the.next.step.is.connecting.these.6d173")}</p>
              <a className="button" href={href("/#connected")}>
                {t("sales.explore.the.integration.roadmap.a2980")}
                <Arrow />
              </a>
              <a
                className="text-link"
                href="https://www.fil.one/contact"
                target="_blank"
                rel="noreferrer"
              >
                {t("sales.discuss.a.fil.one.pilot.28ae4")}
                <Arrow diagonal />
              </a>
            </section>
          )}
          <details className="sample-history">
            <summary>
              {t("sales.follow.the.record.8a93a")}
              <span>
                {t("sales.sample.events.value.e90e1", {
                  count: number(history.length),
                })}
              </span>
            </summary>
            {history.length ? (
              <ol>
                {history.map((event, index) => (
                  <li key={event}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {event}
                  </li>
                ))}
              </ol>
            ) : (
              <p>{t("sales.prepare.the.quote.to.begin.this.2b63a")}</p>
            )}
            {state.seeded && (
              <p>{t("sales.earlier.events.were.loaded.as.prepared.514f7")}</p>
            )}
          </details>
          {!storageAvailable && (
            <p className="tour-storage-note">
              {t("sales.browser.storage.is.unavailable.you.can.11d53")}
            </p>
          )}
          <a
            className="text-link sandbox-link"
            href={href(`${sandboxOrigin}/demo`)}
            target="_blank"
            rel="noreferrer"
          >
            {t("sales.explore.the.full.operational.sandbox.7e481")}
            <Arrow diagonal />
          </a>
        </div>
      </div>
    </div>
  );
}
