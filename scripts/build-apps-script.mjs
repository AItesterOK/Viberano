import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const webDir = join(root, 'dist', 'web');
const serverSource = join(root, 'src', 'apps-script');
const output = join(root, 'dist', 'apps-script');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

let html = await readFile(join(webDir, 'index.html'), 'utf8');
try {
  const logo = await readFile(join(root, 'public', 'reparapro-logo.jpg'));
  html = html.replaceAll('/reparapro-logo.jpg', `data:image/jpeg;base64,${logo.toString('base64')}`);
} catch {
  // The app remains usable if the official asset has not yet been copied.
}
await writeFile(join(output, 'Index.html'), html, 'utf8');

for (const name of await readdir(serverSource)) {
  if (!['.js', '.json'].includes(extname(name))) continue;
  await writeFile(join(output, name), await readFile(join(serverSource, name)));
}

console.log(`Apps Script bundle ready at ${output}`);
