/* Balanced living star field for the production site. Visual only. */
(function(){
  const host=document.getElementById('universe');
  if(!host || host.querySelector('.living-stars')) return;
  const layer=document.createElement('div');
  layer.className='living-stars';
  layer.setAttribute('aria-hidden','true');
  let seed=0x4d59434c;
  const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
  const colors=['#ffffff','#d7e6ff','#9ff8ff','#bca8ff','#89b8ff'];
  const stars=[];
  for(let i=0;i<84;i++){
    const star=document.createElement('i');
    star.className='living-star'+(i%19===0?' cross':'');
    const size=(0.8+rand()*2.2).toFixed(2)+'px';
    star.style.setProperty('--x',(rand()*100).toFixed(2)+'%');
    star.style.setProperty('--y',(rand()*100).toFixed(2)+'%');
    star.style.setProperty('--s',size);
    const opacity=0.28+rand()*0.58;
    star.style.setProperty('--o',opacity.toFixed(2));
    star.style.setProperty('--o1',(opacity*0.30).toFixed(2));
    star.style.setProperty('--o2',(opacity*0.62).toFixed(2));
    const px=parseFloat(size);
    star.style.setProperty('--g1',(px*2.5).toFixed(2)+'px');
    star.style.setProperty('--g2',(px*6.5).toFixed(2)+'px');
    star.style.setProperty('--cross',(px*7).toFixed(2)+'px');
    star.style.setProperty('--c',colors[Math.floor(rand()*colors.length)]);
    star.style.setProperty('--twinkle',(2.8+rand()*6.4).toFixed(2)+'s');
    star.style.setProperty('--float',(10+rand()*24).toFixed(2)+'s');
    star.style.setProperty('--delay',(-rand()*7).toFixed(2)+'s');
    star.style.setProperty('--delay2',(-rand()*14).toFixed(2)+'s');
    const dx=-8+rand()*16, dy=-6+rand()*12;
    star.style.setProperty('--dx',dx.toFixed(1)+'px');
    star.style.setProperty('--dy',dy.toFixed(1)+'px');
    star.style.setProperty('--ndx',(-dx).toFixed(1)+'px');
    star.style.setProperty('--ndy',(-dy).toFixed(1)+'px');
    stars.push(star);
    layer.appendChild(star);
  }
  const sky=host.querySelector('.sky');
  if(sky) sky.insertAdjacentElement('afterend',layer); else host.prepend(layer);

  // Mobile Safari pays heavily for dozens of permanently ticking glow layers.
  // Keep every authored star, but wake only a few of them for short twinkles so
  // the compositor can sleep between pulses. Desktop retains the full motion.
  const mobile=matchMedia('(max-width: 820px), (max-height: 520px) and (max-width: 950px)');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const origin=document.getElementById('originStar');
  let starTimer=0,originTimer=0;
  const motionVisible=()=>mobile.matches&&!reducedMotion.matches&&!document.hidden&&!host.hidden&&!host.classList.contains('dragging')&&host.getClientRects().length>0;
  const clearPulseClasses=()=>{
    for(const star of stars)star.classList.remove('mobile-twinkle');
    origin?.classList.remove('mobile-pulse');
  };
  const stopMobileMotion=()=>{
    clearTimeout(starTimer);clearTimeout(originTimer);starTimer=originTimer=0;clearPulseClasses();
  };
  const queueStarPulse=delay=>{
    if(starTimer)return;
    starTimer=setTimeout(()=>{
      starTimer=0;
      if(!motionVisible()){syncMobileMotion();return;}
      const available=stars.slice(0,40).filter(star=>!star.classList.contains('mobile-twinkle'));
      const count=2+Math.floor(rand()*3);
      for(let i=0;i<count&&available.length;i++){
        const index=Math.floor(rand()*available.length),star=available.splice(index,1)[0];
        star.style.setProperty('--mobile-twinkle',(0.8+rand()*.45).toFixed(2)+'s');
        star.classList.add('mobile-twinkle');
      }
      queueStarPulse(1650+rand()*950);
    },delay);
  };
  const queueOriginPulse=delay=>{
    if(originTimer||!origin)return;
    originTimer=setTimeout(()=>{
      originTimer=0;
      if(!motionVisible()){syncMobileMotion();return;}
      origin.classList.add('mobile-pulse');
      queueOriginPulse(6200+rand()*2600);
    },delay);
  };
  function syncMobileMotion(){
    if(!motionVisible()){stopMobileMotion();return;}
    queueStarPulse(450+rand()*450);queueOriginPulse(2800+rand()*1200);
  }
  for(const star of stars)star.addEventListener('animationend',event=>{if(event.animationName==='mobile-star-twinkle')star.classList.remove('mobile-twinkle');});
  origin?.addEventListener('animationend',event=>{if(event.animationName==='mobile-origin-aura-pulse')origin.classList.remove('mobile-pulse');});
  document.addEventListener('visibilitychange',syncMobileMotion);
  mobile.addEventListener('change',syncMobileMotion);reducedMotion.addEventListener('change',syncMobileMotion);
  new MutationObserver(syncMobileMotion).observe(host,{attributes:true,attributeFilter:['class','hidden']});
  new MutationObserver(syncMobileMotion).observe(document.body,{attributes:true,attributeFilter:['data-view','data-mobile-surface']});
  window.addEventListener('resize',syncMobileMotion,{passive:true});
  syncMobileMotion();
})();
