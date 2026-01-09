export class Resolvable<T extends any|void> {
  private resolveFunc = (value: T) => {}
  private rejectFunc = (reason?: any) => {}
  private readonly promiseField: Promise<T>;
  private completedField = false;

  constructor() {
    this.promiseField = new Promise<T>((resolve, reject) => { this.resolveFunc = resolve; this.rejectFunc = reject; });
    this.promiseField.finally(() => {this.completedField = true;});
  }

  get completed(): boolean {
    return this.completedField;
  }

  resolve(value: T) {
    this.resolveFunc(value);
  }

  reject(reason?: any) {
    this.rejectFunc(reason);
  }

  get promise(): Promise<T> {
    return this.promiseField;
  }

  get callable(): (value: T) => void {
    return this.resolveFunc;
  }
}

export class OperationQueue {
  private head = Promise.resolve();

  async push<TResult>(op: () => TResult | PromiseLike<TResult>): Promise<TResult> {
    const result = new Resolvable<TResult>();
    this.head = this.head.then(async () => {
      result.resolve(await op());
    }).catch(e => {
      result.reject(e);
    });
    return result.promise;
  }
}

export function sleep(delayMillis: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, delayMillis); });
}
