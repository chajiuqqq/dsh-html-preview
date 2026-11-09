import fs from 'node:fs';
const source = fs.readFileSync(new URL('./client-source.js', import.meta.url), 'utf8');
const library = fs.readFileSync(new URL('./node_modules/html2canvas/dist/html2canvas.min.js', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./client.js', import.meta.url), source.replace('    const React =', `    const captureLibrary = ${JSON.stringify(library)};\n    const React =`));
