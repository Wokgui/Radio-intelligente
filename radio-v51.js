(function(){
  const NOTUBE_BASE='https://notube.lol/fr/youtube-app-394';

  function videoId(value){
    const raw=String(value||'').trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
    try{
      const url=new URL(raw);
      const host=url.hostname.replace(/^www\./,'').toLowerCase();
      if(host==='youtu.be')return url.pathname.split('/').filter(Boolean)[0]||'';
      if(host==='youtube.com'||host.endsWith('.youtube.com')){
        if(url.pathname==='/watch')return url.searchParams.get('v')||'';
        const parts=url.pathname.split('/').filter(Boolean);
        if(['shorts','embed','live'].includes(parts[0]))return parts[1]||'';
      }
    }catch{}
    const match=raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/i);
    return match?match[1]:'';
  }

  function canonicalUrl(value){
    const id=videoId(value);
    return id?'https://www.youtube.com/watch?v='+id:'';
  }

  function trackYoutubeUrl(track){
    return canonicalUrl(track?.youtubeUrl||track?.externalUrl||'');
  }

  function trackSearchQuery(track){
    return ((track?.artist||'')+' '+(track?.title||'')).trim();
  }

  function resolvedTarget(track,target){
    const direct=trackYoutubeUrl(track);
    if(direct)return target==='download'?noTubeUrl(direct):direct;
    return '/api/youtube-search?redirect=1&target='+encodeURIComponent(target)+'&q='+encodeURIComponent(trackSearchQuery(track));
  }

  function noTubeUrl(value){
    const id=videoId(value);
    return id?NOTUBE_BASE+'?v='+encodeURIComponent(id):NOTUBE_BASE;
  }

  function findTrack(date,key){
    return S.kept.find(track=>track.date===date&&Q(track)===key);
  }

  function setError(message){
    const error=document.getElementById('youtubeAddError');
    if(error)error.textContent=message||'';
  }

  function closeSheet(){
    const sheet=document.getElementById('youtubeAddSheet');
    if(sheet){
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden','true');
    }
    setError('');
  }

  function updateAddAction(){
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    if(!input||!confirm||confirm.disabled)return;
    const value=input.value.trim();
    confirm.textContent=value&&!videoId(value)?'Rechercher sur YouTube':'Ajouter';
  }

  function openSheet(){
    const sheet=document.getElementById('youtubeAddSheet');
    const title=document.getElementById('youtubeAddTitle');
    const note=document.getElementById('youtubeAddNote');
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    const search=document.getElementById('youtubeSearchLink');
    if(!sheet||!title||!note||!input||!confirm||!search)return;
    title.textContent='Ajouter un morceau';
    note.textContent='Colle un lien YouTube pour ajouter le morceau, ou écris des mots-clés pour afficher les résultats YouTube.';
    confirm.textContent='Ajouter';
    search.classList.remove('visible');
    search.href='#';
    input.value='';
    input.placeholder='Lien YouTube ou artiste + titre';
    setError('');
    updateAddAction();
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden','false');
    setTimeout(()=>input.focus(),30);
  }

  async function submitSheet(){
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    const raw=String(input?.value||'').trim();
    if(!raw){setError('Colle un lien YouTube ou écris des termes de recherche.');return}
    const url=canonicalUrl(raw);
    const id=videoId(url);
    if(!id){
      const search=document.getElementById('youtubeSearchLink');
      search.href='https://www.youtube.com/results?search_query='+encodeURIComponent(raw);
      search.click();
      setError('Résultats ouverts : choisis une vidéo, puis colle son lien ici pour l’ajouter.');
      return;
    }

    if(S.kept.some(track=>videoId(track.youtubeUrl||track.externalUrl)===id)){
      setError('Ce morceau est déjà dans Gardés.');
      return;
    }

    confirm.disabled=true;
    confirm.textContent='Ajout…';
    setError('');
    try{
      let metadata={};
      try{
        const response=await fetch('https://noembed.com/embed?url='+encodeURIComponent(url),{headers:{Accept:'application/json'}});
        if(response.ok)metadata=await response.json();
      }catch{}
      const track={
        id:'yt'+id,
        artist:metadata.author_name||'YouTube',
        title:metadata.title||'Morceau YouTube',
        album:'YouTube',
        cover:metadata.thumbnail_url||'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg',
        preview:'',
        category:'youtube',
        source:'youtube-manual',
        externalUrl:url,
        youtubeUrl:url,
        date:new Date().toISOString(),
        signal:'keep'
      };
      S.kept.push(track);
      if(!S.seen.includes(Q(track)))S.seen.push(Q(track));
      save('Morceau YouTube ajouté dans Gardés.');
      closeSheet();
    }catch{
      setError('Impossible d’ajouter ce morceau pour le moment.');
    }finally{
      confirm.disabled=false;
      confirm.textContent='Ajouter';
    }
  }

  function decorateRows(){
    if(tab!=='kept')return;
    const rows=[...document.querySelectorAll('#hist .row:has(.row-main)')];
    rows.forEach(row=>{
      const cover=row.querySelector('.row-cover');
      if(cover?.src)row.style.setProperty('--row-cover','url("'+cover.src.replace(/"/g,'%22')+'")');
      const deleteButton=row.querySelector('.row-delete');
      const track=deleteButton&&findTrack(deleteButton.dataset.date,deleteButton.dataset.key);
      const actions=row.querySelector('.row-actions');
      if(!track||!actions)return;
      const youtube=actions.children[0];
      if(youtube?.tagName==='A'){
        youtube.href=resolvedTarget(track,'youtube');
        youtube.title='Ouvrir directement la vidéo la plus pertinente';
      }
      const current=actions.children[1];
      const download=document.createElement('button');
      download.type='button';
      download.className='row-link row-download';
      download.textContent='Télécharger';
      download.onclick=()=>window.open(resolvedTarget(track,'download'),'_blank','noopener');
      current?.replaceWith(download);
    });
  }

  function install(){
    const tabs=document.querySelector('#settingsPage .radio-history-card .tabs');
    if(tabs&&!document.getElementById('addYoutubeTrack')){
      const add=document.createElement('button');
      add.type='button';
      add.id='addYoutubeTrack';
      add.className='history-add-tab';
      add.setAttribute('aria-label','Ajouter un morceau depuis YouTube');
      add.innerHTML='<span aria-hidden="true">＋</span><small>Ajouter</small>';
      add.onclick=openSheet;
      tabs.insertBefore(add,tabs.children[1]||null);
    }

    if(!document.getElementById('youtubeAddSheet')){
      const sheet=document.createElement('div');
      sheet.id='youtubeAddSheet';
      sheet.className='youtube-add-sheet';
      sheet.setAttribute('aria-hidden','true');
      sheet.innerHTML='<div class="youtube-add-dialog" role="dialog" aria-modal="true" aria-labelledby="youtubeAddTitle"><h3 id="youtubeAddTitle">Ajouter un morceau</h3><p id="youtubeAddNote"></p><a id="youtubeSearchLink" class="youtube-search-link" target="_blank" rel="noopener">Rechercher sur YouTube</a><input id="youtubeAddInput" type="search" inputmode="search" autocomplete="off" aria-label="Lien ou recherche YouTube"><div id="youtubeAddError" class="youtube-add-error" aria-live="polite"></div><div class="youtube-add-actions"><button id="youtubeAddCancel" type="button">Annuler</button><button id="youtubeAddConfirm" class="youtube-add-confirm" type="button">Ajouter</button></div></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click',event=>{if(event.target===sheet)closeSheet()});
      document.getElementById('youtubeAddCancel').onclick=closeSheet;
      document.getElementById('youtubeAddConfirm').onclick=submitSheet;
      document.getElementById('youtubeAddInput').addEventListener('input',()=>{setError('');updateAddAction()});
      document.getElementById('youtubeAddInput').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submitSheet()}});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sheet.classList.contains('open'))closeSheet()});
    }

    const baseRender=render;
    render=function(){
      const result=baseRender();
      decorateRows();
      return result;
    };
    render();
  }

  install();
})();
