const fs = require('fs');
const path = require('path');
const { parse, compileScript, compileTemplate } = require('E:/AI/wygl/node_modules/@vue/compiler-sfc');

const dir = path.join(__dirname, '..', 'src', 'components');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.vue'));
let allOk = true;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const { descriptor, errors } = parse(src, { filename: f });
  if (errors.length) { console.log(f, 'PARSE FAIL', errors.map(e => e.message)); allOk = false; continue; }
  try {
    if (descriptor.script || descriptor.scriptSetup) {
      compileScript(descriptor, { id: f });
    }
    if (descriptor.template) {
      const r = compileTemplate({ source: descriptor.template.content, filename: f, id: f });
      if (r.errors.length) { console.log(f, 'TEMPLATE FAIL', r.errors.map(String)); allOk = false; continue; }
    }
    console.log(f, 'OK');
  } catch (e) { console.log(f, 'COMPILE FAIL', e.message); allOk = false; }
}
console.log(allOk ? 'ALL SFC OK' : 'SFC ERRORS');
process.exit(allOk ? 0 : 1);
