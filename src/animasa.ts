// Identifies the exact published conversion, also accepted by the local override.
export const ANIMASA_GLB_SHA256 = 'cc3bd0a0c5620a248dda1bbb8b7e2c97aab7c8d863ef9a6add817bd56311cc07';
export const ANIMASA_GLB_BYTES = 1220308;
export async function verifyAnimasaGLB(bytes: ArrayBuffer) {
  if (bytes.byteLength !== ANIMASA_GLB_BYTES) throw new Error('Incorrect Animasa GLB size. Use the documented offline converter.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash = Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if (hash !== ANIMASA_GLB_SHA256)
    throw new Error('Choose model.glb from the documented Animasa offline converter. This file is not the verified Animasa Miku conversion.');
}
