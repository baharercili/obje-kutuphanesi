const indexPromise=fetch(new URL('./model-assets.json',import.meta.url)).then(async response=>{
  if(!response.ok)throw Error('Model dizini açılamadı.');
  return response.json();
});
const packs=new Map();
async function modelSlice(url,entry){
  if(packs.has(url)){const pack=await packs.get(url);return pack.slice(entry.offset,entry.offset+entry.length);}
  const response=await fetch(url,{headers:{Range:`bytes=${entry.offset}-${entry.offset+entry.length-1}`}});
  if(!response.ok)throw Error('Model dosyası açılamadı.');
  const buffer=await response.arrayBuffer();
  if(response.status===206){
    if(buffer.byteLength!==entry.length)throw Error('Model arşivi eksik.');
    return buffer;
  }
  if(entry.offset<0||entry.offset+entry.length>buffer.byteLength)throw Error('Model arşivi eksik.');
  packs.set(url,Promise.resolve(buffer));while(packs.size>3)packs.delete(packs.keys().next().value);
  return buffer.slice(entry.offset,entry.offset+entry.length);
}
export async function loadPreviewModel(id){
  const index=await indexPromise,entry=index.models?.[id];
  if(!entry)throw Error('Bu modelin web görünümü bulunamadı.');
  const cacheKey=new URL('./__model-cache/'+entry.preview_sha256+'.glb',import.meta.url).href;
  let cache,cached;try{cache=await caches.open('obje-web-models-v1');cached=await cache.match(cacheKey);}catch{}
  let bytes;
  if(cached)bytes=await cached.arrayBuffer();
  else{
    const parts=entry.parts||[entry];
    const chunks=await Promise.all(parts.map(part=>modelSlice(new URL(part.pack,index.asset_base_url||import.meta.url).href,part)));
    const combined=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.byteLength,0));
    let offset=0;for(const chunk of chunks){combined.set(new Uint8Array(chunk),offset);offset+=chunk.byteLength;}
    bytes=combined.buffer;
    if(entry.encoding==='gzip')bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==entry.preview_sha256)throw Error('Model dosyası doğrulanamadı.');
  if(cache&&!cached)try{await cache.put(cacheKey,new Response(bytes,{headers:{'content-type':'model/gltf-binary'}}));}catch{}
  return bytes;
}
let decoder;
export async function configureModelLoader(loader){
  decoder??=import('https://cdn.jsdelivr.net/npm/meshoptimizer@0.25.0/meshopt_decoder.module.js');
  const {MeshoptDecoder}=await decoder;
  await MeshoptDecoder.ready;
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
