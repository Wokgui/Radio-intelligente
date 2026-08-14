(function(){
  function shazamTarget(){
    const fallback='https://www.shazam.com/';
    if(/Android/i.test(navigator.userAgent)){
      return 'intent://www.shazam.com/#Intent;scheme=https;package=com.shazam.android;S.browser_fallback_url='+encodeURIComponent(fallback)+';end';
    }
    return fallback;
  }

  function installShazam(){
    if(document.getElementById('miniShazam'))return;
    const mute=document.getElementById('miniMute');
    const gear=document.getElementById('miniMore');
    if(!mute||!gear)return;

    const shazam=document.createElement('button');
    shazam.id='miniShazam';
    shazam.type='button';
    shazam.className='icon-btn shazam-btn';
    shazam.setAttribute('aria-label','Ouvrir Shazam');
    shazam.title='Shazam';
    shazam.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7.3 18.8l4.7 4.7a4.1 4.1 0 0 0 5.8 0l2.7-2.7"/><path d="M24.7 13.2L20 8.5a4.1 4.1 0 0 0-5.8 0l-2.7 2.7"/><path d="M10.8 20.9l10.4-9.8"/></svg>';
    shazam.addEventListener('click',()=>{
      const target=shazamTarget();
      if(/Android/i.test(navigator.userAgent))location.href=target;
      else window.open(target,'_blank','noopener');
    });
    mute.replaceWith(shazam);

    const style=document.createElement('style');
    style.id='radioShazamStyle';
    style.textContent=`
      .playerbar{
        grid-template-columns:52px 46px minmax(0,1fr) 46px 34px 38px!important;
        gap:7px!important;
      }
      #miniShazam{
        width:34px!important;
        height:34px!important;
        min-width:34px!important;
        border:0!important;
        border-radius:50%!important;
        display:grid!important;
        place-items:center!important;
        padding:0!important;
        background:linear-gradient(135deg,var(--a),var(--a2))!important;
        color:#fff!important;
        box-shadow:0 6px 15px #8f40ef30!important;
      }
      #miniShazam svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:3.15;stroke-linecap:round;stroke-linejoin:round}
      #miniShazam:active{transform:scale(.93)}
      @media(max-width:420px){
        .playerbar{
          grid-template-columns:48px 42px minmax(0,1fr) 42px 32px 34px!important;
          gap:6px!important;
          padding-left:9px!important;
          padding-right:9px!important;
        }
        #miniShazam{width:32px!important;height:32px!important;min-width:32px!important}
        #miniShazam svg{width:20px;height:20px}
      }
      @media(max-width:390px){
        .playerbar{
          grid-template-columns:46px 40px minmax(48px,1fr) 40px 30px 34px!important;
          gap:5px!important;
          padding-left:8px!important;
          padding-right:8px!important;
        }
        #miniShazam{width:30px!important;height:30px!important;min-width:30px!important}
        #miniShazam svg{width:19px;height:19px}
      }
    `;
    document.head.appendChild(style);
  }

  function loadCore(){
    const core=document.createElement('script');
    core.src='/radio-v51-core.js?v=1';
    core.onload=installShazam;
    core.onerror=installShazam;
    document.head.appendChild(core);
  }

  loadCore();
})();
