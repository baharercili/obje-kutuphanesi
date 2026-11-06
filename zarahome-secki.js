(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = $('hipicon-app');
  const gallery = $('gallery');
  const dialog = $('product-dialog');
  const storageKey = 'bahar-zarahome-reference-selection-v1';
  const state = { products: [], sources: [], selected: new Set(), pending: [], selectionMode: 'server', processing: false, search: '', source: '', status: '', onlySelected: false, activeProduct: null, activeImage: 0, openerId: null, ready: false };
  const text = value => typeof value === 'string' ? value.trim() : '';
  const fold = value => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function safeUrl(value, image = false) {
    try {
      const url = new URL(value);
      const allowed = image ? ['static.zarahome.net'] : ['www.zarahome.com', 'zarahome.com'];
      return url.protocol === 'https:' && allowed.includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function modelLinks(product) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]+$/.test(product.model_id || '')) return null;
    const version = String(product.model_sha256 || '');
    if (!/^[a-f0-9]{64}$/.test(version)) return null;
    const categories = { 'Dekoratif sepetler': 'sepetler', 'Dekoratif aynalar': 'aynalar', 'Fotoğraf çerçeveleri': 'cerceveler', 'Dekoratif saksılar': 'saksilar', 'Dekoratif kutular': 'kutular', 'Dekoratif aydınlatma': 'aydinlatma', 'Yan sehpalar': 'yan-sehpalar', 'Tabureler': 'tabureler', 'Banklar': 'banklar', 'Puflar': 'puflar', 'Kırlentler': 'kirlentler', 'Halılar': 'halilar', 'Çubuklu oda kokuları': 'oda-kokulari', 'Dekoratif mumlar': 'dekoratif-mumlar', 'Havluluk ve askılar': 'havluluk-askilar', 'Masaüstü aksesuarları': 'masaustu' };
    const category = categories[product.category];
    return { view: './zarahome.html?' + (category ? 'kategori=' + category + '&' : '') + 'model=' + encodeURIComponent(product.model_id) + '#koleksiyon', download: './download.html?model=' + encodeURIComponent(product.model_id) };
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  async function requestJson(path, options = {}) {
    const localEndpoints={
      './api/hipicon/selection':['bahar-hipicon-reference-selection-v1','selected_ids','selected'],
      './api/hipicon/visibility':['bahar-hipicon-hidden-products-v1','hidden_ids','hidden'],
      './api/zarahome/selection':['bahar-zarahome-reference-selection-v1','selected_ids','selected']
    };
    if(localEndpoints[path]){
      const [key,field,flag]=localEndpoints[path];
      const stored=JSON.parse(localStorage.getItem(key)||'[]');
      const ids=new Set(Array.isArray(stored)?stored.filter(x=>typeof x==='string'):[]);
      if(options.method==='PUT'){
        const operation=JSON.parse(options.body);
        if(typeof operation.id!=='string'||typeof operation[flag]!=='boolean')throw Error('Geçersiz seçim');
        operation[flag]?ids.add(operation.id):ids.delete(operation.id);
        localStorage.setItem(key,JSON.stringify([...ids]));
      }
      return {[field]:[...ids]};
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  function selectionFrom(value) {
    if (!value || !Array.isArray(value.selected_ids) || !value.selected_ids.every(id => typeof id === 'string')) throw new Error('Invalid selection response');
    return new Set(value.selected_ids);
  }

  function readLocalSelection() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string') : []);
    } catch { return new Set(); }
  }

  function showNotice(message, error = false) {
    $('selection-notice').textContent = message;
    $('selection-notice').hidden = !message;
    $('selection-notice').classList.toggle('error', error);
  }

  function saveLocalSelection() {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...state.selected]));
      showNotice('Seçimlerin bu tarayıcıda saklanıyor.');
    } catch {
      showNotice('Sunucuya ve tarayıcı kaydına erişilemiyor. Seçimlerin yalnız bu sayfa açıkken korunabilir.', true);
    }
  }

  function currentSelection() {
    const selected = new Set(state.selected);
    for (const operation of state.pending) {
      if (operation.selected) selected.add(operation.id);
      else selected.delete(operation.id);
    }
    return selected;
  }

  function visibleProducts() {
    const selected = currentSelection();
    return state.products.filter(product => (!state.source || product.source_id === state.source || product.additional_source_ids.includes(state.source)) && (!state.status || (state.status === 'ready' ? product.model_links : !product.model_links)) && (!state.onlySelected || selected.has(product.id)) && (!state.search || product.searchText.includes(state.search)));
  }

  function selectionLabel(selected) { return selected ? 'Seçkime eklendi' : 'Seçkime ekle'; }

  function updateSelectionButton(button, selected) {
    button.setAttribute('aria-pressed', String(selected));
    const label = button.querySelector('.select-label');
    const mark = button.querySelector('.select-mark');
    if (label) label.textContent = selectionLabel(selected);
    else button.textContent = selected ? '✓ Seçkime eklendi' : 'Seçkime ekle';
    if (mark) mark.textContent = selected ? '♥' : '♡';
  }

  function updateSelectionUI() {
    const selected = currentSelection();
    const count = state.products.filter(product => selected.has(product.id)).length;
    $('selection-count').textContent = String(count);
    app.dataset.selectedCount = String(count);
    $('selected-filter').setAttribute('aria-pressed', String(state.onlySelected));
    $('selected-filter').querySelector('.selection-icon').textContent = state.onlySelected ? '♥' : '♡';
    for (const button of gallery.querySelectorAll('[data-select-id]')) updateSelectionButton(button, selected.has(button.dataset.selectId));
    for (const card of gallery.querySelectorAll('[data-ref-id]')) card.classList.toggle('is-selected', selected.has(card.dataset.refId));
    if (state.activeProduct) updateSelectionButton($('detail-select'), selected.has(state.activeProduct.id));
  }

  function updateResults() {
    const count = visibleProducts().length;
    const selected = currentSelection();
    const selectedCount = state.products.filter(product => selected.has(product.id)).length;
    $('result-count').textContent = state.onlySelected ? `${count} seçili kayıt gösteriliyor` : `${count} / ${state.products.length} ürün ve boy kaydı gösteriliyor`;
    $('empty-state').hidden = count !== 0;
    $('empty-message').textContent = state.onlySelected && selectedCount === 0 ? 'Beğendiğin ürünlerde “Seçkime ekle” düğmesine dokun. Sonra hepsini burada görebilirsin.' : 'Başka bir kelime veya kategoriyle tekrar dene.';
  }

  function createCard(product, index) {
    const card = node('article', 'product-card');
    card.dataset.refId = product.id;
    const open = node('button', 'photo-open');
    open.type = 'button';
    open.dataset.openId = product.id;
    open.setAttribute('aria-label', `${product.title} · Fotoğrafları ve ayrıntıları gör`);
    if (product.images.length) {
      const image = node('img');
      image.src = product.images[0].url;
      image.alt = product.images[0].alt || product.title;
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.width = 640;
      image.height = 700;
      image.addEventListener('error', () => {
        image.hidden = true;
        const unavailable = node('span', 'image-unavailable', 'Orijinal görsel yüklenemedi. Ayrıntıdan ürün kaynağını açabilirsin.');
        open.prepend(unavailable);
      }, { once: true });
      open.append(image);
    } else open.append(node('span', 'image-unavailable', 'Ürün görseli şu anda görüntülenemiyor.'));
    if (product.category) open.append(node('span', 'card-category', product.category));
    open.addEventListener('click', () => openProduct(product, open));
    card.append(open);
    const copy = node('div', 'card-copy');
    copy.append(node('p', 'card-brand', product.brand || product.source_label));
    copy.append(node('p', 'model-status ' + (product.model_links ? 'is-ready' : 'is-pending'), product.model_links ? '● 3D model hazır' : '○ Modelleme bekliyor'));
    const heading = node('h2', 'card-title');
    const title = node('button', 'title-button', product.title);
    title.type = 'button';
    title.dataset.openId = product.id;
    title.addEventListener('click', () => openProduct(product, title));
    heading.append(title);
    copy.append(heading, node('p', 'card-dimensions', product.dimensions_display || 'Ölçü bilgisi kaynakta belirtilmemiş'));
    const actions = node('div', 'card-actions');
    const select = node('button', 'card-select');
    select.type = 'button';
    select.dataset.selectId = product.id;
    select.append(node('span', 'select-mark', '♡'), node('span', 'select-label', 'Seçkime ekle'));
    select.querySelector('.select-mark').setAttribute('aria-hidden', 'true');
    select.addEventListener('click', () => toggleSelection(product.id));
    const detail = node('button', 'card-detail', 'Ayrıntı ↗');
    detail.type = 'button';
    detail.dataset.openId = product.id;
    detail.addEventListener('click', () => openProduct(product, detail));
    actions.append(select, detail);
    copy.append(actions);
    if (product.model_links) {
      const model = node('a', 'quiet-button', '3D modeli incele ↗');
      model.href = product.model_links.view;
      model.style.cssText = 'display:block;text-align:center;margin-top:12px;font-size:11px';
      model.dataset.modelLink = product.model_id;
      copy.append(model);
    }
    card.append(copy);
    return card;
  }

  function renderGallery() {
    const fragment = document.createDocumentFragment();
    visibleProducts().forEach((product, index) => fragment.append(createCard(product, index)));
    gallery.replaceChildren(fragment);
    updateResults();
    updateSelectionUI();
  }

  function refreshAfterSelection() {
    if (state.onlySelected) {
      const activeId = document.activeElement?.dataset?.selectId;
      renderGallery();
      if (activeId && !dialog.open) {
        const replacement = [...gallery.querySelectorAll('[data-select-id]')].find(button => button.dataset.selectId === activeId);
        (replacement || $('selected-filter')).focus();
      }
    } else {
      updateSelectionUI();
      updateResults();
    }
  }

  function toggleSelection(id) {
    if (!state.ready || !state.products.some(product => product.id === id)) return;
    const selected = !currentSelection().has(id);
    if (state.selectionMode === 'browser') {
      if (selected) state.selected.add(id);
      else state.selected.delete(id);
      saveLocalSelection();
      refreshAfterSelection();
      return;
    }
    state.pending.push({ id, selected });
    refreshAfterSelection();
    void processSelectionQueue();
  }

  async function processSelectionQueue() {
    if (state.processing) return;
    state.processing = true;
    while (state.pending.length) {
      const operation = state.pending[0];
      try {
        const response = await requestJson('./api/zarahome/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) });
        state.selected = selectionFrom(response);
        state.pending.shift();
        showNotice('');
      } catch {
        try {
          state.selected = selectionFrom(await requestJson('./api/zarahome/selection'));
          state.pending.shift();
          showNotice('Son seçim kaydedilemedi. Sunucuda kayıtlı listen yenilendi; yeniden seçebilirsin.', true);
        } catch {
          state.selected = currentSelection();
          state.pending.length = 0;
          state.selectionMode = 'browser';
          saveLocalSelection();
        }
      }
      refreshAfterSelection();
    }
    state.processing = false;
  }

  function setLink(element, url) {
    if (url) { element.href = url; element.hidden = false; }
    else { element.removeAttribute('href'); element.hidden = true; }
  }

  function showPhoto(index) {
    const product = state.activeProduct;
    if (!product) return;
    state.activeImage = product.images.length ? (index + product.images.length) % product.images.length : 0;
    const image = product.images[state.activeImage];
    const photo = $('detail-photo');
    $('detail-image-error').hidden = true;
    photo.hidden = !image;
    if (image) {
      photo.alt = image.alt || `${product.title} · Fotoğraf ${state.activeImage + 1}`;
      photo.src = image.url;
    } else {
      photo.removeAttribute('src');
      $('detail-image-error').hidden = false;
    }
    $('photo-count').textContent = `${state.activeImage + 1} / ${product.images.length}`;
    $('detail-navigation').hidden = product.images.length < 2;
    $('detail-thumbnails').hidden = product.images.length < 2;
    for (const button of $('detail-thumbnails').children) button.setAttribute('aria-pressed', String(Number(button.dataset.imageIndex) === state.activeImage));
    dialog.dataset.imageIndex = String(state.activeImage);
  }

  function openProduct(product, opener) {
    state.activeProduct = product;
    state.openerId = product.id;
    state.opener = opener;
    dialog.dataset.refId = product.id;
    $('detail-brand').textContent = product.brand || product.source_label;
    $('detail-title').textContent = product.title;
    $('detail-kind').textContent = product.model_links ? `${product.category} · 3D model hazır` : product.category ? `${product.category} · Modelleme bekliyor` : 'Modelleme bekliyor';
    $('detail-dimensions').textContent = product.dimensions_display || 'Kaynakta belirtilmemiş';
    $('detail-material').textContent = product.material_label || 'Kaynakta belirtilmemiş';
    $('detail-dimension-note').textContent = product.dimension_note;
    $('detail-dimension-note').hidden = !product.dimension_note;
    setLink($('detail-product-link'), product.url);
    setLink($('detail-source-link'), product.source_url);
    setLink($('detail-model-link'), product.model_links?.view);
    setLink($('detail-download-link'), product.model_links?.download);
    $('detail-modeling-note').textContent = product.model_links ? 'Bu boyun malzemeli 3D modeli hazır. Orijinal fotoğrafıyla yan yana inceleyebilir ve GLB dosyasını projen için indirebilirsin. Diğer bedenlerin hazır olduğu anlamına gelmez.' : product.modeling_note || 'Bu ürün Zara Home envanterine eklendi; 3D modeli henüz hazır değil. Modelleme kişisel seçime bağlı değildir.';
    const thumbnails = document.createDocumentFragment();
    product.images.forEach((image, index) => {
      const button = node('button');
      button.type = 'button';
      button.dataset.imageIndex = String(index);
      button.setAttribute('aria-label', `Fotoğraf ${index + 1}`);
      const thumbnail = node('img');
      thumbnail.src = image.thumbnail_url || image.url;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      button.append(thumbnail);
      button.addEventListener('click', () => showPhoto(index));
      thumbnails.append(button);
    });
    $('detail-thumbnails').replaceChildren(thumbnails);
    updateSelectionUI();
    showPhoto(0);
    dialog.showModal();
    $('close-dialog').focus();
  }

  function normalizeCatalog(data) {
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.sources) || !Array.isArray(data.original_links)) throw new Error('Invalid catalog');
    const ids = new Set();
    const products = data.products.map(product => {
      if (!product || !text(product.id) || !text(product.title) || ids.has(product.id)) throw new Error('Invalid product');
      ids.add(product.id);
      const normalized = {};
      for (const field of ['id', 'title', 'brand', 'source_id', 'source_label', 'product_code', 'category', 'material_label', 'dimensions_display', 'dimension_note', 'modeling_note']) normalized[field] = text(product[field]);
      normalized.url = safeUrl(product.url);
      normalized.source_url = safeUrl(product.source_url);
      normalized.model_id = text(product.model_id);
      normalized.additional_source_ids = Array.isArray(product.additional_source_ids) ? product.additional_source_ids.map(text).filter(Boolean) : [];
      normalized.model_links = modelLinks(product);
      normalized.images = (Array.isArray(product.images) ? product.images : []).map(image => ({ url: safeUrl(image.url, true), thumbnail_url: safeUrl(image.thumbnail_url, true), alt: text(image.alt) })).filter(image => image.url);
      normalized.searchText = fold([normalized.title, normalized.brand, normalized.source_label, normalized.category, normalized.material_label, normalized.product_code].join(' '));
      return normalized;
    });
    if (!products.length) throw new Error('Empty catalog');
    return { ...data, products };
  }

  function renderSources(data) {
    const sourceLabels = new Map();
    for (const source of data.sources) if (text(source.id)) sourceLabels.set(source.id, text(source.label) || source.id);
    for (const product of state.products) if (product.source_id && !sourceLabels.has(product.source_id)) sourceLabels.set(product.source_id, product.source_label || product.brand || product.source_id);
    const availableIds = new Set(state.products.flatMap(product => [product.source_id, ...product.additional_source_ids]));
    const options = document.createDocumentFragment();
    options.append(node('option', '', 'Tüm kategoriler'));
    options.firstChild.value = '';
    for (const [id, label] of [...sourceLabels].filter(([id]) => availableIds.has(id)).sort((a, b) => a[1].localeCompare(b[1], 'tr'))) {
      const option = node('option', '', label);
      option.value = id;
      options.append(option);
    }
    $('source-filter').replaceChildren(options);
    const links = document.createDocumentFragment();
    let count = 0;
    for (const source of data.original_links) {
      const url = safeUrl(source.url);
      if (!url) continue;
      const item = node('li');
      const link = node('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(node('span', '', text(source.label) || 'Zara Home kaynağı'), node('span', '', '↗'));
      link.lastChild.setAttribute('aria-hidden', 'true');
      item.append(link);
      links.append(item);
      count++;
    }
    $('source-links').replaceChildren(links);
    $('source-count').textContent = `${count} bağlantı`;
    app.dataset.sourceCount = String(data.sources.length);
    app.dataset.originalLinkCount = String(count);
    const date = text(data.updated_date);
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) $('updated-date').textContent = `Güncellendi ${parsed.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' })} · Zara Home`;
    }
  }

  function renderCoverage(data) {
    const coverage = data.coverage;
    if (!coverage || !Array.isArray(coverage.categories)) { $('coverage-summary').textContent = 'Hazır modeller ve modelleme bekleyen ürünler ayrı gösterilir.'; return; }
    const pendingRecords=data.products.filter(product=>!product.model_id);
    const measuredBlocked=pendingRecords.filter(product=>product.dimensions_display==='Resmî ölçü doğrulanamadı');
    $('coverage-summary').textContent = pendingRecords.length&&measuredBlocked.length===pendingRecords.length
      ? `${coverage.ready_model_variants} hazır model varyantı. ${pendingRecords.length} kaynak üründe resmî ölçü doğrulanamadı; görselleri ve gerekçeleri envanterde kayıtlı.`
      : `${coverage.ready_model_variants} hazır model varyantı. ${coverage.pending_reference_records} ürün kaydı modelleme bekliyor. İncelenen ${coverage.categories.length} kategorinin tamamı henüz modellenmedi.`;
    const fragment = document.createDocumentFragment();
    for (const category of coverage.categories) {
      const row = node('tr');
      const heading = node('th'); heading.scope = 'row';
      const link = node('a', '', category.category); link.href = './zarahome-secki.html?kategori=' + encodeURIComponent(category.source_id) + '#gallery'; heading.append(link); row.append(heading);
      for (const key of ['official_card_count', 'cards_with_model', 'cards_without_model']) row.append(node('td', '', String(category[key])));
      fragment.append(row);
    }
    $('coverage-rows').replaceChildren(fragment);
  }

  async function load() {
    app.dataset.ready = 'false';
    state.ready = false;
    gallery.setAttribute('aria-busy', 'true');
    $('load-error').hidden = true;
    $('empty-state').hidden = true;
    $('result-count').textContent = 'Seçki yükleniyor…';
    try {
      const [catalogResult, selectionResult] = await Promise.allSettled([requestJson('./zarahome-reference-catalog.json'), requestJson('./api/zarahome/selection')]);
      if (catalogResult.status !== 'fulfilled') throw catalogResult.reason;
      const data = normalizeCatalog(catalogResult.value);
      state.products = data.products;
      state.sources = data.sources;
      try {
        if (selectionResult.status !== 'fulfilled') throw selectionResult.reason;
        state.selected = selectionFrom(selectionResult.value);
        state.selectionMode = 'server';
        showNotice('');
      } catch {
        state.selected = readLocalSelection();
        state.selectionMode = 'browser';
        saveLocalSelection();
      }
      renderSources(data);
      renderCoverage(data);
      const query = new URLSearchParams(location.search);
      const requestedSource = query.get('kategori');
      if (requestedSource && [...$('source-filter').options].some(option => option.value === requestedSource)) { state.source = requestedSource; $('source-filter').value = requestedSource; }
      if (['ready', 'pending'].includes(query.get('durum'))) { state.status = query.get('durum'); $('status-filter').value = state.status; }
      state.ready = true;
      renderGallery();
      app.dataset.ready = 'true';
      app.dataset.productCount = String(state.products.length);
    } catch {
      gallery.replaceChildren();
      $('load-error').hidden = false;
      $('result-count').textContent = 'Seçki yüklenemedi';
      showNotice('');
    } finally { gallery.setAttribute('aria-busy', 'false'); }
  }

  $('search').addEventListener('input', event => { state.search = fold(event.target.value.trim()); if (state.ready) renderGallery(); });
  $('source-filter').addEventListener('change', event => { state.source = event.target.value; if (state.ready) renderGallery(); });
  $('status-filter').addEventListener('change', event => { state.status = event.target.value; if (state.ready) renderGallery(); });
  $('selected-filter').addEventListener('click', () => { state.onlySelected = !state.onlySelected; if (state.ready) renderGallery(); });
  $('reset-filters').addEventListener('click', () => {
    state.search = '';
    state.source = '';
    state.status = '';
    state.onlySelected = false;
    $('search').value = '';
    $('source-filter').value = '';
    $('status-filter').value = '';
    renderGallery();
  });
  $('retry-load').addEventListener('click', () => { void load(); });
  $('close-dialog').addEventListener('click', () => dialog.close());
  $('detail-select').addEventListener('click', () => { if (state.activeProduct) toggleSelection(state.activeProduct.id); });
  $('previous-photo').addEventListener('click', () => showPhoto(state.activeImage - 1));
  $('next-photo').addEventListener('click', () => showPhoto(state.activeImage + 1));
  $('detail-photo').addEventListener('error', () => { $('detail-photo').hidden = true; $('detail-image-error').hidden = false; });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const opener = state.opener?.isConnected ? state.opener : [...gallery.querySelectorAll('[data-open-id]')].find(button => button.dataset.openId === state.openerId);
    (opener || $('selected-filter')).focus();
    state.activeProduct = null;
    delete dialog.dataset.refId;
  });
  void load();
})();
