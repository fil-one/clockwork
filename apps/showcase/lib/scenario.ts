import type { Translator } from "./i18n";
/** A deliberately isolated sales simulation. No operational API or provider effects. */
export const scenarioKey = "fil-one-commerce:tour:v1";
export type Provisioning = "idle" | "requested" | "attention" | "confirmed";
export interface Scenario {
  version: 1;
  capacity: number;
  completed: number;
  provisioning: Provisioning;
  seeded: boolean;
}
export const initialScenario: Scenario = {
  version: 1,
  capacity: 1000,
  completed: 0,
  provisioning: "idle",
  seeded: false,
};
export type ScenarioAction =
  | { type: "capacity"; value: number }
  | { type: "complete"; step: number }
  | { type: "prepare"; step: number }
  | { type: "request" }
  | { type: "delay" }
  | { type: "confirm" }
  | { type: "reset" };
export function scenarioReducer(
  state: Scenario,
  action: ScenarioAction,
): Scenario {
  switch (action.type) {
    case "reset":
      return { ...initialScenario };
    case "capacity":
      return state.completed === 0 &&
        Number.isInteger(action.value) &&
        action.value >= 100 &&
        action.value <= 2000 &&
        action.value % 100 === 0
        ? { ...state, capacity: action.value }
        : state;
    case "complete":
      return action.step === state.completed &&
        [0, 1, 2, 4].includes(action.step)
        ? { ...state, completed: state.completed + 1 }
        : state;
    case "prepare":
      return Number.isInteger(action.step) &&
        action.step > state.completed &&
        action.step <= 4
        ? {
            ...state,
            completed: action.step,
            provisioning: action.step === 4 ? "confirmed" : "idle",
            seeded: true,
          }
        : state;
    case "request":
      return state.completed === 3 &&
        ["idle", "attention"].includes(state.provisioning)
        ? { ...state, provisioning: "requested" }
        : state;
    case "delay":
      return state.completed === 3 && state.provisioning === "requested"
        ? { ...state, provisioning: "attention" }
        : state;
    case "confirm":
      return state.completed === 3 && state.provisioning === "requested"
        ? { ...state, provisioning: "confirmed", completed: 4 }
        : state;
  }
}
export function restoreScenario(raw: string | null): Scenario {
  if (!raw) return { ...initialScenario };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null)
      return { ...initialScenario };
    const s = value as Partial<Scenario>;
    if (
      s.version !== 1 ||
      typeof s.capacity !== "number" ||
      !Number.isInteger(s.capacity) ||
      s.capacity < 100 ||
      s.capacity > 2000 ||
      s.capacity % 100 !== 0 ||
      typeof s.completed !== "number" ||
      !Number.isInteger(s.completed) ||
      s.completed < 0 ||
      s.completed > 5 ||
      typeof s.seeded !== "boolean" ||
      !["idle", "requested", "attention", "confirmed"].includes(
        s.provisioning ?? "",
      )
    )
      return { ...initialScenario };
    if (
      (s.completed < 3 && s.provisioning !== "idle") ||
      (s.completed === 3 && s.provisioning === "confirmed") ||
      (s.completed >= 4 && s.provisioning !== "confirmed")
    )
      return { ...initialScenario };
    return {
      version: 1,
      capacity: s.capacity,
      completed: s.completed,
      provisioning: s.provisioning as Provisioning,
      seeded: s.seeded,
    };
  } catch {
    return { ...initialScenario };
  }
}
export function parseStep(raw: string | null): number {
  return raw !== null && /^[0-4]$/.test(raw) ? Number(raw) : 0;
}
export function economics(capacity: number) {
  const listMonthly = capacity * 5;
  const monthly = capacity * 4.5;
  return {
    listMonthly,
    monthly,
    annual: monthly * 12,
    discount: listMonthly - monthly,
  };
}

export const getScenes = (t: Translator) =>
  [
    {
      role: t("sales.fil.one.sales.a5061"),
      person: t("sales.alex.account.team.7fa7f"),
      title: t("sales.start.with.a.clear.offer.501b6"),
      intro: t("sales.meridian.archive.labs.needs.a.year.e4e74"),
      why: t("sales.a.clear.commercial.starting.point.means.754ac"),
      action: t("sales.prepare.sample.quote.fe6ad"),
      result: t("sales.quote.cw.1042.prepared.the.requested.f7a13"),
      next: t("sales.review.the.terms.e1b87"),
    },
    {
      role: t("sales.fil.one.finance.719bf"),
      person: t("sales.mateo.finance.controller.e1604"),
      title: t("sales.grow.with.commercial.control.2709b"),
      intro: t("sales.the.requested.10.discount.is.above.580ad"),
      why: t("sales.approvals.stay.attached.to.the.agreed.7c427"),
      action: t("sales.approve.sample.terms.1d355"),
      result: t("sales.terms.approved.the.pricing.snapshot.and.cb75f"),
      next: t("sales.see.the.customer.view.1b204"),
    },
    {
      role: t("sales.customer.bf376"),
      person: t("sales.mara.meridian.archive.labs.a6409"),
      title: t("sales.one.acceptance.a.connected.order.77851"),
      intro: t("sales.now.see.the.same.quote.as.70469"),
      why: t("sales.the.customer.and.fil.one.work.b808c"),
      action: t("sales.accept.sample.quote.d3d79"),
      result: t("sales.order.fo.1042.created.from.cw.253aa"),
      next: t("sales.follow.service.activation.68f4c"),
    },
    {
      role: t("sales.fil.one.operations.27576"),
      person: t("sales.ada.commerce.operations.cb13a"),
      title: t("sales.follow.the.order.through.delivery.dbb5d"),
      intro: t("sales.the.accepted.order.tells.operations.what.8b405"),
      why: t("sales.the.commercial.record.reflects.confirmed.delivery.749ab"),
      action: t("sales.send.simulated.service.request.6e55c"),
      result: t("sales.sample.service.confirmed.active.its.capacity.014cf"),
      next: t("sales.follow.the.invoice.169f7"),
    },
    {
      role: t("sales.fil.one.finance.719bf"),
      person: t("sales.mateo.finance.controller.e1604"),
      title: t("sales.close.the.loop.with.billing.e21ae"),
      intro: t("sales.the.first.monthly.invoice.carries.the.95ac9"),
      why: t("sales.teams.can.trace.the.chain.from.81790"),
      action: t("sales.record.sample.payment.7b44e"),
      result: t("sales.sample.payment.recorded.the.invoice.balance.546f2"),
      next: t("sales.see.the.takeaway.eb601"),
    },
  ] as const;
