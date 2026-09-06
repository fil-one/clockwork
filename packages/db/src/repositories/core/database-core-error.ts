export type DatabaseCoreErrorCode =
  "NOT_FOUND" | "VERSION_CONFLICT" | "DUPLICATE" | "INVALID_STATE";

export class DatabaseCoreError extends Error {
  public constructor(
    public readonly code: DatabaseCoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}
