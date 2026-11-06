import {extendHmInventory,spreadCategories,hmMarketLabel} from './collection-data.js';
const $=selector=>document.querySelector(selector);
const names={ready:'3D modeli hazır',pending_model:'Modelleme bekliyor',pending_measurements:'Ölçü bilgisi bekliyor',pending_research:'Form ve ölçü araştırması bekliyor'};
const normalize=value=>String(value||'').toLocaleLowerCase('tr-TR');
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const official=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www2.hm.com'?url.href:null;}catch{return null;}};
const picture=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='image.hm.com'&&url.pathname.endsWith('.jpg')?url.href:null;}catch{return null;}};
const dialog=$('[data-detail]');let activeProduct=null;
function selectPhoto(photo){
  const image=$('[data-detail-image]'),url=picture(photo?.url);image.hidden=!url;$('[data-detail-error]').hidden=!!url;
  $('[data-detail-error]').textContent='Bu ürünün orijinal görseli henüz kaydedilmedi.';
  const full=$('[data-detail-photo]');full.hidden=!url;
  if(url){image.src=url;image.alt=photo.alt||activeProduct.name;full.href=url;}
  for(const button of $('[data-thumbnails]').children)button.setAttribute('aria-pressed',String(button.dataset.photo===url));
}
function showProduct(product){
  activeProduct=product;$('#detail-title').textContent=product.name;$('[data-detail-category]').textContent=product.category;
  $('[data-detail-sku]').textContent='H&M Home · '+product.sku+' · Kaynak: '+hmMarketLabel(product);
  $('[data-detail-status]').textContent=names[product.model_status]+(product.quality_label?' · '+product.quality_label:'');$('[data-detail-note]').textContent=product.status_note;
  const source=$('[data-detail-source]');source.href=official(product.url);source.hidden=!official(product.url);
  const model=$('[data-detail-model]');model.hidden=!product.model_url;if(product.model_url)model.href=product.model_url;
  const thumbnails=$('[data-thumbnails]');thumbnails.replaceChildren();
  const photos=(product.reference_images||[]).filter(photo=>picture(photo.url));
  for(const [index,photo] of photos.entries()){
    const button=element('button');button.type='button';button.dataset.photo=picture(photo.url);button.setAttribute('aria-label',`${index+1}. orijinal ürün fotoğrafı`);
    const image=element('img');image.src=picture(photo.thumbnail_url)||photo.url;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';button.append(image);button.addEventListener('click',()=>selectPhoto(photo));thumbnails.append(button);
  }
  thumbnails.hidden=photos.length<2;selectPhoto(photos[0]);dialog.showModal();
}
$('[data-detail-image]').addEventListener('error',()=>{$('[data-detail-image]').hidden=true;$('[data-detail-error]').hidden=false;$('[data-detail-error]').textContent='Orijinal görsel şu anda yüklenemedi. Resmî ürün sayfasını açabilirsin.';});
$('[data-close]').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();}});
try{
  const responses=await Promise.all(['./hmhome-inventory.json','./hmhome-discovered.json','./hmhome-sources.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('inventory');return r.json();}));const inventory=extendHmInventory(responses[0],responses[1]);inventory.products=spreadCategories(inventory.products);const sources=responses[2];
  const category=$('[data-category]'),status=$('[data-status]'),search=$('[data-search]'),gallery=$('[data-gallery]');
  for(const row of inventory.categories){const option=element('option',null,`${row.label} · ${row.observed_source_cards??'Araştırılıyor'}`);option.value=row.slug;category.append(option);}
  const params=new URLSearchParams(location.search);if(inventory.categories.some(row=>row.slug===params.get('kategori')))category.value=params.get('kategori');if(params.get('durum')==='pending'||Object.hasOwn(names,params.get('durum')))status.value=params.get('durum');
  const counts=inventory.counts;$('[data-summary]').textContent=`${counts.source_cards} ürün · ${counts.ready_source_cards} ürünün modeli hazır · ${counts.ready_model_variants} GLB`;
  $('[data-model-scope]').textContent=counts.pending_source_cards?`${counts.pending_source_cards} kayıtlı ürünün modellemesi sürüyor · Kategori kapsamı aşağıda`:'Kayıtlı ürünlerin modelleri hazır · Kaynak tarama kapsamı aşağıda';
  $('[data-inventory-title]').textContent=counts.source_cards+' ürün, genişleyen koleksiyon.';
  const scope=$('[data-source-progress]');
  for(const source of sources.categories){const row=inventory.categories.find(c=>c.id===source.id);const item=element('li'),link=element('a',null,source.official_navigation_label);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';item.append(link,element('span',null,row?.scan_complete?`${row.observed_source_cards} kaynak ürün · ${row.ready_source_cards} ürünün modeli hazır`:row?.observed_source_cards?`${row.observed_source_cards} kayıt · kaynak toplamı doğrulanamadı`:'Ürün listesi alınamadı · araştırma bekliyor'));scope.append(item);}
  for(const row of inventory.categories){
    const tr=element('tr'),th=element('th'),link=element('a',null,row.label);th.scope='row';link.href='./hmhome-envanter.html?kategori='+row.slug+'#koleksiyon';th.append(link);tr.append(th);
    for(const field of ['observed_source_cards','ready_source_cards','ready_model_variants','pending_source_cards'])tr.append(element('td',null,row[field]===null||row[field]===undefined?'—':String(row[field])));$('[data-coverage]').append(tr);
  }
  function card(product){
    const article=element('article','product-card');article.dataset.sku=product.sku;article.dataset.modelStatus=product.model_status;
    const photoButton=element('button','photo-open');photoButton.type='button';photoButton.setAttribute('aria-label',product.name+' ayrıntıları');photoButton.addEventListener('click',()=>showProduct(product));
    const photo=(product.reference_images||[]).find(value=>picture(value.url));
    const unavailable=element('span','image-unavailable',photo?'Orijinal görsel yüklenemedi':'Orijinal görsel bekleniyor');unavailable.hidden=!!photo;photoButton.append(unavailable);
    if(photo){const image=element('img');image.src=picture(photo.thumbnail_url)||photo.url;image.alt=photo.alt||product.name;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{if(image.src!==photo.url){image.src=photo.url;return;}image.hidden=true;unavailable.hidden=false;});photoButton.append(image);}
    photoButton.append(element('span','card-category',product.category));article.append(photoButton);
    const copy=element('div','card-copy');copy.append(element('p','card-brand','H&M Home · '+hmMarketLabel(product)),element('p','card-sku',product.sku),element('h2','card-title',product.name));
    copy.append(element('p','model-status '+(product.model_status==='ready'?'is-ready':'is-pending'),names[product.model_status]+(product.quality_label?' · '+product.quality_label:'')));
    const actions=element('div','card-actions');
    if(product.model_url){const model=element('a','card-open-model','3D modeli aç ↗');model.href=product.model_url;actions.append(model);}else{const source=element('a','card-open-model','Ürün kaynağı ↗');source.href=official(product.url);source.target='_blank';source.rel='noopener noreferrer';actions.append(source);}
    const detail=element('button','card-detail','Ayrıntılar');detail.type='button';detail.addEventListener('click',()=>showProduct(product));actions.append(detail);copy.append(actions);article.append(copy);return article;
  }
  let limit=48;
  function render(reset=true){
    if(reset)limit=48;
    const query=normalize(search.value).trim();const products=inventory.products.filter(product=>(category.value==='all'||category.value===product.category_slug||product.source_categories?.some(c=>(c.slug||c.category_slug)===category.value))&&(status.value==='all'||(status.value==='pending'?product.model_status!=='ready':status.value===product.model_status))&&(!query||normalize(product.name+' '+product.sku+' '+product.category).includes(query)));
    gallery.replaceChildren(...products.slice(0,limit).map(card));gallery.setAttribute('aria-busy','false');$('[data-results]').textContent=`${products.length} / ${counts.source_cards} kaynak ürün · ${products.filter(product=>product.model_status==='ready').length} ürünün 3D modeli hazır`;$('[data-empty]').hidden=products.length>0;$('[data-inventory-more]').hidden=limit>=products.length;$('[data-page-count]').textContent=Math.min(limit,products.length)+' / '+products.length+' ürün gösteriliyor';
    const source=$('[data-category-source]'),selected=inventory.categories.find(row=>row.slug===category.value);source.hidden=!selected;if(selected)source.href=official(selected.source_url);
    const url=new URL(location.href);category.value==='all'?url.searchParams.delete('kategori'):url.searchParams.set('kategori',category.value);status.value==='all'?url.searchParams.delete('durum'):url.searchParams.set('durum',status.value);history.replaceState(null,'',url);
  }
  $('[data-inventory-more]').addEventListener('click',()=>{limit+=48;render(false);});category.addEventListener('change',render);status.addEventListener('change',render);search.addEventListener('input',render);$('[data-reset]').addEventListener('click',()=>{category.value='all';status.value='all';search.value='';render();});render();document.documentElement.dataset.ready='true';
}catch(error){$('[data-error]').hidden=false;$('[data-error]').textContent='H&M Home envanteri açılamadı. Sayfayı yenileyebilirsin.';$('[data-gallery]').setAttribute('aria-busy','false');console.error(error);}
