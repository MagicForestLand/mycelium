import {formatEther} from 'ethers'
import {IntentStore,createIntent,rememberMint,lastMint,MAX_BUFFER,MINT_PROTOCOL} from './mint-protection.js'
import {ProtectedMintFlow} from './protected-mint-flow.js'

// The UI only sends transactions after an explicit click. Polls are read-only.
export async function openProtectedMint({host,deployment,provider,buyer,selections,counts,getSigner,onBusy=()=>{},onComplete=()=>{},onMintIntent=()=>{},onSubmitted=()=>{},onSelection=()=>{},onStage=()=>{},isOpen=()=>true,resumeHint='You can close this window and continue later.',storage=globalThis.localStorage}){
  if(deployment.mintProtocol!==MINT_PROTOCOL)throw Error('Select a collection with protected public mint.')
  const domain={chainId:deployment.chainId,collection:deployment.address,buyer,deploymentHash:deployment.deploymentHash,codeHash:deployment.codeHash}
  const store=new IntentStore(storage,domain,counts)
  const same=r=>JSON.stringify(r.selections)===JSON.stringify(selections)
  const all=store.list()
  // Retain a completed receipt when the same selection is reopened.
  const latest=lastMint(store)
  let record=latest&&same(latest)?latest:all.filter(same).filter(r=>r.state!=='expired').at(-1)
  if(!record)record=store.save(createIntent(domain,selections,counts,{exposed:all.some(r=>same(r)&&r.exposed)}))
  let flow,timer,poll,assistTimer,closed=false,rendering=false,working=false,screen='',notice='',waitingKey='',pendingKey='',blocked='',retryWallet=false
  const alive=()=>!closed&&isOpen()
  const node=(tag,text,parent=host,cls='')=>{
    const el=document.createElement(tag)
    if(text)el.textContent=text
    if(cls)el.className=cls
    parent.append(el)
    return el
  }
  const note=(text,parent=host,cls='')=>node('p',text,parent,cls)
  const begin=(name,title,step,label)=>{
    screen=name
    clearInterval(timer)
    clearTimeout(assistTimer)
    host.replaceChildren()
    host.dataset.mintScreen=name
    onStage({title,step,label})
    if(notice)note(notice,host,'protected-notice')
  }
  function controls(){
    const busy=working||flow?.active||false
    onBusy(busy)
    host.querySelectorAll('button,input').forEach(el=>{el.disabled=busy})
    host.setAttribute('aria-busy',String(busy))
  }
  function button(label,run,parent=host,secondary=false){
    const b=node('button',label,parent,'chain-action dialog-action'+(secondary?' protected-secondary':parent===host?' protected-primary':''))
    b.type='button'
    b.onclick=async()=>{
      if(working||flow.active||!alive())return
      working=true
      notice=''
      retryWallet=false
      controls()
      try{await run()}
      catch(error){
        if(!alive())return
        retryWallet=error?.code==='ACTION_REJECTED'||error?.code===4001
        if(error?.code==='CombinationAlreadyMinted')blocked='This myFriend has already found a home. Every combination can only be minted once. Choose another look to meet a new friend.'
        if(error?.code==='SoldOut')blocked='Every myFriend has found a home. You can still explore the collection.'
        notice=error?.code==='ACTION_REJECTED'||error?.code===4001
          ?'You cancelled in your wallet. That’s OK — try again whenever you’re ready.'
          :error?.code==='INSUFFICIENT_FUNDS'
          ?'Add enough ETH to this wallet for the mint and network gas, then try again. Your progress is saved.'
          :error?.code===-32002
          ?'A request is already open in your wallet. Open your wallet to continue.'
          :error?.code==='PublicSaleNotOpen'||/minting is not active|minting is temporarily/.test(error?.message||'')
          ?'Public minting is paused right now. Your look is saved. You can return when it resumes.'
          :['PriceAboveMaximum','MintDeadlineExpired'].includes(error?.code)||/price exceeds your maximum|quote deadline/.test(error?.message||'')
          ?'The price or timing changed. Please review the updated price below before trying again. No new transaction was requested.'
          :'This step could not finish. Your progress is saved. Check your wallet, then try again.'
        if(blocked)notice=''
      }
      finally{
        working=false
        if(alive()){
          try{await show()}catch{offline()}
          controls()
        }
      }
    }
    return b
  }
  function use(r){
    blocked=''
    rememberMint(store,r)
    onSelection(r.selections)
    flow=new ProtectedMintFlow({deployment,provider,store,record:r,getSigner,isCurrent:alive,onChange:controls})
  }
  use(record)
  function transactionLink(hash,parent=host){
    if(!hash||!deployment.explorerUrl)return
    const link=node('a','View transaction ↗',parent,'protected-tx-link')
    link.href=`${deployment.explorerUrl}/tx/${hash}`
    link.target='_blank'
    link.rel='noopener noreferrer'
  }
  function extras(){
    note(resumeHint,host,'protected-saved')
    const details=node('details',null,host,'protected-options')
    node('summary','Help & details',details)
    if(screen.startsWith('unknown-')){
      const phase=screen.slice('unknown-'.length)
      const help=node('details',null,details,'protected-options')
      node('summary','Wallet still not responding?',help)
      note('Check your wallet activity. If it shows a transaction, paste its hash below to reconnect it.',help)
      const input=node('input',null,help,'protected-hash')
      input.placeholder='Transaction hash'
      input.setAttribute('aria-label','Recovery transaction hash')
      button('Find transaction',()=>flow.attachTransaction(input.value.trim(),phase),help,true)
      const label=node('label',null,help,'protected-unsent')
      const ack=node('input',null,label)
      ack.type='checkbox'
      label.append(document.createTextNode(' I closed the wallet request and checked that it was never signed or sent.'))
      button('Return to review',async()=>{if(ack.checked)await flow.confirmNotSent(phase)},help,true)
    }
    note(`${deployment.networkName||'Ethereum'} · Two wallet confirmations, with a network fee for each. The first prepares your mint. The second creates your NFT.`,details)
    note('The one-minute pause makes it harder for bots to copy your choice and mint ahead of you. It does not reserve the mushroom. Finish within 24 hours of preparation, using this browser and wallet. Don’t clear site data before finishing.',details)
    note('The price rises with each public mint. Your price limit is optional: leave it at the current price or allow a few mints ahead. Unused ETH is returned in the same transaction. Network fees are separate.',details)
    const explorerLinks=node('div',null,details,'protected-explorer-links')
    transactionLink(flow.record.revealTx?.hash||flow.record.commitTx?.hash,explorerLinks)
    if(deployment.explorerUrl){
      const link=node('a','Collection contract ↗',explorerLinks,'protected-contract-link')
      link.href=`${deployment.explorerUrl}/address/${deployment.address}`
      link.target='_blank'
      link.rel='noopener noreferrer'
    }
    const saved=store.list().filter(r=>r.hash!==flow.record.hash&&!['minted','expired'].includes(r.state))
    if(saved.length){
      const other=node('details',null,details,'protected-options')
      node('summary','Other saved mints',other)
      note('Choose a saved look to preview it and continue where you left off. This does not send a transaction.',other)
      saved.forEach((r,index)=>button(`Continue saved look ${index+1}`,async()=>use(r),other,true))
    }
    const backup=node('details',null,details,'protected-options')
    node('summary','Continue on another device',backup)
    note('Optional. Stay in this browser and there is nothing to download. A transfer file lets you continue with the same wallet on another device. Keep the file private until your mint is complete. It is not a wallet key.',backup)
    const save=node('button','Save transfer file',backup,'chain-action protected-secondary')
    save.type='button'
    save.onclick=()=>{
      if(working||flow.active||!alive())return
      const url=URL.createObjectURL(new Blob([JSON.stringify(flow.record,null,2)],{type:'application/json'}))
      const a=document.createElement('a')
      a.href=url
      a.download='myfriend-mint-progress.json'
      a.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
    }
    const file=node('input',null,backup)
    file.type='file'
    file.accept='.json,application/json'
    file.hidden=true
    file.setAttribute('aria-label','Import mint progress')
    // Opening a file picker does not change or refresh the current mint review.
    const load=node('button','Load transfer file',backup,'chain-action protected-secondary')
    load.type='button'
    load.onclick=()=>{if(!working&&!flow.active)file.click()}
    file.onchange=async()=>{
      if(working||flow.active||!alive())return
      working=true
      controls()
      try{
        if(!file.files[0]||file.files[0].size>32768)throw Error()
        const text=await file.files[0].text()
        if(!alive())return
        use(store.import(text))
      }catch{notice='This file does not match the connected wallet and collection.'}
      finally{working=false;if(alive()){await show().catch(offline);controls()}}
    }
  }
  function quoteView(q){
    begin('ready','Ready to bring your myFriend home?',3,'Final step · Mint your myFriend')
    const card=node('section',null,host,'protected-price-card')
    const totals=node('div',null,card,'protected-price-totals')
    const current=node('div',null,totals,'protected-price-row')
    node('span','CURRENT PRICE',current)
    node('strong',q.price===0n?'FREE':`${formatEther(q.price)} ETH`,current)
    const maximum=node('div',null,totals,'protected-price-row protected-maximum')
    node('span','MAX YOU AUTHORIZE',maximum)
    const amount=node('strong',null,maximum)
    node('h3','PRICE BUFFER · OPTIONAL',card,'protected-buffer-title')
    note('High demand can move the price before your mint is confirmed. Add a buffer to reduce the chance of having to review and try again.',card,'protected-buffer-intro')
    const label=node('label','Protect against price increases from',card,'protected-buffer-label')
    label.htmlFor='mintPriceFlexibility'
    const choice=node('div',null,card,'protected-buffer-choice')
    const count=node('span',null,choice)
    const selected=node('output',null,choice)
    selected.htmlFor='mintPriceFlexibility'
    const range=node('input',null,card,'protected-range')
    range.id='mintPriceFlexibility'
    range.type='range'
    range.min='0'
    range.max=String(q.remaining<BigInt(MAX_BUFFER)?q.remaining:MAX_BUFFER)
    range.step='1'
    range.value=String(q.buffer)
    range.setAttribute('aria-label','Price buffer in NFT mints ahead')
    const ticks=node('div',null,card,'protected-range-ticks')
    ticks.setAttribute('aria-hidden','true')
    for(let step=0;step<=Number(range.max);step++)node('span',String(step),ticks)
    const refund=node('div',null,card,'protected-buffer-refund')
    node('span','You only pay the final mint price.',refund)
    node('strong','Any unused buffer is refunded automatically.',refund)
    node('span','Network fee is separate.',refund,'protected-network-fee')
    function update(){
      amount.textContent=`${formatEther(q.maximum)} ETH`
      count.textContent=`${q.buffer} earlier mint${q.buffer===1?'':'s'}`
      selected.textContent=q.buffer===0?'NO BUFFER':`+${formatEther(q.maximum-q.price)} ETH BUFFER`
      range.setAttribute('aria-valuetext',`${count.textContent}. ${selected.textContent}. Maximum authorized ${formatEther(q.maximum)} ETH plus gas`)
      range.style.setProperty('--range-progress',`${Number(range.max)?q.buffer/Number(range.max)*100:0}%`)
    }
    range.oninput=()=>{
      if(working||flow.active||!alive())return
      try{q=flow.setBuffer(Number(range.value));update()}
      catch{range.value=String(q.buffer);update()}
    }
    range.onchange=range.oninput
    update()
    const mintButton=button(retryWallet?'TRY WALLET AGAIN':'MINT MYFRIEND',async()=>{
      begin('signing-reveal','Confirm your purchase',3,'Final step · Check your wallet')
      node('div',null,host,'protected-loader').setAttribute('aria-hidden','true')
      note(`Your wallet will ask for up to ${formatEther(q.maximum)} ETH plus its network fee.`)
      note('Your friend is yours once this transaction confirms.',host,'protected-footnote')
      walletHint()
      try{onMintIntent({evidenceId:record.hash,wallet:record.buyer,quantity:q.quantity,priceWei:String(q.price),maximumWei:String(q.maximum)})}catch{}
      const tx=await flow.sendReveal(q)
      try{onSubmitted({evidenceId:record.hash,wallet:record.buyer,transactionHash:tx.hash})}catch{}
    })
    mintButton.dataset.mintAction='reveal'
    extras()
  }
  function walletHint(){
    note('Open your wallet to approve or cancel. We won’t ask twice while it is open.',host,'protected-footnote')
    assistTimer=setTimeout(()=>{
      if(!alive())return
      note('Wallet not appearing? Open its extension or app. You can close this window and use Continue mint to check your progress.',host,'protected-notice')
    },12000)
  }
  function checkButton(label='CHECK PROGRESS'){
    const b=button(label,async()=>{}) // only show()/sync(); never signs or sends
    b.dataset.mintAction='check'
    return b
  }
  async function show(){
    if(!alive()||rendering)return
    rendering=true
    try{
      const status=await flow.sync(message=>{
        const preflight=host.querySelector('.protected-preflight-status')
        if(preflight)preflight.textContent=message
      })
      if(!alive())return
      if(status.state==='minted'){
        begin('minted','Your myFriend is here!',4,'Welcome to the forest')
        note('Your myFriend is now in your wallet.')
        clearInterval(poll)
        onBusy(false)
        // Completion failures must not return a successful NFT to the mint form.
        try{await onComplete(status.receipt,flow.record)}
        catch{transactionLink(status.receipt.hash);note('Your mint is confirmed. Reopen My Friends to view it.')}
        closed=true
        return
      }
      if(blocked){
        begin('unavailable','This friend has found a home',3,'No new mint was sent')
        note(blocked)
        button('EXPLORE MORE FRIENDS',async()=>host.closest('dialog')?.close())
        return
      }
      if(status.state==='ready'){
        let q
        try{q=await flow.review(0)}catch(error){
          if(!/temporarily unavailable/.test(error?.message||''))throw error
          begin('paused','We’ll be back soon',2,'Public minting is paused')
          note('Your look and progress are saved. Return when public minting resumes.')
          button('CHECK AGAIN',async()=>{})
          extras()
          return
        }
        if(alive())quoteView(q)
        return
      }
      if(status.state==='missing'){
        begin('start','Let’s bring your friend home',1,'First step · Prepare')
        note('First, a small step to help stop bots copying your mint. Then a one-minute pause before you buy.')
        note('Now: network fee only. You’ll review the mint price afterwards.',host,'protected-fee-note')
        const startButton=button(retryWallet?'TRY WALLET AGAIN':'PREPARE MY MINT',async()=>{
          begin('signing-commit','A quick check in your wallet',1,'First step · Check your wallet')
          node('div',null,host,'protected-loader').setAttribute('aria-hidden','true')
          note('Approve the preparation. This is not the purchase — just the network fee.')
          walletHint()
          await flow.sendCommit()
        })
        startButton.dataset.mintAction='commit'
      }else if(status.state==='waiting'){
        const key=String(status.timestamp)
        if(screen==='waiting'&&waitingKey===key&&!notice)return
        waitingKey=key
        begin('waiting','A little time to grow',2,'Preparation confirmed · Waiting for Ethereum')
        const clock=node('div',null,host,'protected-countdown')
        const value=node('strong',String(status.remaining),clock)
        node('span','SECONDS',clock)
        note('Preparation done. This short pause helps stop bots copying your mint.')
        const hint=note('Next: review the price and confirm your purchase.',host,'protected-footnote')
        const next=checkButton('CONTINUE')
        next.hidden=true
        const until=Date.now()+status.remaining*1000
        timer=setInterval(()=>{
          if(!alive()){clearInterval(timer);return}
          const remaining=Math.max(0,Math.ceil((until-Date.now())/1000))
          value.textContent=String(remaining)
          if(!remaining){hint.textContent='We’re checking automatically. You can also tap Continue.';next.hidden=false}
        },1000)
      }else if(status.state==='expired'){
        begin('expired','Ready when you are',1,'Your previous preparation has expired')
        note('Preparations last 24 hours. Your look is saved. Start again when you are ready to mint.')
        button('START AGAIN',async()=>use(store.save(createIntent(domain,flow.record.selections,counts,{exposed:flow.record.exposed}))))
      }else{
        const reveal=status.phase==='reveal'
        const key=`${status.phase}:${flow.record[status.phase+'Tx']?.hash}`
        if(screen===`${status.state}-${status.phase}`&&pendingKey===key&&!notice)return
        pendingKey=key
        if(status.state==='unknown')notice=''
        begin(`${status.state}-${status.phase}`,status.state==='unknown'?'Let’s check your wallet':reveal?'Your purchase is on its way':'Your first step is on its way',reveal?3:1,reveal?'Final step · Waiting for confirmation':'First step · Waiting for confirmation')
        node('div',null,host,'protected-loader').setAttribute('aria-hidden','true')
        note(status.state==='unknown'?'Your wallet hasn’t given us a clear answer yet. Let’s check before trying again.':reveal?'You’ve submitted your purchase. We’re waiting for Ethereum to confirm it. No more wallet steps.':'You’ve submitted the preparation. Once it confirms, the one-minute clock will start.')
        note('This page updates automatically. Checking again never sends another transaction.',host,'protected-footnote')
        checkButton()
      }
      extras()
    }finally{rendering=false}
  }
  function offline(){
    if(!alive())return
    begin('offline','Let’s check where we are',1,'Reconnecting to Ethereum')
    note('We couldn’t read the latest status. Your progress is saved. We’ll keep checking automatically.')
    checkButton('CHECK AGAIN')
    extras()
  }
  try{await show()}catch{offline()}
  poll=setInterval(async()=>{
    if(!alive()){clearInterval(poll);clearInterval(timer);return}
    if(working||flow.active||rendering||!['waiting','pending-commit','pending-reveal','unknown-commit','unknown-reveal','offline'].includes(screen))return
    try{await show()}catch{offline()}
  },4000)
  return ()=>{closed=true;clearInterval(poll);clearInterval(timer);clearTimeout(assistTimer)}
}
