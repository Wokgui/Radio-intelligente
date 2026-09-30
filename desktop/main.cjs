const { app, BrowserWindow, dialog, ipcMain, clipboard, shell, session, webFrameMain, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const smokeMode=process.env.AIS_SMOKE_TEST==='1';
if(smokeMode)app.disableHardwareAcceleration();

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

async function closeHttpServer(server){
  if(!server)return;
  await new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;resolve()};
    const timer=setTimeout(finish,1200);
    if(timer&&timer.unref)timer.unref();
    try{
      server.close(finish);
      if(typeof server.closeIdleConnections==='function')server.closeIdleConnections();
      if(typeof server.closeAllConnections==='function')server.closeAllConnections();
    }catch(_){finish()}
  });
}

async function stopTargetServer(){
  const server=targetServer;
  targetServer=null;
  targetBaseUrl='';
  await closeHttpServer(server);
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
  const numberOr=(value,fallback)=>{
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  };
  let homeOrigin='';
  try{homeOrigin=new URL(url).origin}catch(_){}
  return {
    mode:'android',
    userAgent:androidWebViewUserAgent(),
    homeOrigin,
    topInset:Math.max(0,numberOr(opts.topInset,28)),
    bottomInset:Math.max(0,numberOr(opts.bottomInset,24)),
    leftInset:Math.max(0,numberOr(opts.leftInset,0)),
    rightInset:Math.max(0,numberOr(opts.rightInset,0)),
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
      "if(p.mode==='android'&&p.mainActivity&&p.mainActivity.externalMainFrameLinks&&!window.__AIS_EXTERNAL_LINKS__){"+
      "window.__AIS_EXTERNAL_LINKS__=true;"+
      "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;try{var u=new URL(a.href,location.href);if(p.homeOrigin&&u.origin!==p.homeOrigin&&/^https?:$/.test(u.protocol)){e.preventDefault();window.open(u.href,'_blank');}}catch(_){}},true);"+
      "}"+
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
  ses.webRequest.onBeforeSendHeaders((details,callback)=>{
    const headers={...(details.requestHeaders||{})};
    const editorAndroid=mainWindow&&editorPreviewProfile&&editorPreviewProfile.mode==='android'&&
      details.webContentsId===mainWindow.webContents.id&&
      (!studioBaseUrl||!String(details.url||'').startsWith(studioBaseUrl));
    if(editorAndroid)headers['User-Agent']=editorPreviewProfile.userAgent||androidWebViewUserAgent();
    callback({cancel:false,requestHeaders:headers});
  });
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
    show:!smokeMode,
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

  if(smokeMode){
    mainWindow.webContents.once('did-finish-load',async ()=>{
      try{
        const result=await mainWindow.webContents.executeJavaScript(`
          (async function(){
            const api=window.AppInterfaceStudio;
            const required=['sourceName','mediaCard','versionList','svgTintControls','assetAuditList','appFrame'];
            const missing=required.filter(function(id){return !document.getElementById(id)});
            if(!api||api.isDesktop!==true)return {ok:false,error:'Bridge desktop indisponible',missing:missing};
            if(missing.length)return {ok:false,error:'Éléments UI manquants',missing:missing};
            const info=await api.appInfo();
            const demo=await api.openDemo();
            if(!demo||!demo.ok||!demo.source)return {ok:false,error:'Ouverture de la démo impossible',demo:demo};
            const shot=await api.captureCurrentSource({source:demo.source,width:360,height:800,css:'/* smoke test */'});
            const captureOk=!!(shot&&shot.ok&&typeof shot.dataUrl==='string'&&shot.dataUrl.indexOf('data:image/png')===0);
            const roundtrip=await api.smokeTransactionRoundtrip();
            return {
              ok:!!(info&&info.name==='App Interface Studio'&&captureOk&&roundtrip&&roundtrip.ok),
              version:info&&info.version,
              bridge:true,
              ui:true,
              demoUrl:demo.source.url,
              captureOk:captureOk,
              captureSize:shot&&shot.width+'x'+shot.height,
              transactionRoundtrip:roundtrip
            };
          })()
        `,true);
        if(!result||!result.ok)throw new Error('Smoke test renderer échoué : '+JSON.stringify(result));
        console.log('AIS_SMOKE_OK '+JSON.stringify(result));
        setTimeout(()=>app.exit(0),80);
      }catch(error){
        console.error('AIS_SMOKE_FAIL '+String(error&&error.stack||error));
        setTimeout(()=>app.exit(1),80);
      }
    });
  }

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


function findAdb(){
  const candidates=[];
  const home=os.homedir();
  if(process.env.ANDROID_HOME)candidates.push(path.join(process.env.ANDROID_HOME,'platform-tools',process.platform==='win32'?'adb.exe':'adb'));
  if(process.env.ANDROID_SDK_ROOT)candidates.push(path.join(process.env.ANDROID_SDK_ROOT,'platform-tools',process.platform==='win32'?'adb.exe':'adb'));
  if(process.platform==='win32')candidates.push(path.join(home,'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
  for(const candidate of candidates){if(candidate&&fs.existsSync(candidate))return candidate}
  try{
    const finder=process.platform==='win32'?'where.exe':'which';
    const value=execFileSync(finder,['adb'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).find(Boolean);
    if(value&&fs.existsSync(value.trim()))return value.trim();
  }catch(_){}
  return null;
}

function adbDevices(){
  const adb=findAdb();
  if(!adb)return {ok:false,error:'ADB introuvable. Installe Android Platform Tools ou Android Studio.',devices:[]};
  try{
    const output=execFileSync(adb,['devices'],{encoding:'utf8',windowsHide:true,timeout:5000});
    const devices=output.split(/\r?\n/).slice(1).map(line=>line.trim().split(/\s+/)).filter(parts=>parts[0]&&parts[1]==='device').map(parts=>parts[0]);
    return {ok:true,adb,devices};
  }catch(error){return {ok:false,error:String(error&&error.message||error),devices:[]}}
}

ipcMain.handle('adb:status',async ()=>{
  const result=adbDevices();
  return {ok:result.ok,devices:result.devices,error:result.error||null};
});

ipcMain.handle('adb:screenshot',async (_event,payload)=>{
  const status=adbDevices();
  if(!status.ok)return status;
  if(!status.devices.length)return {ok:false,error:'Aucun appareil Android autorisé par ADB.'};
  const serial=String(payload&&payload.serial||status.devices[0]);
  if(status.devices.indexOf(serial)<0)return {ok:false,error:'Appareil ADB introuvable.'};
  try{
    const png=execFileSync(status.adb,['-s',serial,'exec-out','screencap','-p'],{encoding:null,windowsHide:true,timeout:10000,maxBuffer:30*1024*1024});
    return {ok:true,serial,dataUrl:'data:image/png;base64,'+Buffer.from(png).toString('base64')};
  }catch(error){return {ok:false,error:'Capture ADB impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('reference:pick-image',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Choisir une capture de référence',
    properties:['openFile'],
    filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  const file=result.filePaths[0];
  try{
    const ext=path.extname(file).toLowerCase();
    const mime=ext==='.jpg'||ext==='.jpeg'?'image/jpeg':ext==='.webp'?'image/webp':'image/png';
    return {ok:true,path:file,dataUrl:'data:'+mime+';base64,'+fs.readFileSync(file).toString('base64')};
  }catch(error){return {ok:false,error:String(error&&error.message||error)}}
});

ipcMain.handle('asset:pick-image',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Choisir une image ou une icône',
    properties:['openFile'],
    filters:[{name:'Images et icônes',extensions:['png','jpg','jpeg','webp','gif','svg','avif']}]
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  const file=result.filePaths[0];
  try{
    const stat=fs.statSync(file);
    if(stat.size>24*1024*1024)return {ok:false,error:'Image trop volumineuse (24 Mo maximum).'};
    const ext=path.extname(file).toLowerCase();
    const mime=ext==='.jpg'||ext==='.jpeg'?'image/jpeg':
      ext==='.webp'?'image/webp':
      ext==='.gif'?'image/gif':
      ext==='.svg'?'image/svg+xml':
      ext==='.avif'?'image/avif':'image/png';
    const bytes=fs.readFileSync(file);
    return {ok:true,path:file,name:path.basename(file),size:stat.size,mime,dataUrl:'data:'+mime+';base64,'+bytes.toString('base64')};
  }catch(error){return {ok:false,error:'Lecture de l’image impossible : '+String(error&&error.message||error)}}
});

function mediaMime(file){
  const ext=path.extname(file).toLowerCase();
  return ext==='.jpg'||ext==='.jpeg'?'image/jpeg':
    ext==='.webp'?'image/webp':
    ext==='.gif'?'image/gif':
    ext==='.svg'?'image/svg+xml':
    ext==='.avif'?'image/avif':'image/png';
}

ipcMain.handle('asset:load-image',async (_event,payload)=>{
  const file=path.resolve(String(payload&&payload.path||''));
  if(!file||!fs.existsSync(file))return {ok:false,error:'Asset introuvable.'};
  try{
    const stat=fs.statSync(file);
    if(!stat.isFile())return {ok:false,error:'Asset invalide.'};
    if(stat.size>24*1024*1024)return {ok:false,error:'Image trop volumineuse (24 Mo maximum).'};
    const ext=path.extname(file).toLowerCase();
    if(!/^\.(png|jpe?g|webp|gif|svg|avif)$/i.test(ext))return {ok:false,error:'Format d’image non pris en charge.'};
    return {ok:true,path:file,name:path.basename(file),size:stat.size,mime:mediaMime(file),dataUrl:'data:'+mediaMime(file)+';base64,'+fs.readFileSync(file).toString('base64')};
  }catch(error){return {ok:false,error:'Lecture de l’asset impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('asset:thumbnail',async (_event,payload)=>{
  const file=path.resolve(String(payload&&payload.path||''));
  if(!file||!fs.existsSync(file))return {ok:false,error:'Asset introuvable.'};
  try{
    const stat=fs.statSync(file);
    const ext=path.extname(file).toLowerCase();
    if(!stat.isFile()||!/^\.(png|jpe?g|webp|gif|svg|avif)$/i.test(ext))return {ok:false,error:'Asset invalide.'};
    if(stat.size>24*1024*1024)return {ok:false,error:'Image trop volumineuse.'};
    if(ext==='.svg'){
      return {ok:true,path:file,dataUrl:'data:image/svg+xml;base64,'+fs.readFileSync(file).toString('base64')};
    }
    const image=nativeImage.createFromPath(file);
    if(image&&!image.isEmpty()){
      const size=image.getSize();
      const scale=Math.min(1,96/Math.max(1,size.width),96/Math.max(1,size.height));
      const width=Math.max(1,Math.round(size.width*scale)),height=Math.max(1,Math.round(size.height*scale));
      return {ok:true,path:file,dataUrl:image.resize({width,height,quality:'best'}).toDataURL()};
    }
    return {ok:true,path:file,dataUrl:'data:'+mediaMime(file)+';base64,'+fs.readFileSync(file).toString('base64')};
  }catch(error){return {ok:false,error:'Miniature impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('asset:stage-data',async (_event,payload)=>{
  try{
    const name=path.basename(String(payload&&payload.name||'image')).replace(/[^a-zA-Z0-9._-]+/g,'-');
    const ext=path.extname(name).toLowerCase();
    if(!/^\.(png|jpe?g|webp|gif|svg|avif)$/i.test(ext))return {ok:false,error:'Format d’image non pris en charge.'};
    const dataUrl=String(payload&&payload.dataUrl||'');
    const match=/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|avif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if(!match)return {ok:false,error:'Données d’image invalides.'};
    const bytes=Buffer.from(match[2],'base64');
    if(!bytes.length||bytes.length>24*1024*1024)return {ok:false,error:'Image vide ou supérieure à 24 Mo.'};
    const hash=crypto.createHash('sha1').update(bytes).digest('hex').slice(0,16);
    const base=path.basename(name,ext).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'asset';
    const dir=path.join(app.getPath('temp'),'app-interface-studio-staged-assets');
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,base+'-'+hash+ext);
    if(!fs.existsSync(file))fs.writeFileSync(file,bytes);
    return {ok:true,path:file,name:path.basename(file),size:bytes.length,dataUrl};
  }catch(error){return {ok:false,error:'Import par glisser-déposer impossible : '+String(error&&error.message||error)}}
});

function localSourceEntry(source){
  if(!source)return null;
  if(source.type==='folder'&&source.path){
    const entry=source.entry||'index.html';
    return {root:source.path,html:path.join(source.path,entry)};
  }
  if(source.type==='html'&&source.path){
    return {root:source.root||path.dirname(source.path),html:source.path};
  }
  return null;
}

function sourceLocatorKey(selector){
  return 's-'+crypto.createHash('sha1').update(String(selector||'')).digest('hex').slice(0,14);
}

function buildSourceLocators(selectors,nodes,patches,prototypeLinks){
  const all=[];
  (Array.isArray(selectors)?selectors:[]).forEach(selector=>all.push(String(selector||'')));
  (Array.isArray(nodes)?nodes:[]).forEach(item=>{if(item&&item.parentSelector)all.push(String(item.parentSelector))});
  (Array.isArray(patches)?patches:[]).forEach(item=>{if(item&&item.selector)all.push(String(item.selector))});
  const links=prototypeLinks&&typeof prototypeLinks==='object'?prototypeLinks:{};
  Object.keys(links).forEach(sourceSelector=>{
    all.push(String(sourceSelector||''));
    if(links[sourceSelector]&&links[sourceSelector].target)all.push(String(links[sourceSelector].target));
  });
  return Array.from(new Set(all.filter(selector=>
    selector&&selector!==':root'&&!selector.startsWith('[data-ais-clone-id=')
  ))).map(selector=>({selector,key:sourceLocatorKey(selector)}));
}

function rewriteGeneratedCss(css,locators){
  let output=String(css||'');
  const sorted=(Array.isArray(locators)?locators:[]).slice().sort((a,b)=>b.selector.length-a.selector.length);
  sorted.forEach(item=>{
    const source=item.selector+' {';
    const target='[data-ais-source-key="'+item.key+'"] {';
    output=output.split(source).join(target);
  });
  return output;
}

function generatedStructureScript(nodes,patches,locators,prototypeLinks){
  const locatorList=Array.isArray(locators)?locators:[];
  const keyBySelector=new Map(locatorList.map(item=>[String(item.selector||''),String(item.key||'')]));

  const cleanLocators=locatorList.map(item=>({
    selector:String(item&&item.selector||''),
    key:String(item&&item.key||'')
  })).filter(item=>item.selector&&item.key);

  const cleanNodes=(Array.isArray(nodes)?nodes:[]).map(item=>({
    cloneId:String(item&&item.cloneId||''),
    parentSelector:String(item&&item.parentSelector||''),
    parentKey:keyBySelector.get(String(item&&item.parentSelector||''))||'',
    index:Number.isInteger(item&&item.index)?item.index:-1,
    html:String(item&&item.html||'')
  })).filter(item=>item.cloneId&&item.parentSelector&&item.html);

  const cleanPatches=(Array.isArray(patches)?patches:[]).map(item=>({
    selector:String(item&&item.selector||''),
    sourceKey:keyBySelector.get(String(item&&item.selector||''))||'',
    textAdjusted:!!(item&&item.textAdjusted),
    textContent:String(item&&item.textContent!==undefined?item.textContent:''),
    accessibilityAdjusted:!!(item&&item.accessibilityAdjusted),
    accessibilityLabel:String(item&&item.accessibilityLabel||''),
    mediaAdjusted:!!(item&&item.mediaAdjusted),
    mediaKind:String(item&&item.mediaKind||''),
    mediaSource:String(item&&item.mediaSource||''),
    mediaFit:String(item&&item.mediaFit||'contain'),
    mediaPositionX:Number.isFinite(Number(item&&item.mediaPositionX))?Math.max(0,Math.min(100,Number(item.mediaPositionX))):50,
    mediaPositionY:Number.isFinite(Number(item&&item.mediaPositionY))?Math.max(0,Math.min(100,Number(item.mediaPositionY))):50,
    svgTintAdjusted:!!(item&&item.svgTintAdjusted),
    svgTintColor:String(item&&item.svgTintColor||'#000000'),
    svgTintMode:['fill','stroke','both'].includes(String(item&&item.svgTintMode))?String(item.svgTintMode):'both'
  })).filter(item=>item.selector&&(item.textAdjusted||item.accessibilityAdjusted||item.mediaAdjusted||item.svgTintAdjusted));

  const cleanPrototypeLinks=Object.keys(prototypeLinks&&typeof prototypeLinks==='object'?prototypeLinks:{}).map(sourceSelector=>{
    const link=prototypeLinks[sourceSelector]||{};
    const targetSelector=String(link.target||'').trim();
    return {
      sourceSelector:String(sourceSelector||''),
      sourceKey:keyBySelector.get(String(sourceSelector||''))||'',
      targetSelector,
      targetKey:keyBySelector.get(targetSelector)||'',
      trigger:String(link.trigger||'click')
    };
  }).filter(item=>item.sourceSelector&&item.targetSelector&&item.trigger==='click');

  return [
    '/* Généré par App Interface Studio — structure réversible. */',
    '(function(){',
    '  const locators='+JSON.stringify(cleanLocators)+';',
    '  const nodes='+JSON.stringify(cleanNodes)+';',
    '  const patches='+JSON.stringify(cleanPatches)+';',
    '  const prototypeLinks='+JSON.stringify(cleanPrototypeLinks)+';',
    '  function sourceByKey(key){',
    '    if(!key)return null;',
    '    return document.querySelector("[data-ais-source-key=\\\""+key+"\\\"]");',
    '  }',
    '  function prepareSources(){',
    '    locators.forEach(function(item){',
    '      if(sourceByKey(item.key))return;',
    '      let element=null;',
    '      try{element=document.querySelector(item.selector)}catch(_){return}',
    '      if(element)element.setAttribute("data-ais-source-key",item.key);',
    '    });',
    '  }',
    '  function existingClone(id){',
    '    return Array.from(document.querySelectorAll("[data-ais-clone-id]")).find(function(el){return el.getAttribute("data-ais-clone-id")===id})||null;',
    '  }',
    '  function createNode(html){',
    '    const template=document.createElement("template");',
    '    template.innerHTML=String(html||"").trim();',
    '    return template.content.firstElementChild;',
    '  }',
    '  function apply(){',
    '    prepareSources();',
    '    nodes.forEach(function(item){',
    '      let parent=sourceByKey(item.parentKey);',
    '      if(!parent){try{parent=document.querySelector(item.parentSelector)}catch(_){return}}',
    '      if(!parent)return;',
    '      const node=createNode(item.html);',
    '      if(!node)return;',
    '      const previous=existingClone(item.cloneId);',
    '      if(previous)return;',
    '      const children=Array.from(parent.children);',
    '      const before=item.index>=0&&item.index<children.length?children[item.index]:null;',
    '      parent.insertBefore(node,before);',
    '    });',
    '    patches.forEach(function(item){',
    '      let element=sourceByKey(item.sourceKey);',
    '      if(!element){try{element=document.querySelector(item.selector)}catch(_){return}}',
    '      if(!element)return;',
    '      if(item.textAdjusted)element.textContent=item.textContent;',
    '      if(item.accessibilityAdjusted){',
    '        if(item.accessibilityLabel)element.setAttribute("aria-label",item.accessibilityLabel);',
    '        else element.removeAttribute("aria-label");',
    '      }',
    '      if(item.mediaAdjusted&&item.mediaSource){',
    '        const fit=item.mediaFit||"contain";',
    '        const rawX=Number(item.mediaPositionX),rawY=Number(item.mediaPositionY);const px=Math.max(0,Math.min(100,Number.isFinite(rawX)?rawX:50));const py=Math.max(0,Math.min(100,Number.isFinite(rawY)?rawY:50));',
    '        const ax=px<34?"xMin":px>66?"xMax":"xMid";const ay=py<34?"YMin":py>66?"YMax":"YMid";',
    '        if(item.mediaKind==="img"){element.setAttribute("src",item.mediaSource);element.style.objectFit=fit;element.style.objectPosition=px+"% "+py+"%";}',
    '        else if(item.mediaKind==="svg-image"){element.setAttribute("href",item.mediaSource);element.setAttributeNS("http://www.w3.org/1999/xlink","href",item.mediaSource);element.setAttribute("preserveAspectRatio",fit==="fill"?"none":ax+ay+(fit==="cover"?" slice":" meet"));}',
    '        else if(item.mediaKind==="svg"){',
    '          while(element.firstChild)element.removeChild(element.firstChild);',
    '          const image=document.createElementNS("http://www.w3.org/2000/svg","image");',
    '          image.setAttribute("href",item.mediaSource);image.setAttribute("x","0");image.setAttribute("y","0");image.setAttribute("width","100%");image.setAttribute("height","100%");',
    '          image.setAttribute("preserveAspectRatio",fit==="fill"?"none":ax+ay+(fit==="cover"?" slice":" meet"));element.appendChild(image);',
    '        }else{',
    '          element.style.setProperty("background-image","url(\\\""+String(item.mediaSource).replace(/\\\"/g,"%22")+"\\\")","important");',
    '          element.style.setProperty("background-size",fit==="fill"?"100% 100%":fit==="none"?"auto":fit,"important");',
    '          element.style.setProperty("background-position",px+"% "+py+"%","important");element.style.setProperty("background-repeat","no-repeat","important");',
    '        }',
    '      }',
    '      if(item.svgTintAdjusted&&String(element.tagName||"").toLowerCase()==="svg"){',
    '        const color=item.svgTintColor||"#000000";const mode=["fill","stroke","both"].includes(item.svgTintMode)?item.svgTintMode:"both";',
    '        element.style.setProperty("color",color,"important");',
    '        Array.from(element.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,text")).forEach(function(node){',
    '          const computed=getComputedStyle(node);const fill=String(computed.fill||"").toLowerCase();const stroke=String(computed.stroke||"").toLowerCase();',
    '          const fillVisible=fill&&fill!=="none"&&fill!=="transparent"&&fill!=="rgba(0, 0, 0, 0)"&&fill!=="rgba(0,0,0,0)";',
    '          const strokeVisible=stroke&&stroke!=="none"&&stroke!=="transparent"&&stroke!=="rgba(0, 0, 0, 0)"&&stroke!=="rgba(0,0,0,0)";',
    '          if((mode==="fill"||mode==="both")&&fillVisible)node.style.setProperty("fill",color,"important");',
    '          if((mode==="stroke"||mode==="both")&&strokeVisible)node.style.setProperty("stroke",color,"important");',
    '        });',
    '      }',
    '    });',
    '  }',
    '  let prototypeRunning=false;',
    '  function resolveTarget(key,selector){',
    '    let element=sourceByKey(key);',
    '    if(!element){try{element=document.querySelector(selector)}catch(_){return null}}',
    '    return element;',
    '  }',
    '  function onPrototypeClick(event){',
    '    if(prototypeRunning)return;',
    '    for(const item of prototypeLinks){',
    '      const source=resolveTarget(item.sourceKey,item.sourceSelector);',
    '      if(!source||!(event.target===source||source.contains(event.target)))continue;',
    '      const target=resolveTarget(item.targetKey,item.targetSelector);',
    '      if(!target)return;',
    '      prototypeRunning=true;',
    '      try{',
    '        if(target.scrollIntoView)target.scrollIntoView({behavior:"smooth",block:"center"});',
    '        if(target.click&&target!==source&&/button|a|input/i.test(target.tagName))target.click();',
    '        if(target.animate)target.animate([{outline:"3px solid #6f49f5"},{outline:"0 solid transparent"}],{duration:700});',
    '      }finally{setTimeout(function(){prototypeRunning=false},0)}',
    '      event.preventDefault();',
    '      return;',
    '    }',
    '  }',
    '  if(prototypeLinks.length)document.addEventListener("click",onPrototypeClick,true);',
    '  function start(){apply();setTimeout(apply,0);}',
    '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});',
    '  else start();',
    '})();',
    ''
  ].join('\n');
}

function ensureGeneratedTag(html,tag,marker){
  if(html.includes(marker))return html;
  const closingBody=new RegExp('</body>','i');
  if(closingBody.test(html))return html.replace(closingBody,'  '+tag+'\n</body>');
  return html+'\n'+tag+'\n';
}

function removeGeneratedStructureTag(html){
  const pattern=new RegExp('\\s*<script[^>]*data-app-interface-studio=["\\\']generated-structure["\\\'][^>]*></script>\\s*','ig');
  return html.replace(pattern,'\n');
}

function removeGeneratedCssTag(html){
  const pattern=new RegExp('\\s*<link[^>]*data-app-interface-studio=["\\\']generated["\\\'][^>]*>\\s*','ig');
  return html.replace(pattern,'\n');
}

function optionalFileBackup(file,stamp){
  const existed=fs.existsSync(file);
  if(!existed)return {existed:false,backupPath:null};
  const backupPath=file+'.ais-backup-'+stamp;
  fs.copyFileSync(file,backupPath);
  return {existed:true,backupPath};
}

function cleanupOptionalBackup(info){
  if(info&&info.backupPath&&fs.existsSync(info.backupPath)){
    try{fs.unlinkSync(info.backupPath)}catch(_){}
  }
}

function restoreOptionalFile(file,existed,backupPath){
  if(existed){
    if(!backupPath||!fs.existsSync(backupPath))throw new Error('Sauvegarde générée introuvable : '+file);
    fs.copyFileSync(backupPath,file);
  }else if(fs.existsSync(file)){
    fs.unlinkSync(file);
  }
}

function transactionFile(dir,stamp){
  return path.join(dir,'app-interface-studio.transaction-'+stamp+'.json');
}

function mediaAssetPlan(item,dir){
  const sourcePath=String(item&&item.mediaAssetPath||'');
  if(!sourcePath||!fs.existsSync(sourcePath)||!fs.statSync(sourcePath).isFile())return null;
  const bytes=fs.readFileSync(sourcePath);
  const hash=crypto.createHash('sha1').update(bytes).digest('hex').slice(0,12);
  const rawExt=path.extname(sourcePath).toLowerCase();
  const ext=/^\.(png|jpe?g|webp|gif|svg|avif)$/i.test(rawExt)?rawExt:'.bin';
  const base=path.basename(sourcePath,rawExt).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'asset';
  const assetDir=path.join(dir,'app-interface-studio-assets');
  const filename=base+'-'+hash+ext;
  const target=path.join(assetDir,filename);
  return {source:sourcePath,target,existed:fs.existsSync(target),url:'./app-interface-studio-assets/'+encodeURIComponent(filename)};
}

function computeLocalPatchPlan(payload,parts){
  const source=payload&&payload.source;
  const css=String(payload&&payload.css||'').trim();
  const generatedNodes=Array.isArray(payload&&payload.generatedNodes)?payload.generatedNodes:[];
  const domPatches=Array.isArray(payload&&payload.domPatches)?payload.domPatches:[];
  const sourceSelectors=Array.isArray(payload&&payload.sourceSelectors)?payload.sourceSelectors:[];
  const prototypeLinks=payload&&payload.prototypeLinks&&typeof payload.prototypeLinks==='object'?payload.prototypeLinks:{};
  const local=localSourceEntry(source);
  if(!local)throw new Error('Application directe disponible uniquement pour un dossier ou fichier HTML local.');
  if(!fs.existsSync(local.html))throw new Error('Fichier HTML source introuvable.');

  const applyParts={
    css:!parts||parts.css!==false,
    structure:!parts||parts.structure!==false
  };
  const dir=path.dirname(local.html);
  const assetCopies=[];
  const normalizedDomPatches=domPatches.map(item=>{
    if(!item||!item.mediaAdjusted)return item;
    const plan=mediaAssetPlan(item,dir);
    if(!plan)return item;
    assetCopies.push(plan);
    return Object.assign({},item,{mediaSource:plan.url});
  });
  const cssPath=path.join(dir,'app-interface-studio.generated.css');
  const jsPath=path.join(dir,'app-interface-studio.generated.js');
  const originalHtml=fs.readFileSync(local.html,'utf8');
  const currentCss=fs.existsSync(cssPath)?fs.readFileSync(cssPath,'utf8'):'';
  const currentJs=fs.existsSync(jsPath)?fs.readFileSync(jsPath,'utf8'):'';
  const needLocators=sourceSelectors.length||generatedNodes.length||normalizedDomPatches.length||Object.keys(prototypeLinks).length;
  const sourceLocators=needLocators?buildSourceLocators(sourceSelectors,generatedNodes,normalizedDomPatches,prototypeLinks):[];
  const stableCss=sourceLocators.length?rewriteGeneratedCss(css,sourceLocators):css;

  let html=originalHtml;
  let nextCss=currentCss;
  let nextJs=currentJs;

  if(applyParts.css){
    if(stableCss&&stableCss!=='/* Aucun ajustement. */'){
      nextCss='/* Généré par App Interface Studio — patch réversible. */\n'+stableCss+'\n';
      const marker='data-app-interface-studio="generated"';
      if(!html.includes(marker)){
        const href='./'+path.basename(cssPath);
        const link='<link rel="stylesheet" href="'+href+'" '+marker+'>';
        if(new RegExp('</head>','i').test(html))html=html.replace(new RegExp('</head>','i'),'  '+link+'\n</head>');
        else html=link+'\n'+html;
      }
    }else{
      nextCss='';
      html=removeGeneratedCssTag(html);
    }
  }

  const prototypeCount=Object.keys(prototypeLinks).length;
  if(applyParts.structure){
    if(generatedNodes.length||normalizedDomPatches.length||sourceLocators.length||prototypeCount){
      nextJs=generatedStructureScript(generatedNodes,normalizedDomPatches,sourceLocators,prototypeLinks);
      const marker='data-app-interface-studio="generated-structure"';
      const src='./'+path.basename(jsPath);
      const tag='<script src="'+src+'" '+marker+'></script>';
      html=ensureGeneratedTag(html,tag,marker);
    }else{
      nextJs='';
      html=removeGeneratedStructureTag(html);
    }
  }

  const htmlChanged=html!==originalHtml;
  const cssChanged=nextCss!==currentCss;
  const structureChanged=nextJs!==currentJs;
  return {
    local,dir,cssPath,jsPath,
    parts:applyParts,
    before:{html:originalHtml,css:currentCss,js:currentJs},
    after:{html:html,css:nextCss,js:nextJs},
    changed:{html:htmlChanged,css:cssChanged,structure:structureChanged},
    diffs:{
      html:simpleUnifiedDiff(originalHtml,html,path.basename(local.html)),
      css:simpleUnifiedDiff(currentCss,nextCss,path.basename(cssPath)),
      js:simpleUnifiedDiff(currentJs,nextJs,path.basename(jsPath))
    },
    generatedCount:generatedNodes.length,
    domPatchCount:normalizedDomPatches.length,
    assetCopies,
    assetCount:assetCopies.length,
    locatorCount:sourceLocators.length,
    prototypeCount
  };
}

ipcMain.handle('source:preview-patch',async (_event,payload)=>{
  try{
    const requested=payload&&payload.applyParts;
    const parts=requested?{css:requested.css!==false,structure:requested.structure!==false}:{css:true,structure:true};
    const plan=computeLocalPatchPlan(payload,parts);
    return {
      ok:true,
      files:{
        html:{path:plan.local.html,changed:plan.changed.html,diff:plan.diffs.html,before:plan.before.html,after:plan.after.html},
        css:{path:plan.cssPath,changed:plan.changed.css,diff:plan.diffs.css,before:plan.before.css,after:plan.after.css},
        js:{path:plan.jsPath,changed:plan.changed.structure,diff:plan.diffs.js,before:plan.before.js,after:plan.after.js}
      },
      generatedCount:plan.generatedCount,
      domPatchCount:plan.domPatchCount,
      assetCount:plan.assetCount,
      locatorCount:plan.locatorCount,
      prototypeCount:plan.prototypeCount
    };
  }catch(error){
    return {ok:false,error:'Préparation du patch impossible : '+String(error&&error.message||error)};
  }
});

async function applyLocalPatch(payload){
  let plan=null;
  try{
    plan=computeLocalPatchPlan(payload,payload&&payload.applyParts);
  }catch(error){
    return {ok:false,error:'Application au code impossible : '+String(error&&error.message||error)};
  }

  if(!plan.changed.html&&!plan.changed.css&&!plan.changed.structure){
    return {ok:false,error:'Le code local est déjà synchronisé avec le projet.'};
  }

  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
  const htmlBackupPath=path.join(plan.dir,path.basename(plan.local.html)+'.ais-backup-'+stamp);
  const cssBackup=optionalFileBackup(plan.cssPath,stamp);
  const jsBackup=optionalFileBackup(plan.jsPath,stamp);
  const createdAssets=[];

  try{
    fs.copyFileSync(plan.local.html,htmlBackupPath);
    for(const asset of plan.assetCopies||[]){
      fs.mkdirSync(path.dirname(asset.target),{recursive:true});
      if(!fs.existsSync(asset.target)){
        fs.copyFileSync(asset.source,asset.target);
        createdAssets.push(asset.target);
      }
    }

    if(plan.changed.css){
      if(plan.after.css)fs.writeFileSync(plan.cssPath,plan.after.css,'utf8');
      else if(fs.existsSync(plan.cssPath))fs.unlinkSync(plan.cssPath);
    }
    if(plan.changed.structure){
      if(plan.after.js)fs.writeFileSync(plan.jsPath,plan.after.js,'utf8');
      else if(fs.existsSync(plan.jsPath))fs.unlinkSync(plan.jsPath);
    }
    if(plan.changed.html)fs.writeFileSync(plan.local.html,plan.after.html,'utf8');

    const transactionPath=transactionFile(plan.dir,stamp);
    const transaction={
      version:4,
      createdAt:new Date().toISOString(),
      sourceHtml:path.resolve(plan.local.html),
      htmlBackupPath,
      cssPath:plan.cssPath,
      cssExisted:cssBackup.existed,
      cssBackupPath:cssBackup.backupPath,
      jsPath:plan.jsPath,
      jsExisted:jsBackup.existed,
      jsBackupPath:jsBackup.backupPath,
      createdAssets,
      applyParts:plan.parts,
      generatedCount:plan.generatedCount,
      domPatchCount:plan.domPatchCount,
      locatorCount:plan.locatorCount,
      prototypeCount:plan.prototypeCount,
      assetCount:plan.assetCount,
      htmlChanged:!!plan.changed.html,
      cssChanged:!!plan.changed.css,
      structureChanged:!!plan.changed.structure,
      rolledBack:false
    };
    fs.writeFileSync(transactionPath,JSON.stringify(transaction,null,2)+'\n','utf8');

    return {
      ok:true,
      cssPath:plan.after.css?plan.cssPath:null,
      jsPath:plan.after.js?plan.jsPath:null,
      htmlPath:plan.local.html,
      backupPath:htmlBackupPath,
      transactionPath,
      generatedCount:plan.generatedCount,
      domPatchCount:plan.domPatchCount,
      locatorCount:plan.locatorCount,
      prototypeCount:plan.prototypeCount,
      assetCount:plan.assetCount,
      createdAssets:createdAssets.slice(),
      cssApplied:plan.parts.css&&!!plan.after.css,
      cssRemoved:plan.parts.css&&!plan.after.css&&!!plan.before.css,
      structureApplied:plan.parts.structure&&!!plan.after.js,
      structureRemoved:plan.parts.structure&&!plan.after.js&&!!plan.before.js
    };
  }catch(error){
    cleanupOptionalBackup(cssBackup);
    cleanupOptionalBackup(jsBackup);
    createdAssets.forEach(file=>{try{if(fs.existsSync(file))fs.unlinkSync(file)}catch(_){}});
    return {ok:false,error:'Application au code impossible : '+String(error&&error.message||error)};
  }
}

async function rollbackLocalPatch(payload){
  const local=localSourceEntry(payload&&payload.source);
  if(!local)return {ok:false,error:'Rollback disponible uniquement pour une source HTML locale.'};
  const dir=path.dirname(local.html);
  try{
    const history=listLocalTransactions({source:payload&&payload.source});
    if(!history.ok)return history;
    const chosenPath=history.nextRollbackPath;
    if(!chosenPath)return {ok:false,error:'Aucun patch local à annuler pour cette source.'};
    let chosen=null;
    try{chosen=JSON.parse(fs.readFileSync(chosenPath,'utf8'))}catch(_){}
    if(!chosen)return {ok:false,error:'Transaction du prochain rollback introuvable ou invalide.'};
    if(!chosen.htmlBackupPath||!fs.existsSync(chosen.htmlBackupPath))return {ok:false,error:'Sauvegarde HTML du dernier patch introuvable.'};

    fs.copyFileSync(chosen.htmlBackupPath,local.html);
    restoreOptionalFile(chosen.cssPath,!!chosen.cssExisted,chosen.cssBackupPath);
    restoreOptionalFile(chosen.jsPath,!!chosen.jsExisted,chosen.jsBackupPath);
    (Array.isArray(chosen.createdAssets)?chosen.createdAssets:[]).forEach(file=>{
      try{if(file&&fs.existsSync(file))fs.unlinkSync(file)}catch(_){}
    });

    chosen.rolledBack=true;
    chosen.rolledBackAt=new Date().toISOString();
    fs.writeFileSync(chosenPath,JSON.stringify(chosen,null,2)+'\n','utf8');

    return {
      ok:true,
      htmlPath:local.html,
      transactionPath:chosenPath,
      restoredAt:chosen.rolledBackAt,
      removedAssets:Array.isArray(chosen.createdAssets)?chosen.createdAssets.slice():[]
    };
  }catch(error){
    return {ok:false,error:'Annulation du patch impossible : '+String(error&&error.message||error)};
  }
}

ipcMain.handle('source:apply-css',async (_event,payload)=>applyLocalPatch(payload));
ipcMain.handle('source:rollback-last-patch',async (_event,payload)=>rollbackLocalPatch(payload));

function listLocalTransactions(payload){
  const local=localSourceEntry(payload&&payload.source);
  if(!local)return {ok:false,error:'Historique disponible uniquement pour une source HTML locale.',transactions:[]};
  const dir=path.dirname(local.html);
  const sourceHtml=path.resolve(local.html);
  try{
    const transactions=fs.readdirSync(dir)
      .filter(name=>/^app-interface-studio\.transaction-.*\.json$/i.test(name))
      .map(name=>{
        const transactionPath=path.join(dir,name);
        try{
          const tx=JSON.parse(fs.readFileSync(transactionPath,'utf8'));
          if(!tx||path.resolve(tx.sourceHtml||'')!==sourceHtml)return null;
          return {
            path:transactionPath,
            version:Number(tx.version)||1,
            createdAt:tx.createdAt||'',
            rolledBack:!!tx.rolledBack,
            rolledBackAt:tx.rolledBackAt||'',
            applyParts:tx.applyParts&&typeof tx.applyParts==='object'?tx.applyParts:{css:true,structure:true},
            generatedCount:Number(tx.generatedCount)||0,
            domPatchCount:Number(tx.domPatchCount)||0,
            locatorCount:Number(tx.locatorCount)||0,
            prototypeCount:Number(tx.prototypeCount)||0,
            assetCount:Number.isFinite(Number(tx.assetCount))?Number(tx.assetCount):(Array.isArray(tx.createdAssets)?tx.createdAssets.length:0),
            htmlChanged:tx.htmlChanged!==undefined?!!tx.htmlChanged:true,
            cssChanged:tx.cssChanged!==undefined?!!tx.cssChanged:!!(tx.applyParts&&tx.applyParts.css),
            structureChanged:tx.structureChanged!==undefined?!!tx.structureChanged:!!(tx.applyParts&&tx.applyParts.structure)
          };
        }catch(_){return null}
      })
      .filter(Boolean)
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.path).localeCompare(String(a.path)));
    const nextRollback=transactions.find(item=>!item.rolledBack)||null;
    return {ok:true,transactions:transactions.slice(0,50),nextRollbackPath:nextRollback&&nextRollback.path||''};
  }catch(error){
    return {ok:false,error:'Lecture de l’historique impossible : '+String(error&&error.message||error),transactions:[]};
  }
}

ipcMain.handle('source:list-transactions',async (_event,payload)=>listLocalTransactions(payload));

async function rollbackThroughLocalTransaction(payload){
  const source=payload&&payload.source;
  const targetPath=path.resolve(String(payload&&payload.transactionPath||''));
  if(!targetPath)return {ok:false,error:'Transaction cible manquante.'};
  const initial=listLocalTransactions({source});
  if(!initial.ok)return initial;
  const active=initial.transactions.filter(item=>!item.rolledBack);
  const target=active.find(item=>path.resolve(item.path)===targetPath);
  if(!target)return {ok:false,error:'La transaction choisie est introuvable ou déjà annulée.'};
  const targetIndex=active.findIndex(item=>path.resolve(item.path)===targetPath);
  if(targetIndex<0)return {ok:false,error:'Transaction cible non active.'};

  const rolledBack=[];
  for(let i=0;i<=targetIndex;i++){
    const current=listLocalTransactions({source});
    if(!current.ok)return current;
    if(!current.nextRollbackPath)return {ok:false,error:'Pile de rollback interrompue avant la transaction cible.',rolledBack};
    const expected=path.resolve(current.nextRollbackPath);
    const result=await rollbackLocalPatch({source});
    if(!result.ok)return Object.assign({},result,{rolledBack});
    rolledBack.push(result.transactionPath);
    if(path.resolve(result.transactionPath)===targetPath){
      return {ok:true,count:rolledBack.length,rolledBack,targetPath:result.transactionPath,restoredAt:result.restoredAt};
    }
    if(i===targetIndex&&expected!==targetPath)break;
  }
  return {ok:false,error:'La transaction cible n’a pas été atteinte.',rolledBack};
}

ipcMain.handle('source:rollback-through',async (_event,payload)=>rollbackThroughLocalTransaction(payload));

async function inspectSmokeFixture(url){
  const win=new BrowserWindow({
    show:false,width:360,height:640,useContentSize:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,backgroundThrottling:false}
  });
  try{
    await win.loadURL(url);
    await new Promise(resolve=>setTimeout(resolve,250));
    return await win.webContents.executeJavaScript(`
      (function(){
        const title=document.getElementById('title');
        const cover=document.getElementById('cover');
        const icon=document.getElementById('icon');
        const pathNode=icon&&icon.querySelector('path');
        return {
          text:title&&title.textContent,
          titleColor:title&&getComputedStyle(title).color,
          coverSrc:cover&&cover.getAttribute('src'),
          iconFill:pathNode&&getComputedStyle(pathNode).fill,
          iconStroke:pathNode&&getComputedStyle(pathNode).stroke,
          generatedCss:!!document.querySelector('link[data-app-interface-studio="generated"]'),
          generatedJs:!!document.querySelector('script[data-app-interface-studio="generated-structure"]')
        };
      })()
    `,true);
  }finally{if(!win.isDestroyed())win.destroy()}
}

async function smokeTransactionRoundtrip(){
  const dir=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-roundtrip-'));
  const htmlPath=path.join(dir,'index.html');
  const assetPath=path.join(dir,'fixture.png');
  const original='<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body><div id="title">Original</div><img id="cover" width="24" height="24"><svg id="icon" viewBox="0 0 10 10" width="20" height="20"><path d="M1 1h8v8H1z" fill="#111111" stroke="#222222"/></svg></body></html>';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2V8AAAAASUVORK5CYII=','base64');
  fs.writeFileSync(htmlPath,original,'utf8');
  fs.writeFileSync(assetPath,png);

  let url='';
  let fixtureServer=null;
  try{
    fixtureServer=serveStatic(dir);
    const fixtureBase=await listen(fixtureServer);
    url=fixtureBase+'/index.html';
    const source={type:'html',path:htmlPath,root:dir,entry:'index.html',url,label:'AIS transaction fixture'};
    const payload={
      source,
      css:'#title { color: rgb(1, 2, 3) !important; }',
      generatedNodes:[],
      sourceSelectors:['#title','#cover','#icon'],
      prototypeLinks:{},
      domPatches:[
        {selector:'#title',textAdjusted:true,textContent:'Changed'},
        {selector:'#cover',mediaAdjusted:true,mediaKind:'img',mediaAssetPath:assetPath,mediaName:'fixture.png',mediaFit:'contain',mediaPositionX:50,mediaPositionY:50},
        {selector:'#icon',svgTintAdjusted:true,svgTintColor:'#ff00aa',svgTintMode:'stroke'}
      ],
      applyParts:{css:true,structure:true}
    };

    const preview=computeLocalPatchPlan(payload,payload.applyParts);
    if(!preview.changed.html||!preview.changed.css||!preview.changed.structure||preview.assetCount!==1)throw new Error('Plan transactionnel incomplet.');

    const applied=await applyLocalPatch(payload);
    if(!applied.ok)throw new Error(applied.error||'Application transactionnelle échouée.');
    const cssPath=path.join(dir,'app-interface-studio.generated.css');
    const jsPath=path.join(dir,'app-interface-studio.generated.js');
    if(!fs.existsSync(cssPath)||!fs.existsSync(jsPath))throw new Error('Fichiers générés absents après application.');
    const htmlAfter=fs.readFileSync(htmlPath,'utf8');
    if(!htmlAfter.includes('data-app-interface-studio="generated"')||!htmlAfter.includes('data-app-interface-studio="generated-structure"'))throw new Error('Balises générées absentes du HTML.');
    const tx=JSON.parse(fs.readFileSync(applied.transactionPath,'utf8'));
    if(tx.rolledBack!==false||!Array.isArray(tx.createdAssets)||tx.createdAssets.length!==1)throw new Error('Transaction ou asset créé invalide.');
    if(!fs.existsSync(tx.createdAssets[0]))throw new Error('Asset généré absent.');

    const renderedAfter=await inspectSmokeFixture(url);
    if(renderedAfter.text!=='Changed')throw new Error('Texte appliqué non rendu.');
    if(renderedAfter.titleColor!=='rgb(1, 2, 3)')throw new Error('CSS appliqué non rendu : '+renderedAfter.titleColor);
    if(!String(renderedAfter.coverSrc||'').includes('app-interface-studio-assets/'))throw new Error('Image générée non rendue.');
    if(renderedAfter.iconStroke!=='rgb(255, 0, 170)')throw new Error('Teinte SVG non rendue : '+renderedAfter.iconStroke);
    if(!renderedAfter.generatedCss||!renderedAfter.generatedJs)throw new Error('Balises générées non chargées.');

    const payload2=Object.assign({},payload,{
      css:'#title { color: rgb(4, 5, 6) !important; }',
      domPatches:[
        {selector:'#title',textAdjusted:true,textContent:'Changed again'},
        {selector:'#cover',mediaAdjusted:true,mediaKind:'img',mediaAssetPath:assetPath,mediaName:'fixture.png',mediaFit:'cover',mediaPositionX:10,mediaPositionY:90},
        {selector:'#icon',svgTintAdjusted:true,svgTintColor:'#00aaff',svgTintMode:'stroke'}
      ]
    });
    const applied2=await applyLocalPatch(payload2);
    if(!applied2.ok)throw new Error(applied2.error||'Deuxième application transactionnelle échouée.');
    if(path.resolve(applied2.transactionPath)===path.resolve(applied.transactionPath))throw new Error('Collision de fichiers de transaction.');
    const tx2=JSON.parse(fs.readFileSync(applied2.transactionPath,'utf8'));
    if(!Array.isArray(tx2.createdAssets)||tx2.createdAssets.length!==0)throw new Error('Le deuxième patch ne doit pas dupliquer un asset déjà copié.');

    const renderedSecond=await inspectSmokeFixture(url);
    if(renderedSecond.text!=='Changed again')throw new Error('Deuxième texte appliqué non rendu.');
    if(renderedSecond.titleColor!=='rgb(4, 5, 6)')throw new Error('Deuxième CSS non rendu : '+renderedSecond.titleColor);
    if(renderedSecond.iconStroke!=='rgb(0, 170, 255)')throw new Error('Deuxième teinte SVG non rendue : '+renderedSecond.iconStroke);

    const historyBefore=listLocalTransactions({source});
    if(!historyBefore.ok||historyBefore.transactions.filter(item=>!item.rolledBack).length!==2||path.resolve(historyBefore.nextRollbackPath)!==path.resolve(applied2.transactionPath))throw new Error('Historique transactionnel incohérent avant rollback ciblé.');

    const rolled=await rollbackThroughLocalTransaction({source,transactionPath:applied.transactionPath});
    if(!rolled.ok||rolled.count!==2)throw new Error(rolled.error||'Rollback ciblé de deux transactions échoué.');
    if(fs.readFileSync(htmlPath,'utf8')!==original)throw new Error('HTML non restauré exactement.');
    if(fs.existsSync(cssPath)||fs.existsSync(jsPath))throw new Error('Fichiers générés non supprimés au rollback.');
    if(tx.createdAssets.some(file=>fs.existsSync(file)))throw new Error('Asset créé non supprimé au rollback.');

    const history=listLocalTransactions({source});
    if(!history.ok||history.transactions.length!==2||history.transactions.some(item=>!item.rolledBack)||history.nextRollbackPath)throw new Error('Historique transactionnel incohérent après rollback ciblé.');

    const renderedRollback=await inspectSmokeFixture(url);
    if(renderedRollback.text!=='Original')throw new Error('Texte non restauré après rollback.');
    if(renderedRollback.coverSrc!==null)throw new Error('Image non restaurée après rollback.');
    if(renderedRollback.iconStroke!=='rgb(34, 34, 34)')throw new Error('SVG non restauré après rollback : '+renderedRollback.iconStroke);
    if(renderedRollback.generatedCss||renderedRollback.generatedJs)throw new Error('Balises générées encore présentes après rollback.');

    return {ok:true,preview:true,apply:true,render:true,rollback:true,rollbackThrough:true,history:true,asset:true,svg:true};
  }finally{
    await closeHttpServer(fixtureServer);
    try{fs.rmSync(dir,{recursive:true,force:true})}catch(_){}
  }
}

if(smokeMode)ipcMain.handle('smoke:transaction-roundtrip',async ()=>smokeTransactionRoundtrip());

function generatedAssetReferences(local){
  const dir=path.dirname(local.html);
  const files=[
    local.html,
    path.join(dir,'app-interface-studio.generated.css'),
    path.join(dir,'app-interface-studio.generated.js')
  ].filter(fs.existsSync);
  const used=new Set();
  const pattern=/app-interface-studio-assets\/([^"'\x60)\s?#]+)/g;
  files.forEach(file=>{
    let content='';
    try{content=fs.readFileSync(file,'utf8')}catch(_){return}
    let match;
    while((match=pattern.exec(content))){
      let decoded=match[1];
      try{decoded=decodeURIComponent(decoded)}catch(_){}
      const safe=path.basename(decoded);
      if(safe===decoded&&safe)used.add(safe);
    }
  });
  return used;
}

function cleanupGeneratedAssets(local){
  const dir=path.dirname(local.html);
  const assetDir=path.join(dir,'app-interface-studio-assets');
  if(!fs.existsSync(assetDir))return {removed:[],kept:[]};
  const used=generatedAssetReferences(local);
  const removed=[],kept=[];
  fs.readdirSync(assetDir).forEach(name=>{
    const file=path.join(assetDir,name);
    let stat=null;
    try{stat=fs.statSync(file)}catch(_){return}
    if(!stat.isFile())return;
    if(used.has(name)){kept.push(file);return}
    try{fs.unlinkSync(file);removed.push(file)}catch(_){}
  });
  try{if(fs.existsSync(assetDir)&&fs.readdirSync(assetDir).length===0)fs.rmdirSync(assetDir)}catch(_){}
  return {removed,kept};
}

function sourceRoot(source){
  const local=localSourceEntry(source);
  if(!local)return null;
  return local.root||path.dirname(local.html);
}

function commandExists(command){
  try{
    const finder=process.platform==='win32'?'where.exe':'which';
    execFileSync(finder,[command],{encoding:'utf8',windowsHide:true,timeout:3000});
    return true;
  }catch(_){return false}
}

function gitPathTracked(root,relativePath){
  try{
    execFileSync('git',['-C',root,'ls-files','--error-unmatch','--',relativePath],{encoding:'utf8',windowsHide:true,timeout:5000});
    return true;
  }catch(_){return false}
}

function svgIntrinsicSize(file){
  try{
    const text=fs.readFileSync(file,'utf8').slice(0,65536);
    const viewBox=/\bviewBox\s*=\s*["']\s*[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/i.exec(text);
    if(viewBox)return {width:Math.max(0,Number(viewBox[1])||0),height:Math.max(0,Number(viewBox[2])||0)};
    const w=/\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(text),h=/\bheight\s*=\s*["']\s*([\d.]+)/i.exec(text);
    return {width:w?Number(w[1])||0:0,height:h?Number(h[1])||0:0};
  }catch(_){return {width:0,height:0}}
}

function collectProjectImages(root,limit){
  const out=[];
  const skip=new Set(['.git','node_modules','.next','.gradle','.idea','.vscode','build','dist','coverage']);
  function walk(dir){
    if(out.length>=limit)return;
    let names=[];
    try{names=fs.readdirSync(dir)}catch(_){return}
    for(const name of names){
      if(out.length>=limit)break;
      if(skip.has(name))continue;
      const file=path.join(dir,name);
      let stat=null;try{stat=fs.statSync(file)}catch(_){continue}
      if(stat.isDirectory()){walk(file);continue}
      if(!stat.isFile()||!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name))continue;
      out.push({file,stat});
    }
  }
  walk(root);
  return out;
}

function auditProjectAssets(local){
  const root=local.root||path.dirname(local.html);
  const generatedDir=path.join(path.dirname(local.html),'app-interface-studio-assets');
  const usedGenerated=generatedAssetReferences(local);
  const entries=collectProjectImages(root,3000);
  const byHash=new Map();
  const files=[];
  let totalBytes=0;
  entries.forEach(({file,stat})=>{
    let bytes=null,hash='',width=0,height=0,format=path.extname(file).slice(1).toLowerCase();
    try{bytes=fs.readFileSync(file);hash=crypto.createHash('sha1').update(bytes).digest('hex')}catch(_){}
    totalBytes+=stat.size||0;
    if(format==='svg'){
      const size=svgIntrinsicSize(file);width=size.width;height=size.height;
    }else{
      try{
        const image=nativeImage.createFromPath(file);
        if(image&&!image.isEmpty()){const size=image.getSize();width=size.width;height=size.height}
      }catch(_){}
    }
    if(hash){
      if(!byHash.has(hash))byHash.set(hash,[]);
      byHash.get(hash).push(file);
    }
    const generated=path.dirname(file)===generatedDir;
    const orphan=generated&&!usedGenerated.has(path.basename(file));
    const megapixels=width&&height?(width*height/1000000):0;
    const issues=[];
    if(orphan)issues.push('orphan');
    if(stat.size>1024*1024)issues.push('large-file');
    if(width>4096||height>4096||megapixels>12)issues.push('oversized-dimensions');
    if(format==='svg'&&stat.size>250*1024)issues.push('large-svg');
    files.push({
      path:file,relative:path.relative(root,file),name:path.basename(file),format,size:stat.size||0,width,height,
      megapixels:Math.round(megapixels*100)/100,hash,generated,orphan,issues
    });
  });
  const duplicateHashes=new Set(Array.from(byHash.entries()).filter(([,items])=>items.length>1).map(([hash])=>hash));
  files.forEach(item=>{if(item.hash&&duplicateHashes.has(item.hash))item.issues.push('duplicate')});
  files.sort((a,b)=>{
    const score=x=>(x.orphan?8:0)+(x.issues.includes('duplicate')?4:0)+(x.issues.includes('large-file')?2:0)+(x.issues.includes('oversized-dimensions')?2:0)+(x.issues.includes('large-svg')?1:0);
    return score(b)-score(a)||b.size-a.size||a.relative.localeCompare(b.relative);
  });
  return {
    root,scanned:files.length,totalBytes,
    orphanCount:files.filter(x=>x.orphan).length,
    duplicateCount:files.filter(x=>x.issues.includes('duplicate')).length,
    largeCount:files.filter(x=>x.issues.includes('large-file')||x.issues.includes('large-svg')).length,
    oversizedCount:files.filter(x=>x.issues.includes('oversized-dimensions')).length,
    files:files.slice(0,500)
  };
}

ipcMain.handle('source:audit-assets',async (_event,payload)=>{
  const local=localSourceEntry(payload&&payload.source);
  if(!local)return {ok:false,error:'Audit disponible uniquement pour une source locale.'};
  try{return Object.assign({ok:true},auditProjectAssets(local))}
  catch(error){return {ok:false,error:'Audit des assets impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('source:clean-assets',async (_event,payload)=>{
  const local=localSourceEntry(payload&&payload.source);
  if(!local)return {ok:false,error:'Nettoyage disponible uniquement pour une source HTML locale.'};
  try{
    const cleanup=cleanupGeneratedAssets(local);
    return {ok:true,removed:cleanup.removed,kept:cleanup.kept};
  }catch(error){return {ok:false,error:'Nettoyage des assets impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('source:git-status',async (_event,payload)=>{
  const root=sourceRoot(payload&&payload.source);
  if(!root)return {ok:false,error:'GitHub direct nécessite un dossier ou fichier HTML local dans un dépôt Git.'};
  try{
    const inside=execFileSync('git',['-C',root,'rev-parse','--is-inside-work-tree'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    if(inside!=='true')return {ok:false,error:'Le dossier local n’est pas un dépôt Git.'};
    const branch=execFileSync('git',['-C',root,'branch','--show-current'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    const remote=execFileSync('git',['-C',root,'remote','get-url','origin'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    const status=execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    return {ok:true,root,branch,remote,status,ghAvailable:commandExists('gh')};
  }catch(error){return {ok:false,error:'Git indisponible ou dépôt invalide : '+String(error&&error.message||error)}}
});

ipcMain.handle('source:git-publish',async (_event,payload)=>{
  const source=payload&&payload.source;
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Publication GitHub disponible uniquement pour une source HTML locale.'};
  const root=local.root||path.dirname(local.html);
  const branch=String(payload&&payload.branch||('app-interface-studio-'+Date.now())).replace(/[^a-zA-Z0-9._\/-]/g,'-');
  const title=String(payload&&payload.title||'Mise à jour interface App Interface Studio');
  const body=String(payload&&payload.body||'Modifications visuelles générées avec App Interface Studio.');
  try{
    execFileSync('git',['-C',root,'rev-parse','--is-inside-work-tree'],{encoding:'utf8',windowsHide:true,timeout:5000});
    const current=execFileSync('git',['-C',root,'branch','--show-current'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    if(current!==branch){
      try{execFileSync('git',['-C',root,'checkout','-b',branch],{encoding:'utf8',windowsHide:true,timeout:10000})}
      catch(_){execFileSync('git',['-C',root,'checkout',branch],{encoding:'utf8',windowsHide:true,timeout:10000})}
    }
    const cleanup=cleanupGeneratedAssets(local);
    const files=[path.relative(root,local.html)];
    const generated=path.join(path.dirname(local.html),'app-interface-studio.generated.css');
    const generatedRelative=path.relative(root,generated);
    if(fs.existsSync(generated)||gitPathTracked(root,generatedRelative))files.push(generatedRelative);
    const generatedStructure=path.join(path.dirname(local.html),'app-interface-studio.generated.js');
    const generatedStructureRelative=path.relative(root,generatedStructure);
    if(fs.existsSync(generatedStructure)||gitPathTracked(root,generatedStructureRelative))files.push(generatedStructureRelative);
    const assetDir=path.join(path.dirname(local.html),'app-interface-studio-assets');
    if(fs.existsSync(assetDir))files.push(path.relative(root,assetDir));
    execFileSync('git',['-C',root,'add','-A','--'].concat(files),{encoding:'utf8',windowsHide:true,timeout:10000});
    const staged=execFileSync('git',['-C',root,'diff','--cached','--name-only'],{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
    if(!staged)return {ok:false,error:'Aucune modification App Interface Studio à publier.'};
    execFileSync('git',['-C',root,'commit','-m',title],{encoding:'utf8',windowsHide:true,timeout:15000});
    execFileSync('git',['-C',root,'push','-u','origin',branch],{encoding:'utf8',windowsHide:true,timeout:30000});

    let prUrl='';
    if(commandExists('gh')){
      try{
        prUrl=execFileSync('gh',['pr','create','--title',title,'--body',body,'--head',branch],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000}).trim();
      }catch(_){}
    }
    return {ok:true,branch,staged,prUrl,cleanedAssets:cleanup.removed.length,keptAssets:cleanup.kept.length};
  }catch(error){return {ok:false,error:'Publication Git/GitHub impossible : '+String(error&&error.message||error)}}
});

function captureStructureScript(payload){
  const generatedNodes=Array.isArray(payload&&payload.generatedNodes)?payload.generatedNodes:[];
  const domPatches=Array.isArray(payload&&payload.domPatches)?payload.domPatches:[];
  const sourceSelectors=Array.isArray(payload&&payload.sourceSelectors)?payload.sourceSelectors:[];
  const prototypeLinks=payload&&payload.prototypeLinks&&typeof payload.prototypeLinks==='object'?payload.prototypeLinks:{};
  if(!generatedNodes.length&&!domPatches.length&&!sourceSelectors.length&&!Object.keys(prototypeLinks).length)return '';
  const locators=buildSourceLocators(sourceSelectors,generatedNodes,domPatches,prototypeLinks);
  return generatedStructureScript(generatedNodes,domPatches,locators,prototypeLinks);
}

async function captureSourceAtSize(source,width,height,css,structurePayload){
  const target=normalizeUrl(source&&source.url);
  if(!target)throw new Error('Source invalide.');
  const win=new BrowserWindow({
    show:false,
    width:Math.max(240,Math.round(width)),
    height:Math.max(240,Math.round(height)),
    useContentSize:true,
    frame:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}
  });
  try{
    await win.loadURL(target);
    await new Promise(resolve=>setTimeout(resolve,450));
    if(css&&String(css).trim()&&String(css).trim()!=='/* Aucun ajustement. */'){
      await win.webContents.insertCSS(String(css),{cssOrigin:'author'});
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    const structureScript=captureStructureScript(structurePayload);
    if(structureScript){
      await win.webContents.executeJavaScript(structureScript,true);
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    const image=await win.webContents.capturePage({x:0,y:0,width:Math.round(width),height:Math.round(height)});
    return image;
  }finally{if(!win.isDestroyed())win.destroy()}
}

ipcMain.handle('capture:batch',async (_event,payload)=>{
  const source=payload&&payload.source;
  const configs=Array.isArray(payload&&payload.configs)?payload.configs:[];
  if(!source||!source.url||!configs.length)return {ok:false,error:'Source ou formats de capture manquants.'};
  const dirResult=await dialog.showOpenDialog({title:'Dossier des captures multi-écrans',properties:['openDirectory','createDirectory']});
  if(dirResult.canceled||!dirResult.filePaths[0])return {ok:false,canceled:true};
  const dir=dirResult.filePaths[0];
  const files=[];
  try{
    for(const cfg of configs){
      const width=Math.max(240,Number(cfg.width)||412),height=Math.max(240,Number(cfg.height)||915);
      const image=await captureSourceAtSize(source,width,height,payload.css,payload);
      const safeName=String(cfg.name||width+'x'+height).replace(/[^a-zA-Z0-9_-]+/g,'-');
      const file=path.join(dir,safeName+'-'+width+'x'+height+'.png');
      fs.writeFileSync(file,image.toPNG());
      files.push(file);
    }
    return {ok:true,dir,files};
  }catch(error){return {ok:false,error:'Capture multi-écrans impossible : '+String(error&&error.message||error)}}
});

function imageFromPayload(value){
  if(!value)return null;
  if(String(value).startsWith('data:'))return nativeImage.createFromDataURL(String(value));
  if(fs.existsSync(String(value)))return nativeImage.createFromPath(String(value));
  return null;
}

ipcMain.handle('regression:compare',async (_event,payload)=>{
  try{
    const baseline=imageFromPayload(payload&&payload.baseline);
    const current=imageFromPayload(payload&&payload.current);
    if(!baseline||baseline.isEmpty()||!current||current.isEmpty())return {ok:false,error:'Images de comparaison invalides.'};
    const size=baseline.getSize();
    const cur=current.resize({width:size.width,height:size.height,quality:'best'});
    const a=baseline.toBitmap(),b=cur.toBitmap();
    if(a.length!==b.length)return {ok:false,error:'Tailles bitmap incompatibles.'};
    const diff=Buffer.alloc(a.length);
    let changed=0,total=size.width*size.height;
    for(let i=0;i<a.length;i+=4){
      const db=Math.abs(a[i]-b[i]),dg=Math.abs(a[i+1]-b[i+1]),dr=Math.abs(a[i+2]-b[i+2]);
      const delta=(dr+dg+db)/3;
      if(delta>12)changed+=1;
      if(delta>12){diff[i]=40;diff[i+1]=40;diff[i+2]=230;diff[i+3]=255}
      else{
        const g=Math.round((a[i]+a[i+1]+a[i+2])/3*.45+120);
        diff[i]=g;diff[i+1]=g;diff[i+2]=g;diff[i+3]=150;
      }
    }
    const diffImage=nativeImage.createFromBitmap(diff,{width:size.width,height:size.height,scaleFactor:1});
    return {ok:true,changedPixels:changed,totalPixels:total,differencePercent:Math.round(changed/Math.max(1,total)*10000)/100,diffDataUrl:diffImage.toDataURL()};
  }catch(error){return {ok:false,error:'Comparaison visuelle impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('capture:current-source',async (_event,payload)=>{
  try{
    const width=Math.max(240,Number(payload&&payload.width)||412),height=Math.max(240,Number(payload&&payload.height)||915);
    const image=await captureSourceAtSize(payload&&payload.source,width,height,payload&&payload.css,payload);
    return {ok:true,dataUrl:image.toDataURL(),width,height};
  }catch(error){return {ok:false,error:String(error&&error.message||error)}}
});


function escapeRegex(value){
  const special='^$.*+?()[]{}|'+String.fromCharCode(92);
  return String(value||'').split('').map(ch=>special.includes(ch)?String.fromCharCode(92)+ch:ch).join('');
}
function detectAndroidProject(root){
  const manifestCandidates=[
    path.join(root,'app','src','main','AndroidManifest.xml'),
    path.join(root,'src','main','AndroidManifest.xml')
  ];
  const manifest=manifestCandidates.find(fs.existsSync);
  if(!manifest)return null;
  const appRoot=manifest.includes(path.join('app','src'))?path.join(root,'app'):root;
  const mainRoot=path.join(appRoot,'src','main');
  const layoutDir=path.join(mainRoot,'res','layout');
  const xmlLayouts=fs.existsSync(layoutDir)?walkFiles(layoutDir,['.xml'],120):[];
  const kotlinRoots=[path.join(mainRoot,'java'),path.join(mainRoot,'kotlin')].filter(fs.existsSync);
  const kotlinFiles=kotlinRoots.flatMap(dir=>walkFiles(dir,['.kt','.java'],250));
  const composeFiles=kotlinFiles.filter(file=>{
    try{return /@Composable|setContent\s*\{/.test(fs.readFileSync(file,'utf8'))}catch(_){return false}
  });
  return {root,manifest,appRoot,mainRoot,xmlLayouts,kotlinFiles,composeFiles,nativeKind:xmlLayouts.length?'xml':composeFiles.length?'compose':'android'};
}

function attrValue(attrs,name){
  const m=String(attrs||'').match(new RegExp(escapeRegex(name)+'\\s*=\\s*"([^"]*)"'));
  return m?m[1]:'';
}

function androidId(attrs){
  return attrValue(attrs,'android:id').replace(/^@\+?id\//,'');
}

function pxFromAndroid(value,fallback){
  const m=String(value||'').match(/(-?\d+(?:\.\d+)?)/);
  return m?Number(m[1]):fallback;
}

function xmlLayoutToHtml(file){
  const xml=fs.readFileSync(file,'utf8');
  const tokenRe=/<\/?[A-Za-z0-9_.$:-]+\b[^>]*>|<!--[\s\S]*?-->/g;
  const root={tag:'root',children:[]},stack=[root];
  let m,index=0;
  while((m=tokenRe.exec(xml))){
    const token=m[0];if(token.startsWith('<!--')||token.startsWith('<?'))continue;
    if(/^<\//.test(token)){if(stack.length>1)stack.pop();continue}
    const tag=(token.match(/^<\s*([A-Za-z0-9_.$:-]+)/)||[])[1];if(!tag)continue;
    const attrs=token.slice(token.indexOf(tag)+tag.length,token.lastIndexOf('>'));
    const node={tag,attrs,id:androidId(attrs),children:[],index:index++};
    stack[stack.length-1].children.push(node);
    if(!/\/\s*>$/.test(token))stack.push(node);
  }
  function esc(v){return String(v||'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
  function render(node){
    const short=node.tag.split('.').pop();
    const width=attrValue(node.attrs,'android:layout_width'),height=attrValue(node.attrs,'android:layout_height');
    const orientation=attrValue(node.attrs,'android:orientation');
    const text=attrValue(node.attrs,'android:text').replace(/^@string\//,'');
    const padding=pxFromAndroid(attrValue(node.attrs,'android:padding'),8);
    const margin=pxFromAndroid(attrValue(node.attrs,'android:layout_margin'),4);
    const bg=attrValue(node.attrs,'android:background');
    const isContainer=/Layout|ViewGroup|ScrollView|RecyclerView/i.test(short);
    const isButton=/Button/i.test(short);
    const isInput=/EditText|TextInput/i.test(short);
    const isImage=/ImageView/i.test(short);
    let style='box-sizing:border-box;margin:'+margin+'px;padding:'+padding+'px;min-height:'+(height==='wrap_content'?34:pxFromAndroid(height,50))+'px;';
    if(width==='match_parent')style+='width:100%;';
    if(height==='match_parent')style+='min-height:100%;';
    if(isContainer)style+='display:flex;flex-direction:'+(orientation==='horizontal'?'row':'column')+';gap:8px;';
    if(bg&&/^#/.test(bg))style+='background:'+bg+';';
    let content='';
    if(isButton)content='<button style="min-height:44px;padding:8px 14px">'+esc(text||short)+'</button>';
    else if(isInput)content='<input value="'+esc(text)+'" placeholder="'+esc(short)+'" style="min-height:44px;width:100%">';
    else if(isImage)content='<div style="min-height:80px;background:#ececf2;display:grid;place-items:center;border-radius:8px">Image</div>';
    else if(!isContainer)content='<div>'+esc(text||short)+'</div>';
    content+=node.children.map(render).join('');
    const key=node.id||('node-'+node.index);
    return '<div id="native-'+esc(key)+'" data-native-key="'+esc(key)+'" data-native-tag="'+esc(short)+'" style="'+style+'">'+content+'</div>';
  }
  return {body:root.children.map(render).join(''),xml,nodes:root.children};
}

function composeToHtml(file){
  const code=fs.readFileSync(file,'utf8'),lines=code.split(/\r?\n/),nodes=[];
  lines.forEach((line,i)=>{
    const m=line.match(/\b(Text|Button|IconButton|Image|Icon|Column|Row|Box|LazyColumn|LazyRow|TextField)\s*\(/);
    if(!m)return;
    const text=(line.match(/"([^"]{1,80})"/)||[])[1]||m[1];
    nodes.push({tag:m[1],line:i+1,text});
  });
  function esc(v){return String(v||'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
  const body=nodes.map((n,i)=>{
    const container=/Column|Row|Box|Lazy/.test(n.tag);
    return '<div id="native-compose-'+i+'" data-native-line="'+n.line+'" data-native-tag="'+n.tag+'" style="margin:6px;padding:10px;min-height:42px;border:1px solid #e0dce8;border-radius:9px;'+(container?'background:#f7f4fb;':'background:#fff;')+'"><small style="color:#7b6d88">'+n.tag+' · ligne '+n.line+'</small><div>'+esc(n.text)+'</div></div>';
  }).join('');
  return {body,nodes,code};
}

async function buildAndroidPreview(android){
  const key=hashText(android.root).slice(0,12);
  const dir=path.join(os.tmpdir(),'app-interface-studio-native',key);
  fs.mkdirSync(dir,{recursive:true});
  let content='',nativeFile='',nativeNodes=[];
  if(android.xmlLayouts.length){
    nativeFile=android.xmlLayouts.find(x=>path.basename(x).toLowerCase()==='activity_main.xml')||android.xmlLayouts[0];
    const parsed=xmlLayoutToHtml(nativeFile);content=parsed.body;nativeNodes=parsed.nodes;
  }else if(android.composeFiles.length){
    nativeFile=android.composeFiles[0];
    const parsed=composeToHtml(nativeFile);content=parsed.body;nativeNodes=parsed.nodes;
  }else content='<div style="padding:24px">Projet Android détecté, mais aucun layout XML ou composable simple n’a été trouvé.</div>';
  const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;font-family:system-ui;background:#fff;color:#222}body{padding:12px}.native-root{max-width:100%;min-height:100%;display:flex;flex-direction:column;gap:6px}</style></head><body><div class="native-root">'+content+'</div></body></html>';
  fs.writeFileSync(path.join(dir,'index.html'),html,'utf8');
  const url=await startLocalTarget(dir,'index.html');
  return {url,nativeFile,nativeKind:android.nativeKind,nativeNodes};
}

function flattenAndroidXml(file){
  const xml=fs.readFileSync(file,'utf8'),nodes=[];
  const re=/<([A-Za-z0-9_.$:-]+)\b([^>]*)>/g;let m,index=0;
  while((m=re.exec(xml))){
    if(m[0].startsWith('</')||m[0].startsWith('<?'))continue;
    const id=androidId(m[2]);
    nodes.push({key:id||('node-'+index++),id,tag:m[1].split('.').pop(),file,line:xml.slice(0,m.index).split(/\r?\n/).length,text:attrValue(m[2],'android:text'),width:attrValue(m[2],'android:layout_width'),height:attrValue(m[2],'android:layout_height')});
  }
  return nodes;
}

ipcMain.handle('source:native-tree',async (_event,payload)=>{
  const source=payload&&payload.source;
  if(!source||source.type!=='android-project')return {ok:false,error:'Projet Android requis.'};
  try{
    const android=detectAndroidProject(source.path);if(!android)return {ok:false,error:'Projet Android introuvable.'};
    let nodes=[];
    android.xmlLayouts.slice(0,20).forEach(file=>{nodes=nodes.concat(flattenAndroidXml(file))});
    android.composeFiles.slice(0,30).forEach(file=>{
      const parsed=composeToHtml(file);
      parsed.nodes.forEach((node,i)=>nodes.push({key:'compose-'+path.basename(file)+'-'+i,tag:node.tag,file,line:node.line,text:node.text,compose:true}));
    });
    return {ok:true,nativeKind:android.nativeKind,nodes:nodes.slice(0,600),files:{xml:android.xmlLayouts,compose:android.composeFiles}};
  }catch(error){return {ok:false,error:String(error&&error.message||error)}}
});

ipcMain.handle('source:prepare-native-edit',async (_event,payload)=>{
  const source=payload&&payload.source,node=payload&&payload.node,property=String(payload&&payload.property||''),value=String(payload&&payload.value||'');
  if(!source||source.type!=='android-project'||!node||!node.file)return {ok:false,error:'Sélection Android invalide.'};
  const file=String(node.file);
  if(!isPathInside(source.path,file))return {ok:false,error:'Fichier Android hors du projet.'};
  try{
    const before=fs.readFileSync(file,'utf8');let after=before;
    if(node.compose){
      const lines=before.split(/\r?\n/),idx=Math.max(0,Number(node.line)-1);
      if(idx>=lines.length)return {ok:false,error:'Ligne Compose introuvable.'};
      if(property==='text')lines[idx]=lines[idx].replace(/"[^"]*"/,'"'+value.replace(/"/g,'\\\"')+'"');
      else return {ok:false,error:'Pour Compose, le mode sûr modifie directement le texte. Les autres propriétés restent disponibles dans l’inspecteur avec aperçu du diff.'};
      after=lines.join('\n');
    }else{
      const id=node.id,tag=node.tag;let re;
      if(id)re=new RegExp('(<[^>]*android:id\\s*=\\s*"@\\+?id/'+escapeRegex(id)+'"[^>]*)(>)');
      else re=new RegExp('(<(?:[A-Za-z0-9_.$:-]+\\.)?'+escapeRegex(tag)+'\\b[^>]*)(>)');
      const m=after.match(re);if(!m)return {ok:false,error:'Élément XML introuvable.'};
      const attrMap={text:'android:text',textSize:'android:textSize',padding:'android:padding',margin:'android:layout_margin',width:'android:layout_width',height:'android:layout_height',background:'android:background',gravity:'android:gravity'};
      const attr=attrMap[property]||property;let tagText=m[1];
      const attrRe=new RegExp('\\s'+escapeRegex(attr)+'\\s*=\\s*"[^"]*"');
      const replacement=' '+attr+'="'+value.replace(/"/g,'&quot;')+'"';
      tagText=attrRe.test(tagText)?tagText.replace(attrRe,replacement):tagText+replacement;
      after=after.replace(m[0],tagText+m[2]);
    }
    return {ok:true,file,beforeHash:hashText(before),before,after,diff:simpleUnifiedDiff(before,after,path.relative(source.path,file))};
  }catch(error){return {ok:false,error:'Préparation Android impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('source:apply-native-edit',async (_event,payload)=>{
  const source=payload&&payload.source,file=String(payload&&payload.file||'');
  if(!source||source.type!=='android-project'||!isPathInside(source.path,file))return {ok:false,error:'Patch Android invalide.'};
  try{
    const before=fs.readFileSync(file,'utf8');
    if(payload.beforeHash&&hashText(before)!==payload.beforeHash)return {ok:false,error:'Le fichier Android a changé. Reprépare le diff.'};
    const backup=file+'.ais-backup-'+new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(file,backup);fs.writeFileSync(file,String(payload.after||''),'utf8');
    return {ok:true,file,backupPath:backup};
  }catch(error){return {ok:false,error:String(error&&error.message||error)}}
});


async function auditSourceAtConfig(source,css,cfg){
  const target=normalizeUrl(source&&source.url);
  if(!target)throw new Error('Source invalide.');
  const width=Math.max(240,Number(cfg.width)||412),height=Math.max(260,Number(cfg.height)||915),keyboard=Math.max(0,Number(cfg.keyboard)||0);
  const win=new BrowserWindow({show:false,width,height:Math.max(240,height-keyboard),useContentSize:true,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}});
  try{
    await win.loadURL(target);await new Promise(r=>setTimeout(r,320));
    let injected='';
    if(css&&String(css).trim()!=='/* Aucun ajustement. */')injected+=String(css);
    injected+='\nhtml{-webkit-text-size-adjust:'+Math.round((Number(cfg.fontScale)||1)*100)+'%!important;text-size-adjust:'+Math.round((Number(cfg.fontScale)||1)*100)+'%!important;color-scheme:'+(cfg.dark?'dark':'light')+';}';
    if(injected)await win.webContents.insertCSS(injected,{cssOrigin:'author'});
    await new Promise(r=>setTimeout(r,90));
    const audit=await win.webContents.executeJavaScript("(function(){var issues=[];if(document.documentElement.scrollWidth>innerWidth+2)issues.push({type:'overflow-x',amount:document.documentElement.scrollWidth-innerWidth});var nodes=Array.from(document.body.querySelectorAll('*')).slice(0,900);var clipped=0,small=0;nodes.forEach(function(el){var cs=getComputedStyle(el),r=el.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden'||r.width<1||r.height<1)return;if(el.children.length===0&&String(el.textContent||'').trim()&&(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2)&&/(hidden|clip)/.test(cs.overflow+cs.overflowX+cs.overflowY))clipped++;if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)&&(r.width<44||r.height<44))small++;});if(clipped)issues.push({type:'text-clipped',count:clipped});if(small)issues.push({type:'touch-target',count:small});return {issues:issues,scrollWidth:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight}};})()");
    let screenshot=null;
    if(audit.issues.length){const img=await win.webContents.capturePage();screenshot=img.toDataURL()}
    return {config:cfg,issues:audit.issues,screenshot,viewport:audit.viewport};
  }finally{if(!win.isDestroyed())win.destroy()}
}

ipcMain.handle('capture:test-matrix',async (_event,payload)=>{
  const source=payload&&payload.source;if(!source||!source.url)return {ok:false,error:'Source web requise.'};
  const sizes=[{name:'compact',width:360,height:800},{name:'phone',width:412,height:915},{name:'tablet',width:768,height:1024},{name:'desktop',width:1366,height:768}];
  const scales=[1,1.3,1.5],configs=[];
  sizes.forEach(size=>scales.forEach(fontScale=>configs.push({name:size.name,width:size.width,height:size.height,fontScale,dark:false,keyboard:size.width<600&&fontScale>=1.3?280:0})));
  const results=[];
  try{
    for(const cfg of configs)results.push(await auditSourceAtConfig(source,payload.css,cfg));
    return {ok:true,results,summary:{tested:results.length,failed:results.filter(x=>x.issues.length).length,totalIssues:results.reduce((n,x)=>n+x.issues.length,0)}};
  }catch(error){return {ok:false,error:'Matrice de tests impossible : '+String(error&&error.message||error),results}}
});

function hashText(value){
  return crypto.createHash('sha256').update(String(value||''),'utf8').digest('hex');
}

function isPathInside(root,file){
  const relative=path.relative(path.resolve(root),path.resolve(file));
  return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);
}

function walkFiles(root,extensions,maxFiles){
  const out=[];
  const wanted=new Set((extensions||[]).map(x=>String(x).toLowerCase()));
  function walk(dir,depth){
    if(depth>10||out.length>=(maxFiles||500))return;
    let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch(_){return}
    for(const entry of entries){
      if(out.length>=(maxFiles||500))break;
      if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='build'||entry.name==='.gradle')continue;
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())walk(file,depth+1);
      else if(!wanted.size||wanted.has(path.extname(entry.name).toLowerCase()))out.push(file);
    }
  }
  walk(root,0);
  return out;
}

function simpleUnifiedDiff(oldText,newText,label){
  const a=String(oldText||'').split(/\r?\n/),b=String(newText||'').split(/\r?\n/);
  let start=0;
  while(start<a.length&&start<b.length&&a[start]===b[start])start+=1;
  let endA=a.length-1,endB=b.length-1;
  while(endA>=start&&endB>=start&&a[endA]===b[endB]){endA-=1;endB-=1}
  const from=Math.max(0,start-3),toA=Math.min(a.length-1,endA+3),toB=Math.min(b.length-1,endB+3);
  const lines=['--- '+label,'+++ '+label,'@@ '+(from+1)+' @@'];
  for(let i=from;i<=toA;i+=1)lines.push('- '+a[i]);
  for(let i=from;i<=toB;i+=1)lines.push('+ '+b[i]);
  return lines.join('\n');
}

function cssDeclarationsFromRule(css,selector){
  const text=String(css||'');
  const re=new RegExp('(^|})\\s*'+escapeRegex(selector)+'\\s*\\{([^{}]*)\\}','m');
  const m=text.match(re);
  if(!m)return null;
  const out={};
  String(m[2]||'').split(';').forEach(part=>{
    const i=part.indexOf(':');
    if(i<0)return;
    const key=part.slice(0,i).trim(),value=part.slice(i+1).replace(/!important/g,'').trim();
    if(key&&value&&!key.startsWith('/*'))out[key]=value;
  });
  return out;
}

function mergeCssRule(content,selector,properties){
  const direct=new RegExp('(^|})\\s*'+escapeRegex(selector)+'\\s*\\{([^{}]*)\\}','m');
  const match=content.match(direct);
  function declarationBlock(existing){
    const map={};
    String(existing||'').split(';').forEach(part=>{
      const i=part.indexOf(':');if(i<0)return;
      const key=part.slice(0,i).trim(),value=part.slice(i+1).trim();if(key&&value)map[key]=value;
    });
    Object.keys(properties||{}).forEach(key=>{map[key]=String(properties[key]).replace(/\\s*!important\\s*$/,'').trim()});
    return Object.keys(map).map(key=>'  '+key+': '+map[key]+';').join('\n');
  }
  if(match){
    const whole=match[0],open=whole.indexOf('{'),close=whole.lastIndexOf('}');
    const replaced=whole.slice(0,open+1)+'\n'+declarationBlock(whole.slice(open+1,close))+'\n'+whole.slice(close);
    return {content:content.replace(whole,replaced),created:false};
  }
  return {content:content+'\n\n'+selector+' {\n'+declarationBlock('')+'\n}\n',created:true};
}

function directSourceCandidate(source,selector,css){
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Édition source directe disponible uniquement pour une application locale.'};
  const props=cssDeclarationsFromRule(css,selector);
  if(!props||!Object.keys(props).length)return {ok:false,error:'Aucune propriété exploitable pour la sélection actuelle.'};
  const files=walkFiles(local.root,['.css'],350).filter(file=>!file.endsWith('app-interface-studio.generated.css'));
  let chosen=null,bestScore=-1;
  for(const file of files){
    let text='';try{text=fs.readFileSync(file,'utf8')}catch(_){continue}
    const score=new RegExp(escapeRegex(selector)+'\\s*\\{').test(text)?100:(text.includes(selector)?20:0);
    if(score>bestScore){bestScore=score;chosen={file,text}}
  }
  if(!chosen){
    const fallback=path.join(path.dirname(local.html),'app-interface-studio.direct.css');
    chosen={file:fallback,text:fs.existsSync(fallback)?fs.readFileSync(fallback,'utf8'):''};
  }
  const merged=mergeCssRule(chosen.text,selector,props);
  return {
    ok:true,
    root:local.root,
    file:chosen.file,
    relativePath:path.relative(local.root,chosen.file),
    selector,
    properties:props,
    beforeHash:hashText(chosen.text),
    before:chosen.text,
    after:merged.content,
    created:!fs.existsSync(chosen.file),
    diff:simpleUnifiedDiff(chosen.text,merged.content,path.relative(local.root,chosen.file))
  };
}

ipcMain.handle('source:prepare-direct-edit',async (_event,payload)=>{
  try{return directSourceCandidate(payload&&payload.source,String(payload&&payload.selector||''),String(payload&&payload.css||''))}
  catch(error){return {ok:false,error:'Préparation du diff impossible : '+String(error&&error.message||error)}}
});

ipcMain.handle('source:apply-direct-edit',async (_event,payload)=>{
  const source=payload&&payload.source;
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Source locale requise.'};
  const file=String(payload&&payload.file||'');
  if(!file||!isPathInside(local.root,file))return {ok:false,error:'Chemin source refusé.'};
  try{
    const before=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
    if(payload.beforeHash&&hashText(before)!==payload.beforeHash)return {ok:false,error:'Le fichier a changé depuis la préparation du diff. Reprépare la modification.'};
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    let backupPath='';
    if(fs.existsSync(file)){backupPath=file+'.ais-backup-'+stamp;fs.copyFileSync(file,backupPath)}
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,String(payload.after||''),'utf8');
    let htmlBackupPath='';
    if(path.basename(file)==='app-interface-studio.direct.css'&&local.html&&fs.existsSync(local.html)){
      let html=fs.readFileSync(local.html,'utf8');
      const marker='data-app-interface-studio="direct"';
      if(!html.includes(marker)){
        const stamp2=new Date().toISOString().replace(/[:.]/g,'-');
        htmlBackupPath=local.html+'.ais-backup-'+stamp2;
        fs.copyFileSync(local.html,htmlBackupPath);
        const href='./'+path.relative(path.dirname(local.html),file).replace(/\\/g,'/');
        const link='<link rel="stylesheet" href="'+href+'" '+marker+'>';
        html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,'  '+link+'\n</head>'):link+'\n'+html;
        fs.writeFileSync(local.html,html,'utf8');
      }
    }
    return {ok:true,file,backupPath,htmlBackupPath,created:!before};
  }catch(error){return {ok:false,error:'Écriture source impossible : '+String(error&&error.message||error)}}
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
  if(entry){
    const url=await startLocalTarget(root,entry);
    return {ok:true,source:{type:'folder',path:root,entry,url,label:path.basename(root)}};
  }
  const android=detectAndroidProject(root);
  if(android){
    const preview=await buildAndroidPreview(android);
    return {ok:true,source:{type:'android-project',path:root,url:preview.url,label:path.basename(root)+' · Android natif',nativeKind:preview.nativeKind,nativeFile:preview.nativeFile}};
  }
  return {ok:false,error:'Aucun index.html ni projet Android détecté dans ce dossier.'};
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
    if(source.type==='android-project'){
      if(!source.path||!fs.existsSync(source.path))return {ok:false,error:'Le projet Android est introuvable.'};
      const android=detectAndroidProject(source.path);if(!android)return {ok:false,error:'Structure Android invalide.'};
      const preview=await buildAndroidPreview(android);
      return {ok:true,source:{...source,url:preview.url,nativeKind:preview.nativeKind,nativeFile:preview.nativeFile}};
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


function portableSafeName(value,fallback){
  const cleaned=String(value||'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90);
  return cleaned||fallback||'file';
}

function portableWalkMediaPaths(value,visitor,seen){
  if(!value||typeof value!=='object')return;
  seen=seen||new Set();
  if(seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){
    value.forEach(item=>portableWalkMediaPaths(item,visitor,seen));
    return;
  }
  Object.keys(value).forEach(key=>{
    if(key==='mediaAssetPath'&&typeof value[key]==='string'&&value[key])visitor(value,key,value[key]);
    else portableWalkMediaPaths(value[key],visitor,seen);
  });
}

function copyPortableSource(root,target){
  const skip=new Set(['.git','node_modules','.next','dist','build','coverage','.gradle','.idea','.vscode']);
  const stats={files:0,bytes:0,skipped:[]};
  const maxFiles=20000,maxBytes=300*1024*1024,maxSingle=40*1024*1024;
  function walk(src,dst){
    if(stats.files>=maxFiles||stats.bytes>=maxBytes)return;
    fs.mkdirSync(dst,{recursive:true});
    let names=[];
    try{names=fs.readdirSync(src)}catch(_){return}
    for(const name of names){
      if(stats.files>=maxFiles||stats.bytes>=maxBytes)break;
      if(skip.has(name)){stats.skipped.push(path.join(src,name));continue}
      const from=path.join(src,name),to=path.join(dst,name);
      let stat=null;try{stat=fs.statSync(from)}catch(_){continue}
      if(stat.isDirectory()){walk(from,to);continue}
      if(!stat.isFile())continue;
      if(stat.size>maxSingle||stats.bytes+stat.size>maxBytes){stats.skipped.push(from);continue}
      fs.mkdirSync(path.dirname(to),{recursive:true});
      fs.copyFileSync(from,to);
      stats.files+=1;stats.bytes+=stat.size;
    }
  }
  walk(root,target);
  return stats;
}

function resolvePortableStrings(value,bundle,seen){
  if(!value||typeof value!=='object')return;
  seen=seen||new Set();
  if(seen.has(value))return;
  seen.add(value);
  if(Array.isArray(value)){value.forEach(item=>resolvePortableStrings(item,bundle,seen));return}
  Object.keys(value).forEach(key=>{
    const current=value[key];
    if(typeof current==='string'&&current.startsWith('portable://')){
      const rel=current.slice('portable://'.length).split('/').filter(Boolean).map(decodeURIComponent);
      const resolved=path.resolve(bundle,...rel);
      const base=path.resolve(bundle)+path.sep;
      if(resolved===path.resolve(bundle)||resolved.startsWith(base))value[key]=resolved;
    }else resolvePortableStrings(current,bundle,seen);
  });
}

function writePortableBundle(project,bundle){
  bundle=path.resolve(bundle);
  const clone=JSON.parse(JSON.stringify(project||{}));
  const temp=bundle+'.tmp-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex');
  try{
    fs.rmSync(temp,{recursive:true,force:true});
    fs.mkdirSync(temp,{recursive:true});
    const assetsDir=path.join(temp,'assets');
    fs.mkdirSync(assetsDir,{recursive:true});
    const assetMap=new Map();
    let assetCount=0,assetBytes=0;
    portableWalkMediaPaths(clone,(holder,key,source)=>{
      if(String(source).startsWith('portable://'))return;
      const absolute=path.resolve(source);
      if(!fs.existsSync(absolute))return;
      let stat=null;try{stat=fs.statSync(absolute)}catch(_){return}
      if(!stat.isFile()||stat.size>40*1024*1024)return;
      let rel=assetMap.get(absolute);
      if(!rel){
        const bytes=fs.readFileSync(absolute);
        const hash=crypto.createHash('sha1').update(bytes).digest('hex').slice(0,12);
        const ext=path.extname(absolute).toLowerCase();
        const name=portableSafeName(path.basename(absolute,ext),'asset')+'-'+hash+ext;
        fs.writeFileSync(path.join(assetsDir,name),bytes);
        rel='assets/'+encodeURIComponent(name);
        assetMap.set(absolute,rel);assetCount+=1;assetBytes+=bytes.length;
      }
      holder[key]='portable://'+rel;
    });

    let sourceStats={files:0,bytes:0,skipped:[]};
    const local=localSourceEntry(clone.source);
    if(local&&fs.existsSync(local.root||path.dirname(local.html))){
      const sourceRoot=path.resolve(local.root||path.dirname(local.html));
      const sourceDir=path.join(temp,'source');
      sourceStats=copyPortableSource(sourceRoot,sourceDir);
      const entryRel=path.relative(sourceRoot,path.resolve(local.html)).replace(/\\/g,'/');
      if(clone.source&&clone.source.type==='html'){
        clone.source.root='portable://source';
        clone.source.path='portable://source/'+entryRel.split('/').map(encodeURIComponent).join('/');
      }else if(clone.source){
        clone.source.path='portable://source';
        clone.source.root='portable://source';
        clone.source.entry=entryRel||clone.source.entry||'index.html';
      }
      if(clone.source)clone.source.url='';
    }

    clone.portable={
      format:'app-interface-studio-portable',
      version:1,
      exportedAt:new Date().toISOString(),
      assetCount,assetBytes,
      sourceFiles:sourceStats.files,sourceBytes:sourceStats.bytes,
      sourceSkipped:sourceStats.skipped.length
    };
    fs.writeFileSync(path.join(temp,'project.json'),JSON.stringify(clone,null,2),'utf8');
    fs.rmSync(bundle,{recursive:true,force:true});
    fs.renameSync(temp,bundle);
    return {ok:true,path:bundle,assetCount,assetBytes,sourceFiles:sourceStats.files,sourceBytes:sourceStats.bytes,sourceSkipped:sourceStats.skipped.length};
  }catch(error){
    try{fs.rmSync(temp,{recursive:true,force:true})}catch(_){}
    return {ok:false,error:'Export portable impossible : '+String(error&&error.message||error)};
  }
}

function readPortableBundle(bundle){
  bundle=path.resolve(bundle);
  const manifest=path.join(bundle,'project.json');
  if(!fs.existsSync(manifest))return {ok:false,error:'Ce dossier ne contient pas project.json.'};
  try{
    const project=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(!project.portable||project.portable.format!=='app-interface-studio-portable')return {ok:false,error:'Projet portable invalide.'};
    resolvePortableStrings(project,bundle);
    return {ok:true,path:bundle,project,portable:project.portable};
  }catch(error){
    return {ok:false,error:'Ouverture du projet portable impossible : '+String(error&&error.message||error)};
  }
}

ipcMain.handle('layout:export-portable',async (_event,project)=>{
  const result=await dialog.showSaveDialog({
    title:'Exporter un projet portable',
    defaultPath:'interface.ais-portable',
    filters:[{name:'Projet portable App Interface Studio',extensions:['ais-portable']}]
  });
  if(result.canceled||!result.filePath)return {ok:false,canceled:true};
  return writePortableBundle(project,result.filePath);
});

ipcMain.handle('layout:import-portable',async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Ouvrir un projet portable',
    properties:['openDirectory']
  });
  if(result.canceled||!result.filePaths[0])return {ok:false,canceled:true};
  return readPortableBundle(result.filePaths[0]);
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
