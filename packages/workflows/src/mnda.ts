import { mndaSigning, type Actor, type MndaRecord } from "@clockwork/contracts";
import type { MndaSigningProvider } from "@clockwork/integrations";
import {
  SigningEngine,
  signingErrors,
  signingReminderCooldownMs,
  type SigningVoidReason,
} from "./signing/engine";
import { mndaSigningStore, type MndaSigningRepository } from "./signing/stores";

/** Manual reminders are spaced so a double click cannot email twice. */
export const mndaReminderCooldownMs = signingReminderCooldownMs;

/** How a void is explained: a typed reason, or the signer-change code. */
export type MndaVoidReason = SigningVoidReason;

const named = signingErrors(mndaSigning);

/**
 * The MNDA register's signing workflow: the shared signing engine (ADR 0012)
 * over the MNDA repository, with `MNDA_*` error codes.
 */
export class MndaWorkflow {
  private readonly engine: SigningEngine<MndaRecord>;
  constructor(
    repo: MndaSigningRepository,
    provider: MndaSigningProvider,
    wait?: (ms: number) => Promise<void>,
  ) {
    this.engine = new SigningEngine(
      mndaSigning,
      mndaSigningStore(repo),
      provider,
      wait,
    );
  }
  send(id: string, actor: Actor) {
    return this.engine.send(id, actor).catch(named);
  }
  sync(id: string, actor: Actor) {
    return this.engine.sync(id, actor).catch(named);
  }
  /** Reminds whoever signs next: the partner, then the Fil One countersigner. */
  remind(id: string, actor: Actor) {
    return this.engine.remind(id, actor).catch(named);
  }
  /** Discards a draft that never reached SignWell. */
  cancel(id: string, actor: Actor) {
    return this.engine.cancel(id, actor).catch(named);
  }
  /** Voids a request the partner has not signed. */
  void(id: string, actor: Actor, why: MndaVoidReason) {
    return this.engine.void(id, actor, why).catch(named);
  }
  /** Replaces the partner signer's email (a bounce or a typo) on a request
   * the partner has not started signing. */
  correctSigner(id: string, actor: Actor, signerEmail: string) {
    return this.engine.correctSigner(id, actor, signerEmail).catch(named);
  }
}
