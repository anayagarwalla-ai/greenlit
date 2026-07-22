type HealthQueryResult = { error: unknown };

export async function retryHealthQuery<T extends HealthQueryResult>(
  query: () => PromiseLike<T>,
  delayMs = 150,
): Promise<T> {
  const first = await query();
  if (!first.error) return first;

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return query();
}
