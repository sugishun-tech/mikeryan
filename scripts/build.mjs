import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(dist,{recursive:true});
// Only public application assets: no test signers, fixtures, or tooling in the deploy artifact.
for(const item of ['index.html','.nojekyll','default.json','assets','js','docs','LICENSE','THIRD_PARTY_NOTICES.md'])fs.cpSync(path.join(root,item),path.join(dist,item),{recursive:true});
console.log('Static site created in dist/. No npm install, bundler, CDN, or server component required.');
