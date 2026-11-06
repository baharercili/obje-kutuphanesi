/** Official product photography stays separate from the reconstructed 3D model. */
export function mountReferenceGallery(root, options = {}) {
  const brand=options.brand||'Zara Home';
  const allowedHosts=new Set(options.allowedHosts||['static.zarahome.net']);
  const thumbnailParameter=options.thumbnailParameter||'w';
  const get=selector=>root.querySelector(selector);
  const stage=get('[data-reference-stage]');
  const image=get('[data-reference-image]');
  const status=get('[data-reference-status]');
  const full=get('[data-reference-full]');
  const thumbnails=get('[data-reference-thumbnails]');
  const navigation=get('[data-reference-navigation]');
  const count=get('[data-reference-count]');
  const caption=get('[data-reference-caption]');
  let product=null,photos=[],index=0,requestId=0,disposed=false;
  const failedPhotos=new Set();
  const listeners=[];
  const listen=(element,type,handler)=>{element.addEventListener(type,handler);listeners.push(()=>element.removeEventListener(type,handler));};
  function safePhotoUrl(value) {
    try { const url=new URL(value);return url.protocol==='https:'&&allowedHosts.has(url.hostname)&&/\.jpe?g$/i.test(url.pathname)?url.href:null; }
    catch { return null; }
  }
  function thumbnailUrl(photo) {
    const explicit=safePhotoUrl(photo.thumbnail_url);
    if(explicit)return explicit;
    const url=new URL(photo.url);url.searchParams.set(thumbnailParameter,'160');return url.href;
  }
  function show(nextIndex) {
    if(disposed||!photos.length)return;
    index=(nextIndex+photos.length)%photos.length;
    const photo=photos[index],generation=++requestId;
    image.hidden=true;image.removeAttribute('src');
    status.hidden=false;status.textContent='Ürün fotoğrafı yükleniyor…';
    stage.setAttribute('aria-busy','true');root.dataset.referenceStatus='loading';
    full.href=photo.url;full.hidden=false;
    full.setAttribute('aria-label',product.name+' · orijinal fotoğrafı aç');
    count.textContent=(index+1)+' / '+photos.length;
    image.alt=photo.alt||product.name+' · '+brand+' orijinal ürün fotoğrafı '+(index+1);
    thumbnails.querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
    image.onload=()=>{
      if(disposed||generation!==requestId)return;
      failedPhotos.delete(photo.url);
      image.hidden=false;status.hidden=true;stage.setAttribute('aria-busy','false');root.dataset.referenceStatus='ready';
    };
    image.onerror=()=>{
      if(disposed||generation!==requestId)return;
      failedPhotos.add(photo.url);
      const next=photos.findIndex(candidate=>!failedPhotos.has(candidate.url));
      if(next>=0){show(next);return;}
      image.hidden=true;status.hidden=false;status.textContent='Fotoğraf yüklenemedi. Yukarıdaki bağlantıdan orijinalini açabilirsin.';
      stage.setAttribute('aria-busy','false');root.dataset.referenceStatus='error';
    };
    image.src=photo.url;
    root.dataset.referenceIndex=String(index);
  }
  listen(get('[data-reference-prev]'),'click',()=>show(index-1));
  listen(get('[data-reference-next]'),'click',()=>show(index+1));
  listen(thumbnails,'click',event=>{const button=event.target.closest('[data-photo-index]');if(button&&thumbnails.contains(button))show(Number(button.dataset.photoIndex));});
  listen(thumbnails,'keydown',event=>{
    const current=event.target.closest('[data-photo-index]');if(!current)return;
    let next=Number(current.dataset.photoIndex);
    if(event.key==='ArrowRight')next=(next+1)%photos.length;
    else if(event.key==='ArrowLeft')next=(next+photos.length-1)%photos.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=photos.length-1;
    else return;
    event.preventDefault();show(next);thumbnails.querySelector('[data-photo-index="'+next+'"]').focus();
  });
  return {
    select(nextProduct) {
      product=nextProduct||{};requestId++;failedPhotos.clear();
      photos=(product.reference_images||[]).map(photo=>({...photo,url:safePhotoUrl(photo.url)})).filter(photo=>photo.url);
      thumbnails.replaceChildren();navigation.hidden=photos.length<2;
      root.dataset.referenceModel=product.id||'';
      caption.textContent=brand+' · '+(product.reference_photo_scope==='product_family'?'ürün ailesinin resmi fotoğrafları; boylar birlikte gösterilebilir.':'resmi ürün fotoğrafı');
      photos.forEach((photo,i)=>{
        const button=document.createElement('button');button.type='button';button.dataset.photoIndex=String(i);button.setAttribute('aria-label','Ürün fotoğrafı '+(i+1));button.setAttribute('aria-pressed',String(i===0));
        const thumbnail=document.createElement('img');thumbnail.src=thumbnailUrl(photo);thumbnail.alt='';thumbnail.loading='lazy';thumbnail.decoding='async';thumbnail.referrerPolicy='no-referrer';
        button.append(thumbnail);thumbnails.append(button);
      });
      thumbnails.hidden=photos.length<2;
      if(photos.length)show(0);
      else {
        image.onload=null;image.onerror=null;image.hidden=true;image.removeAttribute('src');
        full.hidden=true;full.removeAttribute('href');count.textContent='';
        status.hidden=false;status.textContent='Bu ürünün resmi fotoğrafı henüz eklenmedi.';
        stage.setAttribute('aria-busy','false');root.dataset.referenceStatus='missing';
      }
    },
    dispose(){disposed=true;requestId++;image.onload=null;image.onerror=null;listeners.splice(0).forEach(remove=>remove());}
  };
}
