// Identifies the deterministic GLB, without distributing the character asset.
export const ANIMASA_GLB_SHA256 = 'd50f975328ea85c20efb0cba023bc6ec0fa06e07f7be5ee8c12bad24ab220e97';
export const ANIMASA_GLB_BYTES = 1220228;
export async function verifyAnimasaGLB(bytes: ArrayBuffer) {
  if (bytes.byteLength !== ANIMASA_GLB_BYTES) throw new Error('Incorrect Animasa GLB size. Use the documented offline converter.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash = Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if (hash !== ANIMASA_GLB_SHA256)
    throw new Error('Choose model.glb from the documented Animasa offline converter. This file is not the verified Animasa Miku conversion.');
}
