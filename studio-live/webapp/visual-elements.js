(function(){
  'use strict';

  const ALLOWED_TAGS=new Set(['div','span','p','button','strong','small','h1','h2','h3','img']);

  function applyStyles(el,styles){
    if(!styles||typeof styles!=='object')return;
    Object.entries(styles).forEach(([key,value])=>{
      if(value===null||value===undefined)return;
      try{el.style.setProperty(key,String(value))}catch(_){}
    });
  }

  function applyAttributes(el,attrs){
    if(!attrs||typeof attrs!=='object')return;
    Object.entries(attrs).forEach(([key,value])=>{
      if(value===null||value===undefined)return;
      if(/^on/i.test(key))return;
      try{el.setAttribute(key,String(value))}catch(_){}
    });
  }

  function bindAction(el,action){
    if(!action||typeof action!=='object')return;
    el.addEventListener('click',()=>{
      if(action.type==='click'&&action.target){
        document.querySelector(action.target)?.click();
      }else if(action.type==='toggleClass'&&action.target&&action.className){
        document.querySelector(action.target)?.classList.toggle(action.className);
      }else if(action.type==='openUrl'&&action.url){
        window.open(action.url,'_blank','noopener');
      }
    });
  }

  function renderSpec(spec){
    if(!spec||!spec.id||document.getElementById(spec.id))return null;
    const parent=document.querySelector(spec.parent||'#mainPage');
    if(!parent)return null;
    const tag=ALLOWED_TAGS.has(String(spec.tag||'div').toLowerCase())?String(spec.tag||'div').toLowerCase():'div';
    const el=document.createElement(tag);
    el.id=spec.id;
    el.dataset.chatgptElement='1';
    if(spec.className)el.className=String(spec.className);
    if(tag==='img'){
      if(spec.src)el.src=String(spec.src);
      el.alt=String(spec.alt||'');
    }else{
      el.textContent=String(spec.text||'');
    }
    applyAttributes(el,spec.attributes);
    applyStyles(el,spec.styles);
    bindAction(el,spec.action);
    if(spec.before){
      const before=parent.querySelector(spec.before)||document.querySelector(spec.before);
      if(before&&before.parentElement===parent)parent.insertBefore(el,before);
      else parent.appendChild(el);
    }else{
      parent.appendChild(el);
    }
    return el;
  }

  async function load(){
    try{
      const response=await fetch('/visual-elements.json?ts='+Date.now(),{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      const elements=Array.isArray(data)?data:(Array.isArray(data.elements)?data.elements:[]);
      elements.forEach(renderSpec);
      window.dispatchEvent(new CustomEvent('radio-custom-elements-loaded',{detail:{count:elements.length}}));
    }catch(_){}
  }

  window.RadioCustomElements={reload:load,render:renderSpec};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});
  else load();
})();
