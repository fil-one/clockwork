export async function runDurableTask<TInput, TOutput>(
  input: TInput,
  handler: (input: TInput, attempt: number) => Promise<TOutput>,
  options: {
    maxAttempts?: number;
    transient?: (error: unknown) => boolean;
  } = {},
) {
  const errors: unknown[] = [];
  const maxAttempts = options.maxAttempts ?? 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        output: await handler(input, attempt),
        attempts: attempt,
        errors,
      };
    } catch (error) {
      errors.push(error);
      if (attempt === maxAttempts || !(options.transient?.(error) ?? true))
        throw error;
    }
  }
  throw new Error("Unreachable durable task state");
}
