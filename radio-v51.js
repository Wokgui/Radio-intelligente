(function(){
  const THEME={
    status:'#6f30e4',
    primary:'#8a43ef',
    primaryHi:'#bb83ff',
    primaryDark:'#6e2edd',
    surface:'#efe8f4',
    light:'#f3edf7',
    light2:'#faf7fc',
    card:'#ffffff',
    border:'#e6dcf0',
    tag:'#dfcff3',
    text:'#2e1166',
    subtext:'#5f4b89'
  };

  const SHAZAM_SVG='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9.872 16.736c-1.287 0-2.573-.426-3.561-1.281-1.214-1.049-1.934-2.479-2.029-4.024-.09-1.499.42-2.944 1.436-4.067C6.86 6.101 8.907 4.139 8.993 4.055c.555-.532 1.435-.511 1.966.045.53.557.512 1.439-.044 1.971-.021.02-2.061 1.976-3.137 3.164-.508.564-.764 1.283-.719 2.027.049.789.428 1.529 1.07 2.086.844.73 2.51.891 3.553-.043.619-.559 1.372-1.377 1.38-1.386.52-.567 1.4-.603 1.965-.081.565.52.603 1.402.083 1.969-.035.035-.852.924-1.572 1.572-1.005.902-2.336 1.357-3.666 1.357m8.41-.099c-1.143 1.262-3.189 3.225-3.276 3.309-.27.256-.615.385-.96.385-.368 0-.732-.145-1.006-.43-.531-.559-.512-1.439.044-1.971.021-.02 2.063-1.977 3.137-3.166.508-.563.764-1.283.719-2.027-.048-.789-.428-1.529-1.07-2.084-.844-.73-2.51-.893-3.552.044-.621.556-1.373 1.376-1.38 1.384-.521.566-1.399.604-1.966.084-.564-.521-.604-1.404-.082-1.971.034-.037.85-.926 1.571-1.573 1.979-1.778 5.221-1.813 7.227-.077 1.214 1.051 1.935 2.48 2.028 4.025.092 1.497-.419 2.945-1.434 4.068"/></svg>';

  function installTheme(){
    const root=document.documentElement;
    root.style.setProperty('--bg',THEME.light,'important');
    root.style.setProperty('--a',THEME.primary,'important');
    root.style.setProperty('--a2',THEME.primaryDark,'important');
    root.style.setProperty('--l',THEME.border,'important');
    root.style.setProperty('--t',THEME.text,'important');
    root.style.setProperty('--m',THEME.subtext,'important');
    root.style.setProperty('--card','rgba(255,255,255,.90)','important');

    const themeMeta=document.querySelector('meta[name="theme-color"]');
    if(themeMeta)themeMeta.setAttribute('content',THEME.status);

    let style=document.getElementById('radioUnifiedMauveTheme');
    if(!style){
      style=document.createElement('style');
      style.id='radioUnifiedMauveTheme';
      document.head.appendChild(style);
    }
    style.textContent=`
      html,body{
        background:linear-gradient(180deg,${THEME.light2} 0%,${THEME.light} 100%)!important;
        color:${THEME.text}!important;
      }
      .track{
        background:linear-gradient(180deg,${THEME.surface} 0%,${THEME.light} 100%)!important;
      }
      #settingsPage,
      #settingsPage.history-only,
      #settingsPage.settings-only{
        background:linear-gradient(180deg,${THEME.light2} 0%,${THEME.light} 100%)!important;
      }
      h1,#title{color:${THEME.text}!important}
      .artist{color:${THEME.subtext}!important}
      .round{
        background:linear-gradient(135deg,${THEME.primaryHi} 0%,${THEME.primary} 56%,${THEME.primaryDark} 100%)!important;
        color:#fff!important;
        box-shadow:0 9px 22px rgba(110,46,221,.30)!important;
      }
      .tag{
        background:${THEME.tag}!important;
        color:${THEME.primaryDark}!important;
      }
      .playerbar,.stats,.alt button,.tool,.tab,.undo,.card,.ui-open,.ui-control,.ui-actions button,
      .settings-back,#settingsPage.history-only>.radio-history-actions button{
        border-color:${THEME.border}!important;
      }
      .playerbar,.stats,.alt button,.card{
        background:rgba(255,255,255,.84)!important;
      }
      .icon-btn,#miniMore,.alt .ico,.stat .sico,.stat b,.row-link,.ui-open,.ui-control output,
      .settings-back,#settingsPage.history-only>.radio-history-actions button{
        color:${THEME.primaryDark}!important;
      }
      .ui-actions .ui-save,.tab.on,.backup{
        background:linear-gradient(135deg,${THEME.primaryHi} 0%,${THEME.primary} 52%,${THEME.primaryDark} 100%)!important;
        color:#fff!important;
      }
      .seek{background:#dfd1ee!important}
      .seek::-webkit-slider-thumb{
        background:linear-gradient(135deg,${THEME.primaryHi},${THEME.primaryDark})!important;
        box-shadow:0 3px 10px rgba(110,46,221,.35)!important;
      }
      .seek::-moz-range-thumb{background:${THEME.primary}!important}
      input[type=range]{accent-color:${THEME.primary}!important}
    `;
  }

  function shazamTarget(){
    const fallback='https://www.shazam.com/';
    if(/Android/i.test(navigator.userAgent)){
      return 'intent://www.shazam.com/#Intent;scheme=https;package=com.shazam.android;S.browser_fallback_url='+encodeURIComponent(fallback)+';end';
    }
    return fallback;
  }

  function paintShazam(){
    const button=document.getElementById('miniPlay');
    if(!button)return;
    if(!button.querySelector('svg'))button.innerHTML=SHAZAM_SVG;
  }

  function installShazam(){
    const button=document.getElementById('miniPlay');
    const mute=document.getElementById('miniMute');
    const oldRight=document.getElementById('miniShazam');
    if(!button)return;

    if(oldRight)oldRight.remove();
    if(mute)mute.remove();

    button.type='button';
    button.className='mini-btn shazam-btn';
    button.setAttribute('aria-label','Ouvrir Shazam');
    button.title='Shazam';
    paintShazam();
    button.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      const target=shazamTarget();
      if(/Android/i.test(navigator.userAgent))location.href=target;
      else window.open(target,'_blank','noopener');
    };

    if(typeof window.updatePlayer==='function'&&!window.__radioShazamUpdatePatched){
      const baseUpdatePlayer=window.updatePlayer;
      window.updatePlayer=function(){
        const result=baseUpdatePlayer.apply(this,arguments);
        paintShazam();
        return result;
      };
      window.__radioShazamUpdatePatched=true;
    }

    let style=document.getElementById('radioShazamStyle');
    if(!style){
      style=document.createElement('style');
      style.id='radioShazamStyle';
      document.head.appendChild(style);
    }
    style.textContent=`
      .playerbar{
        grid-template-columns:36px 46px minmax(0,1fr) 46px 36px!important;
        gap:8px!important;
        padding-left:14px!important;
        padding-right:14px!important;
      }
      #miniPlay.shazam-btn{
        width:32px!important;
        height:32px!important;
        min-width:32px!important;
        justify-self:center!important;
        border:0!important;
        border-radius:50%!important;
        display:grid!important;
        place-items:center!important;
        padding:0!important;
        background:linear-gradient(135deg,${THEME.primaryHi} 0%,${THEME.primary} 56%,${THEME.primaryDark} 100%)!important;
        color:#fff!important;
        box-shadow:0 6px 15px rgba(110,46,221,.30)!important;
      }
      #miniPlay.shazam-btn svg{
        width:19px!important;
        height:19px!important;
        display:block!important;
        color:#fff!important;
      }
      #miniPlay.shazam-btn:active{transform:scale(.93)}
      #miniMore{
        width:36px!important;
        height:36px!important;
        justify-self:center!important;
      }
      @media(max-width:420px){
        .playerbar{
          grid-template-columns:34px 42px minmax(0,1fr) 42px 34px!important;
          gap:7px!important;
          padding-left:11px!important;
          padding-right:11px!important;
        }
        #miniPlay.shazam-btn{width:30px!important;height:30px!important;min-width:30px!important}
        #miniPlay.shazam-btn svg{width:18px!important;height:18px!important}
        #miniMore{width:34px!important;height:34px!important}
      }
      @media(max-width:390px){
        .playerbar{
          grid-template-columns:32px 40px minmax(48px,1fr) 40px 32px!important;
          gap:6px!important;
          padding-left:10px!important;
          padding-right:10px!important;
        }
        #miniPlay.shazam-btn{width:29px!important;height:29px!important;min-width:29px!important}
        #miniPlay.shazam-btn svg{width:17.5px!important;height:17.5px!important}
        #miniMore{width:32px!important;height:32px!important}
      }
    `;

    paintShazam();
  }

  function finishInstall(){
    installTheme();
    installShazam();
  }

  function loadCore(){
    const core=document.createElement('script');
    core.src='/radio-v51-core.js?v=1';
    core.onload=finishInstall;
    core.onerror=finishInstall;
    document.head.appendChild(core);
  }

  installTheme();
  loadCore();
})();
