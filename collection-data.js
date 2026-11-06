const cm=value=>Number(value).toLocaleString('tr-TR',{maximumFractionDigits:3});
export function hmMarketLabel(product){
  try{return {tr_tr:'Türkiye',en_gb:'Birleşik Krallık',de_de:'Almanya'}[new URL(product.url).pathname.split('./index.html')[1]]||product.source_market||'';}catch{return product.source_market||'';}
}
const groups={'Cam vazolar':'Vazolar','Seramik vazolar':'Vazolar','Metal vazolar':'Vazolar','Kulplu ve terrakota vazolar':'Vazolar','Studio Mary Lennox':'Vazolar','Düzenleyici sepetler':'Sepetler','Çamaşır sepetleri':'Sepetler','Saklama kutuları':'Kutular','Dekoratif kutular':'Kutular','Dekoratif saksılar':'Saksılar','Ev dekorasyonu':'Dekoratif aksesuarlar','Servis tabak ve kaseleri':'Kaseler ve tabaklar','Dekoratif kaseler':'Kaseler ve tabaklar','Servis Tabakları':'Kaseler ve tabaklar','Dekoratif tepsiler':'Tepsiler','Dekoratif sepetler':'Sepetler','Mumluk ve şamdanlar':'Mumluk ve şamdanlar'};
export function spreadCategories(products){const groups=new Map();for(const p of products){if(!groups.has(p.category))groups.set(p.category,[]);groups.get(p.category).push(p);}const rows=[...groups.values()],output=[];for(let i=0;i<Math.max(0,...rows.map(row=>row.length));i++)for(const row of rows)if(row[i])output.push(row[i]);return output;}
export function extendHmInventory(inventory,discovered){
  const products=new Map(inventory.products.map(p=>[p.sku,{...p,source_categories:[{id:p.category_id,slug:p.category_slug,label:p.category}]}]));
  for(const p of discovered.products||[]){
    const memberships=p.source_categories||[{id:p.category_id,slug:p.category_slug,label:p.category}];
    if(products.has(p.sku)){const old=products.get(p.sku);if(p.model_status==='ready'&&p.model_ids?.length)Object.assign(old,{model_status:p.model_status,model_ids:p.model_ids,model_url:p.model_url,ready_model_variants:p.ready_model_variants,status_note:p.status_note,dimensions_cm:p.dimensions_cm,material_label:p.material_label});for(const c of memberships)if(!old.source_categories.some(v=>(v.id||v.category_id)===(c.id||c.category_id)))old.source_categories.push(c);}
    else products.set(p.sku,{...p,source_categories:memberships});
  }
  const categories=inventory.categories.map(c=>({...c}));
  for(const row of discovered.categories||[])if(!categories.some(c=>c.id===row.id))categories.push({id:row.id,slug:row.slug||row.id,label:row.label||row.name,source_url:row.source_url||row.url,observed_source_cards:row.observed_source_cards??row.official_count,scan_complete:row.scan_complete??row.inventory_complete??false});
  for(const row of categories){const members=[...products.values()].filter(p=>p.source_categories.some(c=>(c.id||c.category_id)===row.id));row.ready_source_cards=members.filter(p=>p.model_status==='ready').length;row.ready_model_variants=members.reduce((n,p)=>n+(p.ready_model_variants||0),0);row.pending_source_cards=members.length-row.ready_source_cards;}
  const rows=[...products.values()];return {...inventory,products:rows,categories,counts:{source_cards:rows.length,ready_source_cards:rows.filter(p=>p.model_status==='ready').length,ready_model_variants:rows.reduce((n,p)=>n+(p.ready_model_variants||0),0),pending_source_cards:rows.filter(p=>p.model_status!=='ready').length}};
}
export function mergeCollection(zara,hm,hipicon,discovered=[]){
  const rows=[
    zara.products.map(p=>({id:p.id,name:p.title,brand:'Zara Home',brandId:'zara',maker:p.brand,sku:p.product_code,category:groups[p.category]||p.category,images:p.images||[],source:p.url,dimensions:p.dimensions_display,material:p.material_label,note:p.dimension_note||p.modeling_note,quality:p.quality_label||'',status:p.model_status==='ready'?'ready':'pending_measurements',modelUrl:p.model_status==='ready'?'./zarahome.html?model='+encodeURIComponent(p.model_id)+'#koleksiyon':null,models:p.model_status==='ready'?1:0})),
    extendHmInventory(hm,{products:discovered}).products.map(p=>({id:p.id,name:p.name,brand:'H&M Home',brandId:'hm',maker:p.brand||'H&M Home',sku:p.sku,category:groups[p.category]||p.category,additionalCategories:[...new Set((p.source_categories||[]).filter(c=>!['storage','decorations','textiles'].includes(c.id)).map(c=>groups[c.label]||c.label))],images:p.reference_images||[],source:p.url,dimensions:p.dimensions_cm?p.dimensions_cm.map(cm).join(' × ')+' cm (E × Y × D)':'',material:p.material_label,note:p.status_note,quality:p.quality_label||'',status:p.model_status,modelUrl:p.model_url||null,models:p.ready_model_variants||0})),
    hipicon.products.map(p=>({id:p.id,name:p.title,brand:'Hipicon',brandId:'hipicon',maker:p.brand,sku:p.product_code,category:groups[p.category]||p.category,images:p.images||[],source:p.url,dimensions:p.dimensions_display,material:p.material_label,note:p.dimension_note,status:'reference_only',modelUrl:null,models:0}))
  ];
  for(let i=0;i<rows.length;i++)rows[i]=spreadCategories(rows[i]);
  const merged=[];
  for(let i=0;i<Math.max(...rows.map(row=>row.length));i++)for(const row of rows)if(row[i])merged.push(row[i]);
  return merged;
}
