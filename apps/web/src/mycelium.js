// Production interface connected to the catalog, renderer, and token ID helpers.
const $=id=>document.getElementById(id);
const privacyNoticeKey='mycelium:privacy-notice:v1';
let spiralEntries=[], receiptEntries=new Map(), chainState={ready:false,busy:false,snapshot:null,walletChecking:true,walletEnabled:true}, galleryLimit=24;
const SALE_PHASE={PAUSED:0,ALLOWLIST:1,PUBLIC_ACTIVE:2,PUBLIC_PAUSED:3};
const defaultPreviewGenotype=[4,2,0,9,0,0];
let builderGenotype=[...defaultPreviewGenotype],currentView='spiral',selectedSlot=null,pendingTokenId=null;
let zoom=1,pinnedSlot=null,toastTimer,lastModalFocus=null;
const mobileLayout=matchMedia('(max-width: 820px), (max-height: 520px) and (max-width: 950px)');
let mobileSurface='builder',mobileTraitKey='stem',mobileTraitPaintObserver=null,mobileTraitCenterTimer=0,mobileTraitCentering=false;
let walletLandingAccount=null;
let renderQueue=[],renderQueueFrame=0;
const faviconLink=$('favicon'),faviconCanvas=document.createElement('canvas');
faviconCanvas.dataset.resolution='128';
let faviconTimer=0,faviconRevision=0,faviconObjectURL='';
let spiralFit=null,spiralCount=20,spiralOffset=0,spiralTarget=0,spiralFrame=0,spiralTime=0;
let spiralIntroPhase='waiting',spiralIntroLimit=0,spiralIntroFrame=0,spiralIntroStarted=0,spiralIntroMinted=0;
let spiralThreadReady=false,spiralThreadFrame=0;
const spiralNodes=new Map(),spiralMotion=matchMedia('(prefers-reduced-motion: reduce)');
const num=n=>String(n).padStart(2,'0');
const dnaForGenotype=genotype=>genotypeIndexForTraits(...genotype);
const sameGenotype=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const genotypeKey=genotype=>genotype.join(',');
let mintedGenotypes=new Set();
const genotypeIsMinted=genotype=>mintedGenotypes.has(genotypeKey(genotype));
function randomAvailableGenotype(){
  for(let attempt=0;attempt<256;attempt++){
    const values=new Uint32Array(layerKeys.length);crypto.getRandomValues(values);
    const genotype=layerKeys.map((key,i)=>values[i]%traits[key].length);
    if(!genotypeIsMinted(genotype))return genotype;
  }
  // The collection is deliberately much smaller than the genotype space. This
  // deterministic fallback only matters if random retries become unusually unlucky.
  for(let n=0;n<combinations;n++){const genotype=genotypeFromNumber(n);if(!genotypeIsMinted(genotype))return genotype;}
  return [...builderGenotype];
}
function linearPrice(step){return mintBatchPrice(BigInt(step-1))}
const ethFormat=formatMintETH;
let ethUsdQuote=null,exchangeRatePromise=null;
function usdEquivalent(wei,bare=false){
  if(!ethUsdQuote)return '';
  const label=formatMintUSD(wei,ethUsdQuote);
  if(label==='(USD unavailable)')return '';
  return bare?label.slice(1,-1):label;
}
function priceMarkup(wei,unit=true){return '<span class="eth-price">'+ethFormat(wei)+(unit?' ETH':'')+'</span> <small class="usd-price" data-wei="'+wei+'">'+usdEquivalent(wei)+'</small>';}
function refreshUSDDisplays(){
  document.querySelectorAll('.usd-price[data-wei]').forEach(el=>{
    const wei=BigInt(el.dataset.wei);
    el.textContent=usdEquivalent(wei,el.hasAttribute('data-usd-bare'));
  });
  const rate=$('footerExchangeRate');
  if(rate){
    const usd=Number(ethUsdQuote?.usd),eur=Number(ethUsdQuote?.eur);
    if(Number.isFinite(usd)&&usd>0&&Number.isFinite(eur)&&eur>0){
      const money=(value,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(value);
      rate.textContent=`1 ETH ≈ ${money(usd,'USD')} · ${money(eur,'EUR')}`;
      rate.hidden=false;
    }else rate.hidden=true;
  }
}
function quoteIsFresh(quote){return quote&&Number.isFinite(quote.updatedAt)&&Date.now()-quote.updatedAt<=15*60*1000;}
async function refreshExchangeRate(force=true){
  if(!force&&quoteIsFresh(ethUsdQuote))return ethUsdQuote;
  if(exchangeRatePromise)return exchangeRatePromise;
  exchangeRatePromise=fetchEthUsdQuote().then(quote=>{
    ethUsdQuote=quote;
    if(Number.isFinite(quote.eur)&&quote.eur>0){
      setForestEthEurRate(quote.eur);
      if(currentView==='about')refreshForestProgressFromChain();
    }
    return quote;
  }).catch(()=>null).finally(()=>{exchangeRatePromise=null;refreshUSDDisplays();});
  return exchangeRatePromise;
}
const paidCount=()=>spiralEntries.filter(e=>e.phase==='public').length;
const nextPrice=()=>BigInt(chainState.snapshot?.price??0);
const raised=()=>spiralEntries.reduce((sum,e)=>sum+e.price,0n);
function syncDocumentTitle(){
  const price=nextPrice();
  document.title=chainState.snapshot&&chainState.snapshot.total<chainState.snapshot.cap?'mycelium Friends · '+(price===0n?'FREE':ethFormat(price)+' ETH'):'mycelium Friends';
}
function announce(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}

// Store stable trait IDs so saved looks survive catalog reordering.
const looksKey='myfriends:looks:v1',wishlistKey='myfriends:wishlist:v2',gridSizeKey='myfriends:grid-size:v1';
const gridSizes=['tiny','compact','small','medium','large'];
const gridScaleLabels={tiny:'50%',compact:'65%',small:'80%',medium:'100%',large:'125%'};
let savedLooks=[],lookPosition=-1,catalogKey='cap',catalogRenderedKey=null,catalogCenterFrame=0;
let historyClearTimer=0;
let catalogLimit=0,catalogPaintObserver=null,catalogTiles=null,decodedTraitRuns=new WeakMap();
let wishlistLooks=[],wishlistCatalog=[],wishlistPaintObserver=null,historyCatalog=[],historyPaintObserver=null,historyLimit=24;
let collectionPaintObserver=null,ownedArtObserver=null,aboutLayersGenotype='';
let gridSize='medium';
const genotypeIDs=genotype=>layerKeys.map((key,i)=>traits[key][genotype[i]].id);
function lookIDs(){return genotypeIDs(builderGenotype);}
function lookGenotype(ids){
  if(!Array.isArray(ids)||ids.length!==layerKeys.length)return null;
  const genotype=layerKeys.map((key,i)=>traits[key].findIndex(t=>t.id===ids[i]));
  return genotype.every(i=>i>=0)?genotype:null;
}
function saveLooks(){
  try{localStorage.setItem(looksKey,JSON.stringify({looks:savedLooks,position:lookPosition}));}
  catch{announce('Your looks are available for this visit. Browser storage is full or unavailable.');}
}
function saveWishlist(){
  try{localStorage.setItem(wishlistKey,JSON.stringify(wishlistLooks));}
  catch{announce('Your wishlist is available for this visit. Browser storage is full or unavailable.');}
}
function restoreWishlist(){
  try{
    const stored=JSON.parse(localStorage.getItem(wishlistKey)),seen=new Set();
    wishlistLooks=(Array.isArray(stored)?stored:[]).filter(ids=>{
      const genotype=lookGenotype(ids),key=genotype?.join(',');
      if(!genotype||seen.has(key))return false;seen.add(key);return true;
    });
  }catch{wishlistLooks=[];}
}
function restoreGridSize(){
  try{const saved=localStorage.getItem(gridSizeKey);if(gridSizes.includes(saved))gridSize=saved;}
  catch{/* The default size remains available when browser storage is blocked. */}
}
function syncGridSize(){
  const index=gridSizes.indexOf(gridSize);
  for(const id of ['forest-view','wishlist-view','history-view'])$(id).dataset.gridSize=gridSize;
  $('gridScaleLevel').textContent=gridScaleLabels[gridSize];
  document.querySelectorAll('[data-grid-scale]').forEach(button=>{
    const delta=Number(button.dataset.gridScale);
    button.disabled=delta<0?index===0:index===gridSizes.length-1;
  });
}
function changeGridSize(delta){
  const index=gridSizes.indexOf(gridSize),next=Math.max(0,Math.min(gridSizes.length-1,index+delta));
  if(next===index)return;
  gridSize=gridSizes[next];
  try{localStorage.setItem(gridSizeKey,gridSize);}catch{/* The setting remains active for this visit. */}
  syncGridSize();
  announce(gridSize==='tiny'?'Showing the smallest friends.':gridSize==='compact'?'Showing a compact grid.':gridSize==='small'?'Showing more friends.':gridSize==='large'?'Showing larger friends.':'Showing medium-sized friends.');
}
function resetGridSize(){
  gridSize='medium';
  try{localStorage.setItem(gridSizeKey,gridSize);}catch{/* The setting remains active for this visit. */}
  syncGridSize();announce('Artwork size reset.');
}
function wishlistIndex(genotype){
  const key=genotypeKey(genotype);return wishlistLooks.findIndex(ids=>{const saved=lookGenotype(ids);return saved&&genotypeKey(saved)===key;});
}
function isWishlisted(genotype){return wishlistIndex(genotype)>=0;}
function toggleWishlist(genotype,notify=true){
  const index=wishlistIndex(genotype),saved=index<0;
  if(saved)wishlistLooks.push(genotypeIDs(genotype));else wishlistLooks.splice(index,1);
  saveWishlist();
  if(currentView==='wishlist')renderWishlist();
  if(currentView==='history')syncHistoryWishlist();
  syncPreviewWishlist();if(notify)announce(saved?'Saved to your wishlist.':'Removed from your wishlist.');
  return saved;
}
function syncHistoryWishlist(){
  const likedKeys=new Set(wishlistLooks.map(lookGenotype).filter(Boolean).map(genotypeKey));
  $('history-gallery').querySelectorAll('[data-history-like]').forEach(button=>{
    const item=historyCatalog[Number(button.dataset.historyLike)],liked=Boolean(item&&likedKeys.has(genotypeKey(item.genotype)));
    button.classList.toggle('active',liked);button.setAttribute('aria-pressed',String(liked));
    button.setAttribute('aria-label',(liked?'Remove this combination from':'Save this combination to')+' wishlist');button.textContent=liked?'♥':'♡';
  });
}
function restoreLooks(){
  try{
    const data=JSON.parse(localStorage.getItem(looksKey));
    savedLooks=(Array.isArray(data?.looks)?data.looks:[]).filter(ids=>lookGenotype(ids));
    lookPosition=Math.min(Math.max(0,Math.floor(Number(data?.position))||0),savedLooks.length-1);
    if(savedLooks.length)builderGenotype=lookGenotype(savedLooks[lookPosition]);
  }catch{savedLooks=[];lookPosition=-1;}
}
function rememberLook(){
  const ids=lookIDs();
  if(savedLooks[lookPosition]?.join('|')===ids.join('|'))return;
  // A new shuffle appends; browsing backwards never discards later favourites.
  savedLooks.push(ids);lookPosition=savedLooks.length-1;saveLooks();
}
function renderHistory(){
  $('previousShuffle').disabled=lookPosition<=0;$('nextShuffle').disabled=lookPosition>=savedLooks.length-1;
  const total=Math.max(1,savedLooks.length),current=savedLooks.length?Math.max(0,lookPosition)+1:1,version=$('previewVersion');
  version.textContent=current+' / '+total;version.setAttribute('aria-label','Version '+current+' of '+total);
}
function browseLooks(delta){
  const next=lookPosition+delta;if(next<0||next>=savedLooks.length)return false;
  lookPosition=next;saveLooks();selectGenotype(lookGenotype(savedLooks[next]),false);return true;
}
$('previousShuffle').onclick=()=>browseLooks(-1);$('nextShuffle').onclick=()=>browseLooks(1);
{
  const previewFrame=document.querySelector('.preview-first');let previewSwipe=null,lastPreviewTap=null,previewLikeTimer=0,previewWheelDelta=0,previewWheelTimer=0,previewWheelLocked=false;
  const showPreviewLike=()=>{
    const button=$('toggleWishlist');if(button.hidden||button.disabled)return false;
    if(!isWishlisted(builderGenotype))toggleWishlist(builderGenotype,false);
    const burst=$('previewLikeBurst');clearTimeout(previewLikeTimer);burst.classList.remove('is-active');void burst.offsetWidth;burst.classList.add('is-active');
    previewLikeTimer=setTimeout(()=>burst.classList.remove('is-active'),600);return true;
  };
  previewFrame.addEventListener('pointerdown',event=>{
    if((!mobileLayout.matches&&event.pointerType!=='touch')||event.target.closest('button,a'))return;
    previewSwipe={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now()};
    try{previewFrame.setPointerCapture?.(event.pointerId);}catch{/* The gesture still works without capture. */}
  });
  previewFrame.addEventListener('pointerup',event=>{
    if(!previewSwipe||previewSwipe.id!==event.pointerId)return;
    const now=performance.now(),dx=event.clientX-previewSwipe.x,dy=event.clientY-previewSwipe.y,distance=Math.hypot(dx,dy),duration=now-previewSwipe.time;previewSwipe=null;
    if(Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.2){lastPreviewTap=null;browseLooks(dx>0?-1:1);return;}
    if(distance>12||duration>350){lastPreviewTap=null;return;}
    if(lastPreviewTap&&now-lastPreviewTap.time<=320&&Math.hypot(event.clientX-lastPreviewTap.x,event.clientY-lastPreviewTap.y)<=28){
      lastPreviewTap=null;showPreviewLike();return;
    }
    lastPreviewTap={time:now,x:event.clientX,y:event.clientY};
  });
  for(const name of ['pointercancel','lostpointercapture'])previewFrame.addEventListener(name,()=>{previewSwipe=null;});
  previewFrame.addEventListener('wheel',event=>{
    if(mobileLayout.matches||currentView!=='spiral'||selectedSlot!==null||Math.abs(event.deltaX)<=Math.abs(event.deltaY)||Math.abs(event.deltaX)<2)return;
    event.preventDefault();clearTimeout(previewWheelTimer);previewWheelDelta+=event.deltaX;
    if(!previewWheelLocked&&Math.abs(previewWheelDelta)>=44){browseLooks(previewWheelDelta>0?1:-1);previewWheelDelta=0;previewWheelLocked=true;}
    previewWheelTimer=setTimeout(()=>{previewWheelDelta=0;previewWheelLocked=false;},180);
  },{passive:false});
}
document.querySelectorAll('[data-grid-scale]').forEach(button=>button.onclick=()=>changeGridSize(Number(button.dataset.gridScale)));
$('resetGridScale').onclick=resetGridSize;
function setExplore(catalog){
  $('forest-view').hidden=true;$('myfriends-view').hidden=true;$('wishlist-view').hidden=true;$('history-view').hidden=true;$('about-view').hidden=true;
  $('traitCatalog').hidden=!catalog;$('universe').hidden=catalog;
  $('catalogTabs').hidden=!catalog;$('spiral-view').classList.toggle('catalog-open',catalog);
  $('spiralModeToggle').hidden=catalog;syncLinks();syncPreviewWishlist();
  if(catalog)renderCatalog(true,false);
  else{
    catalogPaintObserver?.disconnect();
    $('catalogGrid').querySelectorAll('canvas').forEach(releaseCatalogCanvas);
  }
}
function openCatalog(key,scroll=false){
  catalogKey=key;
  if(mobileLayout.matches){
    mobileTraitKey=key;mobileSurface='builder';
    if(currentView!=='spiral')showView('spiral');
    setExplore(false);renderMobileTraitRail();syncURL();
    if(scroll)$('mobileCategoryTabs').querySelector('[data-mobile-category="'+key+'"]')?.focus({preventScroll:true});
    return;
  }
  if(currentView!=='spiral')showView('spiral');
  setExplore(true);syncURL();
  if(scroll&&innerWidth<=760)$('traitCatalog').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
$('showSpiral').onclick=event=>{event.preventDefault();showView('spiral');setExplore(false);syncURL();};
$('showTraits').onclick=event=>{event.preventDefault();showView('spiral');setExplore(true);syncURL();};
$('showSpiralMode').onclick=()=>{showView('spiral');setExplore(false);syncURL();};
$('showCollectionMode').onclick=()=>{showView('forest',true);syncURL();};
{
  const mark=document.querySelector('.brandmark path')?.cloneNode();
  if(mark){
    mark.removeAttribute('id');mark.setAttribute('stroke','currentColor');$('spiralModeIcon').append(mark);
    const mobileMark=mark.cloneNode();mobileMark.removeAttribute('stroke-width');$('mobileSpiralIcon').append(mobileMark);
  }
}
document.querySelectorAll('[data-about-destination]').forEach(link=>link.onclick=event=>{
  event.preventDefault();
  if(link.dataset.aboutDestination==='builder'){openCatalog(catalogKey);return;}
  showView('forest',true);syncURL();
});
function centerCatalogTraitOption(smooth=true){
  cancelAnimationFrame(catalogCenterFrame);
  catalogCenterFrame=requestAnimationFrame(()=>{
    catalogCenterFrame=0;
    const root=$('traitCatalog'),active=builderGenotype[layerKeys.indexOf(catalogKey)];
    const selected=root.querySelector('.catalog-trait[data-category="'+catalogKey+'"][data-option="'+active+'"]');
    if(!selected||root.hidden)return;
    const rootRect=root.getBoundingClientRect(),selectedRect=selected.getBoundingClientRect();
    const top=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,root.scrollTop+selectedRect.top+selectedRect.height/2-rootRect.top-rootRect.height/2));
    root.scrollTo({top,behavior:smooth&&!spiralMotion.matches?'smooth':'auto'});
  });
}
function renderCatalog(centerSelected=false,smooth=true){
  const index=layerKeys.indexOf(catalogKey);
  if(catalogRenderedKey!==catalogKey){
    catalogRenderedKey=catalogKey;
    catalogLimit=traits[catalogKey].length;
    if(!$('catalogTabs').childElementCount){
      $('catalogTabs').innerHTML=layerKeys.map(key=>'<button data-category="'+key+'" aria-pressed="'+(key===catalogKey)+'">'+layerNames[key]+'</button>').join('');
      $('catalogTabs').querySelectorAll('button').forEach(button=>button.onclick=()=>openCatalog(button.dataset.category));
    }
    $('traitCatalog').scrollTop=0;
    renderCatalogBatch(true);
  }
  $('catalogTabs').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===catalogKey)));
  const active=builderGenotype[index],stalePinned=$('catalogGrid').querySelector('[data-pinned="true"]');
  if(stalePinned&&Number(stalePinned.dataset.option)!==active)stalePinned.remove();
  if(!$('catalogGrid').querySelector('[data-option="'+active+'"]')){
    $('catalogGrid').insertAdjacentHTML('afterbegin',catalogCard(active,true));observeCatalogCanvases();
  }
  $('catalogGrid').querySelectorAll('.catalog-select').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.closest('.catalog-trait').dataset.option)===builderGenotype[index])));
  observeCatalogCanvases();
  if(centerSelected)centerCatalogTraitOption(smooth);
}
function catalogCard(i,pinned=false,key=catalogKey,showCategory=false){
  const trait=traits[key][i],active=builderGenotype[layerKeys.indexOf(key)];
  return '<article class="catalog-trait" data-option="'+i+'" data-category="'+key+'"'+(pinned?' data-pinned="true"':'')+'><button type="button" class="catalog-select" aria-pressed="'+(i===active)+'"><span class="catalog-image"><canvas class="catalog-canvas" width="1" height="1" data-option="'+i+'" data-category="'+key+'" aria-hidden="true"></canvas>'+(trait.id==='none'?'<span class="no-trait">∅</span>':'')+'<span class="trait-check" aria-hidden="true">✓</span></span><span class="catalog-name">'+trait.name+'</span>'+(showCategory?'<span class="catalog-category">'+layerNames[key]+'</span>':'')+'</button></article>';
}
function beadTiles(){
  if(catalogTiles)return catalogTiles;
  catalogTiles=beadPalette.map(color=>{const tile=document.createElement('canvas');tile.width=tile.height=5;const ctx=tile.getContext('2d');ctx.fillStyle=color;ctx.beginPath();ctx.arc(2.5,2.5,2.3,0,Math.PI*2);ctx.fill();const shine=ctx.createRadialGradient(1.5,1.2,0,2.5,2.5,3.5);shine.addColorStop(0,'#ffffff94');shine.addColorStop(.24,'#ffffff1f');shine.addColorStop(.48,'#00000000');shine.addColorStop(1,'#000000cc');ctx.fillStyle=shine;ctx.fill();return tile;});
  return catalogTiles;
}
function queueRender(node,paint){
  if(!node||node.dataset.paintQueued||node.dataset.painted)return;
  node.dataset.paintQueued='true';renderQueue.push({node,paint});
  if(!renderQueueFrame)renderQueueFrame=requestAnimationFrame(flushRenderQueue);
}
function flushRenderQueue(){
  renderQueueFrame=0;const start=performance.now();
  while(renderQueue.length){
    const {node,paint}=renderQueue.shift();delete node.dataset.paintQueued;
    if(node.isConnected&&node.getClientRects().length&&!node.dataset.painted)paint(node);
    if(performance.now()-start>=4)break;
  }
  if(renderQueue.length)renderQueueFrame=requestAnimationFrame(flushRenderQueue);
}
function decodedRuns(trait){
  let runs=decodedTraitRuns.get(trait);if(runs)return runs;
  runs=new Uint8Array(trait.data.length/2);
  for(let source=0,target=0;source<trait.data.length;source+=2,target++)runs[target]=parseInt(trait.data.slice(source,source+2),16);
  decodedTraitRuns.set(trait,runs);return runs;
}
function paintTrait(ctx,trait,patterns){
  const tiles=beadTiles(),runs=decodedRuns(trait);
  for(let i=0;i<runs.length;i+=4){
    const x=runs[i],y=runs[i+1],count=runs[i+2],color=runs[i+3];
    ctx.fillStyle=patterns[color]??=ctx.createPattern(tiles[color],'repeat');ctx.fillRect(x*5,y*5,count*5,5);
  }
}
function prepareCanvas(canvas,resolution=Number(canvas.dataset.resolution)||400){
  if(canvas.width!==resolution||canvas.height!==resolution){canvas.width=resolution;canvas.height=resolution;}
  const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,resolution,resolution);ctx.setTransform(resolution/400,0,0,resolution/400,0,0);return ctx;
}
function paintGenotypeCanvas(canvas,genotype,{background=false}={}){
  const ctx=prepareCanvas(canvas),patterns=[];
  if(background){ctx.fillStyle='#000';ctx.fillRect(0,0,400,400);}
  for(const key of renderLayerKeys){
    const offset=compositionOffsetX(genotype,key);
    if(offset){ctx.save();ctx.translate(offset,0);}
    paintTrait(ctx,traits[key][genotype[layerKeys.indexOf(key)]],patterns);
    if(offset)ctx.restore();
  }
  canvas.dataset.genotype=genotype.join(',');canvas.classList.add('painted');
  if(canvas.id==='previewCanvas')$('preview').hidden=true;
}
function syncFavicon(genotype=builderGenotype){
  const key=genotypeKey(genotype);if(!faviconLink||faviconLink.dataset.genotype===key||faviconLink.dataset.pendingGenotype===key)return;
  faviconLink.dataset.pendingGenotype=key;const revision=++faviconRevision,selected=[...genotype];clearTimeout(faviconTimer);
  faviconTimer=setTimeout(()=>{
    paintGenotypeCanvas(faviconCanvas,selected);
    faviconCanvas.toBlob(blob=>{
      if(!blob||revision!==faviconRevision)return;
      const nextURL=URL.createObjectURL(blob),previousURL=faviconObjectURL;faviconObjectURL=nextURL;
      faviconLink.type='image/png';faviconLink.href=nextURL;faviconLink.dataset.genotype=key;delete faviconLink.dataset.pendingGenotype;
      if(previousURL)URL.revokeObjectURL(previousURL);
    },'image/png');
  },80);
}
function paintLayerCanvas(canvas,position){
  const ctx=prepareCanvas(canvas,240),patterns=[];
  for(const key of renderLayerKeys.slice(0,position+1)){
    const offset=compositionOffsetX(builderGenotype,key);
    if(offset){ctx.save();ctx.translate(offset,0);}
    paintTrait(ctx,traits[key][builderGenotype[layerKeys.indexOf(key)]],patterns);
    if(offset)ctx.restore();
  }
}
function paintCatalogCanvas(canvas){
  if(canvas.dataset.painted)return;canvas.dataset.painted='true';
  const ctx=prepareCanvas(canvas,240),patterns=[],key=canvas.dataset.category||catalogKey;
  // Expressions read as characters, not disconnected marks. Match the
  // editorial field guide by presenting each one on Porcelain Pause.
  if(key==='temperament')paintTrait(ctx,traits.stem.find(trait=>trait.id==='porcelain'),patterns);
  paintTrait(ctx,traits[key][Number(canvas.dataset.option)],patterns);
}
function paintMobileTraitCanvas(canvas){
  if(canvas.dataset.painted)return;canvas.dataset.painted='true';
  const ctx=prepareCanvas(canvas,96),patterns=[],key=canvas.dataset.category;
  if(key==='temperament')paintTrait(ctx,traits.stem.find(trait=>trait.id==='porcelain'),patterns);
  paintTrait(ctx,traits[key][Number(canvas.dataset.option)],patterns);
}
function observeMobileTraitCanvases(){
  mobileTraitPaintObserver?.disconnect();
  const rail=$('mobileTraitRail'),canvases=[...rail.querySelectorAll('canvas')];
  if(!('IntersectionObserver' in window)){canvases.forEach(canvas=>queueRender(canvas,paintMobileTraitCanvas));return;}
  mobileTraitPaintObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    queueRender(entry.target,paintMobileTraitCanvas);mobileTraitPaintObserver.unobserve(entry.target);
  }),{root:rail,rootMargin:'0px 96px'});
  canvases.forEach(canvas=>mobileTraitPaintObserver.observe(canvas));
  requestAnimationFrame(()=>{
    const root=rail.getBoundingClientRect();
    canvases.forEach(canvas=>{const rect=canvas.getBoundingClientRect();if(rect.right>=root.left-96&&rect.left<=root.right+96)queueRender(canvas,paintMobileTraitCanvas);});
  });
}
function resumeMobileTraitPainting(){
  clearTimeout(mobileTraitCenterTimer);
  mobileTraitCenterTimer=setTimeout(()=>{
    mobileTraitCentering=false;
    if(mobileLayout.matches&&currentView==='spiral'&&mobileSurface==='builder')observeMobileTraitCanvases();
  },120);
}
function centerMobileTraitOption(selected,smooth=true){
  if(!selected)return;
  const rail=$('mobileTraitRail'),railRect=rail.getBoundingClientRect(),selectedRect=selected.getBoundingClientRect();
  const left=Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,rail.scrollLeft+selectedRect.left+selectedRect.width/2-railRect.left-railRect.width/2));
  mobileTraitPaintObserver?.disconnect();mobileTraitCentering=true;
  rail.scrollTo({left,behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
  resumeMobileTraitPainting();
}
function renderMobileTraitRail(centerSelected=true,resumePainting=false,smooth=true){
  const rail=$('mobileTraitRail');if(!rail)return;
  const index=layerKeys.indexOf(mobileTraitKey),active=builderGenotype[index],options=traits[mobileTraitKey];
  $('mobileTraitLabel').textContent=layerNames[mobileTraitKey];
  $('mobileTraitValue').textContent=options[active].name+' · '+num(active+1)+' / '+num(options.length);
  $('mobileCategoryTabs').querySelectorAll('[data-mobile-category]').forEach(button=>{
    const selected=button.dataset.mobileCategory===mobileTraitKey;
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  });
  const rebuild=rail.dataset.category!==mobileTraitKey||rail.children.length!==options.length;
  if(rebuild){
    mobileTraitPaintObserver?.disconnect();clearTimeout(mobileTraitCenterTimer);mobileTraitCentering=false;
    rail.dataset.category=mobileTraitKey;
    rail.innerHTML=options.map((trait,option)=>'<button type="button" id="mobile-trait-'+mobileTraitKey+'-'+option+'" class="mobile-trait-option" role="option" aria-selected="'+(option===active)+'" tabindex="'+(option===active?0:-1)+'" data-mobile-option="'+option+'" data-category="'+mobileTraitKey+'" title="'+trait.name+'"><span class="mobile-trait-art"><canvas width="1" height="1" data-option="'+option+'" data-category="'+mobileTraitKey+'" aria-hidden="true"></canvas>'+(trait.id==='none'?'<span class="no-trait">∅</span>':'')+'</span><span class="mobile-trait-name">'+trait.name+'</span></button>').join('');
  }else rail.querySelectorAll('[data-mobile-option]').forEach(button=>{
    const selected=Number(button.dataset.mobileOption)===active;
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  });
  const selected=rail.querySelector('[aria-selected="true"]');
  if((rebuild||centerSelected)&&selected)paintMobileTraitCanvas(selected.querySelector('canvas'));
  if(centerSelected)centerMobileTraitOption(selected,smooth);
  else if(rebuild||(resumePainting&&rail.querySelector('canvas:not([data-painted])')))observeMobileTraitCanvases();
}
function chooseMobileTrait(option){
  const index=layerKeys.indexOf(mobileTraitKey);if(builderGenotype[index]===option)return;
  const genotype=[...builderGenotype];genotype[index]=option;selectGenotype(genotype);
}
$('mobileCategoryTabs').onclick=event=>{
  const button=event.target.closest('[data-mobile-category]');if(!button)return;
  mobileTraitKey=button.dataset.mobileCategory;renderMobileTraitRail();
};
$('mobileCategoryTabs').onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const buttons=[...event.currentTarget.querySelectorAll('[data-mobile-category]')],current=buttons.indexOf(event.target.closest('button'));if(current<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
  buttons[next].click();buttons[next].focus();
};
$('mobileTraitRail').onclick=event=>{const button=event.target.closest('[data-mobile-option]');if(button)chooseMobileTrait(Number(button.dataset.mobileOption));};
$('mobileTraitRail').addEventListener('scroll',()=>{if(mobileTraitCentering)resumeMobileTraitPainting();},{passive:true});
new ResizeObserver(()=>{
  if(mobileLayout.matches&&currentView==='spiral'&&mobileSurface==='builder')renderMobileTraitRail(true,false,false);
}).observe($('mobileTraitRail'));
$('mobileTraitRail').onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const options=[...event.currentTarget.querySelectorAll('[data-mobile-option]')],current=options.indexOf(event.target.closest('button'));if(current<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,current+(event.key==='ArrowRight'?1:-1)));
  options[next].focus();options[next].click();
};
function releaseCatalogCanvas(canvas){
  if(!canvas.dataset.painted)return;delete canvas.dataset.painted;canvas.width=canvas.height=1;
}
function observeCatalogCanvases(){
  const canvases=[...$('catalogGrid').querySelectorAll('canvas')];
  if(!('IntersectionObserver' in window)){canvases.forEach(paintCatalogCanvas);return;}
  catalogPaintObserver?.disconnect();
  catalogPaintObserver=new IntersectionObserver(entries=>entries.forEach(entry=>entry.isIntersecting?paintCatalogCanvas(entry.target):releaseCatalogCanvas(entry.target)),{root:$('traitCatalog'),rootMargin:'240px'});
  canvases.forEach(canvas=>catalogPaintObserver.observe(canvas));
  // Reopening a previously hidden scroll root does not consistently produce an
  // initial IntersectionObserver delivery in every Chromium build. Paint only
  // its first viewport-sized working set; the observer owns later scrolling.
  requestAnimationFrame(()=>{
    if($('traitCatalog').hidden)return;
    const root=$('traitCatalog').getBoundingClientRect(),margin=240;
    canvases.forEach(canvas=>{const rect=canvas.getBoundingClientRect();if(rect.bottom>=root.top-margin&&rect.top<=root.bottom+margin)paintCatalogCanvas(canvas);});
  });
}
function renderCatalogBatch(reset=false){
  const total=traits[catalogKey].length,oldLimit=reset?0:catalogLimit;
  if(reset){catalogPaintObserver?.disconnect();$('catalogGrid').innerHTML='';catalogLimit=total;}
  else catalogLimit=total;
  const existing=new Set([...$('catalogGrid').querySelectorAll('[data-option]')].map(node=>Number(node.dataset.option)));
  const additions=Array.from({length:catalogLimit-oldLimit},(_,i)=>oldLimit+i).filter(i=>!existing.has(i));
  $('catalogGrid').insertAdjacentHTML('beforeend',additions.map(i=>catalogCard(i)).join(''));
  const active=builderGenotype[layerKeys.indexOf(catalogKey)];if(!existing.has(active)&&active>=catalogLimit)$('catalogGrid').insertAdjacentHTML('afterbegin',catalogCard(active,true));
  $('catalogSentinel').hidden=catalogLimit>=total;observeCatalogCanvases();
}
$('catalogGrid').onclick=event=>{
  const card=event.target.closest('.catalog-trait');if(!card)return;
  if(!event.target.closest('.catalog-select'))return;
  const genotype=[...builderGenotype];genotype[layerKeys.indexOf(card.dataset.category)]=Number(card.dataset.option);selectGenotype(genotype);
};
function paintWishlistCanvas(canvas){
  if(canvas.dataset.painted)return;
  const genotype=wishlistCatalog[Number(canvas.dataset.wishlistArt)];if(!genotype)return;
  paintGenotypeCanvas(canvas,genotype);canvas.dataset.painted='true';
}
function observeWishlistCanvases(){
  wishlistPaintObserver?.disconnect();
  const canvases=[...$('wishlist-gallery').querySelectorAll('[data-wishlist-art]')];
  if(!('IntersectionObserver' in window)){canvases.forEach(canvas=>queueRender(canvas,paintWishlistCanvas));return;}
  wishlistPaintObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    queueRender(entry.target,paintWishlistCanvas);wishlistPaintObserver.unobserve(entry.target);
  }),{root:$('wishlist-view'),rootMargin:'240px 0px'});
  canvases.forEach(canvas=>wishlistPaintObserver.observe(canvas));
}
function renderWishlist(){
  wishlistPaintObserver?.disconnect();
  wishlistCatalog=wishlistLooks.map(lookGenotype).filter(genotype=>genotype&&!genotypeIsMinted(genotype)).reverse();
  const gallery=$('wishlist-gallery');
  $('wishlist-caption').textContent=wishlistCatalog.length?(wishlistCatalog.length===1?'1 favourite myFriend':wishlistCatalog.length+' favourite myFriends')+' · Ready when you are.':'Favourite combinations, ready to mint.';
  if(!wishlistCatalog.length){gallery.innerHTML='<div class="library-empty"><h2>Your favourites can live here.</h2><p>Like a preview or a combination in History to save the whole myFriend.</p></div>';return;}
  const resolution=mobileLayout.matches?320:480;
  gallery.innerHTML=wishlistCatalog.map((genotype,index)=>'<article class="forest-card wishlist-card'+(sameGenotype(genotype,builderGenotype)?' selected':'')+'"><button type="button" class="look-select" data-wishlist="'+index+'" aria-label="Select favourite combination '+(index+1)+'"><div class="forest-art"><canvas width="1" height="1" data-resolution="'+resolution+'" data-wishlist-art="'+index+'" aria-hidden="true"></canvas></div></button><div class="wishlist-actions"><button type="button" data-wishlist-mint="'+index+'">MINT MYFRIEND ↗</button><button type="button" class="look-like active" data-wishlist-remove="'+index+'" aria-label="Remove this combination from wishlist">♥</button></div></article>').join('');
  if(chainState.walletEnabled===false)gallery.querySelectorAll('[data-wishlist-mint]').forEach(button=>{button.disabled=true;button.textContent='READ-ONLY PREVIEW';});
  observeWishlistCanvases();
  gallery.querySelectorAll('[data-wishlist]').forEach(button=>button.onclick=()=>selectGenotype(wishlistCatalog[Number(button.dataset.wishlist)],false));
  gallery.querySelectorAll('[data-wishlist-remove]').forEach(button=>button.onclick=()=>toggleWishlist(wishlistCatalog[Number(button.dataset.wishlistRemove)]));
  gallery.querySelectorAll('[data-wishlist-mint]').forEach(button=>button.onclick=()=>{
    selectGenotype(wishlistCatalog[Number(button.dataset.wishlistMint)],false);
    window.dispatchEvent(new Event('myfriends:review-mint'));
  });
}
function paintHistoryCanvas(canvas){
  if(canvas.dataset.painted)return;
  const item=historyCatalog[Number(canvas.dataset.historyArt)];if(!item)return;
  paintGenotypeCanvas(canvas,item.genotype);canvas.dataset.painted='true';
}
function releaseHistoryCanvas(canvas){
  if(!canvas.dataset.painted)return;
  delete canvas.dataset.painted;delete canvas.dataset.genotype;canvas.classList.remove('painted');
  canvas.width=canvas.height=1;
}
function releaseHistoryCanvases(){
  historyPaintObserver?.disconnect();
  $('history-gallery').querySelectorAll('[data-history-art]').forEach(releaseHistoryCanvas);
}
function observeHistoryCanvases(){
  historyPaintObserver?.disconnect();
  const canvases=[...$('history-gallery').querySelectorAll('[data-history-art]')];
  if(!('IntersectionObserver' in window)){canvases.forEach(canvas=>queueRender(canvas,paintHistoryCanvas));return;}
  historyPaintObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting){queueRender(entry.target,paintHistoryCanvas);if(mobileLayout.matches)historyPaintObserver.unobserve(entry.target);}
    else if(!mobileLayout.matches)releaseHistoryCanvas(entry.target);
  }),{root:$('history-view'),rootMargin:'240px 0px'});
  canvases.forEach(canvas=>historyPaintObserver.observe(canvas));
}
function resetHistoryClear(){
  clearTimeout(historyClearTimer);historyClearTimer=0;
  const button=$('clearHistory');button.classList.remove('is-confirming');button.setAttribute('aria-label','Clear history');button.title='Clear history';
}
function syncHistoryClear(){
  const button=$('clearHistory'),hasPrevious=historyCatalog.some(item=>!sameGenotype(item.genotype,builderGenotype));button.hidden=!hasPrevious;
  if(!hasPrevious)resetHistoryClear();
}
function renderHistoryCatalog(reset=false){
  historyPaintObserver?.disconnect();const seen=new Set();
  if(reset)historyLimit=24;
  historyCatalog=savedLooks.map((ids,position)=>({genotype:lookGenotype(ids),position})).reverse().filter(item=>{
    if(!item.genotype||genotypeIsMinted(item.genotype))return false;const key=genotypeKey(item.genotype);if(seen.has(key))return false;seen.add(key);return true;
  });
  const gallery=$('history-gallery');$('history-caption').textContent=historyCatalog.length?(historyCatalog.length===1?'1 unminted combination':historyCatalog.length+' unminted combinations')+' · Newest first.':'Unminted combinations created in this browser.';
  syncHistoryClear();
  if(!historyCatalog.length){gallery.innerHTML='<div class="library-empty"><h2>No unminted looks yet.</h2><p>Build or shuffle a myFriend and the combination will appear here.</p></div>';$('moreHistory').hidden=true;return;}
  const likedKeys=new Set(wishlistLooks.map(lookGenotype).filter(Boolean).map(genotypeKey));
  const visibleHistory=mobileLayout.matches?historyCatalog.slice(0,historyLimit):historyCatalog;
  const resolution=mobileLayout.matches?320:480;
  gallery.innerHTML=visibleHistory.map(({genotype,position},index)=>{const liked=likedKeys.has(genotypeKey(genotype)),look='LOOK '+num(position+1);return '<article class="forest-card history-card'+(sameGenotype(genotype,builderGenotype)?' selected':'')+'"><button type="button" class="look-select" data-history="'+index+'" aria-label="'+look+' · Open saved combination '+(position+1)+'"><div class="forest-art"><canvas width="1" height="1" data-resolution="'+resolution+'" data-history-art="'+index+'" aria-hidden="true"></canvas></div><div class="forest-label"><span>'+look+'</span></div></button><button type="button" class="look-like'+(liked?' active':'')+'" data-history-like="'+index+'" aria-label="'+(liked?'Remove this combination from':'Save this combination to')+' wishlist" aria-pressed="'+liked+'">'+(liked?'♥':'♡')+'</button></article>';}).join('');
  $('moreHistory').hidden=!mobileLayout.matches||historyLimit>=historyCatalog.length;
  observeHistoryCanvases();
  gallery.querySelectorAll('[data-history]').forEach(button=>button.onclick=()=>selectGenotype(historyCatalog[Number(button.dataset.history)].genotype,false));
  gallery.querySelectorAll('[data-history-like]').forEach(button=>button.onclick=()=>toggleWishlist(historyCatalog[Number(button.dataset.historyLike)].genotype));
}
$('moreHistory').onclick=()=>{historyLimit+=24;renderHistoryCatalog();};
$('clearHistory').onclick=()=>{
  const button=$('clearHistory');
  if(!button.classList.contains('is-confirming')){
    button.classList.add('is-confirming');button.setAttribute('aria-label','Confirm clear history');button.title='Tap again to confirm';
    announce('Tap the highlighted trash again to clear previous looks.');historyClearTimer=setTimeout(resetHistoryClear,4000);return;
  }
  savedLooks=[lookIDs()];lookPosition=0;saveLooks();resetHistoryClear();renderHistory();renderHistoryCatalog(true);announce('History cleared. Your current myFriend and Wishlist remain.');
};
async function rasterArtwork(genotype,format='png'){
  const svg=renderSVG(validateGenotype(genotype),{background:0});
  if(!['png','jpeg'].includes(format))throw Error('Choose SVG, PNG or JPEG.');
  const source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try{
    const img=new Image();img.src=source;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1600;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,1600,1600);ctx.drawImage(img,0,0,1600,1600);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/'+format,.95));
    img.src='';canvas.width=canvas.height=1;
    if(!blob)throw Error('Your image could not be saved. Please try again.');
    return blob;
  }finally{URL.revokeObjectURL(source);}
}
async function downloadArtwork(genotype,format='svg',tokenId=''){
  const name='myFriend-'+(tokenId||genotype.join('-'));
  if(format==='svg'){downloadFile(name+'.svg',renderSVG(validateGenotype(genotype),{background:0}),'image/svg+xml');return;}
  const blob=await rasterArtwork(genotype,format);
  downloadFile(name+'.'+(format==='jpeg'?'jpg':format),blob,blob.type);
}
async function shareArtwork(genotype,tokenId,text){
  const blob=await rasterArtwork(genotype,'png');
  const file=new File([blob],`myFriend-${tokenId}.png`,{type:'image/png'});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
    await navigator.share({files:[file],title:`myFriend #${tokenId}`,text});
    return 'shared';
  }
  if(navigator.clipboard?.write&&globalThis.ClipboardItem){
    try{
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      return 'copied';
    }catch{}
  }
  downloadFile(file.name,blob,blob.type);
  return 'downloaded';
}

