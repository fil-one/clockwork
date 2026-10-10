# ADR 0012: One signing engine for every SignWell document

Status: Proposed, 2026-10-10. Supersedes the part of
[ADR 0011](0011-standalone-commerce-mnda.md) that gives MNDAs a workflow of
their own; the signing rules it sets (bind before send, callbacks as wakeups,
completion with archived evidence, void only before the first signature) stand
and now apply to every type.

`SigningEngine` (`packages/workflows/src/signing/engine.ts`) runs send, sync,
remind, cancel, void and signer correction for any document sent through
SignWell, and refuses to send a request whose type needs approval until it is
approved. A document type is a `SigningDocumentType` declaration
(`packages/contracts/src/signing.ts`): its SignWell binding key, its two signers
in order with the fields each must complete and whether staff may correct them,
the document name, file name, subject and message, whether it needs two-person
approval, whether the sender is copied, and its error and history prefixes.
MNDAs and template contracts are the first two declarations, and one SignWell
document schema serves both. `MndaWorkflow` and `ContractSigningWorkflow` remain
the entry points the application calls, with their existing error codes.
Approval decisions are recorded by the contract repository directly.

A new document from a counsel template needs only the template: it is a template
contract and rides the contract table and declaration. A new kind of document on
a table of its own still needs a declaration, a `SignWellSigningClient` subclass
for its `createDraft`, a `SigningStore` adapter, a facade that maps `SIGNING_*`
codes to its own, and the notes its screen shows for each attention reason. The
engine checks at construction that the declaration names exactly two signers and
that any correctable signer is one its store and client can correct.

Storage is unchanged. Each type keeps its table and repository, so the lease,
the frozen terminal state, the hash-checked executed PDF and the history stay
where they are enforced. A store states what it can keep beyond state and error;
the contract table keeps no cancel code, first-sent time or signer correction,
and its adapter refuses a change that carries one. Moving both types onto one
table is a separate decision, taken when a third document kind or the lifecycle
`agreements` model needs it; the scenario suite in
`packages/workflows/src/signing/scenarios.ts` is the check that any such move
keeps every rule.
