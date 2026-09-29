const { app, BrowserWindow, dialog, ipcMain, clipboard, shell, session, webFrameMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

let studioServer;
let studioBaseUrl = '';
let targetServer;
let targetBaseUrl = '';
let mainWindow;
const previewWindows = new Set();
const injectedFrames = new Set();
let editorPreviewProfile = { mode:'edit' };

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


function androidWebViewUserAgent(){
  const chrome=process.versions.chrome||'127.0.0.0';
  return 'Mozilla/5.0 (Linux; Android 16; SM-S918B Build/BP2A.250705.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/'+chrome+' Mobile Safari/537.36';
}

function androidRuntimeProfile(source, options){
  const opts=options||{};
  const label=String((source&&source.label)||'');
  const url=String((source&&source.url)||'');
  const radio=/radio-intelligente|radio intelligente|app\.local/i.test(label+' '+url);
  return {
    mode:'android',
    userAgent:androidWebViewUserAgent(),
    topInset:Math.max(0,Number(opts.topInset)||28),
    bottomInset:Math.max(0,Number(opts.bottomInset)||24),
    leftInset:Math.max(0,Number(opts.leftInset)||0),
    rightInset:Math.max(0,Number(opts.rightInset)||0),
    statusBarColor:opts.statusBarColor||(radio?'#6f42c1':'#111111'),
    navigationBarColor:opts.navigationBarColor||'#000000',
    backgroundColor:opts.backgroundColor||'#ffffff',
    mainActivity:{
      profile:radio?'radio-intelligente':'generic-webview',
      javaScriptEnabled:true,
      domStorageEnabled:true,
      databaseEnabled:true,
      allowFileAccess:true,
      allowContentAccess:true,
      mediaPlaybackRequiresUserGesture:false,
      loadWithOverviewMode:false,
      useWideViewPort:false,
      builtInZoomControls:false,
      displayZoomControls:false,
      mixedContentMode:'always-allow',
      overScrollMode:'never',
      externalMainFrameLinks:true,
      fileChooser:true
    }
  };
}

async function applyPreviewProfileToFrame(frame, profile){
  if(!frame)return false;
  const p=profile||{mode:'edit'};
  try{
    const payload=JSON.stringify(p);
    await frame.executeJavaScript(
      "(function(){"+
      "var p="+payload+";"+
      "window.__APP_INTERFACE_STUDIO_RUNTIME__=p;"+
      "window.__MAIN_ACTIVITY_PROFILE__=p.mainActivity||null;"+
      "if(!window.__AIS_ORIGINAL_UA__)window.__AIS_ORIGINAL_UA__=navigator.userAgent;"+
      "try{Object.defineProperty(navigator,'userAgent',{configurable:true,get:function(){return p.userAgent||window.__AIS_ORIGINAL_UA__;}});}catch(e){}"+
      "var old=document.getElementById('app-interface-runtime-style');if(old)old.remove();"+
      "if(p.mode==='preview'||p.mode==='android'){"+
      "var s=document.createElement('style');s.id='app-interface-runtime-style';"+
      "s.textContent='html{scrollbar-width:none!important;overscroll-behavior:none!important;}html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;}body{overscroll-behavior:none!important;}';"+
      "(document.head||document.documentElement).appendChild(s);"+
      "}"+
      "var root=document.documentElement;"+
      "root.style.setProperty('--ais-safe-top',(p.topInset||0)+'px');"+
      "root.style.setProperty('--ais-safe-right',(p.rightInset||0)+'px');"+
      "root.style.setProperty('--ais-safe-bottom',(p.bottomInset||0)+'px');"+
      "root.style.setProperty('--ais-safe-left',(p.leftInset||0)+'px');"+
      "})();"
    );
    return true;
  }catch(_){return false}
}

function editorAssets(){
  return {
    js:fs.readFileSync(path.join(webRoot(),'visual-editor.js'),'utf8'),
    css:fs.readFileSync(path.join(webRoot(),'visual-editor.css'),'utf8')
  };
}

async function injectEditorIntoFrame(frame){
  if(!frame || !mainWindow || frame === mainWindow.webContents.mainFrame)return false;
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
    await applyPreviewProfileToFrame(frame,editorPreviewProfile);
    injectedFrames.add(frame.routingId);
    return true;
  }catch(error){
    try{
      mainWindow.webContents.send('editor:inject-status',{
        ok:false,
        url:frame.url||'',
        error:String(error&&error.message||error)
      });
    }catch(_){}
    return false;
  }
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

async function injectIntoAllChildFrames(){
  if(!mainWindow)return 0;
  let frames=[];
  try{
    frames = mainWindow.webContents.mainFrame.frames || [];
  }catch(_){}
  let count=0;
  for(const frame of frames){
    if(await injectEditorIntoFrame(frame))count++;
  }
  return count;
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
  const windowIcon=app.isPackaged
    ? path.join(process.resourcesPath,'app-interface-studio-icon.png')
    : path.join(__dirname,'build','icon-512.png');

  mainWindow=new BrowserWindow({
    width:1520,
    height:1000,
    minWidth:1100,
    minHeight:720,
    backgroundColor:'#f3f0f7',
    title:'App Interface Studio',
    icon:windowIcon,
    autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      webSecurity:false,
      allowRunningInsecureContent:true,
      autoplayPolicy:'no-user-gesture-required'
    }
  });

  mainWindow.loadURL(studioBaseUrl+'/visual-editor.html?desktop=1');

  mainWindow.webContents.on('did-frame-finish-load',(_event,isMainFrame,frameProcessId,frameRoutingId)=>{
    if(isMainFrame)return;
    try{
      const frame=webFrameMain.fromId(frameProcessId,frameRoutingId);
      if(frame) injectEditorIntoFrame(frame);
    }catch(_){}
  });

  mainWindow.webContents.on('did-frame-navigate',(_event,_url,_httpResponseCode,_httpStatusText,isMainFrame,frameProcessId,frameRoutingId)=>{
    if(isMainFrame)return;
    try{
      const frame=webFrameMain.fromId(frameProcessId,frameRoutingId);
      if(frame) setTimeout(()=>injectEditorIntoFrame(frame),60);
    }catch(_){}
  });

  mainWindow.webContents.on('did-navigate-in-page',(_event,_url,isMainFrame,frameProcessId,frameRoutingId)=>{
    if(isMainFrame)return;
    try{
      const frame=webFrameMain.fromId(frameProcessId,frameRoutingId);
      if(frame) setTimeout(()=>injectEditorIntoFrame(frame),60);
    }catch(_){}
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url))shell.openExternal(url);
    return {action:'deny'};
  });
}


