const { app, BrowserWindow, dialog, ipcMain, clipboard, shell, session, webFrameMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

let studioServer;
let studioBaseUrl = '';
let targetServer;
let targetBaseUrl = '';
let mainWindow;

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.gif':'image/gif',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon',
  '.wav':'audio/wav',
  '.mp3':'audio/mpeg',
  '.mp4':'video/mp4',
  '.webm':'video/webm',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.ttf':'font/ttf',
  '.otf':'font/otf',
  '.wasm':'application/wasm'
};

function webRoot(){
  return app.isPackaged ? path.join(process.resourcesPath, 'webapp') : path.resolve(__dirname, '..');
}

function safeFile(root, pathname){
  const rootResolved=path.resolve(root);
  const candidate=path.resolve(rootResolved,'.'+pathname);
  if(candidate!==rootResolved && !candidate.startsWith(rootResolved+path.sep)) return null;
  return candidate;
}

function serveStatic(root){
  return http.createServer((req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      let pathname=decodeURIComponent(url.pathname);
      if(pathname==='/' || pathname==='') pathname='/index.html';
      let file=safeFile(root,pathname);
      if(!file){res.statusCode=403;res.end('Forbidden');return}
      try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html')}catch(_){}
      if(!fs.existsSync(file)){res.statusCode=404;res.end('Not found');return}
      const ext=path.extname(file).toLowerCase();
      res.statusCode=200;
      res.setHeader('content-type',MIME[ext]||'application/octet-stream');
      res.setHeader('cache-control','no-store');
      fs.createReadStream(file).pipe(res);
    }catch(error){
      res.statusCode=500;
      res.end(String(error&&error.message||error));
    }
  });
}

function listen(server){
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      resolve('http://127.0.0.1:'+address.port);
    });
  });
}

async function startStudioServer(){
  studioServer=serveStatic(webRoot());
  studioBaseUrl=await listen(studioServer);
  return studioBaseUrl;
}

async function stopTargetServer(){
  if(!targetServer)return;
  await new Promise(resolve=>targetServer.close(()=>resolve()));
  targetServer=null;
  targetBaseUrl='';
}

async function startLocalTarget(root, entry){
  await stopTargetServer();
  targetServer=serveStatic(root);
  targetBaseUrl=await listen(targetServer);
  const cleanEntry=String(entry||'index.html').replace(/\\/g,'/').replace(/^\/+/,'');
  return targetBaseUrl+'/'+cleanEntry.split('/').map(encodeURIComponent).join('/');
}

function normalizeUrl(value){
  let input=String(value||'').trim();
  if(!input)return null;
  if(!/^[a-z]+:\/\//i.test(input))input='https://'+input;
  try{
    const url=new URL(input);
    if(url.protocol!=='http:'&&url.protocol!=='https:')return null;
    return url.href;
  }catch(_){return null}
}

function editorAssets(){
  return {
    js:fs.readFileSync(path.join(webRoot(),'visual-editor.js'),'utf8'),
    css:fs.readFileSync(path.join(webRoot(),'visual-editor.css'),'utf8')
  };
}

async function injectEditorIntoFrame(frame){
  if(!frame || frame === mainWindow.webContents.mainFrame)return;
  try{
    const assets=editorAssets();
    const cssJson=JSON.stringify(assets.css);
    await frame.executeJavaScript(
      "(function(){"+
      "window.__APP_INTERFACE_STUDIO_HOSTED__=true;"+
      "if(!document.getElementById('app-interface-studio-css')){"+
      "var s=document.createElement('style');s.id='app-interface-studio-css';s.textContent="+cssJson+";(document.head||document.documentElement).appendChild(s);"+
      "}"+
      "})();"
    );
    await frame.executeJavaScript(assets.js);
  }catch(_){}
}

function configureEmbedding(){
  const ses=session.defaultSession;
  ses.webRequest.onHeadersReceived((details,callback)=>{
    const headers={...(details.responseHeaders||{})};
    Object.keys(headers).forEach(key=>{
      const lower=key.toLowerCase();
      if(lower==='x-frame-options' || lower==='content-security-policy' || lower==='content-security-policy-report-only'){
        delete headers[key];
      }
    });
    callback({cancel:false,responseHeaders:headers});
  });
}

function projectPrompt(project){
  const source=project&&project.source ? project.source : {};
  const sourceLabel=source.label||source.url||source.path||'application';
  return [
    'Projet d’interface pour : '+sourceLabel,
    '',
    'Ce fichier a été exporté depuis App Interface Studio.',
    'Applique les modifications proprement dans le code source de l’application correspondante. N’empile pas des rustines CSS : reporte les valeurs dans les règles structurelles pertinentes. Préserve le responsive et les espaces volontaires. Les éléments masqués dans le projet doivent conserver leur espace sauf indication contraire.',
    '',
    'Source ouverte dans l’éditeur :',
    JSON.stringify(source,null,2),
    '',
    'Données exactes du projet :',
    JSON.stringify(project,null,2)
  ].join('\n');
}

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1520,
    height:1000,
    minWidth:1100,
    minHeight:720,
    backgroundColor:'#f3f0f7',
    title:'App Interface Studio',
    autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      webSecurity:false,
      allowRunningInsecureContent:true
    }
  });

  mainWindow.loadURL(studioBaseUrl+'/visual-editor.html?desktop=1');

  mainWindow.webContents.on('did-frame-finish-load',(_event,isMainFrame,frameProcessId,frameRoutingId)=>{
    if(isMainFrame)return;
    try{
      const frame=webFrameMain.fromId(frameProcessId,frameRoutingId);
      if(frame && frame.parent === mainWindow.webContents.mainFrame) injectEditorIntoFrame(frame);
    }catch(_){}
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url))shell.openExternal(url);
    return {action:'deny'};
  });
}

