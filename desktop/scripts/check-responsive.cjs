const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..','..');
const html=fs.readFileSync(path.join(root,'visual-editor.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'visual-editor.js'),'utf8');

function expect(text,needle,label){
  if(!text.includes(needle))throw new Error('Missing '+label+': '+needle);
}

expect(html,'id="responsiveEnabled"','responsive toggle');
expect(html,'id="safeProfile"','safe-area profile');
expect(html,'id="safeOutline"','safe-area overlay');
expect(html,"post('responsive-set'","responsive host command");
expect(html,"post('responsive-capture'","responsive capture command");
expect(engine,"data.type === 'responsive-set'","responsive engine command");
expect(engine,"data.type === 'safe-area'","safe-area engine command");
expect(engine,"function reflowResponsive()","responsive reflow");
expect(engine,"version: 2","project format v2");

const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
if(!blocks.length)throw new Error('No inline script found in visual-editor.html');
for(const block of blocks)new Function(block);

console.log('Responsive editor checks passed.');
