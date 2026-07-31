export type PersistenceErrorHandler = (error: unknown) => void;

export class PersistenceQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly failures: unknown[] = [];

  public constructor(private readonly onError: PersistenceErrorHandler = console.error) {}

  public enqueue(operation: () => Promise<unknown>): void {
    this.tail = this.tail.then(async () => {
      try {
        await operation();
      } catch (error) {
        this.failures.push(error);
        this.onError(error);
      }
    });
  }

  public async flush(): Promise<void> {
    await this.tail;
    if (this.failures.length > 0) {
      const failures = this.failures.splice(0);
      throw new AggregateError(failures, 'Uma ou mais gravações no PostgreSQL falharam');
    }
  }
}
