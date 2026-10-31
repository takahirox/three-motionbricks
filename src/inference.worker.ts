/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { Features } from './motion';
import model from '../model-source.json';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {wasm: wasmUrl};
let session: ort.InferenceSession | undefined;
const dimensions: Record<keyof Features, number[]> = {
  global_root_values: [1, 8, 5], local_root_values: [1, 8, 4], local_poses: [1, 8, 267],
  has_global_root_values: [1, 8], has_local_root_values: [1, 8], has_local_poses: [1, 8], allowed_pred_num_tokens: [1, 11],
};
let busy = false;
self.onmessage = async (event: MessageEvent<{type: string; url?: string; features?: Features; id: number; strictGpu?: boolean; verbose?: boolean}>) => {
  const {type, id} = event.data;
  if (busy) {self.postMessage({type: 'error', id, error: 'An inference request is already running.'}); return;}
  busy = true;
  const started = performance.now();
  const feeds: Record<string, ort.Tensor> = {};
  let outputs: ort.InferenceSession.ReturnType | undefined;
  try {
    if (type === 'load') {
      const adapter = await self.navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('WebGPU adapter unavailable. Use a supported desktop browser on localhost or HTTPS.');
      let response: Response;
      try {response = await fetch(event.data.url!);}
      catch {throw new Error('Cannot reach the model host. Check your connection or content blocker and retry. See README for local setup.');}
      if (!response.ok) throw new Error(`Model HTTP ${response.status}. The host may be unavailable; retry later. For local setup, run npm run assets:model.`);
      if (!response.body) throw new Error('The model host returned no download body. Retry later.');
      const reader = response.body.getReader();
      // Stream into one buffer instead of retaining hundreds of MB of chunks.
      const buffer = new Uint8Array(model.bytes);
      let received = 0, reportedAt = 0;
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          if (received + value.length > buffer.length) throw new Error('Model download is larger than the pinned official model.');
          buffer.set(value, received); received += value.length;
          if (performance.now() - reportedAt > 250) {
            self.postMessage({type: 'progress', id, received}); reportedAt = performance.now();
          }
        }
        if (received !== model.bytes) throw new Error('Model download is incomplete or is a Git LFS pointer. Retry; for local setup run npm run assets:model.');
      } finally {await reader.cancel(); reader.releaseLock();}
      self.postMessage({type: 'progress', id, received});
      // WebGPU executes supported kernels; ORT uses WASM for graph/shape operations.
      session = await ort.InferenceSession.create(buffer, {executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all', logSeverityLevel: event.data.verbose ? 0 : 2, logVerbosityLevel: event.data.verbose ? 1 : 0,
        ...(event.data.strictGpu ? {extra: {session: {disable_cpu_ep_fallback: '1'}}} : {})});
      const inputs = Object.keys(dimensions);
      if (session.inputNames.length !== inputs.length || inputs.some(name => !session!.inputNames.includes(name)) ||
        !session.outputNames.includes('pred_global_motions') || !session.outputNames.includes('pred_num_tokens'))
        throw new Error('The model does not match the official SOMA tensor contract.');
      self.postMessage({type: 'loaded', id, milliseconds: performance.now() - started, runtime: ort.env.versions, gpu: {vendor: adapter.info.vendor, architecture: adapter.info.architecture,
          device: adapter.info.device, description: adapter.info.description, maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize}});
    } else if (type === 'run') {
      if (!session || !event.data.features) throw new Error('Model session is not ready.');
      for (const name of Object.keys(dimensions) as (keyof Features)[]) {
        const data = event.data.features[name];
        feeds[name] = new ort.Tensor(data instanceof Int32Array ? 'int32' : 'float32', data, dimensions[name]);
      }
      outputs = await session.run(feeds);
      const motion = outputs.pred_global_motions, tokens = outputs.pred_num_tokens;
      if (motion.type !== 'float32' || motion.dims.join() !== '1,64,366' || tokens.type !== 'int32' || tokens.dims.join() !== '1')
        throw new Error('Unexpected SOMA output tensor shape or type.');
      const data = new Float32Array(await motion.getData() as Float32Array);
      const count = Number((await tokens.getData())[0]);
      self.postMessage({type: 'result', id, data, tokens: count, milliseconds: performance.now() - started}, [data.buffer]);
    } else throw new Error(`Unknown inference operation ${type}`);
  } catch (error) {
    self.postMessage({type: 'error', id, stage: type, error: error instanceof Error ? error.message : String(error),
      milliseconds: performance.now() - started});
  } finally {
    for (const tensor of Object.values(feeds)) tensor.dispose();
    if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    busy = false;
  }
};
