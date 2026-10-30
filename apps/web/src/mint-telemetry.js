const queues=new Map()

function checkedEndpoint(value){
  if(!value)return null
  const url=new URL(value,globalThis.location?.href)
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname)
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null
  return url.href
}

function checkedEvent(event){
  if(!event||!['intent','submitted','confirmed'].includes(event.stage))return null
  if(!/^[A-Za-z0-9:_-]{8,128}$/.test(event.evidenceId||''))return null
  return event
}

export function newMintEvidenceId(randomUUID=globalThis.crypto?.randomUUID?.bind(globalThis.crypto)){
  if(typeof randomUUID==='function')return randomUUID()
  return `mint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// Evidence collection is deliberately invisible to the mint UI. Calls are
// serialized per mint, never include an IP/country supplied by the browser,
// and never prevent a wallet transaction when the reporting API is offline.
export function emitMintEvidence(endpoint,event,{fetchImpl=globalThis.fetch}={}){
  const url=checkedEndpoint(endpoint),body=checkedEvent(event)
  if(!url||!body||typeof fetchImpl!=='function')return Promise.resolve(false)
  const previous=queues.get(body.evidenceId)||Promise.resolve()
  const current=previous.catch(()=>{}).then(async()=>{
    const response=await fetchImpl(url,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
      credentials:'omit',
      keepalive:true
    })
    return response.ok
  }).catch(()=>false).finally(()=>{if(queues.get(body.evidenceId)===current)queues.delete(body.evidenceId)})
  queues.set(body.evidenceId,current)
  return current
}
