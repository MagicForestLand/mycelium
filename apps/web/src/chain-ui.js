import {openProtectedMint} from './protected-mint-panel.js';
import {IntentStore,lastMint,rememberMint} from './mint-protection.js';
import {xComposerURL,xPostText} from './x-share.js';
const TRAIT_COUNTS=__TRAIT_COUNTS__;
import {BrowserProvider,Contract,formatEther,toQuantity,keccak256} from 'ethers';
import {ABI,allowlistMessage,deploymentKey,friendlyError,mintReceiptForGenotype,mintReceiptPayment,tokenExplorerURL,validateDeployment} from './chain-core.js';
import {ChainReader,fetchAndSeedSnapshot,fetchMinterProfiles} from './chain-reader.js';
import {emitMintEvidence,newMintEvidenceId} from './mint-telemetry.js';

const $=id=>document.getElementById(id);
if(!window.myFriendsUI)await new Promise(resolve=>window.addEventListener('myfriends:ui-ready',resolve,{once:true}));
const ui=window.myFriendsUI;
let config,reader,deployment,walletProvider,account=null,walletChain=null,kit,kitLoading;
let refreshing=false,ready=false,busy=false,pending=null,quote=null,pollTimer,receiptChecking=false;
let snapshotSeeding=null,snapshotSeedFailures=0,snapshotRetryAt=0;
let minterProfiles=Object.create(null),profilesLoading=null,profilesLoadedAt=0,profilesExpireAt=0,profilesExpiryTimer=null;
let walletChecking=true;
let closeProtectedMint,protectedResume;
let mintContext=null,mintIntent=false,celebrationTimer;
let mintGeneration=0,mintCancellation='';
let mintAttemptSerial=0,activeWalletRequestId=null;
let expectedChainChange=null;
const evidence=(stage,data)=>emitMintEvidence(deployment?.mintEvidenceUrl,{stage,chainId:deployment?.chainId,contract:deployment?.address,...data});
const SALE_PHASE={PAUSED:0n,ALLOWLIST:1n,PUBLIC_ACTIVE:2n,PUBLIC_PAUSED:3n};
const discovered=new Map();
let walletRestoreReady=false,walletRestorePromise=null;
window.addEventListener('eip6963:announceProvider',event=>{
  const detail=event.detail;
  if(detail?.info?.uuid && detail?.provider?.request)discovered.set(detail.info.uuid,detail);
  if(walletRestoreReady&&!account)queueAuthorizedWallet(storage.getItem('myfriends:wallet'));
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const storage={getItem:key=>{try{return localStorage.getItem(key);}catch{return null;}},setItem:(key,value)=>{try{localStorage.setItem(key,value);return true;}catch{return false;}},removeItem:key=>{try{localStorage.removeItem(key);}catch{}}};
const walletChoice=choice=>choice.info.rdns||choice.info.uuid;
const walletEnabled=()=>config?.mode!=='read-only';
function browserWallets(){
  const choices=[...discovered.values()];
  if(window.ethereum&&!choices.some(choice=>choice.provider===window.ethereum))choices.push({info:{uuid:'injected',name:'Browser wallet'},provider:window.ethereum});
  return choices;
}
function notice(text,tone=''){$('chainStatus').textContent=text;$('chainStatus').dataset.tone=tone;}
function restoreProtection(){
  protectedResume=null;
  if(!account||deployment?.mintProtocol!=='commit-reveal-v1')return;
  try{
    const store=new IntentStore(localStorage,{chainId:deployment.chainId,collection:deployment.address,buyer:account,deploymentHash:deployment.deploymentHash,codeHash:deployment.codeHash},TRAIT_COUNTS);
    protectedResume=lastMint(store);
  }catch{}
}
function emit(){
  expireMinterProfiles(false);
  restoreProtection();
  const preparedMints=(protectedMintRecords()?.records??[]).flatMap(record=>record.selections.map(genotype=>({genotype:[...genotype],status:mintProgressLabel(record)})));
  const canUseWallet=walletEnabled();
  window.dispatchEvent(new CustomEvent('myfriends:state',{detail:{snapshot:reader?.snapshot,profiles:minterProfiles,ready,busy,account,deployment,walletChecking:canUseWallet&&walletChecking,walletEnabled:canUseWallet,preparedMints}}));
  $('wallet').dataset.state=!canUseWallet?'read-only':walletChecking?'checking':account?'connected':'disconnected';
  $('wallet').disabled=!canUseWallet||walletChecking;
  $('wallet').textContent=!canUseWallet
    ?'READ-ONLY PREVIEW'
    :walletChecking
    ?'CHECKING WALLET'
    :account
      ?'WALLET MENU'
      :'CONNECT WALLET';

  $('wallet').title=!canUseWallet
    ?'Wallet connections are disabled in this preview'
    :walletChecking
    ?'Checking wallet connection'
    :account
      ?'Open wallet menu'
      :'Connect wallet';
  $('deploymentSelect').disabled=busy;
}
function expireMinterProfiles(notify=true){
  if(!profilesExpireAt||Date.now()<profilesExpireAt)return false;
  clearTimeout(profilesExpiryTimer);profilesExpiryTimer=null;
  minterProfiles=Object.create(null);profilesLoadedAt=0;profilesExpireAt=0;
  if(notify)emit();return true;
}
function scheduleMinterProfileExpiry(){
  clearTimeout(profilesExpiryTimer);profilesExpiryTimer=null;
  if(!profilesExpireAt)return;
  const delay=Math.max(0,profilesExpireAt-Date.now());
  profilesExpiryTimer=setTimeout(()=>expireMinterProfiles(),delay);
}
function renderMintDetails(){
  const details=$('mintDetails');details.replaceChildren();
  function row(label,value,path){
    if(!value)return;
    const dt=document.createElement('dt');dt.textContent=label;
    const dd=document.createElement('dd'),node=document.createElement(path&&deployment?.explorerUrl?'a':'span');
    node.textContent=value;
    if(node.tagName==='A'){node.href=deployment.explorerUrl+path;node.target='_blank';node.rel='noopener noreferrer';}
    dd.append(node);details.append(dt,dd);
  }
  row('Network',deployment?.networkName);
  row('Collection contract',deployment?.address,'/address/'+deployment?.address);
  const buyer=mintContext?.buyer||account;row('Collecting wallet',buyer,'/address/'+buyer);
  const hash=pending?.hash||mintContext?.hash;row('Transaction',hash,'/tx/'+hash);
}
const dialogContexts={
  mint:['A FRIEND FOR YOUR WALLET','A little friend. Entirely yours.'],
  connect:['CONNECT YOUR WALLET','Your selected myFriend is waiting.'],
  wallet:['YOUR CONNECTED WALLET','Your wallet. Your myFriends.'],
  allowlist:['ALLOWLIST STATUS','Your saved myFriend is still here.'],
  error:['MINT STATUS','Your selection is safe.']
};
function openDialog(title,context='mint'){
  const [eyebrow,caption]=dialogContexts[context]||dialogContexts.mint;
  $('mintDialog').dataset.context=context;
  $('mintEyebrow').textContent=eyebrow;$('mintArtCaption').textContent=caption;
  $('mintTitle').textContent=title;
  $('walletDialogAddress')?.remove();
  const genotype=mintContext?.genotype||pending?.genotype||ui.genotype();
  ui.paint($('mintPreview'),genotype);$('mintPreview').dataset.genotype=genotype.join(',');
  renderMintDetails();
  if(!$('mintDialog').open){$('mintDialog').showModal();$('mintTitle').focus({preventScroll:true});}
}
function textBody(text){$('walletEmbed').hidden=true;$('mintDialog').classList.remove('is-success','is-protected');delete $('mintBody').dataset.mintScreen;$('mintBody').replaceChildren();const p=document.createElement('p');p.textContent=text;$('mintBody').append(p);}
function action(label,run){const b=document.createElement('button');b.type='button';b.className='chain-action';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await run();}catch(error){showError(error);}finally{b.disabled=false;}};$('mintBody').append(b);return b;}
function walletFriendPreviews(entries){
  const section=document.createElement('section');section.className='wallet-friends-preview';section.setAttribute('aria-label','myFriends in this wallet');
  const label=document.createElement('div');label.className='wallet-friends-label';label.textContent=entries.length===1?'1 MYFRIEND IN THIS WALLET':entries.length?entries.length+' MYFRIENDS IN THIS WALLET':'MYFRIENDS IN THIS WALLET';
  if(!entries.length){
    if(!matchMedia('(max-width: 820px), (max-height: 520px) and (max-width: 950px)').matches)return;
    const empty=document.createElement('p');empty.className='wallet-friends-empty';empty.textContent='No myFriends in this wallet yet.';section.append(label,empty);$('mintBody').append(section);return;
  }
  const strip=document.createElement('div');strip.className='wallet-friends-strip';
  for(const entry of entries){
    const item=document.createElement('div');item.className='wallet-friend-mini';
    const canvas=document.createElement('canvas');canvas.width=canvas.height=144;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',entry.name);
    const token=document.createElement('span');token.textContent='#'+entry.tokenId;
    ui.paint(canvas,entry.genotype);item.append(canvas,token);strip.append(item);
  }
  section.append(label,strip);$('mintBody').append(section);
}
function canonicalMintFor(genotype){
  return reader?.snapshot?.records.find(entry=>entry.genotype.length===genotype.length&&entry.genotype.every((value,index)=>value===genotype[index]))||null;
}
function protectedMintRecords(){
  if(!account||deployment?.mintProtocol!=='commit-reveal-v1')return null;
  try{
    const store=new IntentStore(localStorage,{chainId:deployment.chainId,collection:deployment.address,buyer:account,deploymentHash:deployment.deploymentHash,codeHash:deployment.codeHash},TRAIT_COUNTS);
    // Canonical mint history is truth for what the wallet displays. Keep the
    // hidden recovery bytes locally so a rare chain reorg cannot destroy them.
    const records=store.list().filter(record=>record.commitTx&&!['minted','expired'].includes(record.state)&&!canonicalMintFor(record.selections[0]));
    const current=lastMint(store);
    records.sort((a,b)=>a.hash===current?.hash?-1:b.hash===current?.hash?1:0);
    return {store,records};
  }catch{return null;}
}
function mintProgressLabel(record){
  if(record.revealTx||record.state.startsWith('reveal-'))return 'PURCHASE PENDING';
  if(['ready','exposed'].includes(record.state))return 'READY TO MINT';
  if(record.state==='waiting')return 'WAITING';
  if(record.commitTx||record.state.startsWith('commit-'))return 'PREPARING';
  return 'PREPARING';
}
function confirmRemoveSavedMint(store,record){
  const dialog=document.createElement('dialog');dialog.className='wallet-remove-dialog';
  const title=document.createElement('h2');title.id='walletRemoveTitle';title.textContent='Remove this saved mint?';dialog.setAttribute('aria-labelledby',title.id);
  const message=document.createElement('p');message.textContent='This removes the saved mint from this browser. The preparation transaction and its gas cannot be undone. If it confirms, the preparation will expire on its own; no NFT purchase will be sent.';
  const actions=document.createElement('div');actions.className='wallet-remove-actions';
  const keep=document.createElement('button');keep.type='button';keep.className='wallet-remove-cancel';keep.textContent='KEEP IT';
  const remove=document.createElement('button');remove.type='button';remove.className='wallet-remove-confirm';remove.textContent='REMOVE';
  actions.append(keep,remove);dialog.append(title,message,actions);document.body.append(dialog);
  keep.onclick=()=>dialog.close();
  remove.onclick=()=>{
    keep.disabled=remove.disabled=true;
    try{
      store.remove(record);if(protectedResume?.hash===record.hash)protectedResume=null;
      dialog.close();manageWallet();
    }catch(error){keep.disabled=remove.disabled=false;message.textContent=friendlyError(error);}
  };
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();keep.focus();
}
function walletMintPreviews(){
  const saved=protectedMintRecords(),records=saved?.records??[];
  const visiblePending=pending&&!canonicalMintFor(pending.genotype);
  const items=[...(visiblePending?[{pending:true,genotype:pending.genotype}]:[]),...records.map(record=>({record,genotype:record.selections[0]}))];
  if(!items.length)return;
  const section=document.createElement('section');section.className='wallet-friends-preview wallet-mints-preview';section.setAttribute('aria-label','myFriends in progress');
  const label=document.createElement('div');label.className='wallet-friends-label';label.textContent=items.length===1?'1 MINT IN PROGRESS':items.length+' MINTS IN PROGRESS';
  const strip=document.createElement('div');strip.className='wallet-friends-strip';
  for(const itemData of items){
    const {record}=itemData;
    const card=document.createElement('div');card.className='wallet-mint-card';
    const item=document.createElement('button');item.type='button';item.className='wallet-friend-mini wallet-mint-mini';
    const canvas=document.createElement('canvas');canvas.width=canvas.height=144;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Saved myFriend');
    const status=document.createElement('span');status.textContent=itemData.pending?'PURCHASE PENDING':mintProgressLabel(record);
    ui.paint(canvas,itemData.genotype);item.append(canvas,status);card.append(item);strip.append(card);
    item.setAttribute('aria-label',`${status.textContent}. Continue this mint.`);
    item.onclick=async()=>{
      if(itemData.pending){showPendingStatus();return;}
      item.disabled=true;
      rememberMint(saved.store,record);protectedResume=record;mintIntent=true;mintContext={genotype:[...record.selections[0]],buyer:account};
      try{await reviewMint();}catch(error){showError(error);}finally{item.disabled=false;}
    };
    if(record&&!record.revealTx){
      const remove=document.createElement('button');remove.type='button';remove.className='wallet-mint-remove';remove.textContent='×';remove.title='Remove saved mint';remove.setAttribute('aria-label','Remove this saved mint');
      remove.onclick=()=>confirmRemoveSavedMint(saved.store,record);card.append(remove);
    }
  }
  section.append(label,strip);$('mintBody').append(section);
}
function showError(error){
  if(error?.code==='MINT_FLOW_CANCELLED')return;
  if(pending){showPendingStatus();return;}
  $('mintProgress').hidden=true;resetMintSteps();
  const message=friendlyError(error),allowlistBlocked=/^(Allowlist complete|This wallet has no allowlist (?:mints|claims left))/.test(message);
  textBody(message);openDialog(message.startsWith('Allowlist complete')?'Your allowlist is complete':allowlistBlocked?'This wallet cannot mint right now':'Your friend is worth the wait',allowlistBlocked?'allowlist':'error');
  if(allowlistBlocked){
    const owned=ui.owned();walletFriendPreviews(owned);
    if(owned.length)action('VIEW MY FRIENDS',async()=>{if($('mintDialog').open)$('mintDialog').close();ui.friends();});
    action('CONNECT ANOTHER WALLET',async()=>{await disconnectWallet(false);await connect();});
    return;
  }
  action(pending?'View mint progress':'Review my mint',()=>reviewMint());
}
function showPendingStatus(){
  if(!pending)return;
  if(pending.hash){
    progress(2,'Growing your myFriend','Waiting for confirmation. You can keep exploring. No second mint will be requested.');
    action('CHECK THE NETWORK AGAIN',async()=>{await checkPending();if(pending)showPendingStatus();});
    return;
  }
  progress(1,'Check your wallet activity','The wallet response was interrupted before the transaction hash reached this page. We will not request another mint until you resolve this attempt.');
  action('CHECK THE NETWORK AGAIN',async()=>{await checkPending();if(pending)showPendingStatus();});
  if(activeWalletRequestId!==pending.attemptId)action('I DID NOT APPROVE A TRANSACTION',async()=>{
    const target=pending;
    if(activeWalletRequestId===target?.attemptId)return;
    clearPending(target);quote=null;
    if($('mintDialog').open)$('mintDialog').close();
    notice('The interrupted mint was cleared. Review your wallet activity before starting again.');
  });
  const note=document.createElement('p');note.className='share-hint';
  note.textContent=activeWalletRequestId===pending.attemptId
    ?'Your wallet request is still open. Close or answer it before recovery options become available.'
    :'Only clear this attempt if your wallet shows no submitted mint transaction. If you approved one, keep checking instead.';
  $('mintBody').append(note);
}
function resetMintSteps(text=''){
  const journey=$('mintSteps');journey.textContent=text;journey.removeAttribute?.('role');journey.removeAttribute?.('aria-label');
}
function protectedJourney(step,label){
  const journey=$('mintSteps');journey.replaceChildren();journey.setAttribute('role','list');journey.setAttribute('aria-label',label);
  ['Prepare','Wait','Mint'].forEach((text,index)=>{
    const item=document.createElement('span');item.textContent=text;item.className='mint-journey-step';item.setAttribute('role','listitem');
    const active=step<=1?0:step===2?1:step===3?2:3;
    item.dataset.state=index<active?'done':index===active?'current':'next';
    if(index===active)item.setAttribute('aria-current','step');
    journey.append(item);
  });
}
function protectedPreflight(message='Loading your mint…'){
  $('walletEmbed').hidden=true;
  $('mintDialog').classList.remove('is-success');
  $('mintDialog').classList.add('is-protected');
  openDialog('Let’s bring your friend home');
  $('mintProgress').hidden=false;
  protectedJourney(1,'Preparing your mint');
  const body=$('mintBody');body.dataset.mintScreen='preparing';body.replaceChildren();
  const loader=document.createElement('div');loader.className='protected-loader';loader.setAttribute('aria-hidden','true');
  const status=document.createElement('p');status.className='protected-preflight-status';status.textContent=message;
  body.append(loader,status);
  return status;
}
function progress(stage,title,message){
  openDialog(title);textBody(message);$('mintProgress').hidden=false;
  $('mintProgress').value=stage;$('mintProgress').setAttribute('aria-label',`${stage} of 4 mint steps complete`);
  resetMintSteps(['Finding your friend…','Ready for your wallet','Growing a friendship…','Almost home…','Yours. Forever on-chain.'][stage]);

}
function pendingKey(){return 'myfriends:pending:'+deploymentKey(deployment);}
function savePending(){return storage.setItem(pendingKey(),JSON.stringify(pending));}
function isCurrentPending(target){return Boolean(target&&pending&&(target===pending||(target.attemptId&&target.attemptId===pending.attemptId)));}
function clearPending(target=pending){if(target&&!isCurrentPending(target))return false;storage.removeItem(pendingKey());pending=null;busy=false;emit();return true;}
function cancelPreflight(reason){mintCancellation=reason;mintGeneration++;}
function assertMintGeneration(generation,buyer,provider=walletProvider){
  if(generation===mintGeneration&&provider===walletProvider&&account?.toLowerCase()===buyer.toLowerCase())return;
  const error=Error(mintCancellation==='closed'?'Mint review closed.':'Your wallet changed. Review this mint again.');
  if(mintCancellation==='closed')error.code='MINT_FLOW_CANCELLED';
  throw error;
}
function walletChanged(){
  cancelPreflight('wallet');quote=null;
  if($('mintDialog').open&&$('mintDialog').classList.contains('is-protected')){
    closeProtectedMint?.();busy=false;
    textBody('Your wallet or network changed. Your previous mint progress is saved for the original wallet. Review again before continuing.');
    $('mintDialog').classList.add('is-protected');
    openDialog('Let’s check your wallet');$('mintProgress').hidden=true;resetMintSteps();
    action('REVIEW WITH THIS WALLET',()=>{mintIntent=true;return reviewMint();});
  }
  emit();if($('mintDialog').open)renderMintDetails();
}
const onAccounts=accounts=>{account=accounts?.[0]||null;walletChanged();};
const onChain=id=>{
  walletChain=Number(id);
  if(walletChain===expectedChainChange){expectedChainChange=null;emit();return;}
  expectedChainChange=null;walletChanged();
};
const onDisconnect=()=>{account=null;walletChain=null;walletChanged();};
async function attachProvider(provider,request=false){
  if(provider!==walletProvider)cancelPreflight('wallet');
  if(walletProvider){walletProvider.removeListener?.('accountsChanged',onAccounts);walletProvider.removeListener?.('chainChanged',onChain);walletProvider.removeListener?.('disconnect',onDisconnect);}
  walletProvider=provider;account=null;walletChain=null;expectedChainChange=null;
  if(provider){
    provider.on?.('accountsChanged',onAccounts);provider.on?.('chainChanged',onChain);provider.on?.('disconnect',onDisconnect);
    const [accounts,chain]=await Promise.all([provider.request({method:request?'eth_requestAccounts':'eth_accounts'}),provider.request({method:'eth_chainId'})]);
    account=accounts[0]||null;walletChain=Number(chain);
  }
  emit();
}
async function restoreAuthorizedWallet(preferred){
  const choices=browserWallets().sort((a,b)=>Number(walletChoice(b)===preferred)-Number(walletChoice(a)===preferred));
  for(const choice of choices){
    try{
      const accounts=await choice.provider.request({method:'eth_accounts'});
      if(!accounts?.length)continue;
      await attachProvider(choice.provider);storage.setItem('myfriends:wallet',walletChoice(choice));return true;
    }catch{}
  }
  return false;
}
function queueAuthorizedWallet(preferred){
  if(account){walletChecking=false;emit();return Promise.resolve(true);}
  if(!walletRestorePromise){
    walletChecking=true;emit();
    walletRestorePromise=restoreAuthorizedWallet(preferred).finally(()=>{walletRestorePromise=null;walletChecking=false;emit();});
  }
  return walletRestorePromise;
}
async function finishWalletConnection(){
  if(mintIntent){await reviewMint();return;}
  if($('mintDialog').open)$('mintDialog').close();
  ui.connected();
}
async function loadWalletKit(){
  if(!__WALLET_BUNDLE__)throw Error('Wallet support is not present in this read-only build.');
  if(!kitLoading)kitLoading=import('./wallet-appkit.js').then(({createWalletKit})=>{
    kit=createWalletKit(config,async provider=>{
      walletChecking=true;emit();
      try{
        await attachProvider(provider);
        if(account&&$('mintDialog').open&&!$('walletEmbed').hidden){
          await kit.close();
          await finishWalletConnection();
        }
      }catch(error){showError(error);}
      finally{walletChecking=false;emit();}
    });
    kit.subscribeState(state=>{
      if(!state.open&&walletChecking){walletChecking=false;emit();}
      if(!state.open&&!account&&$('mintDialog').open&&!$('walletEmbed').hidden)connect().catch(showError);
    });
    return kit;
  }).catch(error=>{kitLoading=null;throw error;});
  return kitLoading;
}
function manageWallet(){
  openDialog('Your wallet','wallet');$('mintProgress').hidden=true;resetMintSteps();
  $('walletEmbed').hidden=true;
  $('mintDialog').classList.remove('is-success','is-protected');
  delete $('mintBody').dataset.mintScreen;
  $('mintBody').replaceChildren();
  const walletAddress=document.createElement('p');
  walletAddress.id='walletDialogAddress';
  walletAddress.className='collection-identity wallet-dialog-address';
  walletAddress.textContent=account;
  $('mintTitle').insertAdjacentElement('afterend',walletAddress);
  walletMintPreviews();
  const owned=ui.owned();walletFriendPreviews(owned);
  if(owned.length)action('VIEW MY FRIENDS',async()=>{if($('mintDialog').open)$('mintDialog').close();ui.friends();});
  action('CONNECT ANOTHER WALLET',async()=>{await disconnectWallet(false);await connect();});
  action('DISCONNECT WALLET',async()=>{await disconnectWallet(false);if($('mintDialog').open)$('mintDialog').close();});
}
async function connect(){
  if(!walletEnabled()){ui.notify('Wallet connections and minting are disabled in this read-only preview.');return;}
  if(!config?.deployments.length){showError(Error('The collection is taking a moment to connect. Your friend is saved. Please try again shortly.'));return;}
  if(!mintIntent&&!pending)mintContext=null;
  if(account){
    manageWallet();return;
  }
  walletChecking=true;emit();
  openDialog('One step closer','connect');$('mintProgress').hidden=true;resetMintSteps();
  textBody('Connect your wallet to bring this little friend home.');
  const choices=browserWallets();
  for(const choice of choices)action(choice.info.name||'Browser wallet',async()=>{
    walletChecking=true;emit();
    try{
      await attachProvider(choice.provider,true);storage.setItem('myfriends:wallet',walletChoice(choice));
      await finishWalletConnection();
    }finally{walletChecking=false;emit();}
  });
  if(config.projectId){
    action(choices.length?'More wallets · WalletConnect':'Choose a wallet',async()=>{
      walletChecking=true;emit();
      try{
        storage.setItem('myfriends:appkit-used','yes');const walletKit=await loadWalletKit();
        walletChecking=true;emit();
        await walletKit.open({view:'Connect'});await customElements.whenDefined('w3m-modal');
        if(!$('mintDialog').open){await walletKit.close();return;}
        $('mintBody').replaceChildren();$('walletEmbed').hidden=false;
        if(!$('walletEmbed').firstElementChild){const embedded=document.createElement('w3m-modal');embedded.classList.add('appkit-modal');$('walletEmbed').append(embedded);}
      }catch(error){walletChecking=false;emit();throw error;}
    });
  }else if(!choices.length){
    const p=document.createElement('p');p.textContent='Open this page in your wallet’s browser, or connect using a browser wallet extension.';$('mintBody').append(p);
  }
}
async function disconnectWallet(openFriends=true){
  if(kit)await kit.disconnect();
  const provider=walletProvider;
  if(provider)try{await provider.request({method:'wallet_revokePermissions',params:[{eth_accounts:{}}]});}catch{}
  await attachProvider(null);storage.removeItem('myfriends:wallet');mintIntent=false;if(openFriends)ui.friends();
}
async function ensureNetwork(){
  if(!walletProvider||!account)throw Error('Connect your wallet first.');
  if(Number(await walletProvider.request({method:'eth_chainId'}))!==deployment.chainId){
    expectedChainChange=deployment.chainId;
    try{
      try{await walletProvider.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(deployment.chainId)}]});}
      catch(error){if(Number(error.code)!==4902)throw error;
        await walletProvider.request({method:'wallet_addEthereumChain',params:[{chainId:toQuantity(deployment.chainId),chainName:deployment.networkName,
          rpcUrls:[deployment.rpcUrl],nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},...(deployment.explorerUrl?{blockExplorerUrls:[deployment.explorerUrl]}:{})}]});
      }
    }catch(error){expectedChainChange=null;throw error;}
  }
  walletChain=Number(await walletProvider.request({method:'eth_chainId'}));
  if(walletChain!==deployment.chainId){expectedChainChange=null;throw Error('Switch your wallet to '+deployment.networkName+' to continue.');}
}
async function reviewMint(){
  if(!walletEnabled())throw Error('Minting is unavailable in this read-only preview.');
  if(busy){if(pending)showPendingStatus();else if($('mintBody').dataset.mintScreen!=='preparing')protectedPreflight('Still preparing your mint…');return;}
  if(!reader?.snapshot)throw Error('The forest is taking a moment to connect. Your friend is saved. Try again shortly.');
  if(!account){mintIntent=true;mintContext={genotype:ui.genotype()};await connect();return;}
  const buyer=account,generation=++mintGeneration;mintCancellation='';
  busy=true;emit();const genotype=mintIntent&&mintContext?.genotype?mintContext.genotype:ui.genotype();mintIntent=false;mintContext={genotype:[...genotype],buyer};
  let submitAllowlist=false;
  try{
    const preflightStatus=protectedPreflight('Loading your mint…');
    if(typeof requestAnimationFrame==='function')await new Promise(resolve=>requestAnimationFrame(resolve));
    assertMintGeneration(generation,buyer);
    preflightStatus.textContent='Connecting to your wallet…';
    await ensureNetwork();assertMintGeneration(generation,buyer);
    preflightStatus.textContent='Checking the collection…';
    await reader.verify(true);assertMintGeneration(generation,buyer);
    preflightStatus.textContent='Checking availability…';
    const c=reader.contract,blockTag=await reader.provider.getBlockNumber(),opts={blockTag},phase=await c.salePhase(opts);
    if(phase===SALE_PHASE.PAUSED)throw Error('Minting has not started yet. Your myFriend is saved. Come back when the allowlist opens.');
    const resumeWhilePaused=phase===SALE_PHASE.PUBLIC_PAUSED&&protectedResume?.selections[0].every((v,i)=>v===genotype[i])&&(protectedResume.commitTx||protectedResume.revealTx);
    // Public selections stay local until the protected reveal is mature.
    if(phase===SALE_PHASE.PUBLIC_ACTIVE||resumeWhilePaused){
      assertMintGeneration(generation,buyer);
      // Use already-indexed public mint events, never a pre-maturity trait query.
      const minted=reader.snapshot?.records.find(r=>r.genotype.every((value,index)=>value===genotype[index]));
      if(minted){
        ui.markMinted(genotype);
        if(minted.buyer.toLowerCase()===buyer.toLowerCase()&&minted.owner.toLowerCase()===buyer.toLowerCase()){
          const receipt=await reader.provider.getTransactionReceipt(minted.transactionHash);
          const canonical=receipt&&await reader.provider.getBlock(receipt.blockNumber);
          assertMintGeneration(generation,buyer);
          if(receipt&&canonical?.hash===receipt.blockHash){pending={hash:receipt.hash,state:'submitted',phase:minted.phase,buyer,genotype,tokenId:minted.tokenId,createdAt:Date.now()};await finishReceipt(receipt);return;}
        }
        progress(4,'This friend has found a home','Every combination is unique. This myFriend has already been minted. Choose another look to make a new friend.');
        action('EXPLORE MORE FRIENDS',async()=>{$('mintDialog').close();});
        return;
      }
      preflightStatus.textContent='Almost ready…';
      closeProtectedMint?.();
      const protectedBuyer=buyer,protectedProvider=walletProvider;
      closeProtectedMint=await openProtectedMint({host:$('mintBody'),deployment,provider:reader.provider,buyer,selections:[genotype],counts:TRAIT_COUNTS,
        resumeHint:'You can close this window and continue later.',
        isOpen:()=>generation===mintGeneration&&$('mintDialog').open&&walletProvider===protectedProvider&&account?.toLowerCase()===protectedBuyer.toLowerCase()&&walletChain===deployment.chainId,onBusy:value=>{if(generation===mintGeneration){busy=value;emit();}},
        onStage:({title,step,label})=>{
          $('mintTitle').textContent=title;$('mintProgress').value=step;$('mintProgress').setAttribute('aria-label',label);
          protectedJourney(step,label);
        },
        onSelection:values=>{mintContext={genotype:[...values[0]],buyer:account};ui.paint($('mintPreview'),values[0]);$('mintPreview').dataset.genotype=values[0].join(',');},
        onMintIntent:event=>evidence('intent',{...event,phase:'public',genotype:[...genotype]}),
        onSubmitted:event=>evidence('submitted',{...event,phase:'public'}),
        getSigner:async()=>{if(walletProvider!==protectedProvider||account?.toLowerCase()!==protectedBuyer.toLowerCase())throw Error('Your wallet changed. Review this mint again.');await ensureNetwork();return new BrowserProvider(walletProvider,'any',{cacheTimeout:-1}).getSigner();},
        onComplete:async(receipt,record)=>{
          pending={hash:receipt.hash,state:'submitted',phase:'public',buyer:record.buyer,genotype:record.selections[0],tokenId:'0',evidenceId:record.hash,createdAt:Date.now()};
          mintContext={genotype:[...record.selections[0]],buyer:record.buyer};await finishReceipt(receipt);
        }});
      return;
    }
    if(phase===SALE_PHASE.PUBLIC_PAUSED)throw Error('Public minting is temporarily paused. Existing myFriends are unaffected. Your selection is saved.');
    if(phase!==SALE_PHASE.ALLOWLIST)throw Error('Minting is not available in the current sale phase.');
    const [price,available,allocation,claimed,totalMinted]=await Promise.all([
      c.mintPrice(1,opts),c.isAvailable(...genotype,opts),c.allowlistAllocation(buyer,opts),c.allowlistClaimed(buyer,opts),c.totalMinted(opts)
    ]);
    assertMintGeneration(generation,buyer);
    if(!available){ui.markMinted(genotype);throw Error('This friend has already found a home. Change a trait or discover another available friend.');}
    const allowance=allowlistMessage(allocation,claimed);
    if(allocation<=claimed)throw Error(allowance+' Connect an eligible wallet or wait for public mint.');
    const tokenId=totalMinted+1n;quote={genotype,price,account:buyer,tokenId,salePhase:phase,allowance};
    progress(1,'Opening your wallet',`Mycelium Friend #${tokenId} · ${deployment.networkName}\nAllowlist mint · ${price===0n?'Free':formatEther(price)+' ETH'} + network gas\n${allowance}`);
    submitAllowlist=true;
  }finally{busy=false;emit();}
  if(submitAllowlist)await submitMint(generation);
}
async function submitMint(generation=mintGeneration){
  if(busy)return;
  const q=quote;if(!q || q.account!==account)throw Error('Your wallet changed. Review this mint again.');
  const submissionProvider=walletProvider;
  let attemptId=null,attempt=null;
  busy=true;emit();
  try{
    await ensureNetwork();assertMintGeneration(generation,q.account,submissionProvider);await reader.verify(true);assertMintGeneration(generation,q.account,submissionProvider);
    const provider=new BrowserProvider(walletProvider,'any');
    const [walletCode,walletBlock]=await Promise.all([provider.getCode(deployment.address),provider.getBlock(deployment.deploymentBlock)]);
    if(keccak256(walletCode)!==deployment.codeHash || walletBlock?.hash!==deployment.deploymentHash)throw Error('Your wallet and the collection could not connect on the same network. Reconnect your wallet to continue.');
    const signer=await provider.getSigner();assertMintGeneration(generation,q.account,submissionProvider);
    if((await signer.getAddress()).toLowerCase()!==q.account.toLowerCase())throw Error('Your wallet changed. Review this mint again.');
    const c=new Contract(deployment.address,ABI,signer);
    const [freshPrice,phase,available,totalMinted]=await Promise.all([reader.contract.mintPrice(1),reader.contract.salePhase(),reader.contract.isAvailable(...q.genotype),reader.contract.totalMinted()]);
    assertMintGeneration(generation,q.account,submissionProvider);
    if(phase!==SALE_PHASE.ALLOWLIST || freshPrice!==q.price || phase!==q.salePhase)throw Error('The sale phase or mint details changed since your last look. Review the latest mint details before confirming.');
    if(!available){ui.markMinted(q.genotype);throw Error('This friend has just found a home. Your look is saved. Change a trait or discover another available friend.');}
    await c.mint.staticCall(...q.genotype,{value:q.price});
    const gas=await c.mint.estimateGas(...q.genotype,{value:q.price});
    assertMintGeneration(generation,q.account,submissionProvider);
    progress(1,'Make it yours',`Confirm the mint and network fee in your wallet. Your little friend is ready.\n${q.allowance}`);
    let nonce=null;try{nonce=await provider.getTransactionCount(q.account,'pending');}catch{}
    assertMintGeneration(generation,q.account,submissionProvider);
    attemptId=Date.now().toString(36)+'-'+(++mintAttemptSerial).toString(36);
    const evidenceId=newMintEvidenceId();
    evidence('intent',{evidenceId,wallet:q.account,phase:'allowlist',genotype:[...q.genotype],quantity:1,priceWei:q.price.toString(),maximumWei:q.price.toString()});
    attempt={attemptId,hash:null,state:'requesting',phase:'allowlist',buyer:q.account,genotype:[...q.genotype],tokenId:q.tokenId.toString(),nonce,price:q.price.toString(),evidenceId,createdAt:Date.now()};
    pending=attempt;
    if(!savePending()){pending=null;throw Error('Browser storage is unavailable. Enable site storage before opening your wallet so this mint can be recovered safely.');}
    emit();
    activeWalletRequestId=attemptId;let tx;
    try{tx=await c.mint(...q.genotype,{value:q.price,gasLimit:gas*120n/100n});}
    finally{if(activeWalletRequestId===attemptId)activeWalletRequestId=null;}
    if(!isCurrentPending(attempt))throw Error('This wallet response belongs to an older mint attempt. Check wallet activity before trying again.');
    mintContext={genotype:[...q.genotype],buyer:q.account};
    pending={...attempt,hash:tx.hash,state:'submitted',nonce:tx.nonce};attempt=pending;savePending();
    evidence('submitted',{evidenceId,wallet:q.account,phase:'allowlist',transactionHash:tx.hash});
    progress(2,'Growing your myFriend','Transaction sent. Waiting for confirmation. You can close this window and keep exploring.');emit();
    // The signer tracks same-account replacement / speed-up / cancellation while this page stays open.
    const sentHash=tx.hash;
    tx.wait(1,120_000).then(receipt=>{if(isCurrentPending(attempt)&&pending.hash===sentHash)return finishReceipt(receipt,attempt);}).catch(async error=>{
      if(!isCurrentPending(attempt)||pending.hash!==sentHash)return;
      if(error.code==='TRANSACTION_REPLACED'){
        if(error.cancelled){clearPending(attempt);showError(Error('The transaction was cancelled or replaced in your wallet. Review before minting again.'));}
        else {pending.hash=error.replacement.hash;attempt=pending;savePending();await finishReceipt(error.receipt,attempt);}
      }else if(error.receipt)await finishReceipt(error.receipt,attempt);
      // Timeout / lost connection: keep the hash and let background polling resume it.
    }).catch(()=>{/* Background receipt polling is still active. */});
  }catch(error){
    if(activeWalletRequestId===attemptId)activeWalletRequestId=null;
    const code=error?.code??error?.error?.code,rejected=code===4001||code==='ACTION_REJECTED'||/user rejected|user denied/i.test(error?.message||'');
    if(isCurrentPending(attempt)&&rejected)clearPending(attempt);
    else if(isCurrentPending(attempt)){pending.state='uncertain';pending.updatedAt=Date.now();savePending();notice('The wallet response was interrupted. Checking the chain before another mint is allowed.','error');}
    else{busy=false;emit();}
    throw error;
  }
}
async function finishReceipt(receipt,target=pending){
  if(!isCurrentPending(target))return;
  const transaction={...target};
  // progress() rebuilds the modal body and clears its stage-specific class.
  // Capture the protected journey first so the receipt screen keeps the same frame.
  const protectedReceipt=transaction.phase==='public'||$('mintDialog').classList.contains('is-protected');
  let mintedId=null;try{mintedId=mintReceiptForGenotype(receipt,deployment.address,transaction.buyer,transaction.genotype);}catch{}
  if(mintedId===null){
    clearPending(target);showError(Error('This transaction did not mint the selected myFriend. Check it in your wallet before retrying.'));return;
  }
  transaction.tokenId=mintedId.toString();
  if(transaction.phase==='public'){
    const payment=mintReceiptPayment(receipt,deployment.address,transaction.buyer,mintedId);
    if(payment)transaction.price=payment.quantity===1n?payment.paid.toString():transaction.price;
  }
  if(transaction.evidenceId)evidence('confirmed',{evidenceId:transaction.evidenceId,wallet:transaction.buyer,phase:transaction.phase||'allowlist',transactionHash:receipt.hash||transaction.hash,blockNumber:Number(receipt.blockNumber),tokenId:transaction.tokenId,priceWei:transaction.price||'0'});
  mintContext={...transaction,hash:receipt.hash||transaction.hash};
  ui.confirmed?.({tokenId:transaction.tokenId,genotype:transaction.genotype,owner:transaction.buyer,buyer:transaction.buyer,
    phase:transaction.phase||'allowlist',price:transaction.price||'0',transactionHash:receipt.hash||transaction.hash,blockNumber:Number(receipt.blockNumber)});
  clearPending(target);quote=null;
  progress(4,'Your myFriend is here!',`Mycelium Friend #${transaction.tokenId} is now in your wallet. Welcome to the forest.`);
  if(protectedReceipt){$('mintDialog').classList.add('is-protected');protectedJourney(4,'Mint complete');}
  celebrateMint(transaction.tokenId);
  action('VIEW MY FRIENDS',async()=>{$('mintDialog').close();ui.friends();});
  ui.markMinted(transaction.genotype);ui.fresh();
  // The receipt-backed entry is rendered immediately. The canonical reader stays
  // two blocks behind the head and replaces this temporary entry once confirmed.
  await refresh();
}
function celebrateMint(tokenId){
  $('mintDialog').classList.add('is-success');$('mintArtCaption').textContent='myFriend #'+tokenId+' · Welcome home.';
  const downloads=document.createElement('div');downloads.className='mint-downloads';
  // Capture this receipt's artwork. Changing builder traits cannot alter the download.
  const genotype=[...mintContext.genotype];
  for(const format of ['png','jpeg','svg']){
    const button=document.createElement('button');button.className='chain-action';button.textContent=format.toUpperCase()+' ↓';
    button.onclick=async()=>{button.disabled=true;try{await ui.download(genotype,format,tokenId);}catch{const note=document.createElement('p');note.textContent='Your image is still here. Please try downloading it again.';downloads.after(note);}finally{button.disabled=false;}};downloads.append(button);
  }
  $('mintBody').append(downloads);
  const shareText=xPostText(tokenId),composerURL=xComposerURL(shareText);
  const shareActions=document.createElement('div');shareActions.className='mint-share-actions';
  const imageButton=document.createElement('button');imageButton.type='button';imageButton.className='chain-action';imageButton.id='shareMintImage';imageButton.textContent='Share with image';
  imageButton.onclick=async()=>{imageButton.disabled=true;try{const result=await ui.share(genotype,tokenId,shareText);ui.notify(result==='copied'?'Image copied. Paste it into the X composer, in this or another browser.':result==='downloaded'?'Image downloaded. Add it to your X post.':'Share sheet opened with your image.');}catch(error){if(error?.name!=='AbortError')ui.notify('Image sharing is unavailable. Download the PNG instead.');}finally{imageButton.disabled=false;}};
  const copyButton=document.createElement('button');copyButton.type='button';copyButton.className='chain-action';copyButton.id='copyMintLink';copyButton.textContent='Copy X post link';
  copyButton.onclick=async()=>{try{await navigator.clipboard.writeText(composerURL);copyButton.textContent='X post link copied ✓';ui.notify('X composer link copied. Paste it into the browser where you are signed in.');}catch{ui.notify('Could not copy the X composer link. Use Open X Composer instead.');}};
  shareActions.append(imageButton,copyButton);$('mintBody').append(shareActions);
  const share=document.createElement('a');share.className='chain-action share-mint';share.id='shareMint';
  share.href=composerURL;
  share.target='_blank';share.rel='noopener noreferrer';share.textContent='Open X Composer ↗';$('mintBody').append(share);
  const hint=document.createElement('p');hint.className='share-hint';hint.textContent='The X composer contains a link with your myFriend preview. On supported devices, Share with image also attaches the artwork; on desktop it copies or downloads the image for you to paste.';$('mintBody').append(hint);
  clearTimeout(celebrationTimer);$('mintCelebration').replaceChildren();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    for(let i=0;i<48;i++){const piece=document.createElement('i');piece.style.cssText='--x:'+Math.random()*100+'%;--drift:'+(Math.random()-.5)*240+'px;--delay:'+Math.random()*.8+'s;--turn:'+Math.random()*720+'deg;--color:'+['#8cf8ee','#b99aff','#f9d78d','#ff98c8'][i%4];$('mintCelebration').append(piece);}
    celebrationTimer=setTimeout(()=>$('mintCelebration').replaceChildren(),4500);
  }
}
async function checkPending(){
  if(!pending || receiptChecking)return;const target=pending;receiptChecking=true;
  try{
    if(!target.hash){
      await refresh();
      if(!isCurrentPending(target))return;
      const minted=reader.snapshot?.records.find(r=>r.buyer.toLowerCase()===target.buyer.toLowerCase()&&target.genotype?.length===6&&r.genotype.every((value,i)=>value===target.genotype[i]));
      if(minted){const recovered=await reader.provider.getTransactionReceipt(minted.transactionHash);if(recovered&&isCurrentPending(target))await finishReceipt(recovered,target);return;}
      if(Number.isSafeInteger(target.nonce)&&ready&&await reader.provider.getTransactionCount(target.buyer,reader.snapshot.blockNumber)>target.nonce){
        if(!isCurrentPending(target))return;
        clearPending(target);showError(Error('Your wallet used or cancelled this transaction request. No matching myFriend was minted. Review before trying again.'));return;
      }
      if(isCurrentPending(target))notice('Checking whether your wallet sent this mint. No second mint will be requested.');return;
    }
    const receipt=await reader.provider.getTransactionReceipt(target.hash);if(!isCurrentPending(target))return;
    if(receipt)await finishReceipt(receipt,target);
    else if(Number.isSafeInteger(target.nonce) && await reader.provider.getTransactionCount(target.buyer,'latest')>target.nonce){
      if(!isCurrentPending(target))return;
      // A replacement can be detected after a reload without scanning arbitrary blocks.
      // The unique token's mint event is the authoritative success check.
      await refresh();
      if(!isCurrentPending(target))return;
      const minted=reader.snapshot?.records.find(r=>r.buyer.toLowerCase()===target.buyer.toLowerCase()&&target.genotype?.length===6&&r.genotype.every((value,i)=>value===target.genotype[i]));
      if(minted){const replacement=await reader.provider.getTransactionReceipt(minted.transactionHash);if(replacement&&isCurrentPending(target))await finishReceipt(replacement,target);}
      else {notice('Your wallet replaced this transaction. Waiting for confirmed history before allowing another mint.');
        if(ready && await reader.provider.getTransactionCount(target.buyer,reader.snapshot.blockNumber)>target.nonce){
          if(!isCurrentPending(target))return;
          clearPending(target);showError(Error('Your transaction was replaced or cancelled. No matching myFriend was minted. Review before trying again.'));}}
    }else if(Date.now()-target.createdAt>180_000&&isCurrentPending(target))notice('Mint still pending. Check your wallet for a speed-up or cancellation. No second mint will be sent.');
  }catch{/* Preserve pending transaction through RPC failure. */}finally{receiptChecking=false;}
}
async function refresh(){
  if(refreshing===reader||!reader)return;const active=reader;refreshing=active;$('chainStatus').dataset.ready='false';
  try{
    await active.refresh((current,end)=>{if(reader===active&&!ready)notice('Finding your friends in the forest…');});
    if(reader!==active)return;
    ready=true;
    const phaseLabel=['Minting not started','Allowlist mint open','Public mint open','Public mint paused'][reader.snapshot.salePhase]||'Minting unavailable';
    notice(`${reader.snapshot.total} myFriends have found a home · ${phaseLabel}`);$('chainStatus').dataset.ready='true';
  }catch(error){if(reader!==active)return;ready=false;$('chainStatus').dataset.ready='false';notice((reader.snapshot?'Saved myFriends · Connection interrupted. ':'')+friendlyError(error),'error');}
  finally{if(reader===active){refreshing=false;emit();}}
}
async function seedFromSnapshotApi(active,deployment,replace=false){
  const snapshotUrl=deployment.snapshotUrl;
  if(!snapshotUrl)return false;
  return fetchAndSeedSnapshot(active,snapshotUrl,{replace});
}
function snapshotRetryDelay(error){
  if(Number.isFinite(error?.retryAfterMs))return error.retryAfterMs;
  return Math.min(60_000,2_000*2**Math.min(snapshotSeedFailures,5));
}
async function seedMissingSnapshot(active=reader,{force=false}={}){
  if(!active||active!==reader||(!force&&active.snapshot)||!active.deployment.snapshotUrl)return false;
  if(!force&&Date.now()<snapshotRetryAt)return false;
  if(snapshotSeeding?.reader===active)return snapshotSeeding.promise;
  const promise=seedFromSnapshotApi(active,active.deployment,force).then(seeded=>{
    snapshotSeedFailures=0;snapshotRetryAt=0;
    if(seeded&&reader===active){emit();notice('Showing recent myFriends · Verifying with '+active.deployment.networkName+'…');}
    return seeded;
  }).catch(error=>{
    snapshotSeedFailures++;snapshotRetryAt=Date.now()+snapshotRetryDelay(error);throw error;
  }).finally(()=>{if(snapshotSeeding?.promise===promise)snapshotSeeding=null;});
  snapshotSeeding={reader:active,promise};return promise;
}
async function recoverAndRefresh({forceSnapshot=false}={}){
  const active=reader;if(!active)return;
  if(!active.snapshot||forceSnapshot){try{await seedMissingSnapshot(active,{force:forceSnapshot});}catch{/* Refresh reports the safe user-facing state below. */}}
  if(reader!==active)return;
  await refresh();
  if(reader===active&&!active.snapshot){
    try{await seedMissingSnapshot(active,{force:forceSnapshot});}catch{return;}
    if(reader===active&&active.snapshot)await refresh();
  }
}
async function refreshMinterProfiles(active=reader,{force=false}={}){
  if(!active||active!==reader||!active.deployment.profilesUrl)return false;
  expireMinterProfiles();
  if(!force&&Date.now()-profilesLoadedAt<300_000)return false;
  if(profilesLoading?.reader===active)return profilesLoading.promise;
  const promise=fetchMinterProfiles(active.deployment.profilesUrl).then(result=>{
    if(reader!==active)return false;
    minterProfiles=result.profiles;profilesLoadedAt=Date.now();profilesExpireAt=result.expiresAt;scheduleMinterProfileExpiry();emit();return true;
  }).catch(()=>{
    if(reader===active&&profilesLoadedAt&&Date.now()>=profilesExpireAt){minterProfiles=Object.create(null);profilesLoadedAt=0;profilesExpireAt=0;emit();}
    return false;
  }).finally(()=>{if(profilesLoading?.promise===promise)profilesLoading=null;});
  profilesLoading={reader:active,promise};return promise;
}
async function selectDeployment(id){
  if(busy)return;
  clearTimeout(pollTimer);reader?.destroy();ready=false;quote=null;busy=false;
  snapshotSeeding=null;snapshotSeedFailures=0;snapshotRetryAt=0;
  clearTimeout(profilesExpiryTimer);profilesExpiryTimer=null;
  minterProfiles=Object.create(null);profilesLoading=null;profilesLoadedAt=0;profilesExpireAt=0;
  deployment=config.deployments.find(d=>d.id===id);if(!deployment)throw Error('Unknown deployment.');
  reader=new ChainReader(deployment,__CATALOG_HASH__,undefined,__GENOTYPE_SPACE__,TRAIT_COUNTS);
  const active=reader;
  $('deploymentSelect').value=id;mintContext=null;$('chainStatus').dataset.ready='false';storage.setItem('myfriends:deployment',id);
  pending=null;
  try{
    const p=JSON.parse(storage.getItem(pendingKey()));
    const validNonce=p?.nonce===null||p?.nonce===undefined||(Number.isSafeInteger(p.nonce)&&p.nonce>=0);
    const validAttempt=p?.attemptId===undefined||typeof p.attemptId==='string'&&/^[a-z0-9-]{1,80}$/i.test(p.attemptId);
    if(p && (p.hash===null||/^0x[\da-f]{64}$/i.test(p.hash)) && /^\d+$/.test(p.tokenId)&&/^0x[\da-f]{40}$/i.test(p.buyer)&&
      Array.isArray(p.genotype)&&p.genotype.length===6&&p.genotype.every((value,index)=>Number.isSafeInteger(value)&&value>=0&&value<TRAIT_COUNTS[index])&&
      validNonce&&validAttempt&&['requesting','submitted','uncertain',undefined].includes(p.state)&&['allowlist','public',undefined].includes(p.phase)){
      pending=p;mintContext=p;busy=true;
    }
  }catch{}
  emit();notice(reader.snapshot?'Showing saved myFriends · Checking the network…':'Connecting to '+deployment.networkName+'…');
  refreshMinterProfiles(active,{force:true});
  try{await seedMissingSnapshot(active,{force:true});}catch{/* The pinned RPC remains the source of truth and recovery continues below. */}
  if(reader!==active)return;
  refresh().then(async()=>{if(reader===active)await checkPending();}).finally(()=>{if(reader===active)schedule();});
}
function schedule(){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{
  if(!document.hidden){await Promise.all([recoverAndRefresh(),refreshMinterProfiles()]);await checkPending();}schedule();
},pending?4000:reader&&!reader.snapshot?Math.max(1_000,snapshotRetryAt-Date.now()):45000);}
$('wallet').onclick=()=>connect().catch(showError);
$('closeMint').onclick=()=>$('mintDialog').close();
$('mintDialog').addEventListener('close',()=>{if(!pending){cancelPreflight('closed');if($('mintDialog').classList.contains('is-protected')){busy=false;emit();}}closeProtectedMint?.();mintIntent=false;mintContext=null;kit?.close();if(!account&&walletChecking){walletChecking=false;emit();}clearTimeout(celebrationTimer);$('mintCelebration').replaceChildren();});
$('retryChain').onclick=()=>recoverAndRefresh({forceSnapshot:true});
$('deploymentSelect').onchange=event=>selectDeployment(event.target.value).catch(showError);
window.addEventListener('myfriends:mint',()=>reviewMint().catch(showError));
window.addEventListener('myfriends:disconnect',()=>disconnectWallet().catch(showError));
document.addEventListener('visibilitychange',()=>{if(!document.hidden){expireMinterProfiles();recoverAndRefresh();refreshMinterProfiles(reader,{force:true});checkPending();}});
window.addEventListener('online',()=>recoverAndRefresh({forceSnapshot:true}));
async function start(){
  const response=await fetch(__CHAIN_CONFIG_PATH__,{cache:'no-store'});if(!response.ok)throw Error('Unable to load collection configuration.');
  config=await response.json();if(config.version!==1 || !Array.isArray(config.deployments))throw Error('Invalid collection configuration.');
  config.mode??='wallet';if(!['read-only','wallet'].includes(config.mode))throw Error('Invalid site mode.');
  if(config.projectId && !/^[a-f0-9]{32}$/i.test(config.projectId))throw Error('Invalid Reown Project ID.');
  if(config.mode==='read-only'&&(config.projectId||config.walletMetadata))throw Error('Read-only configuration cannot enable wallet settings.');
  config.deployments.forEach(validateDeployment);
  if(!config.deployments.length){walletChecking=false;notice('The forest is taking a moment to connect. Explore the traits and try again shortly.');emit();return;}
  for(const d of config.deployments){const option=document.createElement('option');option.value=d.id;option.textContent=d.networkName+(config.deployments.filter(item=>item.chainId===d.chainId).length>1?' · Collection '+(config.deployments.indexOf(d)+1):'');$('deploymentSelect').append(option);}
  const saved=storage.getItem('myfriends:deployment');
  const selection=selectDeployment(config.deployments.some(d=>d.id===saved)?saved:config.activeDeployment);
  if(!walletEnabled()){walletRestoreReady=false;await selection;walletChecking=false;emit();return;}
  const selected=storage.getItem('myfriends:wallet');
  storage.removeItem('myfriends:wallet-dismissed');walletRestoreReady=true;
  const walletRestore=queueAuthorizedWallet(selected);
  await selection;
  // Restore AppKit when it was used. A direct browser-wallet choice also survives reload.
  if(config.projectId&&storage.getItem('myfriends:appkit-used')==='yes')await loadWalletKit();
  await walletRestore;walletChecking=false;emit();
}
window.myFriendsWeb3Ready=start().catch(error=>{walletChecking=false;notice(friendlyError(error),'error');emit();});
