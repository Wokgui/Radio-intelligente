const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..','..');
const html=fs.readFileSync(path.join(root,'visual-editor.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'visual-editor.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'app-runtime.html'),'utf8');
const main=fs.readFileSync(path.join(root,'desktop','main.cjs'),'utf8');
const preload=fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');

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
expect(engine,"const selectedSet = new Set()","multi selection state");
expect(engine,"function measurementCandidates()","edge spacing measurement");
expect(engine,"function moveResponsiveState","relative movement");
expect(html,'id="settingsBtn"','settings button');
expect(html,'id="uiFontScale"','interface font scale');
expect(html,"function initializeCards()","collapsible right panels");
expect(html,"Maj+clic","multi selection help");
expect(html,'data-preview-mode="edit"','edit mode');
expect(html,'data-preview-mode="preview"','fullscreen preview mode');
expect(html,'data-preview-mode="android"','android exact mode');
expect(html,'id="openAsAppBtn"','open as app button');
expect(html,'data-device-kind="smartphone"','initial smartphone choice');
expect(html,'data-device-kind="tablet"','initial tablet choice');
expect(html,'data-device-kind="tv"','initial tv choice');
expect(html,'data-device-kind="custom"','initial custom choice');
expect(main,"preview:set-mode","desktop preview mode IPC");
expect(main,"preview:open-app","desktop app window IPC");
expect(main,"androidWebViewUserAgent","android webview user-agent");
expect(preload,"setPreviewMode","preview mode preload bridge");
expect(preload,"openAsApp","open app preload bridge");
expect(runtime,'id="content"','frameless runtime iframe');
expect(engine,"version: 2","project format v2");

const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
if(!blocks.length)throw new Error('No inline script found in visual-editor.html');
for(const block of blocks)new Function(block);
const runtimeBlocks=[...runtime.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
for(const block of runtimeBlocks)new Function(block);

console.log('Responsive and preview-mode editor checks passed.');
