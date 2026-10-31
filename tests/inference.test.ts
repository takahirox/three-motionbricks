import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inference } from '../src/inference';
import type { Features } from '../src/motion';

test('model progress keeps an active slow load alive without resolving it; stalled load and inference time out', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  class WorkerStub {
    static latest: WorkerStub;
    onmessage?: (event: {data: any}) => void;
    onerror?: (event: {message: string}) => void;
    request?: {id: number};
    terminated = false;
    constructor() {WorkerStub.latest = this;}
    postMessage(request: {id: number}) {this.request = request;}
    terminate() {this.terminated = true;}
    receive(data: object) {this.onmessage?.({data: {id: this.request!.id, ...data}});}
  }
  const globals = {Worker: WorkerStub, navigator: {gpu: {}}, location: {href: 'http://localhost/'}};
  const descriptors = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, {value, configurable: true});
  try {
    const inference = new Inference(), progress: number[] = [];
    let settled = false;
    const loaded = inference.load('https://example.test/model.onnx', bytes => progress.push(bytes));
    const outcome = loaded.then(value => {settled = true; return value;}, error => {settled = true; throw error;});
    context.mock.timers.tick(14 * 60_000);
    WorkerStub.latest.receive({type: 'progress', received: 1024});
    await Promise.resolve();
    assert.equal(settled, false, 'Progress must not resolve the load promise');
    context.mock.timers.tick(14 * 60_000);
    assert.equal(WorkerStub.latest.terminated, false, 'An active download can exceed 15 minutes total');
    WorkerStub.latest.receive({type: 'loaded', milliseconds: 28 * 60_000, gpu: {}, runtime: {}});
    assert.equal((await outcome).milliseconds, 28 * 60_000);
    assert.deepEqual(progress, [1024]);

    const runFailure = assert.rejects(inference.run({} as Features), /Inference exceeded 3 minutes/);
    context.mock.timers.tick(180_000);
    await runFailure;
    assert.equal(WorkerStub.latest.terminated, true);

    const stalled = new Inference();
    const loadFailure = assert.rejects(stalled.load('https://example.test/model.onnx'), /no progress for 15 minutes/);
    context.mock.timers.tick(900_000);
    await loadFailure;
    assert.equal(WorkerStub.latest.terminated, true);
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
