export type Branding = {name:string;domain:string;logoUrl:string;faviconUrl:string};
function asset(value:string){
 if(/[\x00-\x20\\<>"']/.test(value)||value.startsWith('//'))throw new Error('Brand assets must use a public path or HTTPS URL');
 if(value.startsWith('/'))return value;
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Brand assets must use a public path or HTTPS URL');
 return url.href;
}
export function loadBranding(env:NodeJS.ProcessEnv):Branding{
 const name=env.CONSOLE_NAME??'LiveKit Console';
 if(!name.trim()||name.length>100||/[\x00-\x1f\x7f]/.test(name))throw new Error('CONSOLE_NAME must be 1–100 characters');
 let domain='';
 if(env.CONSOLE_DOMAIN){
  const url=new URL(env.CONSOLE_DOMAIN.includes('://')?env.CONSOLE_DOMAIN:'https://'+env.CONSOLE_DOMAIN);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('CONSOLE_DOMAIN must be a hostname or HTTP(S) origin');
  domain=url.host;
 }
 const logoUrl=asset(env.CONSOLE_LOGO_URL??'/brand.svg');
 return {name:name.trim(),domain,logoUrl,faviconUrl:asset(env.CONSOLE_FAVICON_URL??logoUrl)};
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function brandHtml(html:string,branding:Branding){return html.replace(/<title>[^<]*<\/title>/,()=>`<title>${escape(branding.name)}</title>`).replace(/<link rel="icon" href="[^"]*"\s*\/>/,()=>`<link rel="icon" href="${escape(branding.faviconUrl)}" />`);}
