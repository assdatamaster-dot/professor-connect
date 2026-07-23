import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/renderer/', import.meta.url), { recursive: true });
await mkdir(new URL('../dist/renderer/media-devices/', import.meta.url), { recursive: true });
await mkdir(new URL('../dist/assets/', import.meta.url), { recursive: true });
await cp(
  new URL('../preload/package.json', import.meta.url),
  new URL('../dist/preload/package.json', import.meta.url),
);
await cp(
  new URL('../renderer/presence.html', import.meta.url),
  new URL('../dist/renderer/presence.html', import.meta.url),
);
await cp(
  new URL('../renderer/presence.css', import.meta.url),
  new URL('../dist/renderer/presence.css', import.meta.url),
);
await cp(
  new URL('../config.json', import.meta.url),
  new URL('../dist/config.json', import.meta.url),
);
await cp(
  new URL('../renderer/index.html', import.meta.url),
  new URL('../dist/renderer/index.html', import.meta.url),
);
await cp(
  new URL('../renderer/styles.css', import.meta.url),
  new URL('../dist/renderer/styles.css', import.meta.url),
);
await cp(new URL('../assets/', import.meta.url), new URL('../dist/assets/', import.meta.url), {
  recursive: true,
});
await cp(
  new URL('../../../packages/engine/dist/client/core/media-devices/', import.meta.url),
  new URL('../dist/renderer/media-devices/', import.meta.url),
  { recursive: true },
);
