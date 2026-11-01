// Identifies the deterministic GLB, without distributing the character asset.
export const ANIMASA_GLB_SHA256 = 'c1f6e34ca7db7e56a297583a4859bc6ad6db018ba7dbebe58d235c95dfc884c3';
export const ANIMASA_GLB_BYTES = 1219992;
export async function verifyAnimasaGLB(bytes: ArrayBuffer) {
  if (bytes.byteLength !== ANIMASA_GLB_BYTES) throw new Error('Incorrect Animasa GLB size. Use the documented offline converter.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash = Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if (hash !== ANIMASA_GLB_SHA256)
    throw new Error('Choose model.glb from the documented Animasa offline converter. This file is not the verified Animasa Miku conversion.');
}
