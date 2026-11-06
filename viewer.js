import {loadPreviewModel,configureModelLoader} from './model-transport.js';
/** Mount the catalog's preview data. Download URLs refer to the unchanged GLB masters. */
export async function mountVaseViewer(options = {}) {
  const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root || document.getElementById('vase-app');
  if (!root) throw new Error('Vazo görüntüleyici alanı bulunamadı.');
  const elements = options.elements || {};
  const get = (name, selector) => {
    const supplied = elements[name];
    return supplied instanceof Element ? supplied : root.querySelector(supplied || selector);
  };
  const stage = get('stage', '.vase-stage');
  const canvas = get('canvas', 'canvas');
  const loading = get('loading', '.vase-loading');
  const select = get('model', '[data-model]') || document.getElementById(root.id + '-select');
  const categorySelect = get('category', '[data-category]') || document.getElementById(root.id + '-category');
  const modelList = get('modelList', '[data-model-list]');
  const search = get('search', '[data-search]');
  const resultsCount = get('resultsCount', '[data-results-count]');
  if (!stage || !canvas || !loading || !select || !categorySelect) throw new Error('Vazo görüntüleyici kontrolleri eksik.');
  const spare = () => document.createElement('span');
  const downloadLink = get('download', '[data-download]') || spare();
  const dimensions = get('dimensions', '[data-dimensions]') || spare();
  const sizeOrigin = get('sizeOrigin', '[data-size-origin]') || spare();
  const sourceDetail = get('sourceDetail', '[data-source-detail]') || spare();
  const sourceNotes = get('sourceNotes', '[data-source-notes]') || spare();
  const sizeSourceLink = get('sizeSource', '[data-size-source]') || spare();
  const materialLabel = get('material', '[data-material]') || spare();
  const sourceLink = get('source', '[data-source]') || spare();
  const announcement = get('announcement', '[data-announcement]') || spare();
  const cleanups = [];
  let disposed = false;
  const listen = (element, event, callback, settings) => {
    element?.addEventListener(event, callback, settings);
    cleanups.push(() => element?.removeEventListener(event, callback, settings));
  };
  const fail = error => {
    loading.hidden = false;
    loading.textContent = 'Modeller görüntülenemedi. Sayfayı yenileyin.';
    loading.setAttribute('role', 'alert'); stage.setAttribute('aria-busy', 'false');
    root.dataset.error = String(error.message || error);
  };
  let config = options.config;
  if (!config && options.configUrl) {
    const response = await fetch(options.configUrl);
    if (!response.ok) throw new Error('Model verisi yüklenemedi: ' + response.status);
    config = await response.json();
  }
  if (!config) {
    const payload = get('payload', '[data-viewer-payload]') || document.getElementById(root.id + '-payload');
    if (payload) config = JSON.parse(payload.textContent);
  }
  if (!config?.models?.length || !config.data) throw new Error('Model verisi bulunamadı.');
  const categoryById = options.categoryById || {};
  const newCategoryNames = ['Vazolar','Yan sehpalar','Tabureler','Sandalyeler','Banklar','Puflar','Kırlentler','Halılar','Çubuklu oda kokuları','Dekoratif mumlar','Havluluk ve askılar','Masaüstü aksesuarları','Dekoratif aksesuarlar'];
  const belongsToCategory = (model, category) => model.category === category || (options.additionalCategoriesById?.[model.id] || []).includes(category);
  const downloadById = options.downloadById || {};
  const modelsById = new Map(config.models.map(model => [model.id, model]));
  const variantById = new Map();
  let variantSelect, variantField;
  if(config.models.some(model=>model.scene_variants?.length>1)){
    variantField=document.createElement('label');variantField.className='scene-variant-field field-label';variantField.hidden=true;
    variantField.append(document.createTextNode('Görünüm'));
    variantSelect=document.createElement('select');variantSelect.setAttribute('aria-label','Görünüm');variantSelect.dataset.sceneVariant='';variantField.appendChild(variantSelect);
    stage.before(variantField);cleanups.push(()=>variantField.remove());
  }
  for (const model of config.models) model.category = categoryById[model.id] || model.category || 'Vazolar';
  const categoryNames = options.categories || [...new Set(config.models.map(model => model.category))];
  categorySelect.replaceChildren();
  for (const name of categoryNames) {
    const count = config.models.filter(model => belongsToCategory(model, name)).length;
    if (!count) continue;
    const option = document.createElement('option'); option.value = name; option.textContent = name + ' · ' + count;
    categorySelect.appendChild(option);
  }
  const defaultModel = config.models.find(model => model.category === 'Seramik vazolar' && String(model.sku).startsWith('7355')) || config.models[0];
  categorySelect.value = options.initialCategory || defaultModel.category || categoryNames[0];
  const storageKey = options.storageKey || 'zarahome-vase-viewer:' + (config.batchId || 'catalog');
  const normalize = text => String(text || '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
  function visibleModels(category) {
    const query = normalize(search?.value).trim();
    return config.models.filter(model => belongsToCategory(model, category) && (!query || normalize([model.name, model.sku, model.materialLabel, model.dimensions_cm[1]].join(' ')).includes(query)));
  }
  function updateSelectedRows() {
    modelList?.querySelectorAll('[data-model-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.modelId === currentId)));
  }
  function fillModelOptions(category) {
    select.replaceChildren();
    modelList?.replaceChildren();
    const matches = visibleModels(category);
    for (const model of matches) {
      const formatSize=value=>new Intl.NumberFormat('tr-TR',{maximumFractionDigits:model.category==='Kırlentler'&&model.estimated_dimensions?1:3}).format(value);
      const sizeLabel=['Dekoratif tepsiler','Mumluk ve şamdanlar','Dekoratif fenerler','Dekoratif objeler','Dekoratif sepetler','Dekoratif aynalar','Fotoğraf çerçeveleri','Dekoratif saksılar','Dekoratif kutular','Dekoratif aydınlatma',...newCategoryNames].includes(model.category)
        ?model.dimensions_cm.map(formatSize).join(' × ')+' cm'
        :'Y '+formatSize(model.dimensions_cm[1])+' cm';
      const option = document.createElement('option'); option.value = model.id;
      option.textContent = model.name + ' · ' + model.sku + ' · ' + sizeLabel + (model.estimated_dimensions ? ' · Yaklaşık' : '');
      select.appendChild(option);
      if (modelList) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'model-row'; button.dataset.modelId = model.id;
        button.setAttribute('aria-pressed', String(model.id === currentId));
        const name = document.createElement('span'); name.className = 'model-row-name'; name.textContent = model.name;
        const meta = document.createElement('span'); meta.className = 'model-row-meta';
        meta.textContent = model.sku + ' · ' + sizeLabel + (model.estimated_dimensions ? ' · Yaklaşık' : '');
        button.append(name, meta); modelList.appendChild(button);
      }
    }
    if (matches.some(model => model.id === currentId)) select.value = currentId;
    if (!matches.length && modelList) {
      const empty = document.createElement('p'); empty.className = 'model-list-empty'; empty.textContent = 'Aramanızla eşleşen ürün bulunamadı.'; modelList.appendChild(empty);
    }
    if (resultsCount) resultsCount.textContent = matches.length + ' model';
    root.dataset.visibleModels = String(select.options.length);
  }
  let THREE;
  try { THREE = await import(options.threeUrl || 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); }
  catch (error) { fail(error); throw error; }
let renderer,scene,camera,currentGroup,floor,contactShadow,keyLight;
let currentId=config.models[0].id;
let yaw=.58,pitch=.21,viewScale=1,target=new THREE.Vector3();
let renderQueued=false,saveTimer;
const groups=new Map(),textures=new Map(),pointers=new Map();
const masters=new Map(),masterRequests=new Map();
let loaderPromise,masterGeneration=0,previewBuffer;
let gesture=null,mouseGesture=null;

function modelFor(id) { return modelsById.get(id)||config.models[0]; }
function previewFor(model) {
  if(groups.has(model.id))return groups.get(model.id);
  const materials={};for(const [name,definition] of Object.entries(model.materials))materials[name]=makeMaterial(definition);
  const group=new THREE.Group();group.name=model.name;
  for(const mesh of model.meshes){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(unpack(mesh.positions,Int32Array,config.precision.positions,3,previewBuffer),3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(unpack(mesh.normals,config.precision.normals===127?Int8Array:Int16Array,config.precision.normals,3,previewBuffer),3));
    geometry.setAttribute('uv',new THREE.BufferAttribute(unpack(mesh.uvs,Int32Array,config.precision.uvs,2,previewBuffer),2));
    const IndexType=mesh.indexType==='u32'?Uint32Array:Uint16Array;
    geometry.setIndex(new THREE.BufferAttribute(mesh.grid?gridIndices(mesh.grid):decode(mesh.indices,IndexType,1,previewBuffer),1));
    geometry.computeBoundingSphere();
    const material=materials[mesh.material];if(!material)throw new Error('Tanımsız malzeme: '+mesh.material);
    const object=new THREE.Mesh(geometry,material);object.name=mesh.name;group.add(object);
  }
  if(model.meshes.length){group.userData.box=new THREE.Box3().setFromObject(group);}
  else{
    if(!options.loadMasters)throw new Error('Tam model yükleme gerekli.');
    const [w,h,d]=model.dimensions_cm.map(value=>value/100);
    if(![w,h,d].every(value=>Number.isFinite(value)&&value>0))throw new Error('Model ölçüsü okunamadı.');
    group.userData.box=new THREE.Box3(new THREE.Vector3(-w/2,0,-d/2),new THREE.Vector3(w/2,h,d/2));
  }
  const size=group.userData.box.getSize(new THREE.Vector3());group.userData.extent=Math.max(size.x,size.y,size.z);
  group.visible=false;groups.set(model.id,group);scene.add(group);
  while(groups.size>4){
    const id=[...groups.keys()].find(key=>key!==model.id&&key!==currentId);
    if(id===undefined)break;
    const previous=groups.get(id),oldMaterials=new Set();groups.delete(id);previous.removeFromParent();
    previous.traverse(object=>{object.geometry?.dispose();if(object.material)oldMaterials.add(object.material);});
    for(const material of oldMaterials)material.dispose();
  }
  const usedTextures=new Set();
  for(const cached of groups.values())cached.traverse(object=>{
    const definitions=Array.isArray(object.material)?object.material:[object.material];
    for(const material of definitions)if(material)for(const value of Object.values(material))if(value?.isTexture)usedTextures.add(value);
  });
  for(const [key,texture] of textures)if(!usedTextures.has(texture)){textures.delete(key);texture.dispose();texture.image=null;}
  root.dataset.previewCacheSize=String(groups.size);root.dataset.previewTextureCacheSize=String(textures.size);
  return group;
}
function masterUrl(model) { return downloadById[model.id]||model.glb_url||model.glbUrl||model.download_url; }
function studioMetalness(material) {
  if(!material.metalnessMap)return material.metalness||0;
  const image=material.metalnessMap.image;
  if(!image)return 0;
  const sample=document.createElement('canvas');sample.width=sample.height=8;
  const context=sample.getContext('2d',{willReadFrequently:true});
  try{
    context.drawImage(image,0,0,8,8);
    const pixels=context.getImageData(0,0,8,8).data;let sum=0;
    for(let i=2;i<pixels.length;i+=4)sum+=pixels[i];
    return (material.metalness||0)*sum/(64*255);
  }catch{return 0;}
}
function disposeMaster(entry) {
  const geometries=new Set(),materials=new Set(),maps=new Set(),images=new Set();
  for(const group of entry.roots){
    group.removeFromParent();
    group.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const definitions=Array.isArray(object.material)?object.material:[object.material];
      for(const material of definitions){
        if(!material)continue;materials.add(material);
        for(const value of Object.values(material))if(value?.isTexture)maps.add(value);
      }
    });
  }
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
  for(const texture of maps){if(texture.source?.data)images.add(texture.source.data);texture.dispose();}
  for(const image of images)image?.close?.();
}
function trimMasterCache() {
  while(masters.size>4){
    const id=[...masters.keys()].find(key=>key!==currentId);
    if(id===undefined)break;
    const entry=masters.get(id);masters.delete(id);disposeMaster(entry);
  }
}
function positionGround() {
  if(!floor||!currentGroup)return;
  const extent=currentGroup.userData.extent,box=currentGroup.userData.box;
  floor.position.y=box.min.y-extent*.002;floor.scale.set(extent*50,extent*50,1);
  contactShadow.position.y=box.min.y-extent*.001;contactShadow.scale.set(extent*.9,extent*.9,1);
}
function activateGroup(group) {
  for(const preview of groups.values())preview.visible=preview===group;
  for(const entry of masters.values())for(const candidate of entry.roots)candidate.visible=candidate===group;
  currentGroup=group;positionGround();applyTheme();draw();
}
function sceneIndexFor(model) {
  const selected=variantById.get(model.id)??model.default_scene_index??0;
  return model.scene_variants?.some(variant=>variant.index===selected)?selected:model.default_scene_index??0;
}
function displayDimensions(model,group) {
  const selectedScene=Boolean(model.scene_variants?.length>1&&group?.userData.box);
  const values=selectedScene?group.userData.box.getSize(new THREE.Vector3()).multiplyScalar(100).toArray():model.dimensions_cm;
  const approximate=selectedScene||model.estimated_dimensions;
  const format=value=>new Intl.NumberFormat('tr-TR',{maximumFractionDigits:model.category==='Kırlentler'&&approximate?1:2}).format(value);
  dimensions.textContent=(selectedScene?'Seçili görünüm · ':'')+(approximate?'Yaklaşık ':'')+values.map(format).join(' × ')+' cm · En × Yükseklik × Derinlik';
  if(selectedScene)dimensions.title='Seçili görünümün modelden ölçülen dış boyutları. İndirilen GLB diğer görünümleri de içerir.';else dimensions.removeAttribute('title');
  root.dataset.displayDimensionsScope=selectedScene?'selected-scene':'catalog';
  root.dataset.displayDimensionsCm=JSON.stringify(values);
}
function activateMaster(entry,model) {
  const index=model.scene_variants?.length?sceneIndexFor(model):entry.defaultIndex,group=entry.roots[index];
  if(!group)throw new Error('Seçilen biçim model dosyasında bulunamadı.');
  entry.group=group;root.dataset.selectedSceneIndex=String(index);activateGroup(group);displayDimensions(model,group);
}
function fillSceneVariants(model) {
  if(!variantField)return;
  const variants=model.scene_variants||[];variantField.hidden=variants.length<2;variantSelect.replaceChildren();
  for(const variant of variants){const option=document.createElement('option');option.value=String(variant.index);option.textContent=variant.label;variantSelect.appendChild(option);}
  variantSelect.value=String(sceneIndexFor(model));
}
function masterStatus(id,status,error) {
  root.dataset.masterModel=id;root.dataset.masterStatus=status;
  if(error)root.dataset.masterError=String(error.message||error);else delete root.dataset.masterError;
  const hasPreview=Boolean(modelFor(id).meshes.length);
  loading.hidden=status!=='loading'&&(status!=='error'||hasPreview);
  loading.textContent=status==='loading'?'3D görünüm yükleniyor…':status==='error'&&!hasPreview?'3D model yüklenemedi. GLB dosyasını indirebilir veya sayfayı yenileyebilirsin.':'Modeller yükleniyor…';
  if(status==='error'&&!hasPreview)loading.setAttribute('role','alert');else loading.setAttribute('role','status');
  stage.setAttribute('aria-busy',String(status==='loading'));
  const quality=root.querySelector('[data-model-quality]');
  if(quality){quality.textContent=status==='ready'?'3D web görünümü':status==='loading'?'3D yükleniyor':hasPreview?'3D önizleme':'3D açılamadı';quality.title=status==='ready'?'Tarayıcı için hazırlanan 3D görünüm. Tam çözünürlüklü model ve malzemeler GLB indirmesinde korunur.':status==='error'?(hasPreview?'Tam model yüklenemedi; hafif önizleme gösteriliyor.':'Model yüklenemedi. Dosya indirme bağlantısı ve orijinal fotoğraflar kullanılabilir.'):'Malzemeli model yükleniyor.';}
  if(quality&&status==='ready'&&modelFor(id).quality_note){quality.textContent=modelFor(id).quality_label||'Fotoğraf yorumu';quality.title=modelFor(id).quality_note;}
}
function getMasterLoader() {
  if(!loaderPromise){
    loaderPromise=import(options.gltfLoaderUrl||'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js')
      .then(async module=>configureModelLoader(new module.GLTFLoader()))
      .catch(error=>{loaderPromise=null;throw error;});
  }
  return loaderPromise;
}
function loadMaster(model) {
  if(masters.has(model.id)){
    const entry=masters.get(model.id);masters.delete(model.id);masters.set(model.id,entry);return Promise.resolve(entry);
  }
  if(masterRequests.has(model.id))return masterRequests.get(model.id);
  const request=Promise.all([getMasterLoader(),loadPreviewModel(model.id)]).then(([loader,bytes])=>loader.parseAsync(bytes,'')).then(gltf=>{
    const group=gltf.scene||gltf.scenes?.[0];
    if(!group)throw new Error('Model sahnesi bulunamadı.');
    const roots=gltf.scenes?.length?gltf.scenes:[group];
    const entry={group,roots,defaultIndex:Math.max(0,roots.indexOf(group))};
    if(disposed){disposeMaster(entry);return null;}
    const maxAnisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
    const fineFurProduct=options.fitAllModels&&['1355345001','1357963001'].includes(model.sku);
    for(const candidate of entry.roots){candidate.traverse(object=>{
      const materials=Array.isArray(object.material)?object.material:[object.material];
      // Individual submillimetre hairs are smaller than a studio shadow texel.
      // Keep the cloth body's shadow without projecting aliased hair patches.
      const fineFibres=fineFurProduct&&materials.some(material=>/(?:fine|free|hair).*(?:fibr|fiber|strand|hair)/i.test(material?.name||''));
      if(options.selfShadows&&object.isMesh){object.castShadow=!fineFibres&&!materials.some(material=>material?.transmission>.02);object.receiveShadow=true;}
      for(const material of materials){
        if(!material)continue;
        if(options.fitAllModels&&'envMapIntensity'in material)material.envMapIntensity=.32+((options.studioMetalEnvironmentIntensity??.9)-.32)*studioMetalness(material);
        for(const value of Object.values(material))if(value?.isTexture)value.anisotropy=maxAnisotropy;
      }
    });
    // Three's transmission buffer excludes other transmissive objects. For a
    // colored glass cup inside clear glass, draw the clear shell without a
    // depth write so its interior remains visible. Downloaded masters retain
    // their original physical materials and geometry.
    if(options.nestedTransmissionPreview){
      let hasAccent=false;
      candidate.traverse(object=>{const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(material=>material?.name==='accent'&&material.transmission>.5))hasAccent=true;});
      if(hasAccent)candidate.traverse(object=>{
        const materials=Array.isArray(object.material)?object.material:[object.material];
        if(materials.some(material=>material?.name==='clear'&&material.transmission>.5)){for(const material of materials)if(material?.name==='clear')material.depthWrite=false;object.renderOrder=-1;}
        else if(materials.some(material=>material?.name==='accent'&&material.transmission>.5))object.renderOrder=1;
      });
    }
    candidate.updateMatrixWorld(true);
    candidate.userData.box=new THREE.Box3().setFromObject(candidate);
    const size=candidate.userData.box.getSize(new THREE.Vector3());candidate.userData.extent=Math.max(size.x,size.y,size.z);
    if(!Number.isFinite(candidate.userData.extent)||candidate.userData.extent<=0){disposeMaster(entry);throw new Error('Model boyutu okunamadı.');}
    candidate.visible=false;scene.add(candidate);}
    masters.set(model.id,entry);trimMasterCache();return entry;
  }).finally(()=>masterRequests.delete(model.id));
  masterRequests.set(model.id,request);return request;
}
function requestMaster(model,generation) {
  if(!options.loadMasters)return;
  const id=model.id;
  if(!masterUrl(model)){masterStatus(id,'error',new Error('Tam model bağlantısı bulunamadı.'));return;}
  masterStatus(id,masters.has(id)?'ready':'loading');
  loadMaster(model).then(entry=>{
    if(disposed||generation!==masterGeneration||currentId!==id||!entry)return;
    activateMaster(entry,model);masterStatus(id,'ready');
  }).catch(error=>{
    if(disposed||generation!==masterGeneration||currentId!==id)return;
    masterStatus(id,'error',error);activateGroup(previewFor(model));
  });
}
function sizeSourceLabel(model) {
  if(model.size_source_kind==='official_dimensions_photo_oriented_axes')return 'Resmî sayı değerleri · Eksenler fotoğraftan';
  if(model.size_source_kind==='official_height_width_estimated_depth')return 'Resmî yükseklik/en · Derinlik teyit bekliyor';
  if(model.size_source_kind==='official_dimensions_axes_normalized')return 'Resmî ölçüler · Kullanım yönüne göre eksenler';
  if(['official_plan_dimensions_estimated_thickness','official_textile_plan_estimated_thickness'].includes(model.size_source_kind))return 'Resmî en/boy · Yaklaşık kalınlık';
  if(['official_cover_dimensions_estimated_filling','official_cushion_plan_estimated_depth'].includes(model.size_source_kind))return 'Resmî en/boy · Yaklaşık dolgu';
  if(model.size_source_kind==='official_textile_plan_estimated_folded_pose')return 'Resmî düz kumaş en/boyu · Yaklaşık katlanmış poz';
  if(model.size_source_kind==='official_panel_dimensions_estimated_hanging_pose')return 'Resmî panel en/boyu · Yaklaşık asılı poz';
  if(model.size_source_kind==='official_two_axis_cylindrical_symmetry_depth')return 'Resmî iki ölçü · Simetriden yorumlanan derinlik';
  if(model.estimated_dimensions)return model.size_source_kind==='photo_estimate'?'Fotoğraftan ölçeklendi':'Kısmen yaklaşık ölçü';
  const kind=model.size_source_kind||'';
  const market=String(model.source_market||'').toUpperCase();
  const names={TR:'Türkiye',GB:'Birleşik Krallık',UK:'Birleşik Krallık',SA:'Suudi Arabistan',US:'ABD',BE:'Belçika',ES:'İspanya',DE:'Almanya',FR:'Fransa',NL:'Hollanda',PT:'Portekiz',AE:'Birleşik Arap Emirlikleri'};
  if(kind==='official_cross_market'||market&&market!=='TR')return 'Resmi ölçü · '+(names[market]||model.source_market||'Türkiye dışı');
  if(kind==='tr_live_product'||kind==='official_tr_research'||market==='TR')return 'Resmi Türkiye ölçüsü';
  return '';
}
function saveState() {
  const model=modelFor(currentId);
  const state={
    modelContent:{kategori:model.category,urun:model.name,referans:model.sku,malzeme:model.materialLabel,yaklasikOlcu:Boolean(model.estimated_dimensions),olcuKaynagi:sizeSourceLabel(model)},
    privateContent:{batchId:config.batchId,id:currentId,sceneIndex:sceneIndexFor(model),yaw,pitch,viewScale}
  };
  try { localStorage.setItem(storageKey,JSON.stringify(state)); } catch(_) {}
}
function readState() {
  try { const saved=JSON.parse(localStorage.getItem(storageKey)||'null'); if(saved?.privateContent?.batchId===config.batchId)return saved; } catch(_) {}
  return null;
}
function saveSoon() { clearTimeout(saveTimer); saveTimer=setTimeout(saveState,200); }
function cameraProjection() {
  if(!camera||!currentGroup)return;
  const box=currentGroup.userData.box;
  const extent=currentGroup.userData.extent;
  const aspect=Math.max(1,stage.clientWidth)/Math.max(1,stage.clientHeight);
  const model=modelFor(currentId);
  const visibleSize=options.fitAllModels?box.getSize(new THREE.Vector3()).multiplyScalar(100).toArray():model.dimensions_cm;
  const [width,height,depth]=visibleSize;
  const flatBowl=['Dekoratif kaseler','Dekoratif tepsiler','Mumluk ve şamdanlar','Dekoratif objeler','Dekoratif kutular'].includes(model.category)&&height/Math.max(width,depth)<.5;
  const fitScale=flatBowl?Math.max(.65,Math.min(1,1/aspect)):1;
  let vertical=extent*1.35*viewScale*Math.max(1,.8/aspect)*fitScale;
  if(options.fitAllModels||['Dekoratif objeler','Dekoratif sepetler','Dekoratif aynalar','Fotoğraf çerçeveleri','Dekoratif saksılar','Dekoratif kutular','Dekoratif aydınlatma',...newCategoryNames].includes(model.category)){
    const projectedWidth=(Math.abs(width*Math.cos(yaw))+Math.abs(depth*Math.sin(yaw)))/100;
    const projectedHeight=(height*Math.abs(Math.cos(pitch))+(Math.abs(width*Math.sin(yaw))+Math.abs(depth*Math.cos(yaw)))*Math.abs(Math.sin(pitch)))/100;
    vertical=Math.max(vertical,1.12*viewScale*Math.max(projectedWidth/aspect,projectedHeight));
  }
  camera.left=-vertical*aspect/2;camera.right=vertical*aspect/2;
  camera.top=vertical/2;camera.bottom=-vertical/2;camera.updateProjectionMatrix();
  target.copy(box.getCenter(new THREE.Vector3()));
  if(options.selfShadows&&keyLight){
    keyLight.target.position.copy(target);keyLight.target.updateMatrixWorld();
    const distance=keyLight.position.distanceTo(target),radius=extent*1.2,shadow=keyLight.shadow;
    Object.assign(shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:Math.max(.001,distance-radius*2),far:distance+radius*2});
    shadow.normalBias=extent*.0004;shadow.camera.updateProjectionMatrix();
  }
  camera.position.set(target.x+3*Math.sin(yaw)*Math.cos(pitch),target.y+3*Math.sin(pitch),target.z+3*Math.cos(yaw)*Math.cos(pitch));
  camera.lookAt(target);
}
function draw() {
  if(disposed||!renderer||renderQueued)return;
  renderQueued=true;
  requestAnimationFrame(()=>{renderQueued=false;if(disposed)return;cameraProjection();renderer.render(scene,camera);});
}
function selectModel(id,persist=true,reset=true) {
  const model=modelFor(id);currentId=model.id;
  const generation=++masterGeneration;
  if(!belongsToCategory(model,categorySelect.value)||!Array.from(select.options).some(option=>option.value===currentId)){
    categorySelect.value=model.category;
    if(search)search.value='';
    fillModelOptions(model.category);
  }
  select.value=currentId;
  fillSceneVariants(model);
  if(options.loadMasters&&masters.has(currentId))activateMaster(masters.get(currentId),model);else activateGroup(previewFor(model));
  displayDimensions(model,options.loadMasters?masters.get(currentId)?.group:null);
  sizeOrigin.textContent=sizeSourceLabel(model);
  sourceNotes.textContent=(model.source_notes||[]).join(' ');
  const sizeUrl=(model.size_source_urls||[]).find(url=>typeof url==='string'&&/^https:\/\//i.test(url));
  sizeSourceLink.hidden=!sizeUrl;if(sizeUrl)sizeSourceLink.href=sizeUrl;else sizeSourceLink.removeAttribute('href');
  sourceDetail.hidden=!sourceNotes.textContent&&!sizeUrl;
  sourceLink.href=model.url;
  const download=downloadById[model.id]||model.glb_url||model.glbUrl||model.download_url;
  downloadLink.hidden=!download;
  if(download){downloadLink.href=download;downloadLink.setAttribute('download',model.id+'.glb');}else downloadLink.removeAttribute('href');
  materialLabel.textContent=model.materialLabel||'';
  canvas.setAttribute('aria-label',model.name+'. Malzemeli üç boyutlu görünüm. Sürükleyerek döndürün, kaydırarak yakınlaşın.');
  if(reset){
    const foldedTextile=options.fitAllModels&&(model.category==='Battaniye ve örtüler'||model.category==='Ev tekstili'&&/fold/i.test(model.id));
    const tray=model.category==='Dekoratif tepsiler'||foldedTextile||(options.fitAllModels&&(model.size_source_kind==='official_textile_plan_estimated_folded_pose'||(model.category==='Tepsiler'||/tepsi|taba[kğ]/i.test(model.name))&&model.dimensions_cm[1]/Math.max(model.dimensions_cm[0],model.dimensions_cm[2])<.4||model.dimensions_cm[1]/Math.max(model.dimensions_cm[0],model.dimensions_cm[2])<.18));
    const [width,height,depth]=model.dimensions_cm;
    const shallowCandle=['Mumluk ve şamdanlar','Dekoratif objeler','Dekoratif kutular'].includes(model.category)&&height/Math.max(width,depth)<.5;
    const flatUpright=['Dekoratif aynalar','Fotoğraf çerçeveleri','Aynalar','Çerçeveler'].includes(model.category);
    const paperStar=model.category==='Aydınlatma'&&/k[aâ]ğıt|paper|yıldız|star/i.test(model.name)&&depth/Math.max(width,height)<.5;
    yaw=model.sku==='4328/043/700'?.05:model.sku==='4515/043/808'?-Math.PI/2+.12:model.sku==='8044/043/970'?-.5:tray?(depth>width*1.15?Math.PI/2+.24:.24):shallowCandle?.3:.58;
    pitch=tray?(height/Math.max(width,depth)>.2?(options.fitAllModels?.6:.45):(options.fitAllModels?.95:.7)):shallowCandle?.65:.21;
    if(flatUpright||paperStar){yaw=.10;pitch=.055;}
    // These shallow caps hide their narrow necks from an elevated reset view.
    if(/^hm-102439802[12]-/.test(model.id)){yaw=.16;pitch=.04;}
    if(/^hm-1275547001-/.test(model.id)){yaw=.06;pitch=.02;}
    if(/^hm-1253603001-/.test(model.id)){yaw=.02;pitch=.20;}
    if(/^hm-1206693001-/.test(model.id)){yaw=.10;pitch=.085;}
    if(/^hm-125390700[13]-/.test(model.id)){yaw=.01;pitch=.02;}
    if(model.category==='Mobilya'&&height/Math.max(width,depth)<.18){yaw=.52;pitch=.32;}
    if(model.category==='Dekoratif kutular'){yaw=.35;pitch=.38;}
    if(['Yan sehpalar','Tabureler','Sandalyeler','Banklar','Puflar'].includes(model.category)){yaw=.52;pitch=.32;}
    if(model.category==='Halılar'){yaw=.16;pitch=.88;}
    if(model.category==='Dekoratif aksesuarlar'&&height/Math.max(width,depth)<.12){yaw=.16;pitch=.88;}
    if(model.category==='Kırlentler'){yaw=.46;pitch=.16;}
    if(model.category==='Dekoratif mumlar'){yaw=.3;pitch=height/Math.max(width,depth)<.5?.58:.22;}
    if(model.category==='Masaüstü aksesuarları'){yaw=.35;pitch=.48;}
    viewScale=1;
  }
  root.dataset.selectedModel=currentId;
  root.dataset.estimatedDimensions=String(Boolean(model.estimated_dimensions));
  announcement.textContent=model.name+(model.estimated_dimensions?' · Yaklaşık ölçü':'');
  updateSelectedRows();
  draw();if(persist)saveState();
  const detail={model,category:model.category,id:currentId};
  root.dispatchEvent(new CustomEvent('vase:modelchange',{detail}));
  options.onModelChange?.(model);
  requestMaster(model,generation);
}

function restoreState(saved) {
  const state=saved?.privateContent;if(!state||typeof state!=='object'||state.batchId!==config.batchId||!modelsById.has(state.id))return;
  const model=modelFor(state.id);if(model.scene_variants?.some(variant=>variant.index===state.sceneIndex))variantById.set(state.id,state.sceneIndex);
  selectModel(state.id,false,true);
  if(Number.isFinite(state.yaw))yaw=state.yaw;
  if(Number.isFinite(state.pitch))pitch=Math.max(-1.25,Math.min(1.4,state.pitch));
  if(Number.isFinite(state.viewScale))viewScale=Math.max(.35,Math.min(2.1,state.viewScale));
  draw();
}
function zoomBy(factor) {viewScale=Math.max(.35,Math.min(2.1,viewScale*factor));draw();saveSoon();}
function makeTexture(index,color=false) {
  if(index===null||index===undefined)return null;
  const key=index+':'+color;if(textures.has(key))return textures.get(key);
  const texture=new THREE.Texture();const image=new Image();
  texture.flipY=false;
  texture.wrapS=THREE.RepeatWrapping;
  texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
  image.onload=()=>{if(disposed||textures.get(key)!==texture)return;texture.image=image;texture.needsUpdate=true;draw();};
  image.onerror=()=>{if(!disposed&&textures.get(key)===texture)root.dataset.textureError=String(index);};image.src=config.textures[index];
  textures.set(key,texture);return texture;
}
function makeMaterial(material) {
  const rgba=material.baseColorFactor||[1,1,1,1];
  const roughnessMap=makeTexture(material.metallicRoughnessTexture);
  const normalScale=material.normalScale??.3;
  const transmission=material.transmission??0;
  const attenuation=material.attenuationColor||[1,1,1];
  return new THREE.MeshPhysicalMaterial({
    color:new THREE.Color().setRGB(rgba[0],rgba[1],rgba[2],THREE.LinearSRGBColorSpace),
    opacity:rgba[3]??1,transparent:material.alphaMode==='BLEND',
    alphaTest:material.alphaMode==='MASK'?(material.alphaCutoff??.5):0,
    map:makeTexture(material.baseColorTexture,true),
    normalMap:makeTexture(material.normalTexture),
    normalScale:new THREE.Vector2(normalScale,normalScale),
    roughness:material.roughness??.5,metalness:material.metallic??0,
    roughnessMap,metalnessMap:roughnessMap,
    transmission,ior:material.ior??1.5,thickness:material.thickness??0,
    attenuationColor:new THREE.Color().setRGB(attenuation[0],attenuation[1],attenuation[2],THREE.LinearSRGBColorSpace),
    attenuationDistance:material.attenuationDistance>0?material.attenuationDistance:Infinity,
    transmissionMap:makeTexture(material.transmissionTexture),thicknessMap:makeTexture(material.thicknessTexture),
    clearcoat:material.clearcoat??0,clearcoatRoughness:material.clearcoatRoughness??0,
    clearcoatMap:makeTexture(material.clearcoatTexture),clearcoatRoughnessMap:makeTexture(material.clearcoatRoughnessTexture),
    clearcoatNormalMap:makeTexture(material.clearcoatNormalTexture),clearcoatNormalScale:new THREE.Vector2(material.clearcoatNormalScale??1,material.clearcoatNormalScale??1),
    envMapIntensity:1,side:material.doubleSided?THREE.DoubleSide:THREE.FrontSide,
  });
}
async function geometryBuffer() {
  const compressed=Uint8Array.from(atob(config.data),character=>character.charCodeAt(0));
  const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}
function decode(field,type,stride,buffer) {
  const result=new type(new type(buffer,field[0],field[1]));
  for(let index=stride;index<result.length;index++)result[index]+=result[index-stride];
  return result;
}
function unpack(field,type,divisor,stride,buffer) {return Float32Array.from(decode(field,type,stride,buffer),value=>value/divisor);}
function gridIndices(grid) {
  const values=[],cols=grid.columns,rows=grid.rows;
  for(let row=0;row<rows-1;row++)for(let col=0;col<cols-1;col++){
    const a=row*cols+col,b=a+cols;
    if(grid.reverse)values.push(a,b+1,b,a,a+1,b+1);else values.push(a,b,b+1,a,b+1,a+1);
  }
  for(const cap of grid.caps||[])for(let col=0;col<cols-1;col++){
    const a=cap.row*cols+col;
    if(cap.forward)values.push(cap.center,a,a+1);else values.push(cap.center,a+1,a);
  }
  return new (grid.vertexCount>65535?Uint32Array:Uint16Array)(values);
}
function themeColor(token) {
  const swatch=document.createElement('span');swatch.style.color=`var(${token},${token==='--background'?'#f4f1eb':'#24251f'})`;root.appendChild(swatch);
  const value=getComputedStyle(swatch).color;swatch.remove();return new THREE.Color(value);
}
function applyTheme(){
  if(!scene)return;
  const background=modelFor(currentId).category==='Dekoratif fenerler'?new THREE.Color('#c7c2b7'):themeColor('--background'),foreground=themeColor('--foreground');scene.background=background;
  if(floor){
    const image=document.createElement('canvas');image.width=image.height=256;
    const ctx=image.getContext('2d'),gradient=ctx.createRadialGradient(128,128,0,128,128,180);
    gradient.addColorStop(0,background.clone().lerp(foreground,.09).getStyle());
    gradient.addColorStop(.42,background.clone().lerp(foreground,.035).getStyle());
    gradient.addColorStop(1,background.getStyle());ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
    floor.material.map?.dispose();floor.material.map=new THREE.CanvasTexture(image);floor.material.map.colorSpace=THREE.SRGBColorSpace;floor.material.needsUpdate=true;
    contactShadow.material.color.copy(background).multiplyScalar(.2);
  }
  draw();
}
function studioEnvironment() {
  const studio=new THREE.Scene();studio.background=new THREE.Color().setRGB(options.fitAllModels?.65:.24,options.fitAllModels?.65:.24,options.fitAllModels?.65:.24);
  const roomLevel=options.fitAllModels?.65:.28;
  const room=new THREE.Mesh(new THREE.BoxGeometry(12,8,12),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(roomLevel,roomLevel,roomLevel),side:THREE.BackSide}));studio.add(room);
  function card(width,height,position,intensity){
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(intensity,intensity,intensity),side:THREE.DoubleSide}));
    mesh.position.fromArray(position);mesh.lookAt(0,0,0);studio.add(mesh);
  }
  card(2.8,5.2,[-3.8,1.2,.8],4.5);card(1.5,4.7,[3.6,1.0,-1.6],2.5);card(4.2,2.0,[.5,3.5,-2.5],3.0);
  card(2.0,5.8,[-2.6,.3,2.1],options.fitAllModels?.15:.004);card(1.8,5.2,[2.7,.4,2.0],options.fitAllModels?.18:.008);card(6,2.2,[0,-2.4,-2],options.fitAllModels?.3:.035);
  const generator=new THREE.PMREMGenerator(renderer);const output=generator.fromScene(studio,.025).texture;
  studio.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});generator.dispose();return output;
}
function makeContactShadow(){
  const image=document.createElement('canvas');image.width=image.height=128;
  const ctx=image.getContext('2d'),gradient=ctx.createRadialGradient(64,64,2,64,64,64);
  gradient.addColorStop(0,'rgba(255,255,255,.22)');gradient.addColorStop(.4,'rgba(255,255,255,.12)');gradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(image);const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));mesh.rotation.x=-Math.PI/2;return mesh;
}
async function init() {
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  if(options.selfShadows){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=options.fitAllModels?.9:1;
  scene=new THREE.Scene();scene.environment=studioEnvironment();
  floor=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({toneMapped:false}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  contactShadow=makeContactShadow();scene.add(contactShadow);
  camera=new THREE.OrthographicCamera(-.5,.5,.5,-.5,.001,20);
  scene.add(new THREE.HemisphereLight(0xffffff,0xb0b0b0,options.fitAllModels?.45:1.15));
  const key=new THREE.DirectionalLight(0xffffff,2.7);key.position.set(-2,4,3);scene.add(key);
  keyLight=key;
  if(options.selfShadows){key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.00001;scene.add(key.target);}
  const fill=new THREE.DirectionalLight(0xffffff,options.fitAllModels?.35:.8);fill.position.set(3,2,-1);scene.add(fill);
  previewBuffer=await geometryBuffer();
  fillModelOptions(categorySelect.value);
  selectModel(options.initialModel||defaultModel.id,false);restoreState(readState());
  const resize=()=>{renderer.setSize(Math.max(stage.clientWidth,1),Math.max(stage.clientHeight,1),false);draw();};
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);cleanups.push(()=>resizeObserver.disconnect());resize();
  listen(select,'change',()=>selectModel(select.value));
  listen(variantSelect,'change',()=>{
    const model=modelFor(currentId),index=Number(variantSelect.value);
    if(!model.scene_variants?.some(variant=>variant.index===index))return;
    variantById.set(model.id,index);
    const entry=masters.get(model.id);if(entry)activateMaster(entry,model);
    const variant=model.scene_variants.find(item=>item.index===index);announcement.textContent=model.name+' · '+variant.label;saveState();
  });
  listen(categorySelect,'change',()=>{if(search)search.value='';fillModelOptions(categorySelect.value);if(select.value)selectModel(select.value);});
  listen(search,'input',()=>{fillModelOptions(categorySelect.value);if(!Array.from(select.options).some(option=>option.value===currentId))select.value='';});
  listen(modelList,'click',event=>{const button=event.target.closest('[data-model-id]');if(button&&modelList.contains(button)&&modelsById.has(button.dataset.modelId))selectModel(button.dataset.modelId);});
  listen(get('reset','[data-reset]'),'click',()=>selectModel(currentId));
  root.querySelectorAll('[data-rotate]').forEach(button=>listen(button,'click',()=>{yaw+=(button.dataset.rotate==='left'?1:-1)*Math.PI/6;draw();saveState();}));
  root.querySelectorAll('[data-zoom]').forEach(button=>listen(button,'click',()=>zoomBy(button.dataset.zoom==='in'?.82:1.22)));
  listen(canvas,'pointerdown',event=>{
    event.preventDefault();mouseGesture=null;canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1)gesture={x:event.clientX,y:event.clientY,yaw,pitch};
    else if(pointers.size===2){const a=[...pointers.values()];gesture={distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),viewScale};}
  });
  listen(canvas,'pointermove',event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;event.preventDefault();
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1&&gesture.yaw!==undefined){yaw=gesture.yaw-(event.clientX-gesture.x)*.008;pitch=Math.max(-1.25,Math.min(1.4,gesture.pitch+(event.clientY-gesture.y)*.006));}
    else if(pointers.size===2&&gesture.distance){const a=[...pointers.values()];const distance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);viewScale=Math.max(.35,Math.min(2.1,gesture.viewScale*gesture.distance/Math.max(distance,1)));}
    draw();saveSoon();
  });
  function release(event){pointers.delete(event.pointerId);if(pointers.size===1){const a=[...pointers.values()][0];gesture={x:a.x,y:a.y,yaw,pitch};}else gesture=null;saveSoon();}
  listen(canvas,'pointerup',release);listen(canvas,'pointercancel',release);
  listen(canvas,'lostpointercapture',event=>{if(pointers.has(event.pointerId))release(event);});
  listen(canvas,'mousedown',event=>{if(pointers.size||event.button!==0)return;event.preventDefault();mouseGesture={x:event.clientX,y:event.clientY,yaw,pitch};});
  listen(window,'mousemove',event=>{if(!mouseGesture||pointers.size)return;event.preventDefault();yaw=mouseGesture.yaw-(event.clientX-mouseGesture.x)*.008;pitch=Math.max(-1.25,Math.min(1.4,mouseGesture.pitch+(event.clientY-mouseGesture.y)*.006));draw();saveSoon();});
  listen(window,'mouseup',()=>{mouseGesture=null;});
  listen(window,'blur',()=>{mouseGesture=null;pointers.clear();gesture=null;});
  listen(canvas,'wheel',event=>{event.preventDefault();zoomBy(Math.exp(Math.max(-150,Math.min(150,event.deltaY))*.0018));},{passive:false});
  listen(canvas,'contextmenu',event=>event.preventDefault());listen(canvas,'dragstart',event=>event.preventDefault());
  const themeObserver=new MutationObserver(applyTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});cleanups.push(()=>themeObserver.disconnect());
  listen(matchMedia('(prefers-color-scheme: dark)'),'change',applyTheme);applyTheme();
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();loading.hidden=false;loading.textContent='Görüntü duraklatıldı. Yeniden açın.';loading.setAttribute('role','alert');});
  loading.hidden=root.dataset.masterStatus!=='loading';stage.setAttribute('aria-busy',String(root.dataset.masterStatus==='loading'));root.dataset.loaded='true';root.dataset.modelCount=String(config.models.length);
  root.dataset.triangles=String(config.models.reduce((sum,model)=>sum+model.meshes.reduce((count,mesh)=>count+mesh.triangles,0),0));
  root.dataset.previewQuality=String(config.quality);root.dataset.batchId=config.batchId;
}

