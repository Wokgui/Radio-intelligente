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
const timeout=setTimeout(()=>{
  if(finished)return;
  finished=true;
  try{child.kill()}catch(_){}
  console.error('App Interface Studio smoke test timed out.');
  process.exit(1);
},60000);

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
