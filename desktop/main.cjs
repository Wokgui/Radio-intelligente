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
            const required=['sourceName','mediaCard','versionList','svgTintControls','assetAuditList','layoutDiagnosticList','cascadeList','containerDiagnosticList','stackingDiagnosticList','overrideCleanupList','advancedCssList','routeAnalyzeList','componentTestStatus','finalControlList','exportFinalReportBtn','sourcePropertyList','scenarioList','savedScenarioList','scenarioReplayResults','keyboardAuditResult','i18nAuditList','fontAuditList','animationAuditList','dynamicDiagnosticsStatus','performanceMetrics','performanceRegressionStatus','networkTestResults','selectorStability','appFrame'];
            const missing=required.filter(function(id){return !document.getElementById(id)});
            if(!api||api.isDesktop!==true)return {ok:false,error:'Bridge desktop indisponible',missing:missing};
            if(missing.length)return {ok:false,error:'Éléments UI manquants',missing:missing};
            const sourceSafetyBridge=typeof api.validateDirectEdit==='function'&&typeof api.analyzeOverrides==='function'&&typeof api.cleanupOverrides==='function'&&typeof api.analyzeCssCleanup==='function'&&typeof api.prepareCssCleanup==='function'&&typeof api.applyCssCleanup==='function';
            const interactionBridge=typeof api.replayScenario==='function'&&typeof api.keyboardAccessibilityAudit==='function'&&typeof api.smokeCascadeFixtures==='function';
            const performanceBridge=typeof api.profilePerformance==='function'&&typeof api.testNetwork==='function'&&typeof api.smokeScenarioFixture==='function';
            const reportBridge=typeof api.analyzeRoutes==='function'&&typeof api.exportReport==='function'&&typeof api.smokeRouteFixture==='function'&&typeof api.smokeReportFixture==='function';
            const info=await api.appInfo();
            const demo=await api.openDemo();
            if(!demo||!demo.ok||!demo.source)return {ok:false,error:'Ouverture de la démo impossible',demo:demo};
            const shot=await api.captureCurrentSource({source:demo.source,width:360,height:800,css:'/* smoke test */'});
            const captureOk=!!(shot&&shot.ok&&typeof shot.dataUrl==='string'&&shot.dataUrl.indexOf('data:image/png')===0);
            const regression=await api.compareRegression({baseline:shot&&shot.dataUrl,current:shot&&shot.dataUrl});
            const regressionOk=!!(regression&&regression.ok&&regression.changedPixels===0&&regression.differencePercent===0&&typeof regression.diffDataUrl==='string'&&regression.diffDataUrl.indexOf('data:image/png')===0);
            const matrix=await api.runTestMatrix({source:demo.source,css:'/* smoke test */'});
            const matrixOk=!!(matrix&&matrix.ok&&matrix.summary&&matrix.summary.tested===12&&Array.isArray(matrix.results)&&matrix.results.length===12);
            const performanceProfile=await api.profilePerformance({source:demo.source,css:'/* smoke test */'});
            const performanceOk=!!(performanceProfile&&performanceProfile.ok&&performanceProfile.metrics&&Number.isFinite(Number(performanceProfile.metrics.domNodes)));
            const roundtrip=await api.smokeTransactionRoundtrip();
            const atomicFailure=await api.smokeAtomicFailureRollback();
            const portableRoundtrip=await api.smokePortableRoundtrip();
            const cascadeFixtures=await api.smokeCascadeFixtures();
            const scenarioFixture=await api.smokeScenarioFixture();
            const cssCleanupFixture=await api.smokeCssCleanupFixture();
            const routeFixture=await api.smokeRouteFixture();
            const reportFixture=await api.smokeReportFixture();
            return {
              ok:!!(info&&info.name==='App Interface Studio'&&sourceSafetyBridge&&interactionBridge&&performanceBridge&&reportBridge&&captureOk&&regressionOk&&matrixOk&&performanceOk&&roundtrip&&roundtrip.ok&&atomicFailure&&atomicFailure.ok&&portableRoundtrip&&portableRoundtrip.ok&&cascadeFixtures&&cascadeFixtures.ok&&scenarioFixture&&scenarioFixture.ok&&cssCleanupFixture&&cssCleanupFixture.ok&&routeFixture&&routeFixture.ok&&reportFixture&&reportFixture.ok),
              version:info&&info.version,
              bridge:true,
              sourceSafetyBridge:sourceSafetyBridge,
              interactionBridge:interactionBridge,
              performanceBridge:performanceBridge,
              reportBridge:reportBridge,
              ui:true,
              demoUrl:demo.source.url,
              captureOk:captureOk,
              captureSize:shot&&shot.width+'x'+shot.height,
              regressionOk:regressionOk,
              regressionDifferencePercent:regression&&regression.differencePercent,
              matrixOk:matrixOk,
              matrixSummary:matrix&&matrix.summary,
              performanceOk:performanceOk,
              performanceMetrics:performanceProfile&&performanceProfile.metrics,
              transactionRoundtrip:roundtrip,
              atomicFailure:atomicFailure,
              portableRoundtrip:portableRoundtrip,
              cascadeFixtures:cascadeFixtures,
              scenarioFixture:scenarioFixture,
              cssCleanupFixture:cssCleanupFixture,
              routeFixture:routeFixture,
              reportFixture:reportFixture
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
  const transactionPath=transactionFile(plan.dir,stamp);
  const createdAssets=[];
  let cssBackup=null,jsBackup=null;
  const existedBefore={
    css:fs.existsSync(plan.cssPath),
    js:fs.existsSync(plan.jsPath)
  };
  const touched={html:false,css:false,js:false,transaction:false};

  try{
    fs.copyFileSync(plan.local.html,htmlBackupPath);
    cssBackup=optionalFileBackup(plan.cssPath,stamp);
    jsBackup=optionalFileBackup(plan.jsPath,stamp);

    for(const asset of plan.assetCopies||[]){
      fs.mkdirSync(path.dirname(asset.target),{recursive:true});
      if(!fs.existsSync(asset.target)){
        createdAssets.push(asset.target);
        fs.copyFileSync(asset.source,asset.target);
      }
    }

    if(plan.changed.css){
      touched.css=true;
      if(plan.after.css)fs.writeFileSync(plan.cssPath,plan.after.css,'utf8');
      else if(fs.existsSync(plan.cssPath))fs.unlinkSync(plan.cssPath);
    }
    if(plan.changed.structure){
      touched.js=true;
      if(plan.after.js)fs.writeFileSync(plan.jsPath,plan.after.js,'utf8');
      else if(fs.existsSync(plan.jsPath))fs.unlinkSync(plan.jsPath);
    }
    if(plan.changed.html){
      touched.html=true;
      fs.writeFileSync(plan.local.html,plan.after.html,'utf8');
    }

    const transaction={
      version:4,
      createdAt:new Date().toISOString(),
      sourceHtml:path.resolve(plan.local.html),
      htmlBackupPath,
      cssPath:plan.cssPath,
      cssExisted:cssBackup&&cssBackup.existed,
      cssBackupPath:cssBackup&&cssBackup.backupPath,
      jsPath:plan.jsPath,
      jsExisted:jsBackup&&jsBackup.existed,
      jsBackupPath:jsBackup&&jsBackup.backupPath,
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
    touched.transaction=true;
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
    const rollbackErrors=[];
    if(touched.html){
      try{fs.writeFileSync(plan.local.html,plan.before.html,'utf8')}
      catch(restoreError){rollbackErrors.push('HTML: '+String(restoreError&&restoreError.message||restoreError))}
    }
    if(touched.css){
      try{
        if(existedBefore.css)fs.writeFileSync(plan.cssPath,plan.before.css,'utf8');
        else if(fs.existsSync(plan.cssPath))fs.unlinkSync(plan.cssPath);
      }catch(restoreError){rollbackErrors.push('CSS: '+String(restoreError&&restoreError.message||restoreError))}
    }
    if(touched.js){
      try{
        if(existedBefore.js)fs.writeFileSync(plan.jsPath,plan.before.js,'utf8');
        else if(fs.existsSync(plan.jsPath))fs.unlinkSync(plan.jsPath);
      }catch(restoreError){rollbackErrors.push('JS: '+String(restoreError&&restoreError.message||restoreError))}
    }
    createdAssets.forEach(assetFile=>{
      try{if(assetFile&&fs.existsSync(assetFile))fs.unlinkSync(assetFile)}
      catch(restoreError){rollbackErrors.push('asset '+path.basename(assetFile)+': '+String(restoreError&&restoreError.message||restoreError))}
    });
    if(touched.transaction){
      try{if(fs.existsSync(transactionPath))fs.unlinkSync(transactionPath)}
      catch(restoreError){rollbackErrors.push('transaction: '+String(restoreError&&restoreError.message||restoreError))}
    }

    if(!rollbackErrors.length){
      try{if(fs.existsSync(htmlBackupPath))fs.unlinkSync(htmlBackupPath)}catch(_){}
      cleanupOptionalBackup(cssBackup);
      cleanupOptionalBackup(jsBackup);
    }

    return {
      ok:false,
      error:'Application au code impossible : '+String(error&&error.message||error)+(rollbackErrors.length?' · rollback incomplet : '+rollbackErrors.join(' | '):''),
      rolledBack:rollbackErrors.length===0,
      recoveryBackups:rollbackErrors.length?[htmlBackupPath,cssBackup&&cssBackup.backupPath,jsBackup&&jsBackup.backupPath].filter(Boolean):[]
    };
  }
}

async function rollbackLocalPatch(payload){
  const local=localSourceEntry(payload&&payload.source);
  if(!local)return {ok:false,error:'Rollback disponible uniquement pour une source HTML locale.'};
  try{
    const history=listLocalTransactions({source:payload&&payload.source});
    if(!history.ok)return history;
    const chosenPath=history.nextRollbackPath;
    if(!chosenPath)return {ok:false,error:'Aucun patch local à annuler pour cette source.'};

    let chosen=null,chosenText='';
    try{
      chosenText=fs.readFileSync(chosenPath,'utf8');
      chosen=JSON.parse(chosenText);
    }catch(_){}
    if(!chosen)return {ok:false,error:'Transaction du prochain rollback introuvable ou invalide.'};
    if(!chosen.htmlBackupPath||!fs.existsSync(chosen.htmlBackupPath))return {ok:false,error:'Sauvegarde HTML du dernier patch introuvable.'};
    if(chosen.cssExisted&&(!chosen.cssBackupPath||!fs.existsSync(chosen.cssBackupPath)))return {ok:false,error:'Sauvegarde CSS du dernier patch introuvable.'};
    if(chosen.jsExisted&&(!chosen.jsBackupPath||!fs.existsSync(chosen.jsBackupPath)))return {ok:false,error:'Sauvegarde JS du dernier patch introuvable.'};

    const current={
      html:fs.readFileSync(local.html,'utf8'),
      css:{existed:!!(chosen.cssPath&&fs.existsSync(chosen.cssPath)),content:chosen.cssPath&&fs.existsSync(chosen.cssPath)?fs.readFileSync(chosen.cssPath,'utf8'):''},
      js:{existed:!!(chosen.jsPath&&fs.existsSync(chosen.jsPath)),content:chosen.jsPath&&fs.existsSync(chosen.jsPath)?fs.readFileSync(chosen.jsPath,'utf8'):''},
      assets:[]
    };
    for(const assetFile of Array.isArray(chosen.createdAssets)?chosen.createdAssets:[]){
      if(assetFile&&fs.existsSync(assetFile)){
        current.assets.push({file:assetFile,bytes:fs.readFileSync(assetFile)});
      }
    }

    try{
      fs.copyFileSync(chosen.htmlBackupPath,local.html);
      restoreOptionalFile(chosen.cssPath,!!chosen.cssExisted,chosen.cssBackupPath);
      restoreOptionalFile(chosen.jsPath,!!chosen.jsExisted,chosen.jsBackupPath);
      (Array.isArray(chosen.createdAssets)?chosen.createdAssets:[]).forEach(assetFile=>{
        if(assetFile&&fs.existsSync(assetFile))fs.unlinkSync(assetFile);
      });

      chosen.rolledBack=true;
      chosen.rolledBackAt=new Date().toISOString();
      writeTextFilesTransactional([{file:chosenPath,text:JSON.stringify(chosen,null,2)+'\n'}]);

      return {
        ok:true,
        htmlPath:local.html,
        transactionPath:chosenPath,
        restoredAt:chosen.rolledBackAt,
        removedAssets:Array.isArray(chosen.createdAssets)?chosen.createdAssets.slice():[]
      };
    }catch(error){
      const restoreErrors=[];
      try{fs.writeFileSync(local.html,current.html,'utf8')}catch(e){restoreErrors.push('HTML: '+String(e&&e.message||e))}
      try{
        if(chosen.cssPath){
          if(current.css.existed)fs.writeFileSync(chosen.cssPath,current.css.content,'utf8');
          else if(fs.existsSync(chosen.cssPath))fs.unlinkSync(chosen.cssPath);
        }
      }catch(e){restoreErrors.push('CSS: '+String(e&&e.message||e))}
      try{
        if(chosen.jsPath){
          if(current.js.existed)fs.writeFileSync(chosen.jsPath,current.js.content,'utf8');
          else if(fs.existsSync(chosen.jsPath))fs.unlinkSync(chosen.jsPath);
        }
      }catch(e){restoreErrors.push('JS: '+String(e&&e.message||e))}
      for(const asset of current.assets){
        try{fs.mkdirSync(path.dirname(asset.file),{recursive:true});fs.writeFileSync(asset.file,asset.bytes)}
        catch(e){restoreErrors.push('asset '+path.basename(asset.file)+': '+String(e&&e.message||e))}
      }
      try{writeTextFilesTransactional([{file:chosenPath,text:chosenText}])}
      catch(e){restoreErrors.push('transaction: '+String(e&&e.message||e))}
      return {
        ok:false,
        error:'Annulation du patch impossible : '+String(error&&error.message||error)+(restoreErrors.length?' · restauration de l’état courant incomplète : '+restoreErrors.join(' | '):''),
        currentStateRestored:restoreErrors.length===0
      };
    }
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

  const planned=active.slice(0,targetIndex+1);
  for(const item of planned){
    let tx=null;
    try{tx=JSON.parse(fs.readFileSync(item.path,'utf8'))}
    catch(_){return {ok:false,error:'Prévalidation impossible : transaction illisible '+path.basename(item.path)+'.'}};
    if(!tx.htmlBackupPath||!fs.existsSync(tx.htmlBackupPath))return {ok:false,error:'Prévalidation impossible : sauvegarde HTML manquante pour '+path.basename(item.path)+'.'};
    if(tx.cssExisted&&(!tx.cssBackupPath||!fs.existsSync(tx.cssBackupPath)))return {ok:false,error:'Prévalidation impossible : sauvegarde CSS manquante pour '+path.basename(item.path)+'.'};
    if(tx.jsExisted&&(!tx.jsBackupPath||!fs.existsSync(tx.jsBackupPath)))return {ok:false,error:'Prévalidation impossible : sauvegarde JS manquante pour '+path.basename(item.path)+'.'};
  }

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

async function smokeAtomicFailureRollback(){
  const dir=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-atomic-failure-'));
  const htmlPath=path.join(dir,'index.html');
  const original='<!doctype html><html><head><meta charset="utf-8"></head><body><div id="title">Original</div></body></html>';
  fs.writeFileSync(htmlPath,original,'utf8');
  const source={type:'html',path:htmlPath,root:dir,entry:'index.html',url:'http://127.0.0.1:1/index.html',label:'atomic failure fixture'};
  const payload={
    source,
    css:'#title { color: rgb(9, 8, 7) !important; }',
    generatedNodes:[],
    sourceSelectors:['#title'],
    prototypeLinks:{},
    domPatches:[{selector:'#title',textAdjusted:true,textContent:'Changed'}],
    applyParts:{css:true,structure:true}
  };
  const originalWrite=fs.writeFileSync;
  try{
    fs.writeFileSync=function(file,...args){
      if(/app-interface-studio\.transaction-.*\.json$/i.test(String(file)))throw new Error('AIS forced transaction write failure');
      return originalWrite.call(fs,file,...args);
    };
    const result=await applyLocalPatch(payload);
    if(result&&result.ok)throw new Error('La panne forcée aurait dû faire échouer le patch.');
    if(!result||result.rolledBack!==true)throw new Error('Le rollback atomique n’a pas été confirmé : '+JSON.stringify(result));
    if(fs.readFileSync(htmlPath,'utf8')!==original)throw new Error('HTML non restauré après panne forcée.');
    if(fs.existsSync(path.join(dir,'app-interface-studio.generated.css')))throw new Error('CSS généré restant après panne forcée.');
    if(fs.existsSync(path.join(dir,'app-interface-studio.generated.js')))throw new Error('JS généré restant après panne forcée.');
    const debris=fs.readdirSync(dir).filter(name=>/\.ais-backup-|app-interface-studio\.transaction-/i.test(name));
    if(debris.length)throw new Error('Débris transactionnels après rollback : '+debris.join(', '));
    return {ok:true,forcedFailure:true,rolledBack:true,clean:true};
  }finally{
    fs.writeFileSync=originalWrite;
    try{fs.rmSync(dir,{recursive:true,force:true})}catch(_){}
  }
}
if(smokeMode)ipcMain.handle('smoke:atomic-failure-rollback',async ()=>smokeAtomicFailureRollback());


async function smokePortableProjectRoundtrip(){
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-portable-smoke-'));
  const sourceDir=path.join(root,'original-source');
  const externalDir=path.join(root,'external');
  const bundle=path.join(root,'roundtrip.ais-portable');
  fs.mkdirSync(path.join(sourceDir,'dist'),{recursive:true});
  fs.mkdirSync(externalDir,{recursive:true});
  const htmlPath=path.join(sourceDir,'dist','index.html');
  const assetPath=path.join(externalDir,'icon.svg');
  const capture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2V8AAAAASUVORK5CYII=';
  fs.writeFileSync(htmlPath,'<!doctype html><html><body><div id="portable">Portable</div></body></html>','utf8');
  fs.writeFileSync(path.join(sourceDir,'dist','app.js'),'document.body.dataset.portable="yes";','utf8');
  fs.writeFileSync(assetPath,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>','utf8');
  const project={
    format:'app-layout-project',
    version:6,
    source:{type:'folder',path:sourceDir,root:sourceDir,entry:'dist/index.html',label:'Portable fixture',url:'http://127.0.0.1:1/dist/index.html'},
    snapshot:{items:[{selector:'#portable',mediaAdjusted:true,mediaAssetPath:assetPath,mediaName:'icon.svg'}],generatedNodes:[],selectedSelector:'#portable',selectedSelectors:['#portable']},
    namedVersions:[{id:'portable-v1',name:'Capture portable',createdAt:new Date().toISOString(),project:{snapshot:{items:[]}},thumbnail:capture}],
    hostPreferences:{fontScale:117,density:'compact',autoRecovery:true},
    regressionBaseline:capture,
    referenceCapture:capture,
    studio:{name:'App Interface Studio',version:app.getVersion()}
  };
  try{
    const written=writePortableBundle(project,bundle);
    if(!written.ok)throw new Error(written.error||'Écriture portable échouée.');
    if(written.assetCount!==1)throw new Error('Nombre d’assets portables incorrect : '+written.assetCount);
    if(written.sourceFiles<2)throw new Error('Copie de source portable incomplète.');
    if(!fs.existsSync(path.join(bundle,'project.json')))throw new Error('Manifest portable absent.');
    const opened=readPortableBundle(bundle);
    if(!opened.ok)throw new Error(opened.error||'Lecture portable échouée.');
    const loaded=opened.project||{};
    if(!loaded.source||!fs.existsSync(loaded.source.path))throw new Error('Source portable non relocalisée.');
    const loadedAsset=loaded.snapshot&&loaded.snapshot.items&&loaded.snapshot.items[0]&&loaded.snapshot.items[0].mediaAssetPath;
    if(!loadedAsset||!fs.existsSync(loadedAsset)||path.dirname(loadedAsset)!==path.join(bundle,'assets'))throw new Error('Asset portable non relocalisé.');
    if(!loaded.namedVersions||loaded.namedVersions[0].thumbnail!==capture)throw new Error('Capture de version portable perdue.');
    if(!loaded.hostPreferences||loaded.hostPreferences.fontScale!==117||loaded.hostPreferences.density!=='compact')throw new Error('Préférences portables perdues.');
    if(loaded.regressionBaseline!==capture||loaded.referenceCapture!==capture)throw new Error('Captures de référence portables perdues.');
    const sourceIndex=path.join(bundle,'source','dist','index.html');
    const sourceScript=path.join(bundle,'source','dist','app.js');
    if(!fs.existsSync(sourceIndex)||!fs.existsSync(sourceScript))throw new Error('Fichiers source portables absents.');
    const serialized=fs.readFileSync(path.join(bundle,'project.json'),'utf8');
    if(serialized.includes(assetPath)||serialized.includes(sourceDir))throw new Error('Le manifest portable contient encore un chemin absolu de la machine source.');
    return {ok:true,assetCount:written.assetCount,sourceFiles:written.sourceFiles,relocatedAsset:true,relocatedSource:true,captures:true,preferences:true};
  }finally{
    try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}
  }
}

if(smokeMode)ipcMain.handle('smoke:portable-roundtrip',async ()=>smokePortableProjectRoundtrip());

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
  let before='',backup='',loadedBefore=false;
  try{
    before=fs.readFileSync(file,'utf8');
    loadedBefore=true;
    if(payload.beforeHash&&hashText(before)!==payload.beforeHash)return {ok:false,error:'Le fichier Android a changé. Reprépare le diff.'};
    backup=file+'.ais-backup-'+new Date().toISOString().replace(/[:.]/g,'-');
    fs.copyFileSync(file,backup);
    fs.writeFileSync(file,String(payload.after||''),'utf8');
    return {ok:true,file,backupPath:backup};
  }catch(error){
    let rolledBack=false;
    if(loadedBefore){
      try{fs.writeFileSync(file,before,'utf8');rolledBack=true}catch(_){}
    }
    return {ok:false,error:String(error&&error.message||error),rolledBack};
  }
});


function browserResponsiveAudit(){
  function esc(v){
    try{return CSS.escape(v)}
    catch(_){return String(v).replace(/[^a-zA-Z0-9_-]/g,function(ch){return '\\'+ch})}
  }
  function selectorFor(el){
    if(!el||el.nodeType!==1)return '';
    if(el.id)return '#'+esc(el.id);
    var p=[],n=el,guard=0;
    while(n&&n.nodeType===1&&n!==document.body&&guard++<7){
      var part=n.tagName.toLowerCase();
      var cls=Array.from(n.classList||[]).find(function(x){return !/^ve-/.test(x)});
      if(cls)part+='.'+esc(cls);
      var parent=n.parentElement;
      if(parent){
        var same=Array.from(parent.children).filter(function(x){return x.tagName===n.tagName});
        if(same.length>1)part+=':nth-of-type('+(same.indexOf(n)+1)+')';
      }
      p.unshift(part);
      try{if(document.querySelectorAll(p.join(' > ')).length===1)break}catch(_){}
      n=parent;
    }
    return p.join(' > ');
  }
  var unreadableSheets=[];
  function activeRulesFor(el){
    var found=[],order=0,visited=0,truncated=false;
    function walk(rules,href,context){
      Array.from(rules||[]).forEach(function(rule){
        if(visited++>2200){truncated=true;return}
        if(rule.type===1&&rule.selectorText){
          order++;
          String(rule.selectorText).split(',').map(function(x){return x.trim()}).filter(Boolean).forEach(function(sel){
            var match=false;try{match=el.matches(sel)}catch(_){}
            if(!match)return;
            var props={};
            ['width','min-width','max-width','height','min-height','max-height','display','position','left','right','top','bottom','overflow','overflow-x','overflow-y','white-space','flex','flex-basis','flex-grow','flex-shrink','flex-wrap','grid-template-columns','grid-auto-columns','gap','row-gap','column-gap','margin','padding','box-sizing','transform','contain','content-visibility'].forEach(function(prop){
              var val=rule.style.getPropertyValue(prop);
              if(val)props[prop]=val.trim()+(rule.style.getPropertyPriority(prop)==='important'?' !important':'');
            });
            if(Object.keys(props).length)found.push({selector:sel,selectorText:rule.selectorText,href:href||'',context:context||'',order:order,properties:props});
          });
          return;
        }
        if(rule.cssRules){
          var active=true,next=context||'';
          if(rule.type===4&&rule.conditionText){
            try{active=matchMedia(rule.conditionText).matches}catch(_){active=true}
            next=(next?next+' · ':'')+'@media '+rule.conditionText;
          }else if(rule.constructor&&/CSSLayerBlockRule/.test(rule.constructor.name||'')){
            next=(next?next+' · ':'')+'@layer '+(rule.name||'(anonyme)');
          }else if(rule.conditionText){
            next=(next?next+' · ':'')+String(rule.conditionText);
          }
          if(active)walk(rule.cssRules,href,next);
        }
      });
    }
    Array.from(document.styleSheets||[]).slice(0,120).forEach(function(sheet){
      try{walk(sheet.cssRules,sheet.href||'','')}
      catch(_){unreadableSheets.push(sheet.href||'(feuille inline inaccessible)')}
    });
    return {rules:found.slice(-20),truncated:truncated};
  }
  function culprit(el,reason){
    var cs=getComputedStyle(el),r=el.getBoundingClientRect(),parent=el.parentElement,pr=parent&&parent.getBoundingClientRect();
    var ruleData=activeRulesFor(el);
    return {
      selector:selectorFor(el),reason:reason,
      metrics:{width:Math.round(r.width),height:Math.round(r.height),clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,parentWidth:pr?Math.round(pr.width):null},
      computed:{width:cs.width,minWidth:cs.minWidth,maxWidth:cs.maxWidth,height:cs.height,minHeight:cs.minHeight,maxHeight:cs.maxHeight,display:cs.display,position:cs.position,overflow:cs.overflow,overflowX:cs.overflowX,overflowY:cs.overflowY,whiteSpace:cs.whiteSpace,flex:cs.flex,flexShrink:cs.flexShrink,flexWrap:cs.flexWrap,gridTemplateColumns:cs.gridTemplateColumns,gap:cs.gap,boxSizing:cs.boxSizing,transform:cs.transform},
      rules:ruleData.rules,
      truncatedRules:ruleData.truncated
    };
  }
  var allNodes=Array.from(document.body.querySelectorAll('*'));
  var truncatedNodes=allNodes.length>1200;
  var nodes=allNodes.slice(0,1200),issues=[],overflowC=[],clippedC=[],small=0;
  if(document.documentElement.scrollWidth>innerWidth+2){
    nodes.forEach(function(el){
      var cs=getComputedStyle(el),r=el.getBoundingClientRect();
      if(cs.display==='none'||cs.visibility==='hidden'||r.width<1||r.height<1)return;
      if(r.right>innerWidth+2||el.scrollWidth>el.clientWidth+3)overflowC.push(culprit(el,'Déborde du viewport ou de sa largeur intérieure.'));
    });
    overflowC.sort(function(a,b){return (b.metrics.scrollWidth-b.metrics.clientWidth)-(a.metrics.scrollWidth-a.metrics.clientWidth)});
    issues.push({type:'overflow-x',amount:document.documentElement.scrollWidth-innerWidth,culprits:overflowC.slice(0,6)});
  }
  nodes.forEach(function(el){
    var cs=getComputedStyle(el),r=el.getBoundingClientRect();
    if(cs.display==='none'||cs.visibility==='hidden'||r.width<1||r.height<1)return;
    if(el.children.length===0&&String(el.textContent||'').trim()&&(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2)&&/(hidden|clip)/.test(cs.overflow+cs.overflowX+cs.overflowY)){
      clippedC.push(culprit(el,'Texte plus grand que la boîte avec overflow masqué.'));
    }
    if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)&&(r.width<44||r.height<44))small++;
  });
  if(clippedC.length)issues.push({type:'text-clipped',count:clippedC.length,culprits:clippedC.slice(0,6)});
  if(small)issues.push({type:'touch-target',count:small});
  return {
    issues:issues,
    scrollWidth:document.documentElement.scrollWidth,
    viewport:{width:innerWidth,height:innerHeight},
    diagnostics:{
      scannedNodes:nodes.length,
      totalNodes:allNodes.length,
      truncatedNodes:truncatedNodes,
      unreadableSheets:Array.from(new Set(unreadableSheets)).slice(0,20)
    }
  };
}

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
    const audit=await win.webContents.executeJavaScript('('+browserResponsiveAudit.toString()+')()');
    let screenshot=null;
    if(audit.issues.length){const img=await win.webContents.capturePage();screenshot=img.toDataURL()}
    return {config:cfg,issues:audit.issues,screenshot,viewport:audit.viewport,diagnostics:audit.diagnostics||{}};
  }finally{if(!win.isDestroyed())win.destroy()}
}

