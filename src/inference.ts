import type { Features } from './motion';

export interface InferenceResult {data: Float32Array; tokens: number; milliseconds: number}
export class Inference {
  private worker = new Worker(new URL('./inference.worker.ts', import.meta.url), {type: 'module'});
  private id = 0;
  private pending?: {id: number; resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>};
  constructor() {
    this.worker.onmessage = event => {
      const message = event.data;
      if (!this.pending || message.id !== this.pending.id) return;
      clearTimeout(this.pending.timer);
      if (message.type === 'error') this.pending.reject(new Error(`${message.stage}: ${message.error}`));
      else this.pending.resolve(message);
      this.pending = undefined;
    };
    this.worker.onerror = event => this.fail(new Error(event.message || 'Inference worker failed.'));
  }
  private fail(error: Error): void {
    if (this.pending) {clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined;}
    this.worker.terminate();
  }
  private send(type: string, fields: object): Promise<any> {
    if (this.pending) return Promise.reject(new Error('Inference is already running.'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending = {id, resolve, reject, timer: setTimeout(() => this.fail(new Error(`${type} exceeded 180 seconds. See docs/validation.md.`)), 180_000)};
      this.worker.postMessage({type, id, ...fields});
    });
  }
  load(url: string): Promise<{milliseconds: number; gpu: object; runtime: object}> {
    if (!navigator.gpu) return Promise.reject(new Error('WebGPU is unavailable. Use a supported desktop browser on localhost or HTTPS.'));
    const query = new URL(location.href).searchParams;
    return this.send('load', {url, strictGpu: query.has('strictGpu'), verbose: query.has('ortVerbose')});
  }
  run(features: Features): Promise<InferenceResult> {return this.send('run', {features});}
  dispose(): void {this.fail(new Error('Inference cancelled.'));}
}