function openAsAppWindow(payload){
  const data=payload||{};
  const source=data.source||{};
  const target=normalizeUrl(source.url);
  if(!target)return {ok:false,error:'Aucune application valide à ouvrir.'};

  const width=Math.max(240,Math.round(Number(data.width)||412));
  const height=Math.max(320,Math.round(Number(data.height)||915));
  const android=!!data.androidExact;
  const profile=android
    ? androidRuntimeProfile(source,data.profile||{})
    : {
        mode:'preview',
        userAgent:null,
        topInset:Math.max(0,Number(data.profile&&data.profile.topInset)||0),
        rightInset:Math.max(0,Number(data.profile&&data.profile.rightInset)||0),
        bottomInset:Math.max(0,Number(data.profile&&data.profile.bottomInset)||0),
        leftInset:Math.max(0,Number(data.profile&&data.profile.leftInset)||0)
      };

  const runtimeUrl=new URL(studioBaseUrl+'/app-runtime.html');
  runtimeUrl.searchParams.set('target',target);
  runtimeUrl.searchParams.set('mode',android?'android':'preview');
  runtimeUrl.searchParams.set('top',String(profile.topInset||0));
  runtimeUrl.searchParams.set('bottom',String(profile.bottomInset||0));
  runtimeUrl.searchParams.set('left',String(profile.leftInset||0));
  runtimeUrl.searchParams.set('right',String(profile.rightInset||0));
  runtimeUrl.searchParams.set('status',profile.statusBarColor||'#111111');
  runtimeUrl.searchParams.set('nav',profile.navigationBarColor||'#000000');
  runtimeUrl.searchParams.set('background',profile.backgroundColor||'#ffffff');

  const win=new BrowserWindow({
    width,
    height,
    useContentSize:true,
    frame:false,
    resizable:false,
    maximizable:false,
    fullscreenable:true,
    backgroundColor:profile.backgroundColor||'#000000',
    title:(source.label||'Application')+' — aperçu',
    autoHideMenuBar:true,
    webPreferences:{
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      webSecurity:false,
      allowRunningInsecureContent:true,
      autoplayPolicy:'no-user-gesture-required',
      backgroundThrottling:false
    }
  });
  previewWindows.add(win);
  if(profile.userAgent)win.webContents.setUserAgent(profile.userAgent);

  win.webContents.on('before-input-event',(event,input)=>{
    if(input.key==='Escape'){
      event.preventDefault();
      win.close();
    }
  });
  win.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url))shell.openExternal(url);
    return {action:'deny'};
  });
  win.webContents.on('did-frame-finish-load',(_event,isMainFrame,processId,routingId)=>{
    if(isMainFrame)return;
    try{
      const frame=webFrameMain.fromId(processId,routingId);
      if(frame)applyPreviewProfileToFrame(frame,profile);
    }catch(_){}
  });
  win.on('closed',()=>previewWindows.delete(win));
  win.loadURL(runtimeUrl.href);
  return {ok:true,width,height,androidExact:android};
}

ipcMain.handle('preview:set-mode',async (_event,payload)=>{
  const mode=String(payload&&payload.mode||'edit');
  if(mode==='android')editorPreviewProfile=androidRuntimeProfile(payload&&payload.source,payload&&payload.profile);
  else editorPreviewProfile={
    mode:mode==='preview'?'preview':'edit',
    userAgent:null,
    topInset:Math.max(0,Number(payload&&payload.profile&&payload.profile.topInset)||0),
    rightInset:Math.max(0,Number(payload&&payload.profile&&payload.profile.rightInset)||0),
    bottomInset:Math.max(0,Number(payload&&payload.profile&&payload.profile.bottomInset)||0),
    leftInset:Math.max(0,Number(payload&&payload.profile&&payload.profile.leftInset)||0)
  };
  let frames=[];
  try{frames=mainWindow?mainWindow.webContents.mainFrame.frames||[]:[]}catch(_){}
  for(const frame of frames)await applyPreviewProfileToFrame(frame,editorPreviewProfile);
  return {ok:true,profile:editorPreviewProfile};
});

ipcMain.handle('preview:open-app',async (_event,payload)=>{
  try{return openAsAppWindow(payload)}catch(error){return {ok:false,error:String(error&&error.message||error)}}
});

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

ipcMain.handle('source:inject-editor',async ()=>{
  const count=await injectIntoAllChildFrames();
  return {ok:count>0,count};
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