async function scenarioWindow(source,css,width,height){
  const target=normalizeUrl(source&&source.url);
  if(!target)throw new Error('Source invalide.');
  const win=new BrowserWindow({
    show:false,width:Math.max(240,Number(width)||412),height:Math.max(260,Number(height)||915),
    useContentSize:true,frame:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}
  });
  await win.loadURL(target);
  await new Promise(r=>setTimeout(r,320));
  if(css&&String(css).trim()&&String(css).trim()!=='/* Aucun ajustement. */'){
    await win.webContents.insertCSS(String(css),{cssOrigin:'author'});
    await new Promise(r=>setTimeout(r,80));
  }
  return win;
}

function scenarioActionScript(action){
  return `(function(action){
    function find(){try{return document.querySelector(String(action.selector||''))}catch(_){return null}}
    var el=find();
    if(!el)return {ok:false,error:'Cible introuvable',selector:action.selector||''};
    var r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||r.width<1||r.height<1)return {ok:false,error:'Cible non visible',selector:action.selector||''};
    try{
      if(action.type==='click'){
        if(el.focus)try{el.focus({preventScroll:true})}catch(_){}
        el.click();
      }else if(action.type==='input'||action.type==='change'){
        var proto=Object.getPrototypeOf(el),desc=proto&&Object.getOwnPropertyDescriptor(proto,'value');
        if(desc&&desc.set)desc.set.call(el,String(action.value==null?'':action.value));else el.value=String(action.value==null?'':action.value);
        el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
        if(action.type==='change')el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
      }else if(action.type==='keydown'){
        if(el.focus)el.focus({preventScroll:true});
        el.dispatchEvent(new KeyboardEvent('keydown',{key:String(action.key||''),code:String(action.code||''),bubbles:true,cancelable:true}));
        el.dispatchEvent(new KeyboardEvent('keyup',{key:String(action.key||''),code:String(action.code||''),bubbles:true,cancelable:true}));
      }else return {ok:false,error:'Action non prise en charge',selector:action.selector||''};
      return {ok:true,selector:action.selector||'',type:action.type,url:location.href};
    }catch(error){return {ok:false,error:String(error&&error.message||error),selector:action.selector||''}}
  })(`+JSON.stringify(action)+`)`;
}

