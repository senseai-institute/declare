// Inline the demo build into one self-contained HTML page.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = 'dist/demo/assets';
const files = readdirSync(dir);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n').replace(/<\/script/gi, '<\\/script');
const page = `<title>Declare</title>
<meta name="theme-color" content="#0b3d2e">
<style>:root{color-scheme:dark;background:#062a1f}
${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync('dist/demo/declare.html', page);
console.log(`dist/demo/declare.html ${(page.length / 1024).toFixed(0)} KB`);
