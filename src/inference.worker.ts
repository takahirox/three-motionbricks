/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { Features } from './motion';

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
      const response = await fetch(event.data.url!);
      if (!response.ok) throw new Error(`Model HTTP ${response.status}. Run npm run assets:model; see README.`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 1_000_000) throw new Error('Model is missing or is a Git LFS pointer. Run npm run assets:model.');
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
