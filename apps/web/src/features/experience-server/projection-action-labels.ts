import type { MessageId, Translator } from "@/src/i18n";

/**
 * Server action identifiers carry no presentation. Without this map an operator
 * reads the raw command name (`mark_uncollectible`) on a control that changes
 * money. Every identifier the command executor accepts is listed here; anything
 * new falls back to the identifier itself, spaced, rather than rendering
 * nothing -- a code, not a sentence, so it is the same in every language.
 */
const actionLabels: Readonly<Record<string, MessageId>> = {
  accept: "projection.action.accept",
  add_contact: "projection.action.addContact",
  add_role: "projection.action.addRole",
  apply: "projection.action.applyAmendment",
  approve_exception: "projection.action.approveException",
  consolidate: "projection.action.consolidate",
  create: "projection.action.create",
  evaluate_dunning: "projection.action.evaluateDunning",
  execute_agreement: "projection.action.executeAgreement",
  expire: "projection.action.expire",
  issue: "projection.action.issue",
  mark_uncollectible: "projection.action.markUncollectible",
  open: "projection.action.openInvoice",
  pay: "projection.action.pay",
  prepare_artifact: "projection.action.prepareArtifact",
  convert_poc: "projection.action.convertPoc",
  price: "projection.action.price",
  reject_exception: "projection.action.rejectException",
  request_teardown: "projection.action.requestTeardown",
  request_renewal: "projection.action.requestRenewal",
  revise: "projection.action.revise",
  set_partner_credit: "projection.action.setPartnerCredit",
  set_payment_terms: "projection.action.setPaymentTerms",
  update: "projection.action.update",
  void: "projection.action.void",
};

/** Transitions that end a commercial record or remove a running service. */
const irreversibleActions = new Set([
  "expire",
  "mark_uncollectible",
  "reject_exception",
  "request_teardown",
  "void",
]);

export function actionLabel(action: string, t: Translator): string {
  const id = actionLabels[action];
  return id ? t(id) : action.replaceAll("_", " ");
}

export function isDestructiveAction(action: string): boolean {
  return (
    irreversibleActions.has(action) ||
    /delete|teardown|terminate|cancel/i.test(action)
  );
}