function dispose() {
  if(disposed)return;disposed=true;masterGeneration++;clearTimeout(saveTimer);
  cleanups.splice(0).forEach(cleanup=>cleanup());
  for(const entry of masters.values())disposeMaster(entry);masters.clear();masterRequests.clear();
  scene?.traverse(object=>{object.geometry?.dispose();const material=object.material;if(Array.isArray(material))material.forEach(item=>item.dispose());else material?.dispose();});
  for(const texture of textures.values())texture.dispose();
  floor?.material?.map?.dispose();contactShadow?.material?.map?.dispose();scene?.environment?.dispose();
  keyLight?.shadow?.map?.dispose();keyLight?.shadow?.mapPass?.dispose();
  renderer?.dispose();groups.clear();textures.clear();pointers.clear();previewBuffer=null;delete root.dataset.loaded;
}
try { await init(); }
catch(error) { fail(error);dispose();throw error; }
return {
  selectModel(id) { if(!disposed&&modelsById.has(id))selectModel(id); },
  selectCategory(category) { if(disposed||!categoryNames.includes(category))return;categorySelect.value=category;if(search)search.value='';fillModelOptions(category);if(select.value)selectModel(select.value); },
  getState() { return {id:currentId,category:modelFor(currentId).category,yaw,pitch,viewScale}; },
  getModel(id=currentId) { return modelsById.get(id); },
  resize() { if(disposed)return;renderer.setSize(Math.max(stage.clientWidth,1),Math.max(stage.clientHeight,1),false);draw(); },
  dispose
};
}
export default mountVaseViewer;