ipcMain.handle('source:open-url',async (_event,value)=>{
  const url=normalizeUrl(value);
  if(!url)return {ok:false,error:'Adresse invalide. Utilise une URL http:// ou https://.'};
  await stopTargetServer();
  return {ok:true,source:{type:'url',url,label:new URL(url).hostname}};
});

ipcMain.handle('source:pick-folder',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Choisir le dossier de l’application',
    properties:['openDirectory']
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  const root=result.filePaths[0];
  const candidates=['index.html','index.htm','dist/index.html','build/index.html','www/index.html','public/index.html'];
  const entry=candidates.find(name=>fs.existsSync(path.join(root,name)));
  if(!entry)return {ok:false,error:'Aucun index.html trouvé dans ce dossier (racine, dist, build, www ou public).'};
  const url=await startLocalTarget(root,entry);
  return {ok:true,source:{type:'folder',path:root,entry,url,label:path.basename(root)}};
});

ipcMain.handle('source:pick-html',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Choisir le fichier HTML principal',
    properties:['openFile'],
    filters:[{name:'Application HTML',extensions:['html','htm']}]
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  const file=result.filePaths[0];
  const root=path.dirname(file);
  const entry=path.basename(file);
  const url=await startLocalTarget(root,entry);
  return {ok:true,source:{type:'html',path:file,root,entry,url,label:path.basename(file)}};
});

ipcMain.handle('source:open-demo',async ()=>{
  const root=webRoot();
  const url=await startLocalTarget(root,'index.html');
  return {ok:true,source:{type:'bundled-demo',entry:'index.html',url,label:'Radio intelligente — démo'}};
});

ipcMain.handle('source:restore',async (_event,source)=>{
  try{
    if(!source||!source.type)return {ok:false,error:'Source de projet manquante.'};
    if(source.type==='url'){
      const url=normalizeUrl(source.url);
      if(!url)return {ok:false,error:'URL du projet invalide.'};
      await stopTargetServer();
      return {ok:true,source:{...source,url}};
    }
    if(source.type==='folder'){
      if(!source.path||!fs.existsSync(source.path))return {ok:false,error:'Le dossier source du projet est introuvable.'};
      const url=await startLocalTarget(source.path,source.entry||'index.html');
      return {ok:true,source:{...source,url}};
    }
    if(source.type==='html'){
      const file=source.path;
      if(!file||!fs.existsSync(file))return {ok:false,error:'Le fichier HTML source du projet est introuvable.'};
      const root=source.root||path.dirname(file);
      const url=await startLocalTarget(root,source.entry||path.basename(file));
      return {ok:true,source:{...source,root,url}};
    }
    if(source.type==='bundled-demo'){
      const url=await startLocalTarget(webRoot(),'index.html');
      return {ok:true,source:{...source,url}};
    }
    return {ok:false,error:'Type de source non pris en charge.'};
  }catch(error){
    return {ok:false,error:String(error&&error.message||error)};
  }
});

ipcMain.handle('layout:save-project',async (_event,project)=>{
  const result=await dialog.showSaveDialog({
    title:'Enregistrer le projet d’interface',
    defaultPath:'interface.app-layout.json',
    filters:[{name:'Projet App Interface Studio',extensions:['json']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled||!result.filePath)return {ok:false,canceled:true};
  fs.writeFileSync(result.filePath,JSON.stringify(project,null,2),'utf8');
  return {ok:true,path:result.filePath};
});

ipcMain.handle('layout:open-project',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Ouvrir un projet d’interface',
    properties:['openFile'],
    filters:[{name:'Projet App Interface Studio',extensions:['json']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  try{
    const project=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'));
    return {ok:true,path:result.filePaths[0],project};
  }catch(error){
    return {ok:false,error:'Fichier de projet invalide : '+String(error&&error.message||error)};
  }
});

ipcMain.handle('layout:save-chatgpt',async (_event,payload)=>{
  const project=payload&&payload.project?payload.project:payload;
  const text=(payload&&payload.text)||projectPrompt(project);
  const result=await dialog.showSaveDialog({
    title:'Exporter pour ChatGPT',
    defaultPath:'interface-pour-chatgpt.txt',
    filters:[{name:'Texte pour ChatGPT',extensions:['txt']},{name:'Markdown',extensions:['md']}]
  });
  if(result.canceled||!result.filePath)return {ok:false,canceled:true};
  fs.writeFileSync(result.filePath,text,'utf8');
  return {ok:true,path:result.filePath,text};
});

ipcMain.handle('layout:copy-text',(_event,text)=>{
  clipboard.writeText(String(text||''));
  return {ok:true};
});

ipcMain.handle('layout:app-info',()=>({
  name:'App Interface Studio',
  version:app.getVersion(),
  packaged:app.isPackaged
}));

app.whenReady().then(async ()=>{
  configureEmbedding();
  await startStudioServer();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});

app.on('window-all-closed',async ()=>{
  if(targetServer)targetServer.close();
  if(studioServer)studioServer.close();
  if(process.platform!=='darwin')app.quit();
});
