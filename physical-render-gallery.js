/** A clearly labelled still-image view of the unchanged downloadable glass model. */
export function mountPhysicalRenderGallery(root, {catalogUrl='./physical-glass-renders.json'}={}) {
  const stage=root.querySelector('.vase-stage'),canvas=stage?.querySelector('canvas');
  if(!stage||!canvas)return {dispose(){}};
  const pane=stage.closest('.model-pane'),toolbar=pane.querySelector('.view-toolbar');
  const heading=pane.querySelector('.pane-heading>span'),hint=pane.querySelector('.pane-hint');
  const stageNote=stage.querySelector('.stage-note');
  const original={heading:heading?.textContent,hint:hint?.textContent,note:stageNote?.textContent};
  const controls=document.createElement('div');controls.className='physical-view-switch';controls.hidden=true;controls.setAttribute('aria-label','Cam modelinin görünümü');
  const renderButton=document.createElement('button'),threeButton=document.createElement('button');
  for(const b of [renderButton,threeButton])b.type='button';
  renderButton.textContent='Malzeme renderi';threeButton.textContent='Serbest 3D';controls.append(renderButton,threeButton);pane.querySelector('.pane-heading').append(controls);
  const image=document.createElement('img');image.className='physical-model-render';image.hidden=true;image.decoding='async';image.draggable=false;stage.append(image);
  const angles=document.createElement('div');angles.className='physical-angle-controls';angles.hidden=true;angles.setAttribute('aria-label','Model renderinin açısı');
  const labels=['Ön','Sağ','Arka','Sol'];
  const angleButtons=labels.map((label,i)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>selectAngle(i));angles.append(b);return b;});toolbar.after(angles);
  const note=document.createElement('p');note.className='physical-render-caption';note.hidden=true;note.textContent='Cam yüzeyi için modelden hesaplanan görünüm. Serbest 3D’de saydamlık farklı görünebilir.';angles.after(note);
  let dataPromise,current=null,angle=0,mode='3d',generation=0,disposed=false;
  const sourceHash=()=>{try{return new URL(root.querySelector('[data-download]').href,location.href).searchParams.get('v');}catch{return null;}};
  function showMode(next){
    mode=current&&next==='render'?'render':'3d';const still=mode==='render';
    pane.classList.toggle('has-physical-render-options',Boolean(current));
    root.dataset.modelRenderMode=mode;controls.hidden=!current;note.hidden=!current;
    image.hidden=!still;angles.hidden=!still;toolbar.hidden=still;
    stage.classList.toggle('show-physical-render',still);canvas.setAttribute('aria-hidden',String(still));
    renderButton.setAttribute('aria-pressed',String(still));threeButton.setAttribute('aria-pressed',String(!still));
    if(heading)heading.textContent=still?'Model renderi':original.heading;
    if(hint){hint.textContent=original.hint;hint.hidden=Boolean(current);}
    if(stageNote)stageNote.textContent=still?'Model renderi · 4 açı':original.note;
  }
  function selectAngle(index){
    if(!current)return;angle=index;const frame=current.views[index],token=generation,id=current.id;
    root.dataset.modelRenderStatus='loading';root.dataset.modelRenderAngle=String(frame.angle_degrees);
    root.dataset.modelRenderImageSha256=frame.image_sha256;
    angleButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    image.alt=current.name+' · '+labels[index]+' açıdan malzeme renderi';
    if(image.getAttribute('src')===frame.image&&image.complete&&image.naturalWidth>0){root.dataset.modelRenderStatus='ready';return;}
    image.onload=()=>{if(disposed||generation!==token||current?.id!==id||image.getAttribute('src')!==frame.image)return;root.dataset.modelRenderStatus='ready';};
    image.onerror=()=>{if(disposed||generation!==token)return;root.dataset.modelRenderStatus='error';showMode('3d');note.textContent='Model renderi açılamadı. Serbest 3D görünümünü kullanabilirsin.';};
    image.src=frame.image;
  }
  async function select(id){
    const token=++generation;current=null;image.removeAttribute('src');showMode('3d');
    root.dataset.modelRenderStatus='unavailable';delete root.dataset.modelRenderId;delete root.dataset.modelRenderGlbSha256;delete root.dataset.modelRenderAngle;delete root.dataset.modelRenderImageSha256;
    if(!/^hm-(?:122631500[12]|127754300[12]|1277798003|1277548001)-/.test(id||''))return;
    try{
      dataPromise??=fetch(catalogUrl).then(response=>{if(!response.ok)throw Error('Renderler açılamadı');return response.json();}).catch(error=>{dataPromise=null;throw error;});
      const data=await dataPromise;if(disposed||generation!==token)return;
      const entry=data.models?.find(e=>e.id===id);
      if(!entry||entry.glb_sha256!==sourceHash()||entry.views?.length!==4)return;
      if(!entry.views.every((v,i)=>v.angle_degrees===i*90&&/^[a-f0-9]{64}$/.test(v.image_sha256||'')&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(v.image)))return;
      current=entry;root.dataset.modelRenderId=id;root.dataset.modelRenderGlbSha256=entry.glb_sha256;
      note.textContent='Cam yüzeyi için modelden hesaplanan görünüm. Serbest 3D’de saydamlık farklı görünebilir.';
      selectAngle(0);showMode(Number(pane.querySelector('[data-scene-variant]')?.value||0)===0?'render':'3d');
    }catch{if(generation===token)showMode('3d');}
  }
  function switchToRender(){
    const variant=pane.querySelector('[data-scene-variant]');
    if(variant&&variant.value!=='0'){variant.value='0';variant.dispatchEvent(new Event('change',{bubbles:true}));}
    showMode('render');
  }
  const onChange=event=>select(event.detail.id);
  const onVariant=()=>showMode('3d');
  root.addEventListener('vase:modelchange',onChange);pane.querySelector('[data-scene-variant]')?.addEventListener('change',onVariant);
  renderButton.addEventListener('click',switchToRender);threeButton.addEventListener('click',()=>showMode('3d'));
  select(root.dataset.selectedModel);
  return {dispose(){disposed=true;generation++;root.removeEventListener('vase:modelchange',onChange);pane.querySelector('[data-scene-variant]')?.removeEventListener('change',onVariant);controls.remove();image.remove();angles.remove();note.remove();canvas.removeAttribute('aria-hidden');toolbar.hidden=false;stage.classList.remove('show-physical-render');pane.classList.remove('has-physical-render-options');}};
}