function genotypeHash(view=currentView){return view==='spiral'?'#genotype='+builderGenotype.join(','):'#'+view+'?genotype='+builderGenotype.join(',');}
function mobileSpiralHash(){return '#spiral?genotype='+builderGenotype.join(',');}
function syncMobileShell(){
  document.body.dataset.view=currentView;document.body.dataset.mobileSurface=mobileSurface;
  document.querySelectorAll('[data-mobile-destination]').forEach(link=>{
    const destination=link.dataset.mobileDestination;
    if(destination==='builder')link.href=genotypeHash('spiral');
    else if(destination==='spiral')link.href=mobileSpiralHash();
    const active=destination==='builder'?currentView==='spiral'&&mobileSurface==='builder':destination==='spiral'?currentView==='spiral'&&mobileSurface==='spiral':currentView===destination;
    if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
}
function syncMobileStatus(){const source=$('chainStatus'),target=$('mobileBuilderStatus');if(source&&target)target.textContent=source.textContent;}
function syncLinks(){
  document.querySelectorAll('[data-view]').forEach(link=>{link.href=genotypeHash(link.dataset.view);if(link.closest('.top-links')){if(link.dataset.view===currentView)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}});
  const catalogOpen=!$('traitCatalog').hidden;
  document.querySelectorAll('[data-explore]').forEach(link=>{
    link.href=genotypeHash('spiral');
    const active=currentView==='spiral'&&(link.dataset.explore==='catalog')===catalogOpen;
    if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  $('showSpiralMode').setAttribute('aria-pressed',String(currentView==='spiral'&&!catalogOpen));
  $('showCollectionMode').setAttribute('aria-pressed',String(currentView==='forest'));
  syncMobileShell();
}
function syncURL(){
  const hash=currentView==='spiral'&&selectedSlot?`#token=${spiralEntries[selectedSlot-1]?.tokenId}`:pendingTokenId?`#token=${pendingTokenId}`:currentView==='spiral'&&mobileSurface==='spiral'?mobileSpiralHash():genotypeHash();
  history.replaceState(null,'',hash);syncLinks();
}
function parseHash(){
  const hash=location.hash.slice(1),[route,query='']=hash.split('?');
  currentView=['forest','collection'].includes(route)?'forest':['about','myfriends','wishlist','history'].includes(route)?route:'spiral';
  if(currentView==='spiral')mobileSurface=route==='spiral'?'spiral':'builder';
  pendingTokenId=route.startsWith('token=')&&/^\d+$/.test(route.slice(6))?route.slice(6):null;
  const params=new URLSearchParams(query);
  const raw=route.startsWith('genotype=')?route.slice(9):params.get('genotype');
  if(raw!==null&&raw!==undefined){
    try{
      if(!/^\d+(?:,\d+){5}$/.test(raw))throw new Error();
      builderGenotype=validateGenotype(raw.split(',').map(Number));
    }catch{announce('That shared combination is invalid. Showing the current mushroom.');}
  }
}
function showView(view,focus=false){
  if(view!=='history')releaseHistoryCanvases();
  syncAboutVideo(view==='about');
  currentView=view;syncMobileShell();
  const workspace=['spiral','forest','myfriends','wishlist','history','about'].includes(view),contentPanel=['forest','myfriends','wishlist','history','about'].includes(view);
  $('spiral-view').hidden=!workspace;
  $('forest-view').hidden=view!=='forest';
  $('about-view').hidden=view!=='about';
  $('myfriends-view').hidden=view!=='myfriends';
  $('wishlist-view').hidden=view!=='wishlist';
  $('history-view').hidden=view!=='history';
  $('gridScaleControls').hidden=!['forest','wishlist','history'].includes(view);
  if(contentPanel){
    $('universe').hidden=true;$('traitCatalog').hidden=true;$('catalogTabs').hidden=true;
    $('spiral-view').classList.remove('catalog-open');
  }else if(view==='spiral'&&mobileLayout.matches){
    $('universe').hidden=false;$('traitCatalog').hidden=true;$('catalogTabs').hidden=true;
    $('spiral-view').classList.remove('catalog-open');
  }
  $('spiralModeToggle').hidden=!['spiral','forest'].includes(view);
  if(view==='forest')renderGallery();
  if(view==='about')renderLayers();
  if(view==='myfriends')renderMyFriends();
  if(view==='wishlist')renderWishlist();
  if(view==='history')renderHistoryCatalog(true);
  if(mobileLayout.matches&&view==='spiral'&&mobileSurface==='builder')renderMobileTraitRail(true,true,false);
  if(view==='spiral'&&(!mobileLayout.matches||mobileSurface==='spiral')){updateNextNode();paintView();}
  else stopSpiral();
  syncLinks();syncPreviewWishlist();syncMobileStatus();
  if(focus&&view!=='spiral')$({forest:'forest-title',about:'about-title',myfriends:'myfriends-title',wishlist:'wishlist-title',history:'history-title'}[view]).focus({preventScroll:true});
}
function rememberPrivacyNotice(){
  try{localStorage.setItem(privacyNoticeKey,'dismissed');}catch{/* Closing the notice still works when browser storage is unavailable. */}
}
function hidePrivacyNotice(){const notice=$('privacyNotice');if(notice)notice.hidden=true;}
function showPrivacyDetails(event){
  event?.preventDefault();
  if(event?.currentTarget?.id==='privacyLearnMore'){rememberPrivacyNotice();hidePrivacyNotice();}
  showView('about');syncURL();
  requestAnimationFrame(()=>{
    const details=$('privacy-details');if(!details)return;
    details.focus({preventScroll:true});
    details.scrollIntoView({block:'start',behavior:spiralMotion.matches?'auto':'smooth'});
  });
}
function setupPrivacyNotice(){
  const notice=$('privacyNotice'),dismiss=$('privacyDismiss');if(!notice||!dismiss)return;
  let dismissed=false;try{dismissed=localStorage.getItem(privacyNoticeKey)==='dismissed';}catch{/* A private browser may block storage. */}
  notice.hidden=dismissed;
  dismiss.onclick=()=>{rememberPrivacyNotice();hidePrivacyNotice();};
  document.querySelectorAll('[data-privacy-details]').forEach(link=>link.addEventListener('click',showPrivacyDetails));
}
function syncAboutVideo(active){
  const host=$('aboutVideoFrame');if(!host)return;
  const existing=host.querySelector('iframe');
  if(!active){if(existing){existing.src='about:blank';existing.remove();}return;}
  if(existing)return;
  const frame=document.createElement('iframe');
  frame.src=host.dataset.videoSrc;frame.title='Humans Behind the Project — Hannah & Dima, Founders of Magic Forest';
  frame.loading='lazy';frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.referrerPolicy='strict-origin-when-cross-origin';frame.allowFullscreen=true;host.append(frame);
}
function selectGenotype(genotype,remember=true){
  builderGenotype=[...validateGenotype(genotype)];selectedSlot=null;clearPinned();
  if(remember)rememberLook();
  renderSidebar(true);updateNextNode();
  if(currentView==='about')renderLayers();
  if(currentView==='wishlist')$('wishlist-gallery').querySelectorAll('.wishlist-card').forEach((card,index)=>card.classList.toggle('selected',sameGenotype(wishlistCatalog[index],builderGenotype)));
  if(currentView==='history')$('history-gallery').querySelectorAll('.history-card').forEach((card,index)=>card.classList.toggle('selected',sameGenotype(historyCatalog[index]?.genotype||[],builderGenotype)));
  if(!$('traitCatalog').hidden)renderCatalog(true);
  syncURL();
  document.querySelectorAll('#gallery .forest-card').forEach((card,i)=>card.classList.toggle('selected',spiralEntries[i]&&sameGenotype(spiralEntries[i].genotype,builderGenotype)));
}
function stepTrait(key,delta){
  const i=layerKeys.indexOf(key),genotype=[...builderGenotype];
  genotype[i]=(genotype[i]+delta+traits[key].length)%traits[key].length;selectGenotype(genotype);
}
function traitRow(key,index){
  const label=layerNames[key],shortcut=layerKeys.indexOf(key)+1;
  return '<div class="builder-row" id="control-'+key+'"><div class="builder-label"><button class="browse-trait" data-browse="'+key+'" title="Browse '+label+' · '+shortcut+'">'+label+'</button><span>'+num(index+1)+' / '+num(traits[key].length)+'</span></div>'+
    '<div class="trait-picker"><button id="previous-'+key+'" class="trait-arrow" data-step="'+key+':-1" aria-label="'+label+': previous option" title="Previous '+label+'">‹</button>'+
    '<select id="select-'+key+'" class="trait-name select-trait" data-trait="'+key+'" aria-label="Choose '+label.toLowerCase()+'" title="Choose '+label+' · '+shortcut+'">'+
    traits[key].map((item,j)=>'<option value="'+j+'"'+(j===index?' selected':'')+'>'+item.name+'</option>').join('')+
    '</select><button id="next-'+key+'" class="trait-arrow" data-step="'+key+':1" aria-label="'+label+': next option" title="Next '+label+'">›</button></div></div>';
}
function ownsEntry(entry){return !!entry&&!!chainState.account&&entry.owner?.toLowerCase()===chainState.account.toLowerCase();}
function entryForGenotype(genotype){return spiralEntries.find(entry=>sameGenotype(entry.genotype,genotype));}
function ownedEntries(){
  const account=chainState.account?.toLowerCase();
  return account?spiralEntries.map((entry,index)=>({entry,index})).filter(({entry})=>entry.owner?.toLowerCase()===account):[];
}
function routeConnectedWallet(){
  const account=chainState.account?.toLowerCase();
  if(!account){walletLandingAccount=null;return;}
  const owned=ownedEntries();
  if(owned.length){walletLandingAccount=null;showView('myfriends',true);syncURL();return;}
  if(!chainState.ready){
    walletLandingAccount=account;
    showView('myfriends',true);syncURL();return;
  }
  walletLandingAccount=null;mobileSurface='builder';showView('spiral');setExplore(false);syncURL();
}
const walletGlyph=()=>'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 9.5h18a3 3 0 0 1 3 3v12H7a3 3 0 0 1-3-3v-14a3 3 0 0 1 3-3h15"/><path d="M21 14h7v6h-7a3 3 0 0 1 0-6Z"/><circle cx="22" cy="17" r="1"/></svg>';
const openSeaGlyph=()=>'<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15"/><path d="M9 21.3h15.2c-.7 2.3-3.6 4-7.3 4-3.6 0-6.5-1.5-7.9-4Z"/><path d="M15.3 7.1v12.2h-6.1l6.1-12.2Zm1.8 3 6.5 8.1-6.5 1.1v-9.2Z"/></svg>';
const preparedGlyph=()=>'<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10"/><path d="m11.5 16 3 3 6.5-7"/></svg>';
const chainGlyph=()=>'<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13.5 20.5 11 23a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0M18.5 11.5 21 9a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0M11.5 20.5l9-9"/></svg>';
function tokenExplorerURL(deployment,tokenId){
  const explorer=new URL(deployment.explorerUrl),base=explorer.href.replace(/\/$/,'');
  return explorer.hostname==='etherscan.io'||explorer.hostname.endsWith('.etherscan.io')
    ?base+'/nft/'+deployment.address+'/'+encodeURIComponent(tokenId)
    :base+'/token/'+deployment.address+'/instance/'+encodeURIComponent(tokenId);
}
function ownerCollectionActions(entry){
  const shareText=xPostText(entry.tokenId),composerURL=xComposerURL(shareText);
  return '<div class="collection-actions owner-collection-actions"><p class="collection-action-label">KEEP &amp; SHARE</p>'+
    '<div class="token-download-grid"><button data-token-download="png">PNG ↓</button><button data-token-download="jpeg">JPEG ↓</button><button data-token-download="svg">SVG ↓</button><button data-token-metadata>METADATA ↓</button></div>'+
    '<div class="token-share-grid"><button data-token-share>IMAGE FOR X</button><button data-token-copy>COPY X POST LINK</button></div>'+
    '<a class="post-token" data-token-post href="'+composerURL+'" target="_blank" rel="noopener noreferrer">OPEN X COMPOSER ↗</a>'+
    '<p class="export-note">The X link includes a preview page for this myFriend. You can also copy or share the artwork separately.</p></div>';
}
function collectionActions(entry){
  if(ownsEntry(entry))return ownerCollectionActions(entry);
  return '';
}
function builderMintState(){
  const mintedEntry=entryForGenotype(builderGenotype),taken=Boolean(mintedEntry),takenByOwner=ownsEntry(mintedEntry),soldOut=chainState.snapshot?.total>=chainState.snapshot?.cap,phase=chainState.snapshot?.salePhase;
  const phaseClosed=phase===SALE_PHASE.PAUSED||phase===SALE_PHASE.PUBLIC_PAUSED;
  const hasSnapshot=Boolean(chainState.snapshot),disabled=chainState.walletEnabled===false||!mintActionAvailable({...chainState,soldOut,taken,phaseClosed});
  const price=nextPrice(),mintPrice=price===0n?'FREE':ethFormat(price)+' ETH <span class="mint-usd usd-price" data-wei="'+price+'" data-usd-bare>'+usdEquivalent(price,true)+'</span>';
  const mintLabel=chainState.walletEnabled===false?'READ-ONLY PREVIEW':!hasSnapshot?'CONNECTING…':chainState.busy?'MINT IN PROGRESS':soldOut?'ALL MYFRIENDS MINTED':taken?'ALREADY IN THE FOREST':!chainState.ready?'RECONNECTING…':
    phase===SALE_PHASE.PAUSED?'MINTING NOT STARTED':phase===SALE_PHASE.PUBLIC_PAUSED?'PUBLIC MINT PAUSED':'MINT MYFRIEND · '+mintPrice;
  const phaseLabel=chainState.walletEnabled===false?'MAINNET READ-ONLY':phase===SALE_PHASE.PUBLIC_ACTIVE?'PUBLIC MINT · STEP '+num(paidCount()+1):
    phase===SALE_PHASE.PUBLIC_PAUSED?'PUBLIC MINT PAUSED · STEP '+num(paidCount()+1):
    phase===SALE_PHASE.ALLOWLIST?'ALLOWLIST MINT':phase===SALE_PHASE.PAUSED?'MINTING NOT STARTED':'FINDING THE FOREST';
  return {taken,takenByOwner,disabled,mintLabel,phaseLabel};
}
function builderHTML(){
  const footprint='<path class="marker-fill footprint-sole" d="M45 174C28 174 17 163 18 146c1-16 13-27 14-42 1-16-12-29-12-46 0-20 13-32 30-31 18 1 32 15 32 32 0 15-12 25-19 37-8 13-8 25-1 41 7 16 2 33-17 37Z"/><ellipse class="marker-fill footprint-toe" cx="25" cy="15" rx="12" ry="15" transform="rotate(-18 25 15)"/><ellipse class="marker-fill footprint-toe" cx="46" cy="14" rx="9" ry="12" transform="rotate(-8 46 14)"/><ellipse class="marker-fill footprint-toe" cx="63" cy="18" rx="8" ry="11" transform="rotate(4 63 18)"/><ellipse class="marker-fill footprint-toe" cx="78" cy="24" rx="7" ry="10" transform="rotate(13 78 24)"/><ellipse class="marker-fill footprint-toe" cx="90" cy="33" rx="6" ry="9" transform="rotate(20 90 33)"/>';
  const stemMarkers={
    'golden-anatomy':'<svg viewBox="0 0 24 24"><path class="marker-fill" d="M5.2 10.3a6.8 6.8 0 1 1 13.6 0c0 2.4-1.2 4.2-3 5.3v3.2h-2.1v-2h-1v2h-1.5v-2h-1v2H8.1v-3.2a6.3 6.3 0 0 1-2.9-5.3Z"/><circle cx="9.1" cy="10.1" r="1.7"/><circle cx="14.9" cy="10.1" r="1.7"/><path d="m12 12.2-1.1 2h2.2L12 12.2Z"/></svg>',
    'nuclear-ember':'<svg viewBox="0 0 24 24"><path class="marker-fill" d="m12 1.8 1.7 5 4.6-2.6-.9 5.2 5.2-.5-3.7 3.7 4.2 3.1-5.2 1.3 2.2 4.8-4.8-2.1-1.4 5.1-2.3-4.7-3.5 3.9.4-5.3-5.1 1.1 3-4.3-5.1-1.5 5-1.6-3.8-3.7 5.3.3-.8-5.2 4.5 2.7L12 1.8Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    'frankenstem':'<svg viewBox="0 0 24 24"><path class="marker-fill" d="M7 3.2h10v3l2 2v9.5c0 1.7-1.3 3-3 3H8c-1.7 0-3-1.3-3-3V8.2l2-2v-3Z"/><path d="M7 3.2v3h2v-3h2v3h2v-3h2v3h2M4.8 11H2.5v3h2.3m14.4-3h2.3v3h-2.3M8.2 11.3h2m3.6 0h2m-6.1 5h4.6m-2.3-5v2.1"/></svg>',
    'cocoa-stomp':'<svg class="footprint-icon foot-left" viewBox="6 -2 96 182">'+footprint+'</svg>',
    'blush-stomp':'<svg class="footprint-icon foot-right" viewBox="6 -2 96 182">'+footprint+'</svg>'
  };
  const swatches=traits.stem.map((item,i)=>'<button id="stem-'+i+'" class="swatch '+(i===builderGenotype[0]?'active':'')+'" style="--sw:'+item.color+'" data-stem="'+i+'" aria-label="'+item.name+'" aria-pressed="'+(i===builderGenotype[0])+'" title="'+item.name+'">'+(stemMarkers[item.id]?'<span class="stem-marker" data-stem-marker="'+item.id+'" aria-hidden="true">'+stemMarkers[item.id]+'</span>':'')+'</button>').join('');
  const {taken,takenByOwner,disabled,mintLabel,phaseLabel}=builderMintState();
  return '<div class="builder-block"><div class="builder-row" id="control-stem"><div class="builder-label"><button class="browse-trait" data-browse="stem" title="Browse Stem · 1">Stem</button><span>'+num(builderGenotype[0]+1)+' / '+num(traits.stem.length)+'</span></div><div class="swatches">'+swatches+'</div></div>'+
    layerKeys.slice(1).map((key,j)=>traitRow(key,builderGenotype[j+1])).join('')+
    '<div class="builder-mint"><button class="mint" id="mint" '+(disabled?'disabled':'')+'><span class="mint-label">'+mintLabel+'</span></button>'+
    (taken?'<div class="availability-note" role="status"><strong>'+(takenByOwner?'This myFriend lives in your wallet.':'This myFriend has found another wallet.')+'</strong><span>'+(takenByOwner?'Open My Friends for its traits, downloads and sharing options.':'Discover another available combination. This look stays in History.')+'</span><button id="'+(takenByOwner?'viewOwnedFriend':'findAvailable')+'">'+(takenByOwner?'VIEW MY FRIENDS':'FIND ANOTHER FRIEND ↗')+'</button></div>':
    '<div class="price-head builder-price-head"><span>'+phaseLabel+'</span><span class="builder-price-value">'+(chainState.snapshot?ethFormat(nextPrice())+' ETH':'—')+'</span></div><p class="gas-note">Network gas is separate, including free mints.</p><div class="price-ladder builder-ladder" id="priceLadder"></div>')+'</div>'+
    collectionActions()+'</div>';
}
function tokenDestinations(entry){
  const deployment=chainState.deployment;
  if(!deployment?.address||!deployment?.explorerUrl)return '';
  const address=deployment.address,tokenId=encodeURIComponent(entry.tokenId),explorer=deployment.explorerUrl.replace(/\/$/,'');
  const explorerName=explorer.includes('etherscan.io')?'ETHERSCAN':'BLOCK EXPLORER';
  const external=(href,label)=>'<a href="'+href+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>';
  const onChain=external(tokenExplorerURL(deployment,entry.tokenId),'VIEW ON '+explorerName);
  const openSea=openSeaTokenURL(deployment,entry.tokenId);
  const marketplaces=openSea?[
    external(openSea,'OPENSEA'),
    external('https://blur.io/asset/'+address+'/'+tokenId,'BLUR'),
    external('https://magiceden.io/item-details/ethereum/'+address+'/'+tokenId,'MAGIC EDEN')
  ].join(''):'';
  return '<div class="token-destinations"><span>ON-CHAIN</span><div class="token-destination-grid">'+onChain+'</div>'+
    (marketplaces?'<span>MARKETPLACES</span><div class="token-destination-grid marketplaces">'+marketplaces+'</div>':'')+'</div>';
}
function sampleHTML(slot){
  const entry=spiralEntries[slot-1],edition=entry;
  return '<div class="minted-card"><div class="minted-kicker"><span>SPIRAL POSITION '+num(slot)+'</span><span>'+(entry.phase==='allowlist'?'ALLOWLIST CLAIM':'PUBLIC MINT')+'</span></div>'+
    '<h2>'+edition.name+'</h2><div class="minted-token">TOKEN ID #'+entry.tokenId+'</div>'+
    '<div class="purchase-box"><div class="purchase-fact"><span>Mint price</span><strong>'+(entry.price===0n?'FREE':priceMarkup(entry.price))+'</strong></div>'+
    '<div class="purchase-fact"><span>Phase</span><strong>'+(entry.phase==='allowlist'?'ALLOWLIST CLAIM':'STEP '+num(entry.step))+'</strong></div></div>'+
    '<div class="minted-traits">'+layerKeys.map((key,i)=>'<div class="minted-trait"><span>'+layerNames[key]+'</span><strong>'+traits[key][edition.genotype[i]].name+'</strong></div>').join('')+'</div>'+
    tokenDestinations(entry)+'<button class="back-build" id="backBuild">← BUILD FROM THESE TRAITS</button>'+collectionActions(entry)+'</div>';
}
function syncPreviewMint(){
  const previewMint=$('previewMint');
  if(!previewMint)return;
  if(selectedSlot){
    previewMint.hidden=true;
    previewMint.disabled=true;
    previewMint.replaceChildren();
    previewMint.onclick=null;
    return;
  }
  const {disabled,mintLabel}=builderMintState();
  previewMint.hidden=false;
  previewMint.disabled=disabled;
  previewMint.innerHTML='<span class="mint-label">'+mintLabel+'</span>';
  previewMint.onclick=()=>window.dispatchEvent(new Event('myfriends:review-mint'));
}
function renderSidebar(centerMobileTrait=false){
  const focusID=document.activeElement?.id,scroll=document.querySelector('.settings-scroll'),scrollTop=scroll.scrollTop;
  const previewCanvas=$('previewCanvas'),previewGenotype=builderGenotype.join(',');
  if(previewCanvas.dataset.genotype!==previewGenotype&&(previewCanvas.classList.contains('painted')||!sameGenotype(builderGenotype,defaultPreviewGenotype)))paintGenotypeCanvas(previewCanvas,builderGenotype);
  $('preview').dataset.genotype=builderGenotype.join(',');
  $('preview').alt=attributes(builderGenotype).map(a=>a.value).join(', ');
  syncFavicon();
  $('previewNumber').textContent=selectedSlot?'MINTED / '+num(selectedSlot):'PREVIEW';
  syncPreviewWishlist();
  if(!mobileLayout.matches){
    $('contextPanel').innerHTML=selectedSlot?sampleHTML(selectedSlot):builderHTML();
    if(selectedSlot)$('backBuild').onclick=()=>{selectedSlot=null;clearPinned();renderSidebar();};
    else{
      document.querySelectorAll('[data-stem]').forEach(button=>button.onclick=()=>{const genotype=[...builderGenotype];genotype[0]=Number(button.dataset.stem);selectGenotype(genotype);});
      document.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{const [key,delta]=button.dataset.step.split(':');stepTrait(key,Number(delta));openCatalog(key);});
      document.querySelectorAll('[data-trait]').forEach(select=>select.onchange=()=>{const genotype=[...builderGenotype];genotype[layerKeys.indexOf(select.dataset.trait)]=Number(select.value);selectGenotype(genotype);openCatalog(select.dataset.trait);});
      $('mint').onclick=()=>window.dispatchEvent(new Event('myfriends:review-mint'));renderLadder();
      if($('findAvailable'))$('findAvailable').onclick=()=>selectGenotype(randomAvailableGenotype());
      if($('viewOwnedFriend'))$('viewOwnedFriend').onclick=()=>{showView('myfriends',true);syncURL();};
    }
    document.querySelectorAll('[data-browse]').forEach(button=>button.onclick=()=>openCatalog(button.dataset.browse,true));
    attachCollectionActions(selectedSlot?spiralEntries[selectedSlot-1]:null);
  }
  renderHistory();
  syncPreviewMint();
  if(mobileLayout.matches&&currentView==='spiral'&&mobileSurface==='builder')renderMobileTraitRail(centerMobileTrait);
  syncMobileStatus();syncMobileShell();
  if(focusID&&$(focusID))$(focusID).focus({preventScroll:true});
  scroll.scrollTop=scrollTop;
  refreshUSDDisplays();
}
function syncPreviewWishlist(){
  const button=$('toggleWishlist'),entry=selectedSlot?spiralEntries[selectedSlot-1]:entryForGenotype(builderGenotype),minted=Boolean(entry),available=!minted;
  const prepared=!minted&&(chainState.preparedMints||[]).find(item=>sameGenotype(item.genotype,builderGenotype));
  const ownership=$('previewOwnership');ownership.hidden=!(minted||prepared);
  ownership.removeAttribute('href');ownership.removeAttribute('target');ownership.removeAttribute('rel');
  if(prepared){
    const label='Preparation paid · '+prepared.status.toLowerCase();
    ownership.className='preview-ownership is-prepared';ownership.innerHTML=preparedGlyph();ownership.title=label;ownership.setAttribute('aria-label',label);
  }else if(minted){
    const mine=ownsEntry(entry),openSea=openSeaTokenURL(chainState.deployment,entry.tokenId);
    const label=mine?'This myFriend is in your wallet':openSea?'Find this myFriend on OpenSea':'View this myFriend on the block explorer';
    ownership.className='preview-ownership '+(mine?'is-owned':openSea?'is-market':'is-chain');ownership.innerHTML=mine?walletGlyph():openSea?openSeaGlyph():chainGlyph();ownership.title=label;ownership.setAttribute('aria-label',label);
    if(!mine&&chainState.deployment?.address&&chainState.deployment?.explorerUrl){ownership.href=openSea||tokenExplorerURL(chainState.deployment,entry.tokenId);ownership.target='_blank';ownership.rel='noopener noreferrer';}
  }
  button.hidden=!available||Boolean(prepared);if(!available||prepared)return;
  const saved=isWishlisted(builderGenotype);
  button.classList.toggle('active',saved);button.setAttribute('aria-pressed',String(saved));button.textContent=saved?'♥':'♡';
  button.setAttribute('aria-label',saved?'Remove this combination from wishlist':'Save this combination to wishlist');
}
$('toggleWishlist').onclick=()=>toggleWishlist(builderGenotype);
function downloadFile(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function downloadMetadata(genotype,tokenId=''){
  const svg=renderSVG(genotype,{background:0}),options=tokenId?{svg,tokenId:Number(tokenId)}:{svg};
  const metadata={...tokenMetadata(genotype,options),genotype:[...genotype],packedGenotype:packGenotype(genotype).toString(),genotypeOrder:layerKeys,background:'Black'};
  downloadFile('mycelium-friend-'+(tokenId||genotype.join('-'))+'.json',JSON.stringify(metadata,null,2),'application/json');announce('Genotype and metadata were saved.');
}
function attachCollectionActions(entry){
  if(ownsEntry(entry)){
    document.querySelectorAll('[data-token-download]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{await downloadArtwork(entry.genotype,button.dataset.tokenDownload,entry.tokenId);announce(button.textContent.split(' ')[0]+' saved.');}
      catch{announce('Your image is still here. Please try downloading it again.');}
      finally{button.disabled=false;}
    });
    document.querySelector('[data-token-metadata]').onclick=()=>downloadMetadata(entry.genotype,entry.tokenId);
    const shareText=xPostText(entry.tokenId),composerURL=xComposerURL(shareText);
    const shareButton=document.querySelector('[data-token-share]');
    shareButton.onclick=async()=>{
      shareButton.disabled=true;
      try{const result=await shareArtwork(entry.genotype,entry.tokenId,shareText);announce(result==='copied'?'Image copied. Paste it into the X composer, in this or another browser.':result==='downloaded'?'Image downloaded. Add it to your X post.':'Share sheet opened with your image.');}
      catch(error){if(error?.name!=='AbortError')announce('Image sharing is unavailable. Download the PNG instead.');}
      finally{shareButton.disabled=false;}
    };
    const copyButton=document.querySelector('[data-token-copy]');
    copyButton.onclick=async()=>{
      try{await navigator.clipboard.writeText(composerURL);copyButton.textContent='X POST LINK COPIED ✓';announce('X composer link copied. Paste it into the browser where you are signed in.');}
      catch{announce('Could not copy the X composer link. Use Open X Composer instead.');}
    };
  }
}
function shuffleLook(){rememberLook();selectGenotype(randomAvailableGenotype());}
const diePipLayout={
  1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],
  4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],
  6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]]
};
// Six choices for the top, each with four quarter-turns: all 24 rotations
// of one physical die. Opposite faces remain 1/6, 2/5 and 3/4 at all times.
const dieNormals=[[0,-1,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,0],[0,1,0]];
const dieOrientations=[[0,0],[90,0],[180,0],[270,0],[0,90],[0,270]].flatMap(([x,z])=>[0,90,180,270].map(y=>{
  const matrix=new DOMMatrix().rotate(0,y,0).rotate(x,0,0).rotate(0,0,z),faces=[];
  dieNormals.forEach(([nx,ny,nz],index)=>{
    const normal=matrix.transformPoint(new DOMPoint(nx,ny,nz,0));
    if(normal.y<-.9)faces[0]=index+1;
    if(normal.x<-.9)faces[1]=index+1;
    if(normal.z>.9)faces[2]=index+1;
  });
  return {x,y,z,faces};
}));
const dieTransform=({x,y,z})=>`rotateX(-35.26438968deg) rotateY(45deg) rotateY(${y}deg) rotateX(${x}deg) rotateZ(${z}deg)`;
const dieCube=$('previewRandomize').querySelector('.preview-die-cube');
for(const face of dieCube.children){
  for(const [u,v] of diePipLayout[Number(face.dataset.dieValue)]){
    const pip=document.createElement('span');pip.className='preview-die-pip';
    pip.style.left=(50+25*u)+'%';pip.style.top=(50+25*v)+'%';face.append(pip);
  }
}
let dieOrientation=0,dieAnimation=null;
function settlePreviewDie(index){
  dieOrientation=index;$('previewRandomize').dataset.faces=dieOrientations[index].faces.join('-');
  dieCube.style.transform=dieTransform(dieOrientations[index]);
}
function differentDieOrientation(from=dieOrientation){return (from+1+Math.floor(Math.random()*(dieOrientations.length-1)))%dieOrientations.length;}
function rollPreviewDie(){
  const button=$('previewRandomize'),finalOrientation=differentDieOrientation();
  const start=dieAnimation?getComputedStyle(dieCube).transform:dieCube.style.transform;
  dieAnimation?.cancel();dieAnimation=null;
  if(spiralMotion.matches||!dieCube.animate){settlePreviewDie(finalOrientation);button.classList.remove('is-rolling');return;}
  const direction=Math.random()<.5?-1:1,jitter=()=>Math.round((Math.random()-.5)*40),target=dieOrientations[finalOrientation];
  const finish={x:target.x+direction*720,y:target.y-direction*720,z:target.z+direction*360};
  button.classList.add('is-rolling');
  // Rotate the six-face solid as one object. Perspective belongs to its fixed
  // scene; no face/pip DOM changes or independent transforms happen mid-roll.
  const animation=dieCube.animate([
    {transform:start},
    {transform:dieTransform({x:direction*(135+jitter()),y:-direction*(170+jitter()),z:direction*(75+jitter())}),offset:.22},
    {transform:dieTransform({x:direction*(350+jitter()),y:-direction*(330+jitter()),z:direction*(180+jitter())}),offset:.52},
    {transform:dieTransform({x:finish.x+direction*12,y:finish.y-direction*10,z:finish.z+direction*8}),offset:.84},
    {transform:dieTransform(finish)}
  ],{duration:560,easing:'cubic-bezier(.2,.72,.18,1)'});
  dieAnimation=animation;
  animation.onfinish=()=>{if(dieAnimation!==animation)return;settlePreviewDie(finalOrientation);button.classList.remove('is-rolling');dieAnimation=null;};
  animation.oncancel=()=>{if(dieAnimation===animation){button.classList.remove('is-rolling');dieAnimation=null;}};
}
settlePreviewDie(dieOrientation);
$('previewRandomize').onclick=()=>{rollPreviewDie();shuffleLook();};
document.addEventListener('keydown',event=>{
  if(mobileLayout.matches||currentView!=='spiral'||selectedSlot!==null||$('mintDialog').open||event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.target instanceof Element&&event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
  const key=event.key.toLowerCase();
  if(event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
    event.preventDefault();const index=layerKeys.indexOf(catalogKey),delta=event.key==='ArrowRight'?1:-1;
    openCatalog(layerKeys[(index+delta+layerKeys.length)%layerKeys.length]);return;
  }
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();browseLooks(event.key==='ArrowRight'?1:-1);return;}
  if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();stepTrait(catalogKey,event.key==='ArrowDown'?1:-1);openCatalog(catalogKey);return;}
  if(/^[1-6]$/.test(event.key)){event.preventDefault();openCatalog(layerKeys[Number(event.key)-1]);return;}
  if(key==='r'){event.preventDefault();rollPreviewDie();shuffleLook();}
});
function selectMinted(index,view='spiral'){
  const entry=spiralEntries[index]; if(!entry)return;
  builderGenotype=[...entry.genotype];selectedSlot=index+1;pendingTokenId=null;currentView=view;
  renderSidebar();renderLayers();updateNextNode();syncURL();showView(view);
  if(view==='spiral')seekSpiral(index-Math.floor(spiralCount/2),true);
}
function showToken(tokenId){
  const index=spiralEntries.findIndex(entry=>entry.tokenId===String(tokenId));
  if(index<0)return false;
  selectMinted(index);return true;
}
function paintCollectionCanvas(canvas){
  if(canvas.dataset.painted)return;
  const entry=spiralEntries[Number(canvas.dataset.mintedArt)];if(!entry)return;
  paintGenotypeCanvas(canvas,entry.genotype);canvas.dataset.painted='true';
}
function observeCollectionCanvases(){
  collectionPaintObserver?.disconnect();
  const canvases=[...$('gallery').querySelectorAll('[data-minted-art]')];
  if(!('IntersectionObserver' in window)){canvases.forEach(canvas=>queueRender(canvas,paintCollectionCanvas));return;}
  collectionPaintObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    queueRender(entry.target,paintCollectionCanvas);collectionPaintObserver.unobserve(entry.target);
  }),{root:$('forest-view'),rootMargin:'240px 0px'});
  canvases.forEach(canvas=>collectionPaintObserver.observe(canvas));
}
function renderGallery(){
  collectionPaintObserver?.disconnect();
  const shortAddress=address=>address?address.slice(0,6)+'…'+address.slice(-4):'Unknown';
  const gallery=$('gallery');
  if(spiralEntries.length)gallery.innerHTML=spiralEntries.slice(0,galleryLimit).map((entry,i)=>'<button class="forest-card collection-card" data-minted="'+i+'" aria-label="Meet '+entry.name+'"><div class="forest-art"><canvas width="240" height="240" data-resolution="240" data-minted-art="'+i+'" aria-hidden="true"></canvas></div><div class="forest-label"><span>#'+entry.tokenId+'</span><strong>'+entry.name+'</strong></div><dl class="collection-card-meta"><div><dt>OWNER</dt><dd title="'+entry.owner+'">'+shortAddress(entry.owner)+'</dd></div><div><dt>MINT</dt><dd>'+(entry.price===0n?'FREE':ethFormat(entry.price)+' ETH')+'</dd></div><div><dt>LISTING</dt><dd title="Marketplace listing data requires an external indexer">—</dd></div></dl></button>').join('');
  else if(!gallery.querySelector('.forest-empty'))gallery.innerHTML='<div class="forest-empty"><h2>The forest starts with a friend.</h2><p>Confirmed myFriends appear here. Choose your traits and grow the first one.</p></div>';
  observeCollectionCanvases();
  gallery.querySelectorAll('button').forEach(button=>button.onclick=()=>selectMinted(Number(button.dataset.minted),'forest'));
  $('moreFriends').hidden=galleryLimit>=spiralEntries.length;
}
$('moreFriends').onclick=()=>{galleryLimit+=24;renderGallery();};
let ownedArtURLs=[];
function clearOwnedArtURLs(){ownedArtObserver?.disconnect();ownedArtURLs.forEach(url=>URL.revokeObjectURL(url));ownedArtURLs=[];}
function paintOwnedArt(image){
  if(image.dataset.painted)return;
  const entry=spiralEntries[Number(image.dataset.ownedArt)];if(!entry)return;
  const svg=renderSVG(entry.genotype,{background:0}),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  ownedArtURLs.push(url);image.src=url;image.dataset.painted='true';
}
function observeOwnedArt(){
  const images=[...$('myfriends-gallery').querySelectorAll('[data-owned-art]')];
  if(!('IntersectionObserver' in window)){images.forEach(image=>queueRender(image,paintOwnedArt));return;}
  ownedArtObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    queueRender(entry.target,paintOwnedArt);ownedArtObserver.unobserve(entry.target);
  }),{root:$('myfriends-view'),rootMargin:'240px 0px'});
  images.forEach(image=>ownedArtObserver.observe(image));
}
function renderMyFriends(){
  clearOwnedArtURLs();
  const gallery=$('myfriends-gallery'),account=chainState.account?.toLowerCase(),owned=ownedEntries();
  $('myfriends-wallet-summary').hidden=true;
  $('friendsWalletAction').hidden=chainState.walletEnabled===false;
  $('friendsWalletAction').textContent='DISCONNECT WALLET';
  $('myfriends-address').hidden=true;
  $('myfriends-address').textContent='';
  if(!account){
    $('myfriends-caption').textContent='';
    if(chainState.walletEnabled===false){
      gallery.innerHTML='<div class="forest-empty"><h2>Read-only mainnet preview.</h2><p>Wallet connections and minting are disabled. Confirmed collection history remains available throughout the site.</p></div>';
      return;
    }
    const checking=Boolean(chainState.walletChecking);
    gallery.innerHTML='<div class="forest-empty"><h2>Your myFriends live here.</h2><p>Connect your wallet to open its collection.</p><button type="button" class="chain-action empty-wallet-connect" data-state="'+(checking?'checking':'disconnected')+'"'+(checking?' disabled':'')+'>'+(checking?'CHECKING WALLET':'CONNECT WALLET')+'</button></div>';
    gallery.querySelector('.empty-wallet-connect').onclick=()=>{if(!chainState.walletChecking)$('wallet').click();};
    return;
  }
  const network=chainState.deployment?.networkName||'this network';
  if(!chainState.snapshot){
    $('myfriends-caption').textContent='Your wallet is connected. Collection data is still being checked.';
    gallery.innerHTML='<div class="forest-empty"><h2>Finding your myFriends…</h2><p>Collection data is temporarily unavailable. Your wallet is still connected, and nothing has left it.</p></div>';
    return;
  }
  $('myfriends-caption').textContent=owned.length?owned.length+' '+(owned.length===1?'myFriend calls':'myFriends call')+' this wallet home on '+network+'.':'No myFriends in this wallet on '+network+' yet.';
  gallery.innerHTML=owned.map(({entry,index})=>'<button class="forest-card'+(selectedSlot===index+1?' selected':'')+'" data-owned="'+index+'" aria-label="Select '+entry.name+'"><div class="forest-art"><img data-owned-art="'+index+'" loading="lazy" decoding="async" alt="" aria-hidden="true"></div><div class="forest-label"><span>#'+entry.tokenId+'</span><strong>'+entry.name+'</strong></div></button>').join('');
  if(!owned.length)gallery.innerHTML='<div class="forest-empty"><h2>A quiet wallet.</h2><p>No myFriends are held by this address yet.</p></div>';
  observeOwnedArt();
  gallery.querySelectorAll('[data-owned]').forEach(button=>button.onclick=()=>selectMinted(Number(button.dataset.owned),'myfriends'));
}
$('friendsWalletAction').onclick=()=>{
  if(chainState.account)window.dispatchEvent(new Event('myfriends:disconnect'));
  else $('wallet').click();
};
const FOREST_PROGRESS_URL='https://magicforest.land/api/progress';
let forestProgressRequested=false;
let forestRateRefreshBound=false;
let forestProgressLastDonations=7085;
let forestProgressLastGoal=100000;
let forestEthEurRate=null;
function euroAmount(value){return '€'+Math.round(value).toLocaleString('en-US');}
function euroAmountExact(value){return '€'+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function directDonationsFromProgress(data){
  const candidates=[
    data?.directDonations,
    data?.donations,
    data?.sources?.donations?.total,
    data?.sources?.directDonations?.total,
    data?.got
  ];
  for(const value of candidates){const amount=Number(value);if(Number.isFinite(amount))return Math.max(0,amount);}
  return null;
}
function onChainMintProceedsEth(){return Number(raised())/1e18;}
function setForestProgress(donations,goal,myFriendsNet=0,myFriendsEth=0,rate=null){
  const box=$('forestProgress');
  if(!box||!Number.isFinite(donations)||!Number.isFinite(goal)||goal<=0)return;
  const safeDonations=Math.max(0,donations),safeMyFriends=Math.max(0,Number(myFriendsNet)||0),safeTotal=safeDonations+safeMyFriends;
  const donationsPercent=Math.max(0,Math.min(100,(safeDonations/goal)*100));
  const myFriendsPercent=Math.max(0,Math.min(100-donationsPercent,(safeMyFriends/goal)*100));
  forestProgressLastDonations=safeDonations;
  forestProgressLastGoal=goal;
  box.style.setProperty('--donations-progress',donationsPercent+'%');
  box.style.setProperty('--myfriends-progress',myFriendsPercent+'%');
  box.classList.toggle('has-myfriends',myFriendsEth>0);
  $('forestProgressTotal').textContent=euroAmount(safeTotal);
  $('forestProgressGoal').textContent=euroAmount(goal);
  $('forestDonationAmount').textContent=euroAmount(safeDonations);
  $('forestMyFriendsAmount').textContent=rate?euroAmountExact(safeMyFriends):'—';
}
function setForestEthEurRate(rate){
  const el=$('forestEthEurRate');
  if(!el||!Number.isFinite(rate)||rate<=0)return;
  forestEthEurRate=rate;
  el.textContent='1 ETH = €'+Math.round(rate).toLocaleString('en-US');
  const ledgerRate=$('moneyEthEurRate');
  if(ledgerRate)ledgerRate.textContent='€'+rate.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function refreshForestProgressFromChain(){
  const mintEth=onChainMintProceedsEth();
  const grossEur=forestEthEurRate?mintEth*forestEthEurRate:0;
  const estimate=estimateCollectionContribution(grossEur);
  setForestProgress(forestProgressLastDonations,forestProgressLastGoal,estimate.netContribution,mintEth,forestEthEurRate);
  const values={
    moneyGrossEuro:estimate.grossEur,
    moneyCollectionCosts:estimate.collectionCostsEur,
    moneyTaxableProfit:estimate.taxableProfit,
    moneyTaxReserve:estimate.taxReserve,
    moneyNetContribution:estimate.netContribution
  };
  for(const [id,value] of Object.entries(values)){
    const element=$(id);if(element)element.textContent=forestEthEurRate?((id==='moneyTaxReserve'?'−':'')+euroAmountExact(value)):'Waiting for rate';
  }
}
function setForestRateRefreshing(active){
  const button=$('forestEthEurRefresh');
  if(!button)return;
  button.disabled=active;
  button.classList.toggle('is-refreshing',active);
}
async function fetchForestEthEur(recalculate=true,force=false){
  setForestRateRefreshing(true);
  try{
    const quote=await refreshExchangeRate(force),rate=Number(quote?.eur);
    if(!Number.isFinite(rate)||rate<=0)throw Error('Invalid ETH/EUR rate');
    setForestEthEurRate(rate);
    if(recalculate)refreshForestProgressFromChain();
    return rate;
  }catch(error){
    const el=$('forestEthEurRate');if(el)el.textContent='ETH/EUR unavailable · retry';
    const ledgerRate=$('moneyEthEurRate');if(ledgerRate)ledgerRate.textContent='Unavailable';
    return null;
  }finally{
    setForestRateRefreshing(false);
  }
}
function bindForestRateRefresh(){
  const button=$('forestEthEurRefresh');
  if(!button||forestRateRefreshBound)return;
  forestRateRefreshBound=true;
  button.onclick=()=>{fetchForestEthEur(true,true);};
}
function loadForestProgress(){
  refreshForestProgressFromChain();
  bindForestRateRefresh();
  if(forestProgressRequested)return;
  forestProgressRequested=true;
  // Donations and the goal do not depend on a currency quote. Paint them as
  // soon as our API responds instead of letting a rate provider hold the whole
  // progress bar inside Promise.all.
  fetch(FOREST_PROGRESS_URL,{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Progress request failed');return response.json();}).then(data=>{
    const donations=directDonationsFromProgress(data),goal=Number(data.goal);
    if(donations===null||!Number.isFinite(goal))return;
    forestProgressLastDonations=donations;forestProgressLastGoal=goal;
    refreshForestProgressFromChain();
  }).catch(()=>{});
  fetchForestEthEur(true,false);
}
// A slow two-way exchange runs only while its bridge is visible. User pause
// applies to the complete circuit, including the receiving cards' response.
const marketFeedbackCard=document.querySelector('.protocol-market-card');
if(marketFeedbackCard&&'IntersectionObserver' in window){
  const marketMotionToggle=$('marketMotionToggle');let marketFeedbackObserver=null;
  const configureMarketFeedback=()=>{
    marketFeedbackObserver?.disconnect();marketFeedbackObserver=null;
    marketFeedbackCard.classList.remove('is-feedback-active');marketMotionToggle.hidden=spiralMotion.matches;
    if(spiralMotion.matches)return;
    marketFeedbackObserver=new IntersectionObserver(entries=>{
      const visible=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=.35);
      if(visible)marketFeedbackCard.classList.add('is-feedback-ready');
      marketFeedbackCard.classList.toggle('is-feedback-active',visible);
    },{threshold:[0,.35]});
    marketFeedbackObserver.observe(marketFeedbackCard.querySelector('.market-bridge'));
  };
  marketMotionToggle.onclick=()=>{
    const paused=marketFeedbackCard.classList.toggle('is-feedback-paused'),label=paused?'Play market animation':'Pause market animation';
    marketMotionToggle.setAttribute('aria-pressed',String(paused));marketMotionToggle.setAttribute('aria-label',label);marketMotionToggle.title=label;
  };
  spiralMotion.addEventListener('change',configureMarketFeedback);configureMarketFeedback();
}
function renderAboutChainStats(){
  const moneyGross=$('moneyGrossRaised'),etherscanLinks=[$('aboutContractLink'),$('aboutPriceContract'),$('aboutRoyaltyContract')],evmNowLinks=[$('aboutContractSecondary'),$('aboutPriceContractSecondary'),$('aboutRoyaltyContractSecondary')];
  const grossText=ethFormat(raised())+' ETH';
  if(moneyGross)moneyGross.textContent=grossText;
  if(currentView==='about')refreshForestProgressFromChain();
  const deployment=chainState.deployment;
  const etherscanBase=deployment?.explorers?.etherscan||deployment?.explorerUrl;
  const etherscanURL=deployment?.address&&etherscanBase?etherscanBase.replace(/\/$/,'')+'/address/'+deployment.address+(Number(deployment.chainId)===1?'#code':''):'';
  const evmNowURL=deployment?.address&&deployment?.explorers?.evmNow?deployment.explorers.evmNow.replace(/\/$/,'')+'/address/'+deployment.address:'';
  for(const link of etherscanLinks){link.hidden=!etherscanURL;if(etherscanURL){link.href=etherscanURL;link.setAttribute('aria-label','Open this deployed contract source on Etherscan');}else link.removeAttribute('href');}
  for(const link of evmNowLinks){link.hidden=!evmNowURL;if(evmNowURL){link.href=evmNowURL;link.setAttribute('aria-label','Open this deployed contract on EVM.Now');}else link.removeAttribute('href');}
}
function renderFooterNetworkLinks(){
  const contracts=[$('footerContract'),$('aboutFooterContract')],secondaries=[$('footerContractSecondary'),$('aboutFooterContractSecondary')],sourcify=$('aboutFooterSourcify'),markets=[$('footerOpenSea'),$('aboutFooterOpenSea'),$('aboutMarketOpenSea'),$('aboutMarketOpenSeaIntro')],marketFallbacks=[$('aboutMarketOpenSeaFallback'),$('aboutMarketOpenSeaIntroFallback')],deployment=chainState.deployment;
  if([...contracts,...secondaries,sourcify,...markets].some(node=>!node))return;
  if(!deployment?.address||!deployment?.explorerUrl){
    for(const node of [...contracts,...secondaries,sourcify,...markets]){node.hidden=true;node.removeAttribute('href');}
    for(const fallback of marketFallbacks)fallback.hidden=false;
    return;
  }
  const mainnet=Number(deployment.chainId)===1;
  const setLink=(node,href,label)=>{node.href=href;const authoredLabel=node.dataset.linkLabel,visibleLabel=node.querySelector('[data-resource-label]');if(visibleLabel)visibleLabel.textContent=authoredLabel||label;else if(!authoredLabel)node.textContent=label;node.setAttribute('aria-label',authoredLabel||label);node.hidden=false;};
  const sourceURL=deployment.explorerUrl.replace(/\/$/,'')+'/address/'+deployment.address+(mainnet?'#code':'');
  for(const contract of contracts)setLink(contract,sourceURL,mainnet?'ETHERSCAN':`CONTRACT · ${(deployment.networkName||'NETWORK').toUpperCase()}`);
  if(deployment.explorers?.evmNow)for(const secondary of secondaries)setLink(secondary,deployment.explorers.evmNow.replace(/\/$/,'')+'/address/'+deployment.address,'EVM.NOW');
  else for(const secondary of secondaries){secondary.hidden=true;secondary.removeAttribute('href');}
  const sourcifyURL=sourcifyContractURL(deployment);
  if(sourcifyURL)setLink(sourcify,sourcifyURL,'SOURCIFY');
  else{sourcify.hidden=true;sourcify.removeAttribute('href');}
  const openSea=openSeaTokenURL(deployment,spiralEntries[0]?.tokenId||1);
  if(openSea){
    for(const market of markets)setLink(market,openSea,'OPENSEA');
    for(const fallback of marketFallbacks)fallback.hidden=true;
  }else{
    for(const market of markets){market.hidden=true;market.removeAttribute('href');}
    for(const fallback of marketFallbacks)fallback.hidden=false;
  }
}
function renderLayers(){
  if(currentView!=='about')return;
  $('friend-introduction').textContent=collectionCopy.friendIntroduction;
  $('about-introduction').textContent='Magic Forest is the real place behind these little on-chain friends. We are raising funds to buy land in Spain, plant a forest, and build an Art Hub. The film below is the short version of who we are, why we started, and what we hope to build.';
  $('copy-artwork').textContent='Choose a stem, cap, temperament, glasses, accessory, and hobby. Tiny vector beads form the artwork, while its original traits, image, and descriptions live entirely on Ethereum. No reveal to wait for. No image server to keep alive.';
  const genotype=builderGenotype.join(',');
  if(aboutLayersGenotype!==genotype){
    aboutLayersGenotype=genotype;
    $('layer-strip').innerHTML=renderLayerKeys.map((key,position)=>{const i=layerKeys.indexOf(key);return (position?'<span class="layer-plus" aria-hidden="true">+</span>':'')+'<div class="layer-preview"><div><canvas width="240" height="240" data-layer="'+key+'" data-position="'+position+'" role="img" aria-label="'+layerNames[key]+': '+traits[key][builderGenotype[i]].name+'"></canvas></div><span>'+layerNames[key]+'</span></div>';}).join('');
  }
  $('layer-strip').querySelectorAll('canvas:not([data-painted])').forEach(canvas=>queueRender(canvas,node=>{paintLayerCanvas(node,Number(node.dataset.position));node.dataset.painted='true';}));
  $('about-counts').textContent=traits.stem.length+' stems, '+traits.cap.length+' caps, '+traits.temperament.length+' temperaments, '+traits.glasses.length+' glasses, '+traits.accessory.length+' decorations and '+traits.hobby.length+' hobby options';
  $('combination-count').textContent=combinations.toLocaleString('en-US');
  renderAboutChainStats();
  loadForestProgress();
}

function spiralIsVisible(){return currentView==='spiral'&&(!mobileLayout.matches||mobileSurface==='spiral')&&!$('universe').hidden;}
function spiralTotal(){return Math.max(1,spiralEntries.length+1+Math.max(6,spiralCount));}
// Transport controls follow confirmed mushrooms only. Future landing places
// remain part of the scene, but never extend playback into an empty tail.
function spiralTravelMax(){return spiralEntries.length;}
function spiralScreenPoint(point){
  return {x:spiralFit.x+point.x*spiralFit.scale,y:spiralFit.y+point.y*spiralFit.scale};
}
function drawSpiral(){
  if(!spiralFit)return;
  const path=spiralFit.points.map((point,i)=>{const p=spiralScreenPoint(point);return (i?'L':'M')+p.x.toFixed(2)+' '+p.y.toFixed(2);}).join(' ');
  $('mainSpiral').setAttribute('d',path);$('backSpiral').setAttribute('d',path);
  $('originStar').setAttribute('transform',`translate(${spiralFit.x.toFixed(2)} ${spiralFit.y.toFixed(2)})`);
  $('futureSpiral').setAttribute('d','');$('ticks').innerHTML='';
}
function slotState(slot){
  if(slot<=spiralEntries.length){const entry=spiralEntries[slot-1],edition=entry;return {...entry,slot,status:'minted',genotype:edition.genotype,name:edition.name};}
  const offset=slot-spiralEntries.length,step=paidCount()+offset;
  return {slot,status:offset===1?'next':'future',phase:chainState.snapshot?.publicOpen?'public':'allowlist',step,price:chainState.snapshot?.publicOpen?linearPrice(step):nextPrice(),genotype:builderGenotype,name:'Your Mycelium Friend'};
}
function placeTooltip(button){
  const universe=$('universe').getBoundingClientRect(),r=button.getBoundingClientRect(),tip=$('slotTooltip');
  const width=tip.offsetWidth,height=tip.offsetHeight;
  let x=r.right-universe.left+12,y=r.top-universe.top+r.height/2-35;
  if(x+width>universe.width-12)x=r.left-universe.left-width-12;
  tip.style.left=Math.max(12,Math.min(x,universe.width-width-12))+'px';
  tip.style.top=Math.max(12,Math.min(y,universe.height-height-12))+'px';
}
function showSlot(slot,button,pin=false){
  if(pin)pinnedSlot=slot;
  const state=slotState(slot);
  $('tipPhase').textContent=state.status==='minted'?(state.phase==='allowlist'?'ALLOWLIST CLAIM':'PUBLIC MINT'):state.status==='next'?'NEXT MINT':'FUTURE MINT';
  $('tipTitle').textContent=state.status==='minted'?state.name:'Spiral position '+num(slot);
  $('tipPrice').innerHTML=state.phase==='allowlist'?'FREE CLAIM':priceMarkup(state.price);
  $('tipMeta').textContent='';
  $('slotTooltip').classList.add('visible');placeTooltip(button);renderLadder(state.step||0);
}
function clearPinned(){pinnedSlot=null;$('slotTooltip').classList.remove('visible');renderLadder();}
function buildNodes(){
  spiralNodes.clear();$('nodes').replaceChildren();clearPinned();paintView();
}
function makeSpiralNode(slot){
    const state=slotState(slot),example=state.status==='minted',next=state.status==='next';
    const button=document.createElement('button');button.type='button';button.dataset.slot=slot;
    button.className='node '+(example?'':'empty ')+(next?'coming':'');
    if(spiralIntroPhase==='current'&&next)button.classList.add('intro-current');
    if(spiralIntroPhase==='future'&&!example&&!next)button.classList.add('intro-future');
    const visibleIndex=(next?'NEXT / ':'')+num(slot);
    button.setAttribute('aria-label',visibleIndex+' · '+(example?state.name:next?'Your next mushroom':'Future mint position')+', spiral position '+slot);
    button.innerHTML=(example||next?'<canvas width="144" height="144" data-resolution="144" aria-hidden="true"></canvas>':'<span class="plus">+</span>')+'<span class="index">'+visibleIndex+'</span>';
    if(example||next)paintGenotypeCanvas(button.querySelector('canvas'),state.genotype);
    button.onmouseenter=button.onfocus=()=>{stopSpiral();if(pinnedSlot===null)showSlot(slot,button);};
    button.onmouseleave=button.onblur=()=>{if(pinnedSlot===null){$('slotTooltip').classList.remove('visible');renderLadder();}};
    button.onclick=event=>{
      event.stopPropagation();
      if(slot<=spiralEntries.length){
        builderGenotype=[...spiralEntries[slot-1].genotype];selectedSlot=slot;renderSidebar();renderLayers();updateNextNode();syncURL();
      }else{selectedSlot=null;renderSidebar();}
      $('nodes').querySelectorAll('button').forEach(node=>node.classList.toggle('selected',node===button));
      if(pinnedSlot===slot)clearPinned();else showSlot(slot,button,true);
    };
    return button;
}
function updateNextNode(){
  if(currentView!=='spiral'||$('universe').hidden||(mobileLayout.matches&&mobileSurface!=='spiral'))return;
  const canvas=$('nodes').querySelector('.coming canvas'),genotype=builderGenotype.join(',');
  if(canvas&&canvas.dataset.genotype!==genotype)paintGenotypeCanvas(canvas,builderGenotype);
}
function renderLadder(inspectStep=0){
  const container=$('priceLadder');if(!container)return;
  if(!chainState.snapshot?.publicOpen){container.innerHTML='';return;}
  const paid=paidCount(),current=paid+1,start=Math.max(1,current-3);
  container.innerHTML=Array.from({length:7},(_,i)=>{
    const step=start+i,price=linearPrice(step),classes=['step',step<=paid?'sold':'',step===current?'current':'',step===inspectStep?'inspect':''].filter(Boolean).join(' ');
    return '<div class="'+classes+'" title="Mint step '+num(step)+' · '+ethFormat(price)+' ETH"><div class="bar" style="height:'+(10+Math.min(48,i*7))+'px"></div><span>'+ethFormat(price)+'</span><span class="usd-price" data-wei="'+price+'" data-usd-bare>'+usdEquivalent(price,true)+'</span></div>';
  }).join('');
}
function paintView(){
  const bounds=$('universe').getBoundingClientRect(),width=bounds.width,height=bounds.height;
  if(!width||!height)return;
  const count=width<600?12:20;
  const top=64,controls=universe.querySelector('.spiral-controls').getBoundingClientRect();
  const bottom=Math.max(110,bounds.bottom-controls.top+58);
  if(!spiralFit||spiralFit.width!==width||spiralFit.height!==height||spiralFit.zoom!==zoom||spiralFit.top!==top||spiralFit.bottom!==bottom){
    spiralFit={...fitSpiral(width,height,count,{top,bottom},zoom),width,height,top,bottom,zoom};
    spiralCount=spiralFit.count;
    $('stage').querySelector('svg').setAttribute('viewBox',`0 0 ${width} ${height}`);
    $('stage').dataset.turns=spiralFit.turns.toFixed(4);
    $('stage').dataset.visibleTurns=spiralFit.visibleTurns.toFixed(4);
    $('stage').dataset.capacity=spiralCount;
    $('stage').dataset.originX=spiralFit.x;
    $('stage').dataset.originY=spiralFit.y;
  }
  const max=spiralTravelMax();
  spiralOffset=Math.max(0,Math.min(max,spiralOffset));spiralTarget=Math.max(0,Math.min(max,spiralTarget));
  drawSpiral();paintSpiralNodes();
  $('zoomLevel').textContent=Math.round(zoom*100)+'%';
  $('zoomOut').disabled=zoom<=.2;$('zoomIn').disabled=zoom>=3.2;
}
function paintSpiralNodes(){
  if(!spiralFit)return;
  const total=spiralTotal(),window=spiralWindow(total,spiralCount,spiralOffset),max=spiralTravelMax();
  $('stage').dataset.totalPositions=total;
  const size=spiralFit.nodeSize;
  $('stage').classList.toggle('spiral-overview',size<28);
  const active=new Set();
  for(let slot=window.first;slot<=window.last;slot++){
    if(spiralIntroPhase!=='done'&&slot>spiralIntroLimit)continue;
    const position=slot-spiralOffset,p=spiralScreenPoint(spiralPoint(position,spiralFit.angle,spiralFit.nodeArcScale));
    active.add(slot);
    let node=spiralNodes.get(slot);
    if(!node){node=makeSpiralNode(slot);spiralNodes.set(slot,node);$('nodes').append(node);}
    const visualSize=node.classList.contains('empty')&&!node.classList.contains('coming')?size:spiralFit.artNodeSize;
    node.style.left=p.x+'px';node.style.top=p.y+'px';node.style.width=visualSize+'px';node.style.height=visualSize+'px';
    node.style.opacity='';node.style.pointerEvents='';node.tabIndex=0;
    node.classList.toggle('selected',selectedSlot===slot);
  }
  for(const [slot,node] of spiralNodes)if(!active.has(slot)){node.remove();spiralNodes.delete(slot);}
  $('spiralPosition').textContent=window.first>window.last?`0 / ${total}`:`${window.first}–${window.last} / ${total}`;
  $('spiralScrub').max=max;$('spiralScrub').value=spiralOffset;
  $('spiralScrub').disabled=max===0;
  if(pinnedSlot!==null){const node=spiralNodes.get(pinnedSlot);if(node)placeTooltip(node);else clearPinned();}
}
function stopSpiral(){
  spiralTarget=spiralOffset;
}
function setSpiralIntroPhase(phase){
  spiralIntroPhase=phase;document.body.dataset.spiralIntro=phase;
}
function finishSpiralIntro(){
  if(spiralIntroFrame)cancelAnimationFrame(spiralIntroFrame);
  spiralIntroFrame=0;spiralOffset=0;spiralTarget=0;spiralIntroLimit=Infinity;setSpiralIntroPhase('done');paintSpiralNodes();
}
function animateSpiralIntro(time){
  spiralIntroFrame=0;
  if(!spiralIsVisible()){finishSpiralIntro();return;}
  const elapsed=time-spiralIntroStarted;
  if(spiralIntroPhase==='minted'){
    const duration=Math.min(12000,Math.max(5500,spiralIntroMinted*350)),progress=Math.min(1,elapsed/duration);
    const eased=progress<.5?2*progress*progress:1-Math.pow(-2*progress+2,2)/2;
    spiralOffset=spiralTarget=spiralIntroMinted*(1-eased);paintSpiralNodes();
    if(progress>=1){spiralOffset=spiralTarget=0;spiralIntroLimit=spiralIntroMinted+1;setSpiralIntroPhase('current');spiralIntroStarted=time;paintSpiralNodes();}
  }else if(spiralIntroPhase==='current'&&elapsed>=850){
    setSpiralIntroPhase('future');spiralIntroStarted=time;
  }else if(spiralIntroPhase==='future'){
    const futureCount=Math.max(0,spiralTotal()-spiralIntroMinted-1),duration=Math.min(3000,Math.max(1200,futureCount*60));
    const progress=Math.min(1,elapsed/duration);
    spiralIntroLimit=spiralIntroMinted+1+Math.floor(futureCount*progress);paintSpiralNodes();
    if(progress>=1){finishSpiralIntro();return;}
  }
  spiralIntroFrame=requestAnimationFrame(animateSpiralIntro);
}
function startSpiralIntro(){
  if(spiralIntroFrame)cancelAnimationFrame(spiralIntroFrame);
  spiralIntroMinted=spiralEntries.length;
  if(spiralIntroMinted){
    spiralIntroLimit=spiralIntroMinted;spiralOffset=spiralTarget=spiralIntroMinted;setSpiralIntroPhase('minted');
  }else{
    // With no minted mushrooms there is no journey from the centre to animate.
    // Hand the completed thread straight to the NEXT mint instead of holding an
    // empty scene for the minted phase's minimum duration.
    spiralIntroLimit=1;spiralOffset=spiralTarget=0;setSpiralIntroPhase('current');
  }
  buildNodes();
  if(spiralMotion.matches||!spiralIsVisible()){finishSpiralIntro();return;}
  spiralIntroStarted=performance.now();spiralIntroFrame=requestAnimationFrame(animateSpiralIntro);
}
function finishSpiralThreadIntro(){
  if(spiralThreadReady)return;
  if(spiralThreadFrame)cancelAnimationFrame(spiralThreadFrame);spiralThreadFrame=0;
  spiralThreadReady=true;$('stage').classList.remove('spiral-loading','spiral-loading-pending');
  if(spiralIntroPhase==='waiting'&&chainState.snapshot)startSpiralIntro();
}
function armSpiralThreadIntro(){
  if(spiralMotion.matches||!spiralIsVisible()){finishSpiralThreadIntro();return;}
  const stage=$('stage'),path=$('mainSpiral');
  // The path receives its geometry at runtime. Keep it fully masked until that
  // geometry exists, then start a fresh one-stroke draw on the next frame.
  stage.classList.remove('spiral-loading');stage.classList.add('spiral-loading-pending');
  requestAnimationFrame(()=>{
    if(spiralThreadReady)return;
    stage.classList.add('spiral-loading');stage.classList.remove('spiral-loading-pending');
    const animation=path.getAnimations().find(item=>item.animationName==='spiral-loading-draw');
    if(!animation){finishSpiralThreadIntro();return;}
    // The source path extends beyond the circumscribed viewport so zoom can
    // never expose its artificial end. Begin the mushrooms once the brush has
    // covered every pixel the browser can actually show; do not wait for that
    // invisible safety tail.
    const visibleOffset=1-spiralFit.visiblePathFraction;
    const watch=()=>{
      if(spiralThreadReady)return;
      const offset=Number.parseFloat(getComputedStyle(path).strokeDashoffset);
      if(!Number.isFinite(offset)||offset<=visibleOffset+.002){finishSpiralThreadIntro();return;}
      spiralThreadFrame=requestAnimationFrame(watch);
    };
    spiralThreadFrame=requestAnimationFrame(watch);
  });
}
function animateSpiral(time){
  spiralFrame=0;
  const elapsed=Math.min(.05,(time-(spiralTime||time))/1000);spiralTime=time;
  const distance=spiralTarget-spiralOffset;
  spiralOffset=spiralMotion.matches?spiralTarget:Math.abs(distance)<.001?spiralTarget:spiralOffset+distance*(1-Math.exp(-elapsed*12));
  paintSpiralNodes();
  if(Math.abs(spiralTarget-spiralOffset)>.001)spiralFrame=requestAnimationFrame(animateSpiral);
  else spiralTime=0;
}
function seekSpiral(offset,instant=false){
  clearPinned();
  spiralTarget=Math.max(0,Math.min(spiralTravelMax(),offset));
  if(instant||spiralMotion.matches){spiralOffset=spiralTarget;paintSpiralNodes();}
  else if(!spiralFrame)spiralFrame=requestAnimationFrame(animateSpiral);
}
function changeSpiralZoom(factor){stopSpiral();zoom=Math.max(.2,Math.min(3.2,zoom*factor));clearPinned();paintView();}
document.addEventListener('keydown',event=>{if(event.key==='Escape')clearPinned();});
$('zoomIn').onclick=()=>changeSpiralZoom(1.2);
$('zoomOut').onclick=()=>changeSpiralZoom(1/1.2);
$('reset').onclick=()=>{stopSpiral();zoom=1;seekSpiral(0,true);paintView();};
$('spiralLatest').onclick=()=>{stopSpiral();seekSpiral(spiralEntries.length-Math.floor(spiralCount/2));};
$('spiralScrub').oninput=event=>{stopSpiral();seekSpiral(Number(event.target.value),true);};
let drag=null,dragFrame=0,dragPending=0,pinch=null,pinchFrame=0,pinchPendingZoom=1;
const gesturePointers=new Map(),universe=$('universe');
const pointerDistance=points=>Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
universe.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button,input'))return;
  stopSpiral();
  try{universe.setPointerCapture(event.pointerId);}catch{/* Synthetic and older pointer implementations can still use the gesture. */}
  universe.classList.add('dragging');clearPinned();
  if(event.pointerType==='touch'){
    gesturePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(gesturePointers.size>1){
      const points=[...gesturePointers.values()].slice(0,2);
      pinch={distance:Math.max(1,pointerDistance(points)),zoom};pinchPendingZoom=zoom;drag=null;
    }else drag={id:event.pointerId,x:event.clientX,y:event.clientY,offset:spiralOffset};
    return;
  }
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,offset:spiralOffset};
});
universe.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'&&gesturePointers.has(event.pointerId)){
    gesturePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch&&gesturePointers.size>1){
      event.preventDefault();
      pinchPendingZoom=Math.max(.2,Math.min(3.2,pinch.zoom*pointerDistance([...gesturePointers.values()].slice(0,2))/pinch.distance));
      if(!pinchFrame)pinchFrame=requestAnimationFrame(()=>{pinchFrame=0;zoom=pinchPendingZoom;paintView();});
      return;
    }
  }
  if(!drag)return;dragPending=drag.offset+(drag.x-event.clientX)/65;
  if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(drag)seekSpiral(dragPending,true);});
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])universe.addEventListener(name,event=>{
  if(drag&&dragFrame){cancelAnimationFrame(dragFrame);dragFrame=0;seekSpiral(dragPending,true);}
  gesturePointers.delete(event.pointerId);
  if(pinch&&gesturePointers.size===1){
    const [id,point]=gesturePointers.entries().next().value;drag={id,x:point.x,y:point.y,offset:spiralOffset};pinch=null;
  }else if(!gesturePointers.size){drag=null;pinch=null;universe.classList.remove('dragging');}
});
universe.addEventListener('wheel',event=>{
  if(event.target.closest('input'))return;
  event.preventDefault();
  if(event.ctrlKey||event.metaKey){changeSpiralZoom(Math.exp(-event.deltaY*.008));return;}
  const delta=(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?universe.clientHeight:1);
  const target=spiralTarget;stopSpiral();seekSpiral(target+delta/180);
},{passive:false});
universe.addEventListener('keydown',event=>{
  if(event.target!==universe)return;
  const target=spiralTarget;
  if(['ArrowRight','ArrowLeft','Home','End','+','-'].includes(event.key))event.preventDefault();
  if(event.key==='ArrowRight'||event.key==='ArrowLeft'){stopSpiral();seekSpiral(target+(event.key==='ArrowRight'?1:-1));}
  if(event.key==='Home'||event.key==='End'){stopSpiral();seekSpiral(event.key==='Home'?0:spiralTravelMax());}
  if(event.key==='+')changeSpiralZoom(1.2);if(event.key==='-')changeSpiralZoom(1/1.2);
});
const spiralResize=new ResizeObserver(()=>{clearPinned();paintView();});
for(const element of [universe,universe.querySelector('.spiral-controls')])spiralResize.observe(element);
new MutationObserver(()=>{if(universe.hidden)stopSpiral();}).observe(universe,{attributes:true,attributeFilter:['hidden']});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSpiral();});
spiralMotion.addEventListener('change',()=>stopSpiral());
window.addEventListener('hashchange',()=>{
  const previousGenotype=[...builderGenotype],wasSelected=selectedSlot!==null;
  parseHash();rememberLook();selectedSlot=null;clearPinned();
  if(pendingTokenId&&showToken(pendingTokenId))return;
  if(wasSelected||!sameGenotype(previousGenotype,builderGenotype)){renderSidebar();updateNextNode();}
  if(!$('traitCatalog').hidden)renderCatalog();
  showView(currentView,true);
});
new MutationObserver(syncMobileStatus).observe($('chainStatus'),{childList:true,characterData:true,subtree:true});
mobileLayout.addEventListener('change',()=>{syncMobileShell();renderSidebar();paintView();});
restoreWishlist();restoreGridSize();syncGridSize();restoreLooks();parseHash();rememberLook();drawSpiral();paintView();armSpiralThreadIntro();renderSidebar();buildNodes();showView(currentView);syncURL();
setupPrivacyNotice();
$('summaryCurrent').textContent='—';
refreshExchangeRate();
setInterval(refreshExchangeRate,5*60*1000);
setInterval(refreshUSDDisplays,60*1000);
delete document.body.dataset.booting;document.body.dataset.ready='true';

