import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
} from "@clockwork/db";
import type { DatabaseCoreFinanceRepositoryOptions } from "@clockwork/db";

import {
  CoreServiceError,
  type CoreFinanceService,
  type CoreListInput,
  type CoreMutation,
} from "../routes/core/service";

export type DatabaseCoreFinanceServiceOptions =
  DatabaseCoreFinanceRepositoryOptions;

/**
 * API-facing orchestration adapter. All SQL and transaction ownership remains
 * in @clockwork/db; this adapter only translates stable repository failures
 * into the public core service error contract.
 */
export class DatabaseCoreFinanceService implements CoreFinanceService {
  private readonly repository: DatabaseCoreFinanceRepository;

  public constructor(options: DatabaseCoreFinanceServiceOptions) {
    this.repository = new DatabaseCoreFinanceRepository(options);
  }

  public mutate(input: CoreMutation) {
    return this.translate(() => this.repository.mutate(input));
  }

  public list(input: CoreListInput) {
    return this.translate(() => this.repository.list(input));
  }

  public report(input: Parameters<CoreFinanceService["report"]>[0]) {
    return this.translate(() => this.repository.report(input));
  }

  public replay(input: Parameters<CoreFinanceService["replay"]>[0]) {
    return this.translate(() => this.repository.replay(input));
  }

  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DatabaseCoreError)
        throw new CoreServiceError(error.code, error.message);
      throw error;
    }
  }
}