async function replayScenarioAtConfig(source,css,actions,cfg){
  const win=await scenarioWindow(source,css,cfg.width,cfg.height);
  const steps=[];
  try{
    for(let i=0;i<actions.length;i+=1){
      const action=actions[i];
      const result=await win.webContents.executeJavaScript(scenarioActionScript(action),true);
      steps.push(Object.assign({index:i},result||{}));
      await new Promise(r=>setTimeout(r,Math.max(20,Math.min(500,Number(action.waitAfter)||90))));
      if(!result||!result.ok)break;
    }
    const audit=await win.webContents.executeJavaScript('('+browserResponsiveAudit.toString()+')()',true);
    return {
      config:cfg,
      ok:steps.length===actions.length&&steps.every(x=>x.ok),
      steps,
      issues:audit&&audit.issues||[],
      diagnostics:audit&&audit.diagnostics||{},
      finalUrl:await win.webContents.getURL()
    };
  }finally{if(!win.isDestroyed())win.destroy()}
}

ipcMain.handle('scenario:replay',async (_event,payload)=>{
  const source=payload&&payload.source,actions=Array.isArray(payload&&payload.actions)?payload.actions.slice(0,160):[];
  if(!source||!source.url)return {ok:false,error:'Source requise.',results:[]};
  if(!actions.length)return {ok:false,error:'Scénario vide.',results:[]};
  const configs=[
    {name:'phone',width:412,height:915},
    {name:'tablet',width:768,height:1024},
    {name:'desktop',width:1366,height:768}
  ];
  const results=[];
  try{
    for(const cfg of configs)results.push(await replayScenarioAtConfig(source,payload&&payload.css,actions,cfg));
    return {
      ok:true,
      results,
      summary:{
        tested:results.length,
        failed:results.filter(x=>!x.ok||(x.issues||[]).some(y=>y.type==='overflow-x'||y.type==='text-clipped')).length,
        failedSteps:results.reduce((n,x)=>n+x.steps.filter(s=>!s.ok).length,0),
        layoutIssues:results.reduce((n,x)=>n+(x.issues||[]).filter(y=>y.type==='overflow-x'||y.type==='text-clipped').length,0)
      }
    };
  }catch(error){return {ok:false,error:'Relecture du scénario impossible : '+String(error&&error.message||error),results}}
});

function focusSelectorScript(){
  return "(function(){var el=document.activeElement;if(!el||el===document.body)return '';if(el.id)return '#'+CSS.escape(el.id);var p=[],n=el,g=0;while(n&&n.nodeType===1&&n!==document.body&&g++<6){var s=n.tagName.toLowerCase();var c=Array.from(n.classList||[]).find(function(x){return !/^ve-/.test(x)});if(c)s+='.'+CSS.escape(c);p.unshift(s);n=n.parentElement;}return p.join(' > ');})()";
}

async function keyboardAccessibilityAudit(source,css){
  const win=await scenarioWindow(source,css,412,915);
  try{
    const initial=await win.webContents.executeJavaScript(`(function(){
      var nodes=Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]'));
      var visible=nodes.filter(function(el){var cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0&&!el.disabled&&Number(el.getAttribute('tabindex')||0)>=0});
      var positive=visible.filter(function(el){return Number(el.getAttribute('tabindex')||0)>0}).length;
      var modal=Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')).find(function(el){var r=el.getBoundingClientRect(),cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0});
      return {focusable:visible.length,positiveTabindex:positive,modal:!!modal};
    })()`);
    const maxTabs=Math.min(80,Math.max(1,Number(initial.focusable)||1)+3),sequence=[];
    for(let i=0;i<maxTabs;i+=1){
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'TAB'});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'TAB'});
      await new Promise(r=>setTimeout(r,24));
      const selector=await win.webContents.executeJavaScript(focusSelectorScript(),true);
      sequence.push(selector||'(body)');
      if(i>2&&selector&&selector===sequence[0])break;
    }
    const focusChecks=await win.webContents.executeJavaScript(`(function(){
      var el=document.activeElement,cs=el&&el!==document.body?getComputedStyle(el):null;
      var modal=Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open]')).find(function(x){var r=x.getBoundingClientRect(),s=getComputedStyle(x);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0});
      return {
        activeInsideModal:!modal||!!(el&&modal.contains(el)),
        focusVisibleStyle:!cs||cs.outlineStyle!=='none'||parseFloat(cs.outlineWidth||0)>0||String(cs.boxShadow||'none')!=='none'
      };
    })()`);
    let reducedMotion={supported:false,violations:0};
    try{
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await new Promise(r=>setTimeout(r,70));
      reducedMotion=await win.webContents.executeJavaScript(`(function(){
        var mq=matchMedia('(prefers-reduced-motion: reduce)').matches;
        var bad=0;
        Array.from(document.querySelectorAll('*')).slice(0,900).forEach(function(el){
          var cs=getComputedStyle(el),ad=cs.animationDuration.split(',').map(parseFloat),td=cs.transitionDuration.split(',').map(parseFloat);
          if((ad.some(function(x){return x>.1})&&cs.animationName!=='none')||td.some(function(x){return x>.3}))bad++;
        });
        return {supported:mq,violations:bad};
      })()`);
    }catch(_){}
    finally{try{if(win.webContents.debugger.isAttached())win.webContents.debugger.detach()}catch(_){}}
    const unique=Array.from(new Set(sequence.filter(Boolean)));
    const stuck=initial.focusable>1&&unique.length<=1;
    const issues=[];
    if(initial.positiveTabindex)issues.push({type:'positive-tabindex',count:initial.positiveTabindex,message:'tabindex positif détecté.'});
    if(stuck)issues.push({type:'focus-stuck',count:1,message:'La touche Tab ne fait pas progresser le focus.'});
    if(focusChecks&&!focusChecks.activeInsideModal)issues.push({type:'focus-trap',count:1,message:'Le focus est sorti d’une boîte de dialogue modale.'});
    if(focusChecks&&!focusChecks.focusVisibleStyle)issues.push({type:'focus-invisible',count:1,message:'Le focus actif ne présente ni outline ni box-shadow visible.'});
    if(reducedMotion&&reducedMotion.supported&&reducedMotion.violations)issues.push({type:'reduced-motion',count:reducedMotion.violations,message:'Animations/transitions longues encore actives avec prefers-reduced-motion: reduce.'});
    return {ok:true,focusable:initial.focusable,sequence:sequence.slice(0,80),reducedMotion,issues};
  }finally{if(!win.isDestroyed())win.destroy()}
}

ipcMain.handle('accessibility:keyboard-audit',async (_event,payload)=>{
  try{return await keyboardAccessibilityAudit(payload&&payload.source,payload&&payload.css)}
  catch(error){return {ok:false,error:'Audit clavier impossible : '+String(error&&error.message||error),issues:[]}}
});

