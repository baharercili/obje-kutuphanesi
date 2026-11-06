import { mountVaseViewer } from './viewer.js';
import { mountReferenceGallery } from './reference-gallery.js';

const root=document.getElementById('vase-app');
try {
  const [config,catalog]=await Promise.all([
    fetch('./preview.json').then(response=>{if(!response.ok)throw new Error('Önizleme yüklenemedi');return response.json();}),
    fetch('./catalog.json').then(response=>{if(!response.ok)throw new Error('Katalog yüklenemedi');return response.json();})
  ]);
  const products=Array.isArray(catalog)?catalog:catalog.models;
  const categoryById=Object.fromEntries(products.map(model=>[model.id,model.category]));
  const additionalCategoriesById=Object.fromEntries(products.map(model=>[model.id,model.additional_categories||[]]));
  const downloadById=Object.fromEntries(products.map(model=>[model.id,model.glb_url]));
  const productById=new Map(products.map(model=>[model.id,model]));
  const inventorySlugs={'Dekoratif sepetler':'sepetler','Dekoratif aynalar':'aynalar','Fotoğraf çerçeveleri':'cerceveler','Dekoratif saksılar':'saksilar','Dekoratif kutular':'kutular','Dekoratif aydınlatma':'aydinlatma','Yan sehpalar':'yan-sehpalar','Tabureler':'tabureler','Sandalyeler':'sandalyeler','Banklar':'banklar','Puflar':'puflar','Kırlentler':'kirlentler','Halılar':'halilar','Çubuklu oda kokuları':'oda-kokulari','Dekoratif mumlar':'dekoratif-mumlar','Havluluk ve askılar':'havluluk-askilar','Masaüstü aksesuarları':'masaustu','Dekoratif aksesuarlar':'dekoratif-aksesuarlar','Mumluk ve şamdanlar':'mumluklar','Dekoratif kaseler':'kaseler','Dekoratif tepsiler':'tepsiler','Dekoratif objeler':'objeler','Dekoratif fenerler':'fenerler'};
  let coverageCategories=[];
  let lastModel=null;
  const showCoverage=model=>{
    const activeCategory=root.querySelector('[data-category]').value||model.category;
    const slug=inventorySlugs[activeCategory]||'vazolar';
    root.querySelector('[data-category-inventory]').href='./zarahome-secki.html?kategori='+slug+'#gallery';
    const sourceIds=slug==='halilar'?['halilar','oturma-odasi-halilari']:[slug];
    const matching=coverageCategories.filter(item=>sourceIds.includes(item.source_id));
    const category=matching.length?matching.reduce((total,item)=>({official_card_count:total.official_card_count+item.official_card_count,cards_with_model:total.cards_with_model+item.cards_with_model,cards_without_model:total.cards_without_model+item.cards_without_model}),{official_card_count:0,cards_with_model:0,cards_without_model:0}):null;
    root.querySelector('[data-coverage-note]').textContent=category ? `${category.official_card_count} kaynak kartından ${category.cards_with_model} tanesinin en az bir modeli var; ${category.cards_without_model} kart modelleme bekliyor. Kartlar aynı ürünün tekrarlarını içerebilir; hazır boylar ürün listesinde ayrı gösterilir.` : 'Burada hazır 3D modeller gösteriliyor. Modelleme bekleyen ürünleri Zara Home envanterinde görebilirsin.';
  };
  void fetch('./zarahome-reference-catalog.json').then(response=>{if(!response.ok)throw new Error('coverage');return response.json();}).then(data=>{coverageCategories=data.coverage?.categories||[];if(lastModel)showCoverage(lastModel);}).catch(()=>{});
  const referenceGallery=mountReferenceGallery(root);
  const onModelChange=model=>{
    root.querySelector('[data-model-name]').textContent=model.name;
    root.querySelector('[data-sku]').textContent=model.sku;
    root.querySelector('[data-category-count]').textContent=root.querySelector('[data-model]').options.length+' model';
    document.title=model.name+' · Obje Kütüphanesi';
    referenceGallery.select(productById.get(model.id));
    lastModel=model;showCoverage(model);
  };
  const viewer=await mountVaseViewer({root,config,categoryById,additionalCategoriesById,downloadById,loadMasters:true,categories:[...new Set(products.map(model=>model.category))],storageKey:'vazo-kutuphanesi-viewer-v1',onModelChange});
  const requestedCategory=new URLSearchParams(location.search).get('kategori');
  if(requestedCategory==='kaseler')viewer.selectCategory('Dekoratif kaseler');
  if(requestedCategory==='tepsiler')viewer.selectCategory('Dekoratif tepsiler');
  if(requestedCategory==='mumluklar')viewer.selectCategory('Mumluk ve şamdanlar');
  if(requestedCategory==='fenerler')viewer.selectCategory('Dekoratif fenerler');
  if(requestedCategory==='objeler')viewer.selectCategory('Dekoratif objeler');
  if(requestedCategory==='sepetler')viewer.selectCategory('Dekoratif sepetler');
  if(requestedCategory==='aynalar')viewer.selectCategory('Dekoratif aynalar');
  if(requestedCategory==='cerceveler')viewer.selectCategory('Fotoğraf çerçeveleri');
  if(requestedCategory==='saksilar')viewer.selectCategory('Dekoratif saksılar');
  if(requestedCategory==='kutular')viewer.selectCategory('Dekoratif kutular');
  if(requestedCategory==='aydinlatma')viewer.selectCategory('Dekoratif aydınlatma');
  const newCategories={'vazolar':'Vazolar','dekoratif-aksesuarlar':'Dekoratif aksesuarlar','yan-sehpalar':'Yan sehpalar','tabureler':'Tabureler','sandalyeler':'Sandalyeler','banklar':'Banklar','puflar':'Puflar','kirlentler':'Kırlentler','halilar':'Halılar','oda-kokulari':'Çubuklu oda kokuları','dekoratif-mumlar':'Dekoratif mumlar','havluluk-askilar':'Havluluk ve askılar','masaustu':'Masaüstü aksesuarları'};
  if(newCategories[requestedCategory])viewer.selectCategory(newCategories[requestedCategory]);
  const requestedModel=new URLSearchParams(location.search).get('model');
  if(requestedModel&&productById.has(requestedModel))viewer.selectModel(requestedModel);
  root.dataset.ready='true';
  window.addEventListener('pagehide',()=>{viewer.dispose?.();referenceGallery.dispose();},{once:true});
} catch(error) {
  const loading=root.querySelector('.vase-loading');
  loading.hidden=false;loading.textContent='Koleksiyon açılamadı. Sayfayı yenileyerek tekrar deneyebilirsin.';loading.setAttribute('role','alert');
  console.error(error);
}
