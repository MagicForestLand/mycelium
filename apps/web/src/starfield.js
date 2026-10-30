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
    layer.appendChild(star);
  }
  const sky=host.querySelector('.sky');
  if(sky) sky.insertAdjacentElement('afterend',layer); else host.prepend(layer);
})();
