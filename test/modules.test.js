'use strict';
// Los módulos del front (public/js) se cargan en el navegador sin empaquetador: un import que no exista o un nombre
// compartido sin importar solo falla al abrir esa pantalla. Esta prueba lo comprueba sin navegador.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const files = Object.fromEntries(fs.readdirSync(DIR).filter(f => f.endsWith('.js')).map(f => [f.slice(0, -3), fs.readFileSync(path.join(DIR, f), 'utf8')]));
const exported = m => new Set([...files[m].matchAll(/^export (?:async function|function|const|let)\s+([\w$]+)/gm)].map(x => x[1]));
const importsOf = t => [...t.matchAll(/import \{([^}]*)\} from '\.\/(?:js\/)?(\w+)\.js'/g)].map(x => ({ names: x[1].split(',').map(s => s.trim()).filter(Boolean), mod: x[2] }));

test('front: cada import apunta a un módulo y a un nombre exportado', () => {
  const entry = fs.readFileSync(path.join(DIR, '..', 'app.js'), 'utf8');
  for (const [m, t] of [...Object.entries(files), ['app', entry]]) {
    for (const { names, mod } of importsOf(t)) {
      assert.ok(files[mod], `${m}: importa de un módulo que no existe (${mod})`);
      const ex = exported(mod);
      for (const n of names) assert.ok(ex.has(n), `${m}: importa «${n}», que ${mod} no exporta`);
    }
  }
});

test('front: ningún módulo usa un nombre de otro sin importarlo', () => {
  const declared = {};
  for (const m of Object.keys(files)) for (const x of files[m].matchAll(/^(?:export )?(?:async function|function|const|let)\s+([\w$]+)/gm)) declared[x[1]] = m;
  for (const [m, t] of Object.entries(files)) {
    const have = new Set(importsOf(t).flatMap(i => i.names));
    const code = t.replace(/^\s*\/\/.*$/gm, '').replace(/https?:\/\/[^"'`\s]+/g, 'URL');
    for (const [n, owner] of Object.entries(declared)) {
      if (owner === m || have.has(n)) continue;
      if (new RegExp(`\\b(?:const|let|var|function)\\s+${n.replace(/\$/g, '\\$')}\\b`).test(code)) continue;       // declarada en local
      if (n === 'rel' && !/(?<![\w$.])rel\(/.test(code)) continue;                                              // `rel="noopener"` es HTML
      const used = new RegExp(`(?:(?<![\\w$.])|(?<=\\.\\.\\.))${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(code);
      assert.ok(!used, `${m} usa «${n}» (de ${owner}) sin importarlo`);
    }
  }
});

test('front: la página carga app.js como módulo', () => {
  const html = fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
});
