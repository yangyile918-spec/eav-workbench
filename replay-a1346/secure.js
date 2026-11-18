// The key is kept in memory only. No login/password is sent to a server.
const nativeFetch=globalThis.fetch.bind(globalThis),base=new URL('.',import.meta.url);
export async function manifest(){const r=await nativeFetch(new URL('manifest.json',base));if(!r.ok)throw Error('分享资料读取失败');return r.json();}
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function derive(password,m){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(m.salt),iterations:m.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);}
export async function decryptAsset(name,key,m){
 const a=m.assets[name];if(!a)throw Error('此资料未包含在分享中');
 const parts=await Promise.all(a.chunks.map(async p=>{const r=await nativeFetch(new URL(p,base));if(!r.ok)throw Error('资料下载失败，请刷新重试');return new Uint8Array(await r.arrayBuffer());}));
 const encrypted=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){encrypted.set(p,offset);offset+=p.length;}
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(a.iv),additionalData:new TextEncoder().encode(name)},key,encrypted);
 return new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip')),{headers:{'Content-Type':a.mime}});
}
export function installAssetFetch(key,m,prefix=''){
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  const method=(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET')throw Error('分享版仅支持查看');
  if(url.protocol==='blob:'||url.protocol==='data:')return nativeFetch(input,options);
  if(url.origin!==location.origin)throw Error('分享版不连接其他服务');
  const relative=decodeURIComponent(url.pathname.slice(base.pathname.length));
  const name=prefix?prefix+relative.split('/').pop():relative;
  if(m.assets[name])return decryptAsset(name,key,m);
  if(relative.startsWith('api/')||/\.(json|glb)$/.test(relative))return new Response('未分享此资料',{status:404});
  return nativeFetch(input,options);
 };
}