async function smokeCascadeFixtures(){
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-cascade-smoke-'));
  try{
    const htmlPath=path.join(root,'index.html'),cssPath=path.join(root,'styles.css');
    fs.writeFileSync(htmlPath,'<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><button id="target" class="item primary">Test</button></body></html>','utf8');
    const css=[
      '.item { width: 100px; color: black; }',
      '@layer base { .item { width: 110px; color: navy; } }',
      '@media (max-width: 599px) { .item { width: 120px; color: red; } }',
      '@media (min-width: 600px) { @layer components { .item { width: 130px; color: blue; } } }'
    ].join('\n');
    fs.writeFileSync(cssPath,css,'utf8');
    const server=serveStatic(root),base=await listen(server);
    try{
      const source={type:'folder',path:root,root,entry:'index.html',url:base+'/index.html',label:'cascade fixture'};
      const generated='.item { width: 140px; color: green; }';
      const phone=directSourceCandidate(source,'.item',generated,'.item',base+'/styles.css',['width'],'@media (max-width: 599px)');
      if(!phone.ok||!phone.contextMatched||!phone.after.includes('@media (max-width: 599px)'))throw new Error('Ciblage @media téléphone échoué.');
      const desktop=directSourceCandidate(source,'.item',generated,'.item',base+'/styles.css',['width'],'@media (min-width: 600px) · @layer components');
      if(!desktop.ok||!desktop.contextMatched||!desktop.matchedContext.includes('@layer components'))throw new Error('Ciblage @media/@layer échoué.');
      const propertyOnly=directSourceCandidate(source,'.item',generated,'.item',base+'/styles.css',['color'],'');
      if(!propertyOnly.ok||Object.keys(propertyOnly.properties).join(',')!=='color')throw new Error('Filtrage propriété du diff échoué.');
      return {ok:true,media:true,layer:true,propertyFilter:true};
    }finally{await closeHttpServer(server)}
  }finally{try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}}
}
if(smokeMode)ipcMain.handle('smoke:cascade-fixtures',async ()=>smokeCascadeFixtures());
async function smokeScenarioFixture(){
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-scenario-smoke-'));
  let server=null;
  try{
    const htmlPath=path.join(root,'index.html');
    fs.writeFileSync(htmlPath,'<!doctype html><html><body><input id="name"><button id="go" onclick="document.getElementById(\'out\').textContent=document.getElementById(\'name\').value">Go</button><div id="out"></div></body></html>','utf8');
    server=serveStatic(root);const base=await listen(server);
    const source={type:'folder',path:root,root,entry:'index.html',url:base+'/index.html',label:'scenario fixture'};
    const actions=[
      {type:'input',selector:'#name',value:'Studio',waitAfter:30},
      {type:'click',selector:'#go',waitAfter:40}
    ];
    const result=await replayScenarioAtConfig(source,'',actions,{name:'fixture',width:412,height:915});
    if(!result.ok)throw new Error('Rejeu fixture échoué.');
    return {ok:true,steps:result.steps.length,issues:result.issues.length};
  }finally{
    await closeHttpServer(server);
    try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}
  }
}
if(smokeMode)ipcMain.handle('smoke:scenario-fixture',async ()=>smokeScenarioFixture());
async function smokeAdvancedCssCleanupFixture(){
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-css-cleanup-smoke-'));
  let server=null;
  try{
    const htmlPath=path.join(root,'index.html'),cssPath=path.join(root,'styles.css');
    fs.writeFileSync(htmlPath,'<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="used">OK</div></body></html>','utf8');
    fs.writeFileSync(cssPath,[
      ':root { --unused-fixture: #123456; --used-fixture: #fff; }',
      '.used { color: var(--used-fixture); padding: 4px; }',
      '.used { color: var(--used-fixture); padding: 4px; }'
    ].join('\n'),'utf8');
    server=serveStatic(root);const base=await listen(server);
    const source={type:'folder',path:root,root,entry:'index.html',url:base+'/index.html',label:'css cleanup fixture'};
    const analysis=await analyzeAdvancedCss(source);
    if(!analysis.ok)throw new Error('Analyse CSS fixture échouée.');
    const safe=analysis.items.filter(x=>x.safe&&x.confidence==='high');
    if(!safe.some(x=>x.kind==='exact-duplicate-rule'))throw new Error('Doublon strict non détecté.');
    if(!safe.some(x=>x.kind==='unused-variable'&&x.variable==='--unused-fixture'))throw new Error('Variable inutilisée non détectée.');
    const ids=new Set(safe.map(x=>x.id));
    const plan=advancedCssCleanupPlan(analysis,ids);
    if(!plan.files.length||!plan.files.some(x=>x.diff&&x.diff.length))throw new Error('Diff nettoyage CSS absent.');
    return {ok:true,safe:safe.length,files:plan.files.length,duplicate:true,unusedVariable:true};
  }finally{
    await closeHttpServer(server);
    try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}
  }
}
if(smokeMode)ipcMain.handle('smoke:css-cleanup-fixture',async ()=>smokeAdvancedCssCleanupFixture());
async function smokeRouteFixture(){
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-route-smoke-'));
  let server=null;
  try{
    fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><html><head><title>Home</title></head><body><a href="about.html">About</a><div class="home-only">Home</div></body></html>','utf8');
    fs.writeFileSync(path.join(root,'about.html'),'<!doctype html><html><head><title>About</title></head><body><a href="index.html">Home</a><div class="about-only">About</div></body></html>','utf8');
    server=serveStatic(root);const base=await listen(server);
    const source={type:'folder',path:root,root,entry:'index.html',url:base+'/index.html',label:'route fixture'};
    const result=await analyzeSourceRoutes(source,{maxRoutes:6,selectors:['.home-only','.about-only','.missing']});
    if(!result.ok)throw new Error(result.error||'Route fixture échouée.');
    if((result.summary&&result.summary.scanned||0)<2)throw new Error('Toutes les routes fixture ne sont pas scannées.');
    if(!(result.selectorUsage['.home-only']||[]).length)throw new Error('Sélecteur home non détecté.');
    if(!(result.selectorUsage['.about-only']||[]).length)throw new Error('Sélecteur about non détecté.');
    if((result.selectorUsage['.missing']||[]).length)throw new Error('Sélecteur absent détecté à tort.');
    return {ok:true,summary:result.summary,home:(result.selectorUsage['.home-only']||[]).length,about:(result.selectorUsage['.about-only']||[]).length};
  }finally{
    await closeHttpServer(server);
    try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}
  }
}
if(smokeMode)ipcMain.handle('smoke:route-fixture',async ()=>smokeRouteFixture());

function smokeReportFixture(){
  const tiny='data:image/png;base64,iVBORw0KGgo=';
  const report={
    version:'fixture',generatedAt:'2026-01-01T00:00:00.000Z',
    source:{label:'Fixture App',url:'http://fixture/',type:'folder'},
    checks:[{title:'Responsive',detail:'12 tests',ok:true},{title:'Accessibilité',detail:'1 point',ok:false}],
    captures:[{name:'Téléphone',width:412,height:915,dataUrl:tiny}],
    details:{matrix:{summary:{tested:12,failed:0}},routes:{summary:{scanned:2}}}
  };
  const html=buildStandaloneReport(report);
  const ok=html.includes('Fixture App')&&html.includes('Responsive')&&html.includes('À vérifier')&&html.includes(tiny)&&html.includes('Détails techniques');
  if(!ok)throw new Error('Rapport HTML fixture incomplet.');
  return {ok:true,length:html.length,hasCapture:html.includes(tiny),hasDetails:html.includes('Détails techniques')};
}
if(smokeMode)ipcMain.handle('smoke:report-fixture',async ()=>smokeReportFixture());




async function profileSourcePerformance(source,css){
  const target=normalizeUrl(source&&source.url);
  if(!target)return {ok:false,error:'Source invalide.'};
  const win=new BrowserWindow({
    show:false,width:412,height:915,useContentSize:true,frame:false,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}
  });
  let attached=false;
  try{
    try{
      win.webContents.debugger.attach('1.3');attached=true;
      await win.webContents.debugger.sendCommand('Performance.enable');
      await win.webContents.debugger.sendCommand('Network.enable');
    }catch(_){}
    const started=Date.now();
    await win.loadURL(target);
    const loadMs=Date.now()-started;
    await new Promise(r=>setTimeout(r,450));
    if(css&&String(css).trim()&&String(css).trim()!=='/* Aucun ajustement. */'){
      await win.webContents.insertCSS(String(css),{cssOrigin:'author'});
      await new Promise(r=>setTimeout(r,160));
    }
    let metricMap={};
    if(attached){
      try{
        const rawMetrics=await win.webContents.debugger.sendCommand('Performance.getMetrics');
        (rawMetrics.metrics||[]).forEach(item=>{metricMap[item.name]=item.value});
      }catch(_){}
    }
    const page=await win.webContents.executeJavaScript("(function(){var resources=performance.getEntriesByType('resource')||[];var nav=(performance.getEntriesByType('navigation')||[])[0]||null;var paints=performance.getEntriesByType('paint')||[];var images=Array.from(document.images||[]);var imageNaturalBytes=0,brokenImages=0;images.forEach(function(img){if(!img.complete||!img.naturalWidth)brokenImages++;imageNaturalBytes+=Math.max(0,(img.naturalWidth||0)*(img.naturalHeight||0)*4);});var transfer=resources.reduce(function(n,r){return n+(Number(r.transferSize)||0)},0);var encoded=resources.reduce(function(n,r){return n+(Number(r.encodedBodySize)||0)},0);var decoded=resources.reduce(function(n,r){return n+(Number(r.decodedBodySize)||0)},0);var byType={};resources.forEach(function(r){var k=r.initiatorType||'other';if(!byType[k])byType[k]={count:0,transfer:0,duration:0};byType[k].count++;byType[k].transfer+=Number(r.transferSize)||0;byType[k].duration+=Number(r.duration)||0;});return {url:location.href,nodes:document.getElementsByTagName('*').length,images:images.length,brokenImages:brokenImages,estimatedDecodedImageBytes:imageNaturalBytes,resources:resources.length,transferBytes:transfer,encodedBytes:encoded,decodedBytes:decoded,resourceTypes:byType,navigation:nav?{domContentLoaded:nav.domContentLoadedEventEnd,loadEventEnd:nav.loadEventEnd,responseStart:nav.responseStart,responseEnd:nav.responseEnd,duration:nav.duration}:null,paints:paints.map(function(x){return {name:x.name,startTime:x.startTime}})};})()",true);
    let processMemory=null;
    try{processMemory=await win.webContents.getProcessMemoryInfo()}catch(_){}
    const secToMs=name=>Math.round((Number(metricMap[name])||0)*10000)/10;
    const bytes=name=>Math.round(Number(metricMap[name])||0);
    const metrics={
      loadMs,
      taskDurationMs:secToMs('TaskDuration'),
      scriptDurationMs:secToMs('ScriptDuration'),
      layoutDurationMs:secToMs('LayoutDuration'),
      recalcStyleDurationMs:secToMs('RecalcStyleDuration'),
      layoutCount:Math.round(Number(metricMap.LayoutCount)||0),
      recalcStyleCount:Math.round(Number(metricMap.RecalcStyleCount)||0),
      domNodes:Math.round(Number(metricMap.Nodes)||Number(page.nodes)||0),
      documents:Math.round(Number(metricMap.Documents)||1),
      jsHeapUsedBytes:bytes('JSHeapUsedSize'),
      jsHeapTotalBytes:bytes('JSHeapTotalSize')
    };
    const findings=[];
    if(metrics.domNodes>1500)findings.push({type:'large-dom',value:metrics.domNodes,message:'DOM volumineux : '+metrics.domNodes+' nœuds.'});
    if(metrics.taskDurationMs>2000)findings.push({type:'task-duration',value:metrics.taskDurationMs,message:'Temps cumulé de tâches Chromium élevé : '+metrics.taskDurationMs+' ms.'});
    if(metrics.scriptDurationMs>1200)findings.push({type:'script-duration',value:metrics.scriptDurationMs,message:'Temps JavaScript cumulé élevé : '+metrics.scriptDurationMs+' ms.'});
    if(metrics.layoutCount>100)findings.push({type:'layout-count',value:metrics.layoutCount,message:'Nombre de layouts élevé : '+metrics.layoutCount+'.'});
    if(metrics.recalcStyleCount>150)findings.push({type:'style-recalc',value:metrics.recalcStyleCount,message:'Nombre de recalculs de style élevé : '+metrics.recalcStyleCount+'.'});
    if(metrics.jsHeapUsedBytes>100*1024*1024)findings.push({type:'heap',value:metrics.jsHeapUsedBytes,message:'Heap JavaScript utilisé > 100 Mo.'});
    if(Number(page.transferBytes)>5*1024*1024)findings.push({type:'transfer',value:page.transferBytes,message:'Plus de 5 Mo transférés pour ce chargement.'});
    if(Number(page.estimatedDecodedImageBytes)>80*1024*1024)findings.push({type:'images-memory',value:page.estimatedDecodedImageBytes,message:'Images potentiellement lourdes une fois décodées en mémoire.'});
    if(Number(page.brokenImages)>0)findings.push({type:'broken-images',value:page.brokenImages,message:page.brokenImages+' image(s) non chargée(s).'});
    return {ok:true,metrics,page,processMemory,findings};
  }catch(error){
    return {ok:false,error:'Profilage impossible : '+String(error&&error.message||error)};
  }finally{
    try{if(attached&&win.webContents.debugger.isAttached())win.webContents.debugger.detach()}catch(_){}
    if(!win.isDestroyed())win.destroy();
  }
}

ipcMain.handle('performance:profile',async (_event,payload)=>profileSourcePerformance(payload&&payload.source,payload&&payload.css));
async function testNetworkProfile(source,css,profile){
  const target=normalizeUrl(source&&source.url);
  if(!target)return {ok:false,error:'Source invalide.'};
  const profiles={
    slow3g:{label:'3G lent',offline:false,latency:400,downloadThroughput:400*1024/8,uploadThroughput:200*1024/8},
    slow4g:{label:'4G lente',offline:false,latency:150,downloadThroughput:1600*1024/8,uploadThroughput:750*1024/8},
    offline:{label:'Hors ligne',offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},
    imagesBlocked:{label:'Images bloquées',offline:false,latency:50,downloadThroughput:4*1024*1024/8,uploadThroughput:2*1024*1024/8,blockImages:true}
  };
  const cfg=profiles[profile]||profiles.slow3g;
  const win=new BrowserWindow({show:false,width:412,height:915,useContentSize:true,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}});
  let attached=false;
  try{
    win.webContents.debugger.attach('1.3');attached=true;
    await win.webContents.debugger.sendCommand('Network.enable');
    if(cfg.blockImages)await win.webContents.debugger.sendCommand('Network.setBlockedURLs',{urls:['*.png','*.jpg','*.jpeg','*.webp','*.gif','*.svg','*.avif']});
    await win.webContents.debugger.sendCommand('Network.emulateNetworkConditions',{
      offline:cfg.offline,latency:cfg.latency,downloadThroughput:cfg.downloadThroughput,uploadThroughput:cfg.uploadThroughput,connectionType:cfg.offline?'none':'cellular3g'
    });
    const started=Date.now();
    let loaded=true,error='';
    try{await win.loadURL(target)}catch(e){loaded=false;error=String(e&&e.message||e)}
    const loadMs=Date.now()-started;
    if(loaded){
      await new Promise(r=>setTimeout(r,Math.min(1800,cfg.offline?100:900)));
      if(css&&String(css).trim()&&String(css).trim()!=='/* Aucun ajustement. */')try{await win.webContents.insertCSS(String(css),{cssOrigin:'author'})}catch(_){}
    }
    let page={usable:false,nodes:0,textLength:0,brokenImages:0,hasErrorUi:false};
    if(loaded){
      try{
        page=await win.webContents.executeJavaScript("(function(){var text=String(document.body&&document.body.innerText||'').trim();var imgs=Array.from(document.images||[]);var errorText=/offline|hors ligne|erreur|error|réessayer|retry|connexion/i.test(text);return {usable:!!(document.body&&document.body.children.length&&text.length>0),nodes:document.getElementsByTagName('*').length,textLength:text.length,brokenImages:imgs.filter(function(i){return i.complete&&!i.naturalWidth}).length,hasErrorUi:errorText};})()",true);
      }catch(_){}
    }
    return {ok:true,profile:profile,label:cfg.label,loaded,loadMs,error,page};
  }catch(error){
    return {ok:false,profile:profile,label:cfg.label,error:String(error&&error.message||error)};
  }finally{
    try{if(attached&&win.webContents.debugger.isAttached())win.webContents.debugger.detach()}catch(_){}
    if(!win.isDestroyed())win.destroy();
  }
}