window.myFriendsUI={genotype:()=>[...builderGenotype],paint:(canvas,genotype)=>paintGenotypeCanvas(canvas,genotype),isMinted:genotypeIsMinted,
  owned:()=>ownedEntries().map(({entry})=>({tokenId:entry.tokenId,genotype:[...entry.genotype],name:entry.name})),
  confirmed:record=>{
    const tokenId=String(record.tokenId),entry={...record,tokenId,genotype:[...record.genotype],price:BigInt(record.price||0),step:0,
      phase:record.phase||'allowlist',name:'Mycelium Friend #'+tokenId,confirmedByReceipt:true};
    receiptEntries.set(tokenId,entry);
    if(!spiralEntries.some(item=>item.tokenId===tokenId))spiralEntries=[...spiralEntries,entry].sort((a,b)=>Number(a.tokenId)-Number(b.tokenId));
    mintedGenotypes.add(genotypeKey(entry.genotype));buildNodes();
    if(currentView==='forest')renderGallery();if(currentView==='myfriends')renderMyFriends();if(currentView==='wishlist')renderWishlist();if(currentView==='history')renderHistoryCatalog();renderSidebar();
  },
  markMinted:genotype=>{mintedGenotypes.add(genotypeKey(genotype));if(currentView==='wishlist')renderWishlist();if(currentView==='history')renderHistoryCatalog();if(sameGenotype(genotype,builderGenotype))renderSidebar();},
  download:downloadArtwork,share:shareArtwork,notify:announce,
  fresh:()=>selectGenotype(randomAvailableGenotype()),showToken,
  forest:()=>{showView('forest',true);syncURL();},
  connected:routeConnectedWallet,
  friends:()=>{showView('myfriends',true);syncURL();}};
