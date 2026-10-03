(() => {
  'use strict';
  const $=id=>document.getElementById(id),api=window.StudioWorkspaceApi;
  const categories=[
    ['screen','Écran et Android','Définir les dimensions, les barres et les limites visibles.'],
    ['edit','Modifier les éléments','Sélectionner un objet et ajuster son texte, son image ou sa forme.'],
    ['layout','Organiser la page','Aligner les éléments et adapter la mise en page aux écrans.'],
    ['design','Style et composants','Harmoniser les couleurs et réutiliser les éléments du design.'],
    ['test','Tester et diagnostiquer','Rechercher les problèmes d’affichage, de navigation et de performance.'],
    ['code','Code et structure','Comprendre les règles CSS et préparer les modifications du code.'],
    ['delivery','Sauvegarder et livrer','Enregistrer, comparer les versions et exporter le travail.']
  ];
  const definitions=[
    ['Écran','screen','Choisir la taille logique du téléphone, le zoom, les barres Android et les zones masquées. Le mode superposé permet de voir un bouton recouvert comme sur Android.'],
    ['Simulation système','screen','Prévisualiser thème sombre, taille du texte et réglages système. Cette simulation ne lance pas un APK.'],
    ['Comparer avec l’APK','screen','Comparer l’aperçu à une capture Android pour repérer les différences. Une capture peut être importée sans téléphone branché.'],
    ['Android natif','code','Modifier les ressources XML ou Compose disponibles. Un aperçu de ressources ne reproduit pas tout le code de l’application.'],
    ['Sélection','edit','Choisir un ou plusieurs éléments et ajuster finement leur position et leurs dimensions.'],
    ['Groupes de travail','edit','Conserver une sélection de plusieurs objets pour les retrouver et les modifier ensemble.'],
    ['Texte','edit','Changer le texte, sa police, sa taille, sa couleur et son alignement.'],
    ['Apparence','edit','Régler le fond, les bordures, les angles et les effets de l’objet sélectionné.'],
    ['Image / icône','edit','Remplacer une image ou une icône, ajuster son cadrage et recolorer un SVG.'],
    ['Calques','edit','Parcourir l’arbre des objets pour sélectionner un élément difficile à cliquer.'],
    ['Box model','layout','Ajuster les marges externes et les espaces internes sans confondre la taille de l’objet avec ses espacements.'],
    ['Adaptatif','layout','Adapter largeur, hauteur et contraintes pour que la page reste correcte sur plusieurs tailles d’écran.'],
    ['Flex / Grid','layout','Organiser les enfants d’un conteneur en ligne, en colonne ou en grille.'],
    ['Distribuer','layout','Répartir régulièrement plusieurs objets sélectionnés.'],
    ['Alignement','layout','Aligner rapidement des objets sur un bord, un centre ou une référence commune.'],
    ['Espacements','layout','Mesurer et ajuster la distance entre les éléments.'],
    ['Design system','design','Définir des couleurs et valeurs partagées pour garder un style cohérent.'],
    ['Composants','design','Réutiliser un groupe d’éléments et créer ses variantes.'],
    ['États et animations','design','Préparer des états visuels et des interactions de prototype. Ils ne remplacent pas la logique Android réelle.'],
    ['Cohérence du design','design','Repérer les couleurs, tailles et espacements incohérents entre objets.'],
    ['Polices','test','Vérifier que les polices chargent et identifier les polices de remplacement.'],
    ['Animations','test','Analyser les animations, leur coût et le respect de la réduction des mouvements.'],
    ['Parcours utilisateur','test','Enregistrer une suite d’actions et la rejouer pour vérifier un parcours.'],
    ['Clavier et focus','test','Tester les déplacements au clavier et la visibilité de l’élément actif.'],
    ['Tests de contenu','test','Vérifier les textes longs, les traductions et les contenus extrêmes.'],
    ['Audit des assets','test','Repérer les images trop lourdes, doublons et dimensions inadaptées.'],
    ['Surveillance dynamique','test','Observer les changements de page et les redimensionnements pendant l’utilisation.'],
    ['Diagnostic de mise en page','test','Rechercher les débordements et causes de problèmes Flex ou Grid.'],
    ['Vérifier l’interface','test','Lancer les contrôles automatiques de lisibilité et de structure.'],
    ['Réseau dégradé','test','Tester une connexion lente, une panne réseau ou des images absentes.'],
    ['Performances','test','Mesurer le chargement et les performances dans Chromium. Ce résultat ne constitue pas une mesure du téléphone.'],
    ['Contrôle final','test','Rassembler les contrôles avant livraison et produire un bilan.'],
    ['Inspecteur avancé','code','Inspecter les propriétés CSS structurelles de l’élément sélectionné.'],
    ['Container Queries','code','Identifier le conteneur dont la taille déclenche un changement de mise en page.'],
    ['Empilement','code','Comprendre pourquoi un élément passe devant ou derrière un autre.'],
    ['Cascade CSS','code','Trouver la règle CSS qui gagne et son fichier source.'],
    ['Code source direct','code','Préparer et examiner les différences avant d’appliquer une modification au fichier d’origine.'],
    ['Nettoyer les surcharges','code','Repérer les ajustements devenus redondants et examiner leur suppression.'],
    ['Routes et pages','code','Parcourir plusieurs pages locales pour vérifier le comportement au-delà de l’écran courant.'],
    ['Nettoyage CSS avancé','code','Examiner doublons, variables et règles inutilisées avec un niveau de confiance avant validation.'],
    ['CSS produit','code','Lire le CSS généré par tes ajustements visuels.'],
    ['Historique visuel','delivery','Créer des points de contrôle et revenir à un état précédent.'],
    ['Captures et régression','delivery','Comparer des captures pour repérer les différences après un changement.'],
    ['GitHub','delivery','Préparer une branche et une proposition de modification du dépôt.'],
    ['Projet PC','delivery','Enregistrer ou rouvrir le projet de travail sur ton ordinateur. Enregistrer le projet ne reconstruit pas l’APK.']
  ];
  document.body.classList.add('studio-unified');document.body.dataset.workspace='edit';
  const header=document.querySelector('body>header'),main=document.querySelector('body>main'),side=document.querySelector('.side'),workspace=document.querySelector('.workspace');
  const bar=document.createElement('nav');bar.className='studio-workspace-bar';bar.setAttribute('aria-label','Espace de travail');
  bar.innerHTML='<div class="studio-tabs" role="tablist" aria-label="Vue de travail"><button role="tab" data-workspace="edit" aria-selected="true">Édition</button><button role="tab" data-workspace="run" aria-selected="false">Exécution Android</button><button role="tab" data-workspace="compare" aria-selected="false">Côte à côte</button></div><span class="studio-workspace-note" id="workspaceNote">Éditer les ressources. Tester le fonctionnement dans Android.</span><label class="studio-bars-control">Barres Android <select id="workspaceBars"><option value="overlay">Superposées au contenu</option><option value="inset">Entre les barres</option></select></label><button class="btn" id="studioFitScreen" title="Afficher tout l’écran du téléphone sans couper sa partie basse">Ajuster l’écran</button><button class="btn" id="studioTutorialBtn">Tutoriel</button>';
  header.after(bar);
  const pane=document.createElement('section');pane.className='studio-runtime-pane';pane.hidden=true;pane.setAttribute('aria-label','Application exécutée sur Android');pane.innerHTML='<div class="studio-runtime-caption">Préparation du rendu Android…</div><div class="studio-runtime-mount" id="runtimeMount"></div>';workspace.after(pane);
  let mode='edit',source=null,frame=0,previousShown=false,dockBusy=false,again=false;
  function blocking(){return document.body.classList.contains('preview-mode')||document.body.classList.contains('android-mode')||!!document.querySelector('dialog[open],.source-modal:not([hidden]),.settings-modal:not([hidden]),.diff-modal.visible,.matrix-modal.visible,.flow-modal.visible,.repair-modal.visible,.command-palette:not([hidden])')||!document.querySelector('.studio-chat-panel[hidden]')&&!!document.querySelector('.studio-chat-panel');}
  async function position(){
    frame=0;if(!api)return;
    if(dockBusy){again=true;return;}
    dockBusy=true;
    try{const shown=mode!=='edit'&&!blocking();if(!shown){await api.dock({action:'hide'});previousShown=false;return;}
      const r=$('runtimeMount').getBoundingClientRect();if(r.width<1||r.height<1)return;
      const result=await api.dock({action:'show',bounds:{x:r.x,y:r.y,width:r.width,height:r.height}});if(!result.ok)throw Error(result.error);previousShown=true;
    }catch(e){$('workspaceNote').textContent=e.message;}finally{dockBusy=false;if(again){again=false;schedule();}}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(position);}
  function setMode(next){mode=['edit','run','compare'].includes(next)?next:'edit';document.body.dataset.workspace=mode;pane.hidden=mode==='edit';if(mode==='compare'){$('zoom').value='fit';$('zoom').dispatchEvent(new Event('change'));}for(const button of bar.querySelectorAll('[data-workspace]'))button.setAttribute('aria-selected',String(button.dataset.workspace===mode));$('workspaceNote').textContent=mode==='compare'?'À gauche : ressources éditables. À droite : APK exécuté. Exporter puis installer pour tester les changements.':mode==='run'?'Android réel dans un émulateur : aucun téléphone à brancher.':'Éditer les ressources avec les dimensions et barres de ton appareil.';window.dispatchEvent(new Event('resize'));schedule();}
  $('studioFitScreen').onclick=()=>{$('zoom').value='fit';$('zoom').dispatchEvent(new Event('change'));};
  for(const button of bar.querySelectorAll('[data-workspace]'))button.onclick=async()=>{setMode(button.dataset.workspace);if(mode!=='edit'&&(source?.apkProject||source?.runtimeApkId)){const r=await window.AppInterfaceStudio.openAndroidLab({source,useExport:true});if(!r.ok)$('workspaceNote').textContent=r.error||'APK indisponible.';}};
  api?.onMode(next=>setMode(next==='run'&&mode==='compare'?'compare':next));api?.onGeometry(profile=>window.dispatchEvent(new CustomEvent('studio-geometry',{detail:profile})));
  window.addEventListener('studio-source-profile',syncBars);
  window.addEventListener('studio-source-changed',event=>{source=event.detail;syncBars();});
  function syncBars(){$('workspaceBars').value=$('androidBarsLayout').value;}
  $('workspaceBars').onchange=()=>{$('androidBarsLayout').value=$('workspaceBars').value;$('androidBarsLayout').dispatchEvent(new Event('change',{bubbles:true}));};
  $('androidBarsLayout').addEventListener('change',syncBars);syncBars();
  new ResizeObserver(schedule).observe(main);
  new MutationObserver(schedule).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','hidden','open']});
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  const catNav=document.createElement('nav');catNav.className='studio-category-nav';catNav.setAttribute('aria-label','Catégories des outils');side.prepend(catNav);
  const cards=[...side.querySelectorAll(':scope>.card')];
  let active='screen';
  function filter(category){active=category;for(const card of cards)card.hidden=category!=='all'&&card.dataset.studioCategory!==category;for(const heading of side.querySelectorAll('.studio-category-title'))heading.hidden=category!=='all'&&heading.dataset.category!==category;for(const button of catNav.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.category===category));}
  for(const [index,[id,title,description]] of categories.entries()){
    const button=document.createElement('button');button.textContent=title;button.dataset.category=id;button.title=description;button.onclick=()=>filter(id);catNav.append(button);
    const heading=document.createElement('h3');heading.className='studio-category-title';heading.dataset.category=id;heading.style.order=String(index*100);heading.textContent=title;const hint=document.createElement('small');hint.textContent=description;heading.append(hint);side.append(heading);
  }
  const all=document.createElement('button');all.textContent='Tout';all.dataset.category='all';all.title='Afficher toutes les catégories regroupées dans leur ordre.';all.onclick=()=>filter('all');catNav.append(all);
  for(const [index,card] of cards.entries()){
    const head=card.querySelector(':scope>h2'),name=head?.childNodes[0]?.textContent.trim()||head?.textContent.trim()||'';
    const entry=definitions.find(d=>d[0]===name)||['Autres outils','code','Outils complémentaires de l’éditeur.'];
    card.dataset.studioCategory=entry[1];card.style.order=String(categories.findIndex(c=>c[0]===entry[1])*100+index+1);
    const info=document.createElement('button');info.className='studio-info';info.textContent='';info.title=entry[2];info.setAttribute('aria-label','À quoi sert '+name+' ?');info.setAttribute('aria-expanded','false');
    const explanation=document.createElement('p');explanation.className='studio-help-text';explanation.id='studioHelp'+index;explanation.hidden=true;explanation.textContent=entry[2];info.setAttribute('aria-controls',explanation.id);
    info.addEventListener('click',event=>{event.stopPropagation();explanation.hidden=!explanation.hidden;info.setAttribute('aria-expanded',String(!explanation.hidden));});info.addEventListener('keydown',event=>event.stopPropagation());head.append(info);head.after(explanation);
  }
  filter(active);
  // Keep existing buttons and their event handlers while reducing header clutter.
  const actions=document.querySelector('.top-actions');
  for(const [label,ids] of [['Projet',['openProjectBtn','saveProjectBtn','exportChatGPTBtn']],['APK',['apkFilesBtn','exportApkBtn','apkToolsBtn']],['Outils',['openAsAppBtn','commandsBtn','reloadBtn']]]){
    const group=document.createElement('details');group.className='studio-actions-group';const summary=document.createElement('summary');summary.className='btn';summary.textContent=label+' ▾';const body=document.createElement('div');group.append(summary,body);for(const id of ids)if($(id))body.append($(id));actions.prepend(group);
    body.addEventListener('click',event=>{if(event.target.closest('button'))group.open=false;});
  }
  $('openAndroidLabBtn').textContent='Configurer Android';$('openAndroidLabBtn').title='Ouvrir les outils de l’émulateur dans la même plateforme.';
  const tutorial=document.createElement('dialog');tutorial.className='studio-tutorial';tutorial.setAttribute('aria-label','Tutoriel Interface Studio');tutorial.innerHTML='<div class="studio-tutorial-step" id="tutorialStep"></div><h2 id="tutorialTitle"></h2><div id="tutorialText"></div><nav><button id="tutorialPrevious">Précédent</button><button id="tutorialNext">Suivant</button><button id="tutorialClose">Fermer</button><button id="tutorialFull">Guide complet</button></nav>';document.body.append(tutorial);
  const steps=[
    ['Un seul espace de travail','Ouvre ton APK avec « Ouvrir une application ». L’onglet Édition permet de sélectionner les objets et de modifier les ressources. Exécution Android lance réellement l’APK. Côte à côte montre les deux sur le même écran.','screen'],
    ['Commencer sans brancher le téléphone','Dans Exécution Android, ouvre Configurer Android. Installe une fois Android Studio et une image système, crée ou choisis un appareil virtuel, puis démarre-le. Sélectionne l’APK et clique sur Installer et afficher cet APK. Aucun téléphone USB n’est nécessaire.','screen'],
    ['Reproduire le bas masqué','Dans l’exécution, clique sur « Même écran dans l’éditeur ». Vérifie ensuite le réglage Barres Android : Superposées reproduit le contenu qui passe dessous ; Entre les barres réserve leur espace. Une capture du téléphone et la calibration permettent de régler le profil sans câble. Les dimensions d’un émulateur ne sont pas automatiquement celles de ton smartphone.','screen'],
    ['Modifier un élément','Dans Édition, clique sur un objet du téléphone. La catégorie Modifier les éléments regroupe Sélection, Texte, Apparence, Image et Calques. Le bouton ? explique chaque panneau. Fais un petit changement et vérifie le résultat avant de poursuivre.','edit'],
    ['Organiser et harmoniser','Organiser la page contient marges, alignements, distribution, Flex/Grid et adaptation. Style et composants contient les couleurs communes, composants réutilisables et états. Privilégie les contraintes adaptées à la taille du téléphone.','layout'],
    ['Tester le vrai APK modifié','Enregistre ton projet, puis choisis APK → Exporter APK signé. Sélectionne ensuite cet export dans Exécution Android et installe-le. Les ressources changées dans l’éditeur ne modifient pas instantanément un APK déjà installé. Une signature différente bloque une mise à jour : utilise un émulateur dédié ou ta clé originale.','delivery'],
    ['Vérifier et conserver le travail','Tester et diagnostiquer rassemble les audits, parcours, réseau et performances. Sauvegarder et livrer regroupe les versions et comparaisons. Projet → Enregistrer conserve ton travail pour le rouvrir. La copie de l’APK seule ne conserve pas le projet d’édition.','test'],
    ['Modifier Interface Studio lui-même','Le menu Développement → Modifier Interface Studio ouvre ses propres fichiers. Sauvegarder et voir applique les changements locaux. Les sources restent dans resources/webapp. Pour partager le même code avec l’assistant, transmets les fichiers modifiés ou synchronise-les via ton dépôt. Cette conversation n’a pas accès automatiquement à ton écran ou au disque de ton PC.','code']
  ];
  let step=0;function renderTutorial(){const item=steps[step];$('tutorialStep').textContent='Étape '+(step+1)+' / '+steps.length;$('tutorialTitle').textContent=item[0];$('tutorialText').textContent=item[1];$('tutorialPrevious').disabled=step===0;$('tutorialNext').disabled=step===steps.length-1;filter(item[2]);}
  $('studioTutorialBtn').onclick=()=>{step=0;renderTutorial();tutorial.showModal();schedule();};$('tutorialPrevious').onclick=()=>{step--;renderTutorial();};$('tutorialNext').onclick=()=>{step++;renderTutorial();};$('tutorialClose').onclick=()=>tutorial.close();
  $('tutorialFull').onclick=()=>{window.open('studio-guide.html','_blank');};
  window.StudioWorkspace={setMode,filter,categories,definitions};
  $('studioFitScreen').click();setMode('edit');
})();