ipcMain.handle('network:test',async (_event,payload)=>{
  const source=payload&&payload.source,css=payload&&payload.css;
  const requested=Array.isArray(payload&&payload.profiles)&&payload.profiles.length?payload.profiles:['slow4g','slow3g','imagesBlocked','offline'];
  const results=[];
  for(const profile of requested.slice(0,6))results.push(await testNetworkProfile(source,css,String(profile)));
  return {ok:true,results,summary:{tested:results.length,failed:results.filter(x=>!x.ok||(!x.loaded&&x.profile!=='offline')).length,offlineHandled:results.some(x=>x.profile==='offline'&&x.loaded&&x.page&&x.page.usable)}};
});

ipcMain.handle('capture:test-matrix',async (_event,payload)=>{
  const source=payload&&payload.source;if(!source||!source.url)return {ok:false,error:'Source web requise.'};
  try{return await runMatrixForSource(source,payload.css)}
  catch(error){return {ok:false,error:'Matrice de tests impossible : '+String(error&&error.message||error),results:[]}}
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

function splitCssSelectorList(text){
  const out=[];let start=0,depth=0,quote='';
  const input=String(text||'');
  for(let i=0;i<input.length;i+=1){
    const ch=input[i];
    if(quote){if(ch===quote&&input[i-1]!=='\\')quote='';continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='('||ch==='[')depth+=1;
    else if(ch===')'||ch===']')depth=Math.max(0,depth-1);
    else if(ch===','&&depth===0){out.push(input.slice(start,i).trim());start=i+1}
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}

function parseCssBlocks(content){
  const text=String(content||''),blocks=[],stack=[];
  let boundary=0,quote='',comment=false;
  for(let i=0;i<text.length;i+=1){
    const ch=text[i],next=text[i+1];
    if(comment){
      if(ch==='*'&&next==='/'){comment=false;i+=1}
      continue;
    }
    if(quote){
      if(ch===quote&&text[i-1]!=='\\')quote='';
      continue;
    }
    if(ch==='/'&&next==='*'){comment=true;i+=1;continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='{'){
      const rawPrelude=text.slice(boundary,i);
      const leading=(rawPrelude.match(/^\s*/)||[''])[0].length;
      const prelude=rawPrelude.trim();
      const preludeStart=boundary+leading;
      const parent=stack.length?stack[stack.length-1]:null;
      const ancestors=stack.filter(x=>x.prelude&&x.prelude.trim().startsWith('@')).map(x=>x.prelude.trim());
      const block={prelude,preludeStart,open:i,bodyStart:i+1,close:-1,parent,context:ancestors.join(' · ')};
      stack.push(block);boundary=i+1;
      continue;
    }
    if(ch==='}'){
      const block=stack.pop();
      if(block){block.close=i;blocks.push(block)}
      boundary=i+1;
      continue;
    }
    if(ch===';')boundary=i+1;
  }
  return blocks.filter(x=>x.close>=0);
}

function normalizeCssContext(value){
  return String(value||'').replace(/\s+/g,' ').replace(/\s*·\s*/g,' · ').trim();
}

function cssContextScore(context,preferred){
  const ctx=normalizeCssContext(context),pref=normalizeCssContext(preferred);
  if(!pref)return ctx?0:100;
  if(ctx===pref)return 1000;
  if(ctx&&pref&&(ctx.includes(pref)||pref.includes(ctx)))return 700;
  const parts=pref.split(' · ').filter(Boolean);
  return parts.reduce((score,part)=>score+(ctx.includes(part)?120:0),0);
}

function findCssRuleBlocks(content,selector){
  const target=String(selector||'').trim();
  if(!target)return [];
  return parseCssBlocks(content).filter(block=>{
    const prelude=String(block.prelude||'').trim();
    if(!prelude||prelude.startsWith('@'))return false;
    return splitCssSelectorList(prelude).includes(target)||prelude===target;
  });
}

function chooseCssRuleBlock(content,selector,preferredContext){
  const matches=findCssRuleBlocks(content,selector);
  if(!matches.length)return null;
  return matches.slice().sort((a,b)=>{
    const sa=cssContextScore(a.context,preferredContext),sb=cssContextScore(b.context,preferredContext);
    return sb-sa||a.open-b.open;
  })[0];
}

function cssDeclarationsFromRule(css,selector,preferredContext){
  const text=String(css||'');
  const block=chooseCssRuleBlock(text,selector,preferredContext);
  if(!block)return null;
  const body=text.slice(block.bodyStart,block.close);
  const out={};
  String(body||'').split(';').forEach(part=>{
    const i=part.indexOf(':');
    if(i<0)return;
    const key=part.slice(0,i).trim(),value=part.slice(i+1).replace(/!important/g,'').trim();
    if(key&&value&&!key.startsWith('/*'))out[key]=value;
  });
  return out;
}

function mergeCssRule(content,selector,properties,preferredContext){
  const text=String(content||'');
  function declarationBlock(existing){
    const map={};
    String(existing||'').split(';').forEach(part=>{
      const i=part.indexOf(':');if(i<0)return;
      const key=part.slice(0,i).trim(),value=part.slice(i+1).trim();if(key&&value)map[key]=value;
    });
    Object.keys(properties||{}).forEach(key=>{map[key]=String(properties[key]).replace(/\s*!important\s*$/,'').trim()});
    return Object.keys(map).map(key=>'  '+key+': '+map[key]+';').join('\n');
  }
  const block=chooseCssRuleBlock(text,selector,preferredContext);
  if(block){
    const before=text.slice(0,block.bodyStart),after=text.slice(block.close);
    const existing=text.slice(block.bodyStart,block.close);
    return {
      content:before+'\n'+declarationBlock(existing)+'\n'+after,
      created:false,
      context:block.context||'',
      contextMatched:cssContextScore(block.context,preferredContext)>0||!preferredContext
    };
  }

  if(preferredContext){
    const groups=parseCssBlocks(text).filter(block=>String(block.prelude||'').trim().startsWith('@'));
    const group=groups.slice().sort((a,b)=>{
      const ca=normalizeCssContext([a.context,a.prelude].filter(Boolean).join(' · '));
      const cb=normalizeCssContext([b.context,b.prelude].filter(Boolean).join(' · '));
      const sa=cssContextScore(ca,preferredContext),sb=cssContextScore(cb,preferredContext);
      return sb-sa||b.open-a.open;
    })[0];
    if(group){
      const fullContext=normalizeCssContext([group.context,group.prelude].filter(Boolean).join(' · '));
      if(cssContextScore(fullContext,preferredContext)>0){
        const indent='  ';
        const rule='\n'+indent+selector+' {\n'+declarationBlock('').split('\n').map(line=>indent+line).join('\n')+'\n'+indent+'}\n';
        return {
          content:text.slice(0,group.close)+rule+text.slice(group.close),
          created:true,
          context:fullContext,
          contextMatched:true
        };
      }
    }
  }

  return {content:text+'\n\n'+selector+' {\n'+declarationBlock('')+'\n}\n',created:true,context:'',contextMatched:!preferredContext};
}

function directSourceCandidate(source,selector,css,sourceSelector,preferredHref,selectedProperties,preferredContext){
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Édition source directe disponible uniquement pour une application locale.'};
  const allProps=cssDeclarationsFromRule(css,String(sourceSelector||selector),preferredContext);
  if(!allProps||!Object.keys(allProps).length)return {ok:false,error:'Aucune propriété exploitable pour la sélection actuelle dans ce contexte CSS.'};
  selectedProperties=Array.isArray(selectedProperties)?selectedProperties.map(String):null;
  const props={};
  Object.keys(allProps).forEach(key=>{
    if(!selectedProperties||selectedProperties.includes(key))props[key]=allProps[key];
  });
  if(!Object.keys(props).length)return {ok:false,error:'Aucune propriété sélectionnée pour le diff.'};
  const files=walkFiles(local.root,['.css'],350).filter(file=>!file.endsWith('app-interface-studio.generated.css'));
  let chosen=null,bestScore=-1;
  let preferredPath='';
  if(preferredHref){
    try{
      const hrefUrl=new URL(String(preferredHref),source&&source.url||'http://127.0.0.1/');
      const pathname=decodeURIComponent(hrefUrl.pathname||'').replace(/^\/+/, '');
      const candidate=path.join(local.root,pathname);
      if(isPathInside(local.root,candidate)&&fs.existsSync(candidate))preferredPath=candidate;
    }catch(_){}
  }
  for(const file of files){
    let text='';try{text=fs.readFileSync(file,'utf8')}catch(_){continue}
    const block=chooseCssRuleBlock(text,selector,preferredContext);
    let score=block?100+cssContextScore(block.context,preferredContext):(text.includes(selector)?20:0);
    if(preferredPath&&path.resolve(file)===path.resolve(preferredPath))score+=1000;
    if(score>bestScore){bestScore=score;chosen={file,text,block}}
  }
  if(!chosen){
    const fallback=path.join(path.dirname(local.html),'app-interface-studio.direct.css');
    chosen={file:fallback,text:fs.existsSync(fallback)?fs.readFileSync(fallback,'utf8'):'',block:null};
  }
  const merged=mergeCssRule(chosen.text,selector,props,preferredContext);
  return {
    ok:true,
    root:local.root,
    file:chosen.file,
    relativePath:path.relative(local.root,chosen.file),
    selector,
    sourceSelector:String(sourceSelector||selector),
    preferredHref:String(preferredHref||''),
    preferredContext:String(preferredContext||''),
    matchedContext:String(merged.context||''),
    contextMatched:merged.contextMatched!==false,
    properties:props,
    allProperties:allProps,
    selectedProperties:Object.keys(props),
    beforeHash:hashText(chosen.text),
    before:chosen.text,
    after:merged.content,
    created:!fs.existsSync(chosen.file),
    diff:simpleUnifiedDiff(chosen.text,merged.content,path.relative(local.root,chosen.file))
  };
}

ipcMain.handle('source:prepare-direct-edit',async (_event,payload)=>{
  try{return directSourceCandidate(
    payload&&payload.source,
    String(payload&&payload.selector||''),
    String(payload&&payload.css||''),
    String(payload&&payload.sourceSelector||''),
    String(payload&&payload.preferredHref||''),
    payload&&payload.selectedProperties,
    String(payload&&payload.preferredContext||'')
  )}
  catch(error){return {ok:false,error:'Préparation du diff impossible : '+String(error&&error.message||error)}}
});

function matrixConfigs(){
  const sizes=[{name:'compact',width:360,height:800},{name:'phone',width:412,height:915},{name:'tablet',width:768,height:1024},{name:'desktop',width:1366,height:768}];
  const scales=[1,1.3,1.5],configs=[];
  sizes.forEach(size=>scales.forEach(fontScale=>configs.push({
    name:size.name,width:size.width,height:size.height,fontScale,dark:false,
    keyboard:size.width<600&&fontScale>=1.3?280:0
  })));
  return configs;
}

async function runMatrixForSource(source,css){
  const results=[];
  for(const cfg of matrixConfigs())results.push(await auditSourceAtConfig(source,css,cfg));
  return {
    ok:true,
    results,
    summary:{
      tested:results.length,
      failed:results.filter(x=>x.issues.length).length,
      totalIssues:results.reduce((n,x)=>n+x.issues.length,0)
    }
  };
}

function severeMatrixIssues(matrix){
  const severe=new Map();
  (matrix&&matrix.results||[]).forEach(item=>{
    const key=[item.config&&item.config.name,item.config&&item.config.width,item.config&&item.config.fontScale].join('|');
    (item.issues||[]).forEach(issue=>{
      if(issue.type==='overflow-x'||issue.type==='text-clipped'){
        const issueKey=key+'|'+issue.type;
        severe.set(issueKey,(severe.get(issueKey)||0)+Number(issue.count||1));
      }
    });
  });
  return severe;
}

function compareMatrixSafety(baseline,candidate){
  const before=severeMatrixIssues(baseline),after=severeMatrixIssues(candidate);
  const regressions=[];
  after.forEach((count,key)=>{
    const previous=before.get(key)||0;
    if(count>previous)regressions.push({key,before:previous,after:count});
  });
  const failedBefore=Number(baseline&&baseline.summary&&baseline.summary.failed)||0;
  const failedAfter=Number(candidate&&candidate.summary&&candidate.summary.failed)||0;
  const issuesBefore=Number(baseline&&baseline.summary&&baseline.summary.totalIssues)||0;
  const issuesAfter=Number(candidate&&candidate.summary&&candidate.summary.totalIssues)||0;
  return {
    safe:regressions.length===0&&failedAfter<=failedBefore+1&&issuesAfter<=issuesBefore+2,
    regressions,failedBefore,failedAfter,issuesBefore,issuesAfter
  };
}

async function validateDirectEditCandidate(payload){
  const source=payload&&payload.source;
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Validation disponible uniquement pour une source locale.'};
  const file=String(payload&&payload.file||'');
  if(!file||!isPathInside(local.root,file))return {ok:false,error:'Fichier candidat hors du projet.'};
  const relative=path.relative(local.root,file);
  const root=fs.mkdtempSync(path.join(app.getPath('temp'),'ais-validate-'));
  const copyRoot=path.join(root,'source');
  let server=null;
  try{
    fs.cpSync(local.root,copyRoot,{recursive:true,filter:(src)=>{
      const rel=path.relative(local.root,src);
      if(!rel)return true;
      return !rel.split(path.sep).some(part=>['.git','node_modules','dist','build','coverage'].includes(part));
    }});
    const candidateFile=path.join(copyRoot,relative);
    fs.mkdirSync(path.dirname(candidateFile),{recursive:true});
    fs.writeFileSync(candidateFile,String(payload&&payload.after||''),'utf8');
    server=serveStatic(copyRoot);
    const base=await listen(server);
    const entry=path.relative(local.root,local.html).replace(/\\/g,'/');
    const candidateSource=Object.assign({},source,{root:copyRoot,path:copyRoot,url:base+'/'+entry.split('/').map(encodeURIComponent).join('/')});
    const baseline=await runMatrixForSource(source,'');
    const candidate=await runMatrixForSource(candidateSource,'');
    const comparison=compareMatrixSafety(baseline,candidate);
    return {ok:true,safe:comparison.safe,baseline:baseline.summary,candidate:candidate.summary,regressions:comparison.regressions};
  }catch(error){
    return {ok:false,error:'Validation préalable impossible : '+String(error&&error.message||error)};
  }finally{
    await closeHttpServer(server);
    try{fs.rmSync(root,{recursive:true,force:true})}catch(_){}
  }
}

ipcMain.handle('source:validate-direct-edit',async (_event,payload)=>validateDirectEditCandidate(payload));

function parseSimpleCssRules(text){
  const rules=[];
  const re=/([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while((m=re.exec(String(text||'')))){
    const selector=String(m[1]||'').trim();
    if(!selector||selector.startsWith('@'))continue;
    const props={};
    String(m[2]||'').split(';').forEach(part=>{
      const i=part.indexOf(':');if(i<0)return;
      const key=part.slice(0,i).trim(),value=part.slice(i+1).replace(/\s*!important\s*$/,'').trim();
      if(key&&value)props[key]=value;
    });
    if(Object.keys(props).length)rules.push({selector,props,raw:m[0],index:m.index});
  }
  return rules;
}

function sameProperties(a,b){
  const ak=Object.keys(a||{}),bk=Object.keys(b||{});
  if(ak.length!==bk.length)return false;
  return ak.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&String(a[k]).trim()===String(b[k]).trim());
}

function analyzeLegacyOverrides(source){
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Source locale requise.',items:[]};
  const root=local.root,dir=path.dirname(local.html);
  const direct=path.join(dir,'app-interface-studio.direct.css');
  const generated=path.join(dir,'app-interface-studio.generated.css');
  const candidates=[];
  const otherCss=walkFiles(root,['.css'],400).filter(f=>f!==direct&&f!==generated);
  const corpus=otherCss.map(file=>{
    let text='';try{text=fs.readFileSync(file,'utf8')}catch(_){}
    return {file,text,rules:parseSimpleCssRules(text)};
  });
  if(fs.existsSync(direct)){
    const text=fs.readFileSync(direct,'utf8');
    const rules=parseSimpleCssRules(text);
    rules.forEach(rule=>{
      const matches=[];
      corpus.forEach(doc=>doc.rules.forEach(other=>{
        if(other.selector===rule.selector&&sameProperties(rule.props,other.props))matches.push(doc.file);
      }));
      if(matches.length)candidates.push({
        kind:'redundant-rule',file:direct,selector:rule.selector,raw:rule.raw,
        reason:'Même sélecteur et mêmes propriétés déjà présents dans '+path.relative(root,matches[0])+'.',
        duplicateFile:matches[0]
      });
    });
    if(!String(text).replace(/\/\*[\s\S]*?\*\//g,'').trim())candidates.push({kind:'empty-file',file:direct,reason:'Fichier de surcharge vide.'});
  }
  if(fs.existsSync(generated)){
    const text=fs.readFileSync(generated,'utf8');
    if(!String(text).replace(/\/\*[\s\S]*?\*\//g,'').trim())candidates.push({kind:'empty-file',file:generated,reason:'Fichier CSS généré vide.'});
  }
  return {ok:true,root,items:candidates.map((x,i)=>Object.assign({id:'override-'+(i+1),relativePath:path.relative(root,x.file)},x))};
}

ipcMain.handle('source:analyze-overrides',async (_event,payload)=>analyzeLegacyOverrides(payload&&payload.source));


function cssRuleDeclarations(body){
  const text=String(body||''),entries=[];
  let start=0,quote='',comment=false,paren=0,bracket=0,brace=0,index=0;
  function push(end){
    const raw=text.slice(start,end),segment=raw.replace(/;\s*$/,'');
    let colon=-1,q='',comm=false,p=0,b=0,br=0;
    for(let i=0;i<segment.length;i+=1){
      const ch=segment[i],next=segment[i+1];
      if(comm){if(ch==='*'&&next==='/'){comm=false;i+=1}continue}
      if(q){if(ch===q&&segment[i-1]!=='\\')q='';continue}
      if(ch==='/'&&next==='*'){comm=true;i+=1;continue}
      if(ch==='"'||ch==="'"){q=ch;continue}
      if(ch==='(')p+=1;else if(ch===')')p=Math.max(0,p-1);
      else if(ch==='[')b+=1;else if(ch===']')b=Math.max(0,b-1);
      else if(ch==='{')br+=1;else if(ch==='}')br=Math.max(0,br-1);
      else if(ch===':'&&p===0&&b===0&&br===0){colon=i;break}
    }
    if(colon>=0){
      const property=segment.slice(0,colon).trim(),value=segment.slice(colon+1).trim();
      if(property&&value)entries.push({property,value,index:index++,raw,start,end});
    }
    start=end;
  }
  for(let i=0;i<text.length;i+=1){
    const ch=text[i],next=text[i+1];
    if(comment){if(ch==='*'&&next==='/'){comment=false;i+=1}continue}
    if(quote){if(ch===quote&&text[i-1]!=='\\')quote='';continue}
    if(ch==='/'&&next==='*'){comment=true;i+=1;continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='(')paren+=1;else if(ch===')')paren=Math.max(0,paren-1);
    else if(ch==='[')bracket+=1;else if(ch===']')bracket=Math.max(0,bracket-1);
    else if(ch==='{')brace+=1;else if(ch==='}')brace=Math.max(0,brace-1);
    else if(ch===';'&&paren===0&&bracket===0&&brace===0)push(i+1);
  }
  if(start<text.length)push(text.length);
  return entries;
}

function cssRuleSignature(selector,context,body){
  const props=cssRuleDeclarations(body).map(x=>x.property+':'+x.value.replace(/\s+/g,' ').trim()).sort();
  return normalizeCssContext(context)+'|'+String(selector||'').trim()+'|'+props.join(';');
}


function sourceRouteUrl(source,relativePath){
  try{
    const base=new URL(String(source&&source.url||''));
    base.pathname='/'+String(relativePath||'').split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/');
    base.search='';base.hash='';
    return base.toString();
  }catch(_){return ''}
}

function routeUrlKey(value){
  try{
    const u=new URL(String(value||''));
    u.hash=u.hash||'';
    return u.origin+u.pathname+u.search+u.hash;
  }catch(_){return String(value||'')}
}

async function analyzeSourceRoutes(source,options){
  options=options||{};
  const maxRoutes=Math.max(1,Math.min(24,Number(options.maxRoutes)||12));
  const selectors=Array.isArray(options.selectors)?Array.from(new Set(options.selectors.map(String).filter(Boolean))).slice(0,180):[];
  const queue=[],queued=new Set(),pages=[],selectorUsage={};
  const local=localSourceEntry(source);
  const followDiscoveredLinks=!!local||options.followRemoteLinks===true;
  function enqueue(url,kind){
    if(!url||queue.length+pages.length>=maxRoutes*4)return;
    let normalized='';
    try{
      const u=new URL(String(url),String(source&&source.url||url));
      if(!/^https?:$/.test(u.protocol))return;
      if(source&&source.url){
        const origin=new URL(String(source.url)).origin;
        if(u.origin!==origin)return;
      }
      normalized=u.toString();
    }catch(_){return}
    const key=routeUrlKey(normalized);
    if(queued.has(key))return;
    queued.add(key);queue.push({url:normalized,kind:kind||'link'});
  }
  enqueue(source&&source.url,'entry');
  if(local){
    walkFiles(local.root,['.html','.htm'],80).slice(0,maxRoutes*2).forEach(file=>{
      const rel=path.relative(local.root,file).replace(/\\/g,'/');
      enqueue(sourceRouteUrl(source,rel),'html-file');
    });
  }

  const win=new BrowserWindow({show:false,width:412,height:915,useContentSize:true,frame:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:false,allowRunningInsecureContent:true,backgroundThrottling:false}});
  try{
    while(queue.length&&pages.length<maxRoutes){
      const item=queue.shift();
      let loaded=true,error='';
      try{await win.loadURL(item.url);await new Promise(r=>setTimeout(r,220))}
      catch(e){loaded=false;error=String(e&&e.message||e)}
      if(!loaded){
        pages.push({url:item.url,kind:item.kind,ok:false,error});
        continue;
      }
      let data={};
      try{
        const selectorJson=JSON.stringify(selectors);
        const script="(function(){"+
          "var links=Array.from(document.querySelectorAll('a[href]')).slice(0,160).map(function(a){try{return new URL(a.getAttribute('href'),location.href).toString()}catch(_){return ''}}).filter(Boolean);"+
          "var selectors="+selectorJson+";var found=[];selectors.forEach(function(sel){try{if(document.querySelector(sel))found.push(sel)}catch(_){}});"+
          "return {url:location.href,title:document.title||'',lang:document.documentElement.lang||'',dir:document.documentElement.dir||getComputedStyle(document.documentElement).direction||'ltr',nodes:document.getElementsByTagName('*').length,textLength:String(document.body&&document.body.innerText||'').trim().length,links:links,foundSelectors:found};"+
        "})()";
        data=await win.webContents.executeJavaScript(script,true);
      }catch(e){data={url:item.url,links:[],foundSelectors:[],error:String(e&&e.message||e)}}
      const page={url:data.url||item.url,kind:item.kind,ok:true,title:data.title||'',lang:data.lang||'',dir:data.dir||'',nodes:Number(data.nodes)||0,textLength:Number(data.textLength)||0,links:(data.links||[]).slice(0,160)};
      pages.push(page);
      (data.foundSelectors||[]).forEach(selector=>{
        if(!selectorUsage[selector])selectorUsage[selector]=[];
        if(!selectorUsage[selector].includes(page.url))selectorUsage[selector].push(page.url);
      });
      if(followDiscoveredLinks)(data.links||[]).forEach(url=>enqueue(url,'link'));
    }
    return {
      ok:true,pages,selectorUsage,
      summary:{
        scanned:pages.length,
        failed:pages.filter(x=>!x.ok).length,
        htmlFiles:pages.filter(x=>x.kind==='html-file').length,
        links:pages.filter(x=>x.kind==='link').length,
        selectorsChecked:selectors.length,
        remoteLinkDiscoverySkipped:!local&&!followDiscoveredLinks
      }
    };
  }catch(error){
    return {ok:false,error:'Analyse multi-routes impossible : '+String(error&&error.message||error),pages,selectorUsage};
  }finally{if(!win.isDestroyed())win.destroy()}
}

ipcMain.handle('routes:analyze',async (_event,payload)=>analyzeSourceRoutes(payload&&payload.source,{
  maxRoutes:payload&&payload.maxRoutes,
  selectors:payload&&payload.selectors
}));

function sourceTextCorpus(root){
  const exts=['.css','.html','.htm','.js','.mjs','.cjs','.ts','.tsx','.jsx','.vue','.svelte'];
  return walkFiles(root,exts,700).map(file=>{
    let text='';try{text=fs.readFileSync(file,'utf8')}catch(_){}
    return {file,text};
  });
}

async function analyzeAdvancedCss(source){
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Analyse CSS avancée disponible uniquement pour une source locale.',items:[]};
  const root=local.root;
  const cssFiles=walkFiles(root,['.css'],300).filter(file=>!file.includes('.ais-cleanup-backup-'));
  const corpus=sourceTextCorpus(root);
  const items=[],seenSignatures=new Map(),variableDefs=new Map();
  let itemId=0;

  const parsedFiles=cssFiles.map(file=>{
    let text='';try{text=fs.readFileSync(file,'utf8')}catch(_){}
    return {file,text,blocks:parseCssBlocks(text)};
  });

  parsedFiles.forEach(doc=>{
    doc.blocks.forEach(block=>{
      const prelude=String(block.prelude||'').trim();
      if(!prelude||prelude.startsWith('@'))return;
      const body=doc.text.slice(block.bodyStart,block.close);
      const decls=cssRuleDeclarations(body);
      const sig=cssRuleSignature(prelude,block.context,body);
      if(seenSignatures.has(sig)){
        const first=seenSignatures.get(sig);
        const start=Math.max(0,Number(block.preludeStart)||0);
        const sameFile=path.resolve(first.file)===path.resolve(doc.file);
        items.push({
          id:'css-clean-'+(++itemId),
          kind:sameFile?'exact-duplicate-rule':'cross-file-duplicate-rule',
          confidence:sameFile?'high':'medium',
          safe:sameFile,
          file:doc.file,relativePath:path.relative(root,doc.file),selector:prelude,context:block.context||'',
          start:start,end:block.close+1,raw:doc.text.slice(start,block.close+1),
          reason:sameFile
            ?'Règle strictement dupliquée plus haut dans le même fichier et le même contexte CSS.'
            :'Règle identique à '+path.relative(root,first.file)+' mais dans un autre fichier ; elle peut être chargée sur une autre route, donc suppression automatique interdite.'
        });
      }else seenSignatures.set(sig,{file:doc.file,block});

      const propertyPositions=new Map();
      decls.forEach(entry=>{
        if(!propertyPositions.has(entry.property))propertyPositions.set(entry.property,[]);
        propertyPositions.get(entry.property).push(entry);
        if(entry.property.startsWith('--')){
          if(!variableDefs.has(entry.property))variableDefs.set(entry.property,[]);
          const absoluteStart=block.bodyStart+entry.start,absoluteEnd=block.bodyStart+entry.end;
          variableDefs.get(entry.property).push({
            file:doc.file,selector:prelude,context:block.context||'',
            start:absoluteStart,end:absoluteEnd,raw:doc.text.slice(absoluteStart,absoluteEnd)
          });
        }
      });
      propertyPositions.forEach((entries,property)=>{
        if(entries.length>1){
          items.push({
            id:'css-clean-'+(++itemId),kind:'shadowed-declaration',confidence:'medium',safe:false,
            file:doc.file,relativePath:path.relative(root,doc.file),selector:prelude,context:block.context||'',
            property,reason:'La propriété '+property+' apparaît '+entries.length+' fois dans la même règle ; les occurrences précédentes sont écrasées.'
          });
        }
      });
    });
  });

  variableDefs.forEach((defs,name)=>{
    const literalRef=new RegExp('var\\(\\s*'+escapeRegex(name)+'(?:\\s*[,\\)])','g');
    let refs=0;
    corpus.forEach(doc=>{const m=doc.text.match(literalRef);if(m)refs+=m.length});
    if(refs===0){
      defs.forEach(def=>{
        items.push({
          id:'css-clean-'+(++itemId),kind:'unused-variable',confidence:'high',safe:true,
          file:def.file,relativePath:path.relative(root,def.file),selector:def.selector,context:def.context,
          variable:name,start:def.start,end:def.end,raw:def.raw,
          reason:'Variable '+name+' définie mais aucune référence var('+name+') trouvée dans les fichiers source analysés.'
        });
      });
    }
  });

  parsedFiles.forEach(doc=>{
    const rules=doc.blocks.filter(b=>{const p=String(b.prelude||'').trim();return p&&!p.startsWith('@')}).slice(0,180);
    for(let i=0;i<rules.length;i++){
      const a=rules[i],aSel=String(a.prelude||'').trim(),aBody=doc.text.slice(a.bodyStart,a.close);
      const aMap=new Map(cssRuleDeclarations(aBody).map(x=>[x.property,x.value.replace(/\s+/g,' ').trim()]));
      if(aMap.size<3)continue;
      for(let j=i+1;j<rules.length&&j<i+45;j++){
        const b=rules[j];if(normalizeCssContext(a.context)!==normalizeCssContext(b.context))continue;
        const bSel=String(b.prelude||'').trim(),bBody=doc.text.slice(b.bodyStart,b.close);
        const bMap=new Map(cssRuleDeclarations(bBody).map(x=>[x.property,x.value.replace(/\s+/g,' ').trim()]));
        if(bMap.size<3)continue;
        const keys=new Set([...aMap.keys(),...bMap.keys()]);
        let same=0;keys.forEach(k=>{if(aMap.has(k)&&bMap.has(k)&&aMap.get(k)===bMap.get(k))same++});
        const ratio=same/Math.max(aMap.size,bMap.size);
        if(ratio>=.8&&aSel!==bSel){
          items.push({
            id:'css-clean-'+(++itemId),kind:'near-duplicate-rule',confidence:'low',safe:false,
            file:doc.file,relativePath:path.relative(root,doc.file),selector:aSel+' ↔ '+bSel,context:a.context||'',
            reason:'Règles très proches ('+Math.round(ratio*100)+' % de déclarations identiques). À factoriser éventuellement.'
          });
        }
      }
    }
  });

  let win=null;
  try{
    if(source&&source.url){
      win=await scenarioWindow(source,'',412,915);
      for(const doc of parsedFiles){
        const rules=doc.blocks.filter(b=>{const p=String(b.prelude||'').trim();return p&&!p.startsWith('@')}).slice(0,220);
        for(const block of rules){
          const selector=String(block.prelude||'').trim();
          if(!selector||selector.includes(':hover')||selector.includes(':active')||selector.includes(':focus')||selector.includes('::'))continue;
          const checkScript='(function(){try{return !!document.querySelector('+JSON.stringify(selector)+')}catch(_){return true}})()';
          const exists=await win.webContents.executeJavaScript(checkScript,true);
          if(!exists){
            items.push({
              id:'css-clean-'+(++itemId),kind:'unused-on-current-screen',confidence:'low',safe:false,
              file:doc.file,relativePath:path.relative(root,doc.file),selector,context:block.context||'',
              reason:'Aucun élément correspondant sur l’écran courant. Peut être utilisé sur une autre route ou dans un état dynamique.'
            });
          }
        }
      }
    }
  }catch(_){}
  finally{if(win&&!win.isDestroyed())win.destroy()}

  const absentItems=items.filter(x=>x.kind==='unused-on-current-screen').slice(0,180);
  let routeScan=null;
  if(absentItems.length){
    try{
      routeScan=await analyzeSourceRoutes(source,{maxRoutes:12,selectors:Array.from(new Set(absentItems.map(x=>x.selector)))});
      if(routeScan&&routeScan.ok){
        absentItems.forEach(item=>{
          const used=(routeScan.selectorUsage&&routeScan.selectorUsage[item.selector])||[];
          if(used.length){
            item.kind='used-on-other-route';
            item.reason='Absent de l’écran courant mais présent sur '+used.length+' route(s) scannée(s), par exemple '+used[0]+'.';
          }else{
            item.kind='unused-across-scanned-routes';
            item.reason='Aucun élément correspondant sur les '+(routeScan.summary&&routeScan.summary.scanned||0)+' route(s) scannée(s). Diagnostic uniquement : une route dynamique non découverte peut encore l’utiliser.';
          }
        });
      }
    }catch(_){}
  }

  const order={high:0,medium:1,low:2};
  items.sort((a,b)=>(order[a.confidence]??9)-(order[b.confidence]??9)||String(a.relativePath).localeCompare(String(b.relativePath)));
  return {
    ok:true,root,items:items.slice(0,500),
    summary:{
      total:items.length,
      safe:items.filter(x=>x.safe).length,
      high:items.filter(x=>x.confidence==='high').length,
      medium:items.filter(x=>x.confidence==='medium').length,
      low:items.filter(x=>x.confidence==='low').length,
      routesScanned:routeScan&&routeScan.summary?routeScan.summary.scanned:0
    },
    routeSummary:routeScan&&routeScan.summary||null
  };
}

function advancedCssCleanupPlan(analysis,ids){
  const selected=analysis.items.filter(x=>ids.has(String(x.id))&&x.safe&&x.confidence==='high');
  const byFile=new Map();
  selected.forEach(item=>{
    if(!byFile.has(item.file))byFile.set(item.file,[]);
    byFile.get(item.file).push(item);
  });
  const files=[];
  byFile.forEach((items,file)=>{
    const before=fs.readFileSync(file,'utf8');
    const deletions=items.map(item=>({
      start:Number(item.start),end:Number(item.end),raw:String(item.raw||''),item
    })).filter(x=>Number.isInteger(x.start)&&Number.isInteger(x.end)&&x.start>=0&&x.end>x.start&&x.end<=before.length)
      .sort((a,b)=>b.start-a.start);
    let after=before,lastStart=Infinity;
    for(const deletion of deletions){
      if(deletion.end>lastStart)continue;
      const current=after.slice(deletion.start,deletion.end);
      if(deletion.raw&&current!==deletion.raw)continue;
      after=after.slice(0,deletion.start)+after.slice(deletion.end);
      lastStart=deletion.start;
    }
    after=after.replace(/\n{3,}/g,'\n\n');
    if(after!==before)files.push({
      file,relativePath:path.relative(analysis.root,file),before,after,beforeHash:hashText(before),
      diff:simpleUnifiedDiff(before,after,path.relative(analysis.root,file))
    });
  });
  return {selected,files};
}

ipcMain.handle('css-cleanup:analyze',async (_event,payload)=>{
  try{return await analyzeAdvancedCss(payload&&payload.source)}
  catch(error){return {ok:false,error:'Analyse CSS avancée impossible : '+String(error&&error.message||error),items:[]}}
});

ipcMain.handle('css-cleanup:prepare',async (_event,payload)=>{
  try{
    const analysis=await analyzeAdvancedCss(payload&&payload.source);
    if(!analysis.ok)return analysis;
    const ids=new Set(Array.isArray(payload&&payload.ids)?payload.ids.map(String):[]);
    const plan=advancedCssCleanupPlan(analysis,ids);
    if(!plan.files.length)return {ok:false,error:'Aucune modification haute confiance sélectionnée.',files:[]};
    return {
      ok:true,files:plan.files,
      selected:plan.selected.map(x=>({id:x.id,kind:x.kind,relativePath:x.relativePath,selector:x.selector||'',variable:x.variable||''})),
      diff:plan.files.map(f=>f.diff).join('\n\n')
    };
  }catch(error){return {ok:false,error:'Préparation du nettoyage CSS impossible : '+String(error&&error.message||error),files:[]}}
});

ipcMain.handle('css-cleanup:apply',async (_event,payload)=>{
  const source=payload&&payload.source,local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Source locale requise.'};
  const files=Array.isArray(payload&&payload.files)?payload.files:[];
  if(!files.length)return {ok:false,error:'Plan de nettoyage vide.'};
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backups=[],staged=[],written=[];
  try{
    for(const entry of files){
      const file=String(entry&&entry.file||'');
      if(!file||!isPathInside(local.root,file))throw new Error('Chemin refusé.');
      if(!fs.existsSync(file))throw new Error('Fichier introuvable : '+path.relative(local.root,file));
      const before=fs.readFileSync(file,'utf8');
      if(entry.beforeHash&&hashText(before)!==entry.beforeHash)throw new Error('Le fichier '+path.relative(local.root,file)+' a changé depuis le diff.');
      staged.push({file,before,after:String(entry.after||''),backup:file+'.ais-cleanup-backup-'+stamp});
    }
    for(const item of staged){
      fs.copyFileSync(item.file,item.backup);backups.push(item.backup);
    }
    for(const item of staged){
      written.push(item.file);
      fs.writeFileSync(item.file,item.after,'utf8');
    }
    return {ok:true,changed:staged.length,backups};
  }catch(error){
    const rollbackErrors=[];
    for(const item of staged){
      if(!written.includes(item.file))continue;
      try{fs.writeFileSync(item.file,item.before,'utf8')}catch(restoreError){rollbackErrors.push(path.relative(local.root,item.file)+': '+String(restoreError&&restoreError.message||restoreError))}
    }
    return {
      ok:false,
      error:'Application du nettoyage CSS impossible : '+String(error&&error.message||error)+(rollbackErrors.length?' · rollback incomplet : '+rollbackErrors.join(' | '):''),
      backups,rolledBack:written.length>0&&rollbackErrors.length===0
    };
  }
});

ipcMain.handle('source:cleanup-overrides',async (_event,payload)=>{
  const source=payload&&payload.source,local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Source locale requise.'};
  const analysis=analyzeLegacyOverrides(source);
  if(!analysis.ok)return analysis;
  const ids=new Set(Array.isArray(payload&&payload.ids)?payload.ids.map(String):[]);
  const selected=analysis.items.filter(x=>ids.has(String(x.id)));
  if(!selected.length)return {ok:false,error:'Aucune surcharge sûre sélectionnée.'};
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backups=[],removed=[],staged=[],changedFiles=[];
  const byFile=new Map();
  selected.forEach(item=>{
    if(!byFile.has(item.file))byFile.set(item.file,[]);
    byFile.get(item.file).push(item);
  });
  try{
    for(const [file,items] of byFile.entries()){
      if(!file||!isPathInside(local.root,file))throw new Error('Chemin refusé.');
      if(!fs.existsSync(file))throw new Error('Fichier introuvable : '+path.relative(local.root,file));
      const before=fs.readFileSync(file,'utf8');
      let after=before;
      items.filter(x=>x.kind==='redundant-rule').forEach(item=>{after=after.replace(item.raw,'')});
      after=after.replace(/\n{3,}/g,'\n\n').trim();
      const removeWhole=items.some(x=>x.kind==='empty-file')||!after;
      staged.push({file,before,after:removeWhole?'':after+'\n',removeWhole,backup:file+'.ais-cleanup-backup-'+stamp});
    }
    for(const item of staged){fs.copyFileSync(item.file,item.backup);backups.push(item.backup)}
    for(const item of staged){
      changedFiles.push(item.file);
      if(item.removeWhole){fs.unlinkSync(item.file);removed.push(path.relative(local.root,item.file))}
      else fs.writeFileSync(item.file,item.after,'utf8');
    }
    return {ok:true,removed,backups,changed:selected.length};
  }catch(error){
    const rollbackErrors=[];
    for(const item of staged){
      if(!changedFiles.includes(item.file))continue;
      try{fs.writeFileSync(item.file,item.before,'utf8')}catch(restoreError){rollbackErrors.push(path.relative(local.root,item.file)+': '+String(restoreError&&restoreError.message||restoreError))}
    }
    return {
      ok:false,
      error:'Nettoyage impossible : '+String(error&&error.message||error)+(rollbackErrors.length?' · rollback incomplet : '+rollbackErrors.join(' | '):''),
      backups,rolledBack:changedFiles.length>0&&rollbackErrors.length===0
    };
  }
});

ipcMain.handle('source:apply-direct-edit',async (_event,payload)=>{
  const source=payload&&payload.source;
  const local=localSourceEntry(source);
  if(!local)return {ok:false,error:'Source locale requise.'};
  const file=String(payload&&payload.file||'');
  if(!file||!isPathInside(local.root,file))return {ok:false,error:'Chemin source refusé.'};
  const existedBefore=fs.existsSync(file);
  let original='',backupPath='',htmlOriginal='',htmlTouched=false;
  try{
    original=existedBefore?fs.readFileSync(file,'utf8'):'';
    if(payload.beforeHash&&hashText(original)!==payload.beforeHash)return {ok:false,error:'Le fichier a changé depuis la préparation du diff. Reprépare la modification.'};
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    if(existedBefore){backupPath=file+'.ais-backup-'+stamp;fs.copyFileSync(file,backupPath)}
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,String(payload.after||''),'utf8');
    let htmlBackupPath='';
    if(path.basename(file)==='app-interface-studio.direct.css'&&local.html&&fs.existsSync(local.html)){
      let html=fs.readFileSync(local.html,'utf8');
      htmlOriginal=html;
      const marker='data-app-interface-studio="direct"';
      if(!html.includes(marker)){
        const stamp2=new Date().toISOString().replace(/[:.]/g,'-');
        htmlBackupPath=local.html+'.ais-backup-'+stamp2;
        fs.copyFileSync(local.html,htmlBackupPath);
        const href='./'+path.relative(path.dirname(local.html),file).replace(/\\/g,'/');
        const link='<link rel="stylesheet" href="'+href+'" '+marker+'>';
        html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,'  '+link+'\n</head>'):link+'\n'+html;
        htmlTouched=true;
        fs.writeFileSync(local.html,html,'utf8');
      }
    }
    return {ok:true,file,backupPath,htmlBackupPath,created:!existedBefore};
  }catch(error){
    const rollbackErrors=[];
    try{
      if(existedBefore)fs.writeFileSync(file,original,'utf8');
      else if(fs.existsSync(file))fs.unlinkSync(file);
    }catch(restoreError){rollbackErrors.push('CSS: '+String(restoreError&&restoreError.message||restoreError))}
    if(htmlTouched&&local.html){
      try{fs.writeFileSync(local.html,htmlOriginal,'utf8')}
      catch(restoreError){rollbackErrors.push('HTML: '+String(restoreError&&restoreError.message||restoreError))}
    }
    return {
      ok:false,
      error:'Écriture source impossible : '+String(error&&error.message||error)+(rollbackErrors.length?' · rollback incomplet : '+rollbackErrors.join(' | '):''),
      rolledBack:rollbackErrors.length===0
    };
  }
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


function writeTextFilesTransactional(entries){
  const token=Date.now()+'-'+crypto.randomBytes(4).toString('hex');
  const staged=[];
  try{
    const seen=new Set();
    for(const entry of entries||[]){
      const file=path.resolve(String(entry&&entry.file||''));
      if(!file||seen.has(file))throw new Error('Chemin de sortie invalide ou dupliqué.');
      seen.add(file);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const tmp=file+'.ais-write-tmp-'+token;
      fs.writeFileSync(tmp,String(entry&&entry.text!==undefined?entry.text:''),'utf8');
      staged.push({file,tmp,backup:'',committed:false});
    }
    for(const item of staged){
      if(fs.existsSync(item.file)){
        item.backup=item.file+'.ais-write-backup-'+token;
        fs.renameSync(item.file,item.backup);
      }
    }
    for(const item of staged){
      fs.renameSync(item.tmp,item.file);
      item.committed=true;
    }
    for(const item of staged){
      if(item.backup&&fs.existsSync(item.backup))try{fs.unlinkSync(item.backup)}catch(_){}
    }
    return {ok:true,files:staged.map(x=>x.file)};
  }catch(error){
    for(const item of staged){
      try{if(item.committed&&fs.existsSync(item.file))fs.unlinkSync(item.file)}catch(_){}
      try{if(item.backup&&fs.existsSync(item.backup))fs.renameSync(item.backup,item.file)}catch(_){}
      try{if(item.tmp&&fs.existsSync(item.tmp))fs.unlinkSync(item.tmp)}catch(_){}
    }
    throw error;
  }
}

function reportEscape(value){
  return String(value===undefined||value===null?'':value).replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function reportJson(value){
  try{return JSON.stringify(value,null,2)}catch(_){return '{}'}
}

function buildStandaloneReport(report){
  report=report&&typeof report==='object'?report:{};
  const checks=Array.isArray(report.checks)?report.checks:[];
  const captures=Array.isArray(report.captures)?report.captures:[];
  const details=report.details&&typeof report.details==='object'?report.details:{};
  const source=report.source||{};
  const checkHtml=checks.map(item=>
    '<tr><td><strong>'+reportEscape(item.title)+'</strong></td><td>'+reportEscape(item.detail)+'</td><td><span class="badge '+(item.ok?'ok':'warn')+'">'+(item.ok?'OK':'À vérifier')+'</span></td></tr>'
  ).join('');
  const captureHtml=captures.map(item=>
    '<figure><figcaption>'+reportEscape(item.name||'Capture')+' · '+reportEscape(item.width)+'×'+reportEscape(item.height)+'</figcaption><img src="'+reportEscape(item.dataUrl||'')+'" alt="'+reportEscape(item.name||'Capture')+'"></figure>'
  ).join('');
  const detailSections=Object.keys(details).map(key=>
    '<details><summary>'+reportEscape(key)+'</summary><pre>'+reportEscape(reportJson(details[key]))+'</pre></details>'
  ).join('');
  const rawJson=reportEscape(reportJson(Object.assign({},report,{captures:captures.map(x=>({name:x.name,width:x.width,height:x.height,embedded:!!x.dataUrl}))})));
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>App Interface Studio — Rapport</title><style>'+
    ':root{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#241d2d;background:#f6f3f8}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:28px}header{background:#251d2e;color:#fff;padding:24px;border-radius:16px;margin-bottom:18px}header h1{margin:0 0 6px;font-size:1.7rem}header p{margin:4px 0;color:#d9cede}section{background:#fff;border:1px solid #e3dce8;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 4px 14px #2a173510}h2{font-size:1.05rem;margin:0 0 12px}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #eee8f1;text-align:left;vertical-align:top}.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:800;font-size:.75rem}.ok{background:#e8f7ee;color:#24643d}.warn{background:#fff0df;color:#8b541b}.captures{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}figure{margin:0;border:1px solid #e2dbe7;border-radius:12px;overflow:hidden;background:#faf8fb}figcaption{padding:8px 10px;font-weight:750;font-size:.8rem}img{display:block;width:100%;height:auto;background:#eee}details{border:1px solid #e4deea;border-radius:10px;margin:8px 0;overflow:hidden}summary{cursor:pointer;padding:10px 12px;font-weight:800;background:#faf8fb}pre{margin:0;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#19151f;color:#eee;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}.meta div{padding:9px;border-radius:9px;background:#f7f4f9}.raw{max-height:360px;overflow:auto}@media print{body{background:#fff}.wrap{max-width:none;padding:0}section,header{box-shadow:none;break-inside:avoid}}'+
    '</style></head><body><div class="wrap">'+
    '<header><h1>App Interface Studio — Rapport de contrôle</h1><p>'+reportEscape(source.label||source.url||'Application')+'</p><p>Généré le '+reportEscape(report.generatedAt||new Date().toISOString())+' · Studio '+reportEscape(report.version||'')+'</p></header>'+
    '<section><h2>Synthèse</h2><div class="meta"><div><strong>Contrôles</strong><br>'+checks.length+'</div><div><strong>Sans anomalie</strong><br>'+checks.filter(x=>x.ok).length+'</div><div><strong>À vérifier</strong><br>'+checks.filter(x=>!x.ok).length+'</div><div><strong>Source</strong><br>'+reportEscape(source.type||'')+'</div></div></section>'+
    '<section><h2>Contrôles</h2><table><thead><tr><th>Contrôle</th><th>Détail</th><th>État</th></tr></thead><tbody>'+checkHtml+'</tbody></table></section>'+
    (captureHtml?'<section><h2>Captures de référence</h2><div class="captures">'+captureHtml+'</div></section>':'')+
    '<section><h2>Détails techniques</h2>'+detailSections+'</section>'+
    '<section><h2>Données structurées résumées</h2><pre class="raw">'+rawJson+'</pre></section>'+
    '</div></body></html>';
}

ipcMain.handle('report:export',async (_event,payload)=>{
  const report=payload&&payload.report?payload.report:payload;
  if(!report||typeof report!=='object')return {ok:false,error:'Rapport invalide.'};
  const result=await dialog.showSaveDialog({
    title:'Exporter le rapport App Interface Studio',
    defaultPath:'app-interface-studio-report.html',
    filters:[{name:'Rapport HTML',extensions:['html']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled||!result.filePath)return {ok:false,canceled:true};
  try{
    let htmlPath=result.filePath;
    if(path.extname(htmlPath).toLowerCase()!=='.html')htmlPath+='.html';
    const jsonPath=htmlPath.replace(/\.html$/i,'.json');
    const htmlText=buildStandaloneReport(report);
    const jsonText=JSON.stringify(report,null,2);
    writeTextFilesTransactional([{file:htmlPath,text:htmlText},{file:jsonPath,text:jsonText}]);
    return {ok:true,htmlPath,jsonPath};
  }catch(error){
    return {ok:false,error:'Export du rapport impossible : '+String(error&&error.message||error)};
  }
});

ipcMain.handle('layout:save-project',async (_event,project)=>{
  const result=await dialog.showSaveDialog({
    title:'Enregistrer le projet d’interface',
    defaultPath:'interface.app-layout.json',
    filters:[{name:'Projet App Interface Studio',extensions:['json']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled||!result.filePath)return {ok:false,canceled:true};
  try{
    writeTextFilesTransactional([{file:result.filePath,text:JSON.stringify(project,null,2)}]);
    return {ok:true,path:result.filePath};
  }catch(error){
    return {ok:false,error:'Enregistrement du projet impossible : '+String(error&&error.message||error)};
  }
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

function copyPortableSource(root,target,options){
  const skip=new Set(['.git','node_modules','.next','dist','build','coverage','.gradle','.idea','.vscode']);
  const stats={files:0,bytes:0,skipped:[]};
  const maxFiles=20000,maxBytes=300*1024*1024,maxSingle=40*1024*1024;
  const requiredFile=options&&options.requiredFile?path.resolve(options.requiredFile):'';
  function containsRequired(candidate){
    if(!requiredFile)return false;
    const resolved=path.resolve(candidate);
    return requiredFile===resolved||requiredFile.startsWith(resolved+path.sep);
  }
  function walk(src,dst){
    if(stats.files>=maxFiles||stats.bytes>=maxBytes)return;
    fs.mkdirSync(dst,{recursive:true});
    let names=[];
    try{names=fs.readdirSync(src)}catch(_){return}
    for(const name of names){
      if(stats.files>=maxFiles||stats.bytes>=maxBytes)break;
      const from=path.join(src,name),to=path.join(dst,name);
      if(skip.has(name)&&!containsRequired(from)){stats.skipped.push(from);continue}
      let stat=null;try{stat=fs.statSync(from)}catch(_){continue}
      if(stat.isDirectory()){walk(from,to);continue}
      if(!stat.isFile())continue;
      if(stat.size>maxSingle||stats.bytes+stat.size>maxBytes){
        if(path.resolve(from)===requiredFile)throw new Error('Le fichier d’entrée portable dépasse la limite de '+Math.round(maxSingle/1024/1024)+' Mo.');
        stats.skipped.push(from);continue
      }
      fs.mkdirSync(path.dirname(to),{recursive:true});
      fs.copyFileSync(from,to);
      stats.files+=1;stats.bytes+=stat.size;
    }
  }
  walk(root,target);
  if(requiredFile){
    const rel=path.relative(path.resolve(root),requiredFile);
    const copied=path.join(target,rel);
    if(!fs.existsSync(copied))throw new Error('Le fichier d’entrée du projet n’a pas pu être inclus dans le bundle portable.');
  }
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
  const token=Date.now()+'-'+crypto.randomBytes(3).toString('hex');
  const temp=bundle+'.tmp-'+token;
  const previous=bundle+'.previous-'+token;
  let previousMoved=false;
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
      sourceStats=copyPortableSource(sourceRoot,sourceDir,{requiredFile:path.resolve(local.html)});
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
    if(fs.existsSync(bundle)){
      fs.renameSync(bundle,previous);
      previousMoved=true;
    }
    try{
      fs.renameSync(temp,bundle);
    }catch(error){
      if(previousMoved&&fs.existsSync(previous)&&!fs.existsSync(bundle)){
        try{fs.renameSync(previous,bundle);previousMoved=false}catch(_){}
      }
      throw error;
    }
    if(previousMoved&&fs.existsSync(previous)){
      try{fs.rmSync(previous,{recursive:true,force:true})}catch(_){}
      previousMoved=false;
    }
    return {ok:true,path:bundle,assetCount,assetBytes,sourceFiles:sourceStats.files,sourceBytes:sourceStats.bytes,sourceSkipped:sourceStats.skipped.length};
  }catch(error){
    try{fs.rmSync(temp,{recursive:true,force:true})}catch(_){}
    if(previousMoved&&fs.existsSync(previous)&&!fs.existsSync(bundle)){
      try{fs.renameSync(previous,bundle);previousMoved=false}catch(_){}
    }
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
  try{
    writeTextFilesTransactional([{file:result.filePath,text}]);
    return {ok:true,path:result.filePath,text};
  }catch(error){
    return {ok:false,error:'Export ChatGPT impossible : '+String(error&&error.message||error)};
  }
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