window.dispatchEvent(new Event('myfriends:ui-ready'));
window.addEventListener('myfriends:state',event=>{
  const state=event.detail,previous=chainState;
  const historyKey=s=>(s.snapshot?.records||[]).map(r=>r.tokenId+':'+r.transactionHash+':'+r.owner).join(',');
  const changed=previous.deployment?.id!==state.deployment?.id||historyKey(state)!==historyKey(previous);
  const snapshotChanged=previous.snapshot?.blockNumber!==state.snapshot?.blockNumber||previous.snapshot?.blockHash!==state.snapshot?.blockHash;
  const snapshotIds=new Set((state.snapshot?.records||[]).map(entry=>String(entry.tokenId)));
  const receiptsChanged=snapshotChanged&&[...receiptEntries].some(([tokenId,entry])=>snapshotIds.has(tokenId)||(state.snapshot&&state.snapshot.blockNumber>=entry.blockNumber));
  const preparedKey=s=>(s.preparedMints||[]).map(item=>item.genotype.join(',')+':'+item.status).join('|');
  const preparedChanged=preparedKey(previous)!==preparedKey(state);
  chainState=state;
  syncDocumentTitle();
  renderFooterNetworkLinks();
  if(changed||receiptsChanged){
    const deploymentChanged=previous.deployment?.id!==state.deployment?.id;
    if(deploymentChanged){if(spiralIntroFrame)cancelAnimationFrame(spiralIntroFrame);spiralIntroFrame=0;setSpiralIntroPhase('waiting');}
    if(previous.deployment?.id!==state.deployment?.id)receiptEntries.clear();
    const indexed=(state.snapshot?.records||[]).map(entry=>({...entry,price:BigInt(entry.price),genotype:[...entry.genotype],name:'Mycelium Friend #'+entry.tokenId}));
    const indexedIds=new Set(indexed.map(entry=>entry.tokenId));
    for(const [tokenId,entry] of receiptEntries){
      if(indexedIds.has(tokenId)||(state.snapshot&&state.snapshot.blockNumber>=entry.blockNumber))receiptEntries.delete(tokenId);
    }
    spiralEntries=[...indexed,...receiptEntries.values()].sort((a,b)=>Number(a.tokenId)-Number(b.tokenId));
    // A validated browser snapshot is useful immediately. The reader verifies it
    // and appends newer blocks in the background, so visitors see the known
    // collection without waiting for the RPC scan.
    mintedGenotypes=new Set(spiralEntries.map(entry=>genotypeKey(entry.genotype)));
    if(previous.deployment?.id!==state.deployment?.id){selectedSlot=null;galleryLimit=24;clearPinned();}
    if(selectedSlot>spiralEntries.length)selectedSlot=null;
    const beginIntro=spiralThreadReady&&spiralIntroPhase==='waiting'&&Boolean(state.snapshot);
    if(beginIntro)startSpiralIntro();else buildNodes();
    if(currentView==='forest')renderGallery();if(currentView==='myfriends')renderMyFriends();if(currentView==='wishlist')renderWishlist();if(currentView==='history')renderHistoryCatalog();
    if(pendingTokenId)showToken(pendingTokenId);
  }
  if(!changed&&previous.ready!==state.ready&&currentView==='forest')renderGallery();
  if((changed||previous.account!==state.account||previous.walletChecking!==state.walletChecking||previous.walletEnabled!==state.walletEnabled)&&currentView==='myfriends')renderMyFriends();
  if(changed||preparedChanged||previous.ready!==state.ready||previous.busy!==state.busy||previous.snapshot?.price!==state.snapshot?.price||
    previous.snapshot?.publicOpen!==state.snapshot?.publicOpen||previous.snapshot?.salePhase!==state.snapshot?.salePhase||previous.account!==state.account||previous.walletEnabled!==state.walletEnabled)renderSidebar();
  if(walletLandingAccount&&state.account?.toLowerCase()===walletLandingAccount&&(state.ready||ownedEntries().length))routeConnectedWallet();
  else if(walletLandingAccount&&state.account?.toLowerCase()!==walletLandingAccount)walletLandingAccount=null;
  if(!state.snapshot)$('summaryCurrent').textContent='—';
  else if(state.snapshot.total>=state.snapshot.cap)$('summaryCurrent').textContent='Sold out';
  else $('summaryCurrent').innerHTML=ethFormat(nextPrice())+' ETH<br><small class="usd-price" data-wei="'+nextPrice()+'">'+usdEquivalent(nextPrice())+'</small>';
  if(currentView==='about')renderAboutChainStats();
});
