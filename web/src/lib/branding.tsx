import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
export type Branding={name:string;domain:string;logoUrl:string;faviconUrl:string};
const defaults:Branding={name:'LiveKit Console',domain:'',logoUrl:'/brand.svg',faviconUrl:'/brand.svg'};
export function useBranding(){
 const query=useQuery<Branding>({queryKey:['branding'],queryFn:async()=>{const r=await fetch('/branding.json');if(!r.ok)throw new Error('Branding unavailable');return r.json();},staleTime:Infinity,retry:false});
 const brand=query.data??defaults;
 useEffect(()=>{
  if(!query.data)return;
  document.title=brand.name;
  let icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.append(icon);}
  icon.href=brand.faviconUrl;
 },[query.data,brand.name,brand.faviconUrl]);
 return {...brand,domain:brand.domain||window.location.host};
}
