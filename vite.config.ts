import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig(({command, isPreview}) => ({
  base: command === 'build' || isPreview ? '/three-motionbricks/' : '/',
  // Only publish reviewed assets. In particular, never copy locally downloaded
  // weights, partial downloads, or arbitrary new public/ files into Pages.
  publicDir: command === 'build' ? false : 'public',
  plugins: [{
    name: 'reviewed-static-assets',
    apply: 'build',
    generateBundle() {
      for (const [source, fileName] of [
        ['public/assets/soma.glb', 'assets/soma.glb'],
        ['public/assets/soma_n1.json', 'assets/soma_n1.json'],
        ['public/NOTICE.txt', 'NOTICE.txt'],
        ['licenses/SOMA-X-Apache-2.0.txt', 'licenses/SOMA-X-Apache-2.0.txt'],
        ['licenses/MotionBricks-LICENSE.txt', 'licenses/MotionBricks-LICENSE.txt'],
      ]) {
        const content = readFileSync(new URL(source, import.meta.url));
        if (content.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/'))
          throw new Error(`${source} is an unresolved Git LFS pointer.`);
        this.emitFile({type: 'asset', fileName, source: content});
      }
    },
  }],
}));
