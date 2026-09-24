import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())walk(p);else files.push(p);}}
walk(path.join(root,'js'));walk(path.join(root,'scripts'));
for(const file of files.filter(p=>/\.(js|mjs)$/.test(p))){
 execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
 const text=fs.readFileSync(file,'utf8');
 for(const match of text.matchAll(/(?:from\s+|new URL\()['"]([^'"]+)['"]/g)){
  const rel=match[1];if(!rel.startsWith('.'))continue;
  if(!fs.existsSync(path.resolve(path.dirname(file),rel)))throw Error(`Missing local import/resource: ${file}: ${rel}`);
 }
 if(/https?:\/\/(?:cdn|unpkg|esm\.sh)/.test(text))throw Error(`Unexpected remote dependency in ${file}`);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))if(!fs.existsSync(path.join(root,m[1])))throw Error(`Missing entry asset: ${m[1]}`);
if(!html.includes('Content-Security-Policy'))throw Error('Missing CSP');
for(const name of ['README.md','LICENSE','default.json','.nojekyll','docs/index.html'])if(!fs.existsSync(path.join(root,name)))throw Error(`Missing ${name}`);
JSON.parse(fs.readFileSync(path.join(root,'default.json'),'utf8'));
console.log(`Checked syntax and relative imports in ${files.filter(p=>/\.(js|mjs)$/.test(p)).length} modules; entry assets, CSP, and required files OK.`);
