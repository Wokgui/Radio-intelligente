const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const cwd=path.resolve(__dirname,'..');
const child=spawn(electron,['.','--disable-gpu'],{
  cwd,
  env:Object.assign({},process.env,{
    AIS_SMOKE_TEST:'1',
    ELECTRON_DISABLE_SECURITY_WARNINGS:'true'
  }),
  stdio:'inherit',
  windowsHide:true
});

let finished=false;
const configuredTimeout=Number(process.env.AIS_SMOKE_TIMEOUT_MS);
const timeoutMs=Number.isFinite(configuredTimeout)&&configuredTimeout>=30000?configuredTimeout:180000;
const timeout=setTimeout(()=>{
  if(finished)return;
  finished=true;
  try{child.kill()}catch(_){}
  console.error('App Interface Studio smoke test timed out after '+Math.round(timeoutMs/1000)+'s.');
  process.exit(1);
},timeoutMs);

child.on('error',error=>{
  if(finished)return;
  finished=true;
  clearTimeout(timeout);
  console.error(error&&error.stack||error);
  process.exit(1);
});

child.on('exit',(code,signal)=>{
  if(finished)return;
  finished=true;
  clearTimeout(timeout);
  if(code===0)process.exit(0);
  console.error('Electron smoke test failed with code '+code+(signal?' / '+signal:'')+'.');
  process.exit(code||1);
});
