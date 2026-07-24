export function createTraceId(): string {
  return `tr_${crypto.randomUUID()}`;
}

export async function withTrace<T>(traceId: string, operation: () => Promise<T>): Promise<T> {
  void traceId;
  return operation();
}
