import {mountVaseViewer} from './viewer.js';
import {mountReferenceGallery} from './reference-gallery.js';
import {extendHmInventory,hmMarketLabel} from './collection-data.js';
import {mountPhysicalRenderGallery} from './physical-render-gallery.js';

const root=document.getElementById('vase-app');
const initialParams=new URLSearchParams(location.search);
try {
  const read=async path=>{const response=await fetch(path);if(!response.ok)throw new Error('Koleksiyon yüklenemedi');return response.json();};
  const [config,products,sources,inventory,discovered]=await Promise.all([read('./hmhome-preview.json'),read('./hmhome-catalog.json'),read('./hmhome-sources.json'),read('./hmhome-inventory.json'),read('./hmhome-discovered.json')]);
  const sourceCount=new Set([...inventory.products,...discovered.products].map(p=>p.sku)).size;
  const readyProductCount=new Set(products.map(p=>p.sku)).size;
  const pendingProductCount=sourceCount-readyProductCount;
  document.querySelector('[data-hm-count]').textContent=products.length.toLocaleString('tr-TR');
  document.querySelector('[data-hm-count-label]').textContent='hazır 3D model · '+readyProductCount.toLocaleString('tr-TR')+' ürün';
  document.querySelector('[data-hm-progress-status]').textContent=pendingProductCount?'Modelleme sürüyor.':'Kayıtlı koleksiyonun modelleri hazır.';
  document.querySelector('[data-hm-scope]').textContent=sourceCount+' kayıtlı ürün · '+readyProductCount+' ürüne ait '+products.length+' hazır 3D model'+(pendingProductCount?' · '+pendingProductCount+' ürünün modellemesi bekliyor.':'.');
  root.querySelector('[data-coverage-note]').textContent=sourceCount+' kayıtlı ürünün '+readyProductCount+' tanesinin modeli hazır. '+(pendingProductCount?'Modelleme bekleyen '+pendingProductCount+' ürünü envanterde inceleyebilirsin.':'Ürün fotoğraflarını ve kategori kapsamını kaynak envanterinde inceleyebilirsin.');
  const sourceInventory=extendHmInventory(inventory,discovered);
  const sourceBySku=new Map(sourceInventory.products.map(p=>[p.sku,p]));
  const additionalCategoriesById=Object.fromEntries(products.map(p=>[p.id,(sourceBySku.get(p.sku)?.source_categories||[]).filter(c=>!['storage','decorations','textiles'].includes(c.id)).map(c=>c.label)]));
  const byId=new Map(products.map(product=>[product.id,product]));
  const gallery=mountReferenceGallery(root,{brand:'H&M Home',allowedHosts:['image.hm.com'],thumbnailParameter:'imwidth'});
  const viewer=await mountVaseViewer({
    root,config,loadMasters:true,nestedTransmissionPreview:true,selfShadows:true,fitAllModels:true,storageKey:'hmhome-viewer-v1',
    additionalCategoriesById,
    categoryById:Object.fromEntries(products.map(product=>[product.id,product.category])),
    downloadById:Object.fromEntries(products.map(product=>[product.id,product.glb_url])),
    categories:[...new Set([...products.map(product=>product.category),...Object.values(additionalCategoriesById).flat()])],
    onModelChange(model){
      const product=byId.get(model.id);
      root.querySelector('[data-model-name]').textContent=model.name;
      root.querySelector('[data-sku]').textContent='H&M Home · '+model.sku+' · Kaynak: '+hmMarketLabel(product);
      document.title=model.name+' · H&M Home · Obje Kütüphanesi';
      gallery.select(product);
      const activeCategory=root.querySelector('[data-category]').value||product.category;
      const activeSlug=sourceInventory.categories.find(c=>c.label===activeCategory)?.slug||product.category_slug;
      root.querySelector('[data-category-inventory]').href='./hmhome-envanter.html?kategori='+activeSlug+'#koleksiyon';
      const url=new URL(location.href);url.searchParams.set('model',model.id);url.searchParams.set('kategori',activeSlug);history.replaceState(null,'',url);
    }
  });
  const params=initialParams;
  const requestedCategory=sourceInventory.categories.find(c=>c.slug===params.get('kategori'))?.label||products.find(product=>product.category_slug===params.get('kategori'))?.category;
  if(requestedCategory)viewer.selectCategory(requestedCategory);
  const requestedModel=params.get('model');
  if(byId.has(requestedModel))viewer.selectModel(requestedModel);
  const physicalGallery=mountPhysicalRenderGallery(root);
  const list=document.querySelector('[data-hm-sources]');
  for(const category of sources.categories||[]){
    const url=new URL(category.url);
    if(url.protocol!=='https:'||url.hostname!=='www2.hm.com')continue;
    const item=document.createElement('li'),link=document.createElement('a');
    const label=category.official_navigation_label||category.label||category.name||category.category;
    link.href=url.href;link.textContent=label+(Number.isInteger(category.current_visible_category_count)?' · '+category.current_visible_category_count+' kaynak ürün':'');link.target='_blank';link.rel='noopener noreferrer';
    item.append(link);list.append(item);
  }
  root.dataset.ready='true';
  window.addEventListener('pagehide',()=>{physicalGallery.dispose();viewer.dispose?.();gallery.dispose();},{once:true});
}catch(error){
  const loading=root.querySelector('.vase-loading');
  loading.hidden=false;loading.textContent='H&M Home koleksiyonu açılamadı. Sayfayı yenileyerek tekrar deneyebilirsin.';loading.setAttribute('role','alert');
  console.error(error);
}
