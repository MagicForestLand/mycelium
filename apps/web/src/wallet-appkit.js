import {createAppKit} from '@reown/appkit';
import {EthersAdapter} from '@reown/appkit-adapter-ethers';
export function createWalletKit(config,onProvider) {
  const chains=[...new Map(config.deployments.map(d=>[d.chainId,{
    id:d.chainId,name:d.networkName,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
    rpcUrls:{default:{http:[d.rpcUrl]}},testnet:d.chainId!==1,
    ...(d.explorerUrl?{blockExplorers:{default:{name:'Explorer',url:d.explorerUrl}}}:{})
  }])).values()];
  const kit=createAppKit({adapters:[new EthersAdapter()],networks:chains,projectId:config.projectId,
    metadata:config.walletMetadata||{name:'mycelium Friends',description:'myFriends by Magic Forest',url:location.origin,icons:[location.origin+'/output/branding/avatar.svg']},
    themeMode:'dark',themeVariables:{'--w3m-accent':'#79f7ff','--w3m-border-radius-master':'2px','--w3m-color-mix':'#0b162a','--w3m-color-mix-strength':15,'--w3m-font-family':'Inter, -apple-system, sans-serif'},
    enableEmbedded:true,
    features:{analytics:false,email:false,socials:false,swaps:false,onramp:false},enableWalletConnect:true});
  kit.subscribeProviders(providers=>onProvider(providers.eip155||null));
  return kit;
}
