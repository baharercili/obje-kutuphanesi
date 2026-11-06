(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const app = $('hipicon-app');
  const gallery = $('gallery');
  const dialog = $('product-dialog');
  const storageKey = 'bahar-hipicon-reference-selection-v1';
  const hiddenStorageKey = 'bahar-hipicon-hidden-products-v1';
  const state = { products: [], sources: [], selected: new Set(), pending: [], selectionMode: 'server', processing: false, hidden: new Set(), pendingVisibility: [], visibilityMode: 'server', processingVisibility: false, onlyHidden: false, lastVisibility: null, search: '', source: '', onlySelected: false, activeProduct: null, activeImage: 0, openerId: null, ready: false };
  const text = value => typeof value === 'string' ? value.trim() : '';
  const fold = value => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function safeUrl(value, image = false) {
    try {
      const url = new URL(value);
      const allowed = image ? ['cdn3.hipicon.com'] : ['www.hipicon.com', 'hipicon.com'];
      return url.protocol === 'https:' && allowed.includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
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
    const hidden = currentHidden();
    return state.products.filter(product => hidden.has(product.id) === state.onlyHidden && (!state.source || product.source_id === state.source) && (!state.onlySelected || selected.has(product.id)) && (!state.search || product.searchText.includes(state.search)));
  }

  function hiddenFrom(value) {
    if (!value || !Array.isArray(value.hidden_ids) || !value.hidden_ids.every(id => typeof id === 'string')) throw new Error('Invalid visibility response');
    return new Set(value.hidden_ids);
  }

  function currentHidden() {
    const hidden = new Set(state.hidden);
    for (const operation of state.pendingVisibility) {
      if (operation.hidden) hidden.add(operation.id);
      else hidden.delete(operation.id);
    }
    return hidden;
  }

  function saveLocalHidden() {
    try {
      localStorage.setItem(hiddenStorageKey, JSON.stringify([...state.hidden]));
      showVisibilityNotice('Gizlediklerin bu tarayıcıda saklanıyor.');
    } catch { showVisibilityNotice('Gizlediklerin yalnız bu sayfa açıkken korunabilir.'); }
  }

  function showVisibilityNotice(message, operation = null) {
    $('visibility-message').textContent = message;
    $('visibility-notice').hidden = !message;
    state.lastVisibility = operation;
    $('undo-visibility').hidden = !operation;
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
    const hidden = currentHidden();
    const hiddenCount = state.products.filter(product => hidden.has(product.id)).length;
    $('hidden-count').textContent = String(hiddenCount);
    $('hidden-filter').setAttribute('aria-pressed', String(state.onlyHidden));
    app.dataset.hiddenCount = String(hiddenCount);
    app.dataset.showingHidden = String(state.onlyHidden);
    app.dataset.visibilitySaving = String(state.pendingVisibility.length > 0);
    if (state.activeProduct) $('detail-visibility').textContent = hidden.has(state.activeProduct.id) ? 'Geri getir' : 'Sekmeden çıkar';
  }

  function updateResults() {
    const count = visibleProducts().length;
    const selected = currentSelection();
    const selectedCount = state.products.filter(product => selected.has(product.id)).length;
    $('result-count').textContent = state.onlyHidden ? `${count} gizlenen parça gösteriliyor` : state.onlySelected ? `${count} seçili parça gösteriliyor` : `${count} / ${state.products.length} parça gösteriliyor`;
    $('empty-state').hidden = count !== 0;
    $('empty-message').textContent = state.onlyHidden ? 'Gizlediğin ürünler burada görünür. “Geri getir” ile Hipicon listesine yeniden ekleyebilirsin.' : state.onlySelected && selectedCount === 0 ? 'Beğendiğin ürünlerde “Seçkime ekle” düğmesine dokun. Sonra hepsini burada görebilirsin.' : 'Başka bir kelime veya kaynakla tekrar dene.';
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
    const heading = node('h2', 'card-title');
    const title = node('button', 'title-button', product.title);
    title.type = 'button';
    title.dataset.openId = product.id;
    title.addEventListener('click', () => openProduct(product, title));
    heading.append(title);
    copy.append(heading, node('p', 'card-dimensions', product.dimensions_display || 'Ölçü bilgisi henüz doğrulanmadı'));
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
    const visibility = node('button', 'card-visibility', currentHidden().has(product.id) ? 'Geri getir' : 'Sekmeden çıkar');
    visibility.type = 'button';
    visibility.dataset.visibilityId = product.id;
    visibility.setAttribute('aria-label', `${product.title} · ${currentHidden().has(product.id) ? 'Geri getir' : 'Sekmeden çıkar'}`);
    visibility.addEventListener('click', () => setVisibility(product.id, !currentHidden().has(product.id)));
    copy.append(visibility);
    card.append(copy);
    return card;
  }

  function renderGallery() {
    const products = visibleProducts();
    const existing = new Map([...gallery.children].map(card => [card.dataset.refId, card]));
    const visibleIds = new Set(products.map(product => product.id));
    for (const [id, card] of existing) if (!visibleIds.has(id)) card.remove();
    let cursor = gallery.firstElementChild;
    products.forEach((product, index) => {
      const card = existing.get(product.id) || createCard(product, index);
      if (card === cursor) cursor = cursor.nextElementSibling;
      else gallery.insertBefore(card, cursor);
    });
    updateResults();
    updateSelectionUI();
  }

  function galleryPosition() {
    const active = document.activeElement;
    const card = active?.closest('[data-ref-id]');
    return {
      left: window.scrollX, top: window.scrollY,
      id: card?.dataset.refId,
      index: [...gallery.children].indexOf(card),
      action: active?.matches('[data-select-id]') ? '[data-select-id]' : active?.matches('[data-visibility-id]') ? '[data-visibility-id]' : null
    };
  }

  function restoreGalleryPosition(position) {
    if (position.action && !dialog.open) {
      const cards = [...gallery.children];
      const card = cards.find(card => card.dataset.refId === position.id) || cards[Math.min(position.index, cards.length - 1)];
      (card?.querySelector(position.action) || $('selected-filter')).focus({ preventScroll: true });
    }
    window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' });
  }

  function refreshAfterSelection() {
    if (state.onlySelected) {
      const position = galleryPosition();
      renderGallery();
      restoreGalleryPosition(position);
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
        const response = await requestJson('./api/hipicon/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) });
        state.selected = selectionFrom(response);
        state.pending.shift();
        showNotice('');
      } catch {
        try {
          state.selected = selectionFrom(await requestJson('./api/hipicon/selection'));
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

  function setVisibility(id, hidden) {
    if (!state.ready || !state.products.some(product => product.id === id)) return;
    if (currentHidden().has(id) === hidden) return;
    const position = galleryPosition();
    const product = state.products.find(product => product.id === id);
    if (state.visibilityMode === 'browser') {
      if (hidden) state.hidden.add(id); else state.hidden.delete(id);
      saveLocalHidden();
    } else {
      state.pendingVisibility.push({ id, hidden });
      showVisibilityNotice(hidden ? `${product.title} Hipicon listesinden gizlendi.` : `${product.title} Hipicon listesine geri getirildi.`, { id, hidden });
    }
    if (dialog.open && state.activeProduct?.id === id) dialog.close();
    renderGallery();
    restoreGalleryPosition(position);
    if (state.visibilityMode === 'server') void processVisibilityQueue();
  }

  async function processVisibilityQueue() {
    if (state.processingVisibility) return;
    state.processingVisibility = true;
    while (state.pendingVisibility.length) {
      const operation = state.pendingVisibility[0];
      try {
        state.hidden = hiddenFrom(await requestJson('./api/hipicon/visibility', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) }));
        state.pendingVisibility.shift();
      } catch {
        try {
          state.hidden = hiddenFrom(await requestJson('./api/hipicon/visibility'));
          state.pendingVisibility.shift();
          showVisibilityNotice('Son değişiklik kaydedilemedi. Kayıtlı gizleme listen yenilendi; yeniden deneyebilirsin.');
        } catch {
          state.hidden = currentHidden();
          state.pendingVisibility.length = 0;
          state.visibilityMode = 'browser';
          saveLocalHidden();
        }
      }
      const position = galleryPosition();
      renderGallery();
      restoreGalleryPosition(position);
    }
    state.processingVisibility = false;
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
    $('detail-kind').textContent = product.category ? `${product.category} · Görsel referans` : 'Görsel referans';
    $('detail-dimensions').textContent = product.dimensions_display || 'Henüz doğrulanmadı';
    $('detail-material').textContent = product.material_label || 'Henüz doğrulanmadı';
    $('detail-dimension-note').textContent = product.dimension_note;
    $('detail-dimension-note').hidden = !product.dimension_note;
    setLink($('detail-product-link'), product.url);
    setLink($('detail-source-link'), product.source_url);
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
      for (const field of ['id', 'title', 'brand', 'source_id', 'source_label', 'product_code', 'category', 'material_label', 'dimensions_display', 'dimension_note']) normalized[field] = text(product[field]);
      normalized.url = safeUrl(product.url);
      normalized.source_url = safeUrl(product.source_url);
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
    const availableIds = new Set(state.products.map(product => product.source_id));
    const options = document.createDocumentFragment();
    options.append(node('option', '', 'Tüm marka ve sanatçılar'));
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
      link.append(node('span', '', text(source.label) || 'Hipicon kaynağı'), node('span', '', '↗'));
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
      if (!Number.isNaN(parsed.getTime())) $('updated-date').textContent = `Güncellendi ${parsed.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' })} · Hipicon`;
    }
  }

  async function load() {
    app.dataset.ready = 'false';
    state.ready = false;
    gallery.setAttribute('aria-busy', 'true');
    $('load-error').hidden = true;
    $('empty-state').hidden = true;
    $('result-count').textContent = 'Seçki yükleniyor…';
    try {
      const [catalogResult, selectionResult, visibilityResult] = await Promise.allSettled([requestJson('./hipicon-reference-catalog.json'), requestJson('./api/hipicon/selection'), requestJson('./api/hipicon/visibility')]);
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
      try {
        if (visibilityResult.status !== 'fulfilled') throw visibilityResult.reason;
        state.hidden = hiddenFrom(visibilityResult.value);
        state.visibilityMode = 'server';
      } catch {
        try {
          const hidden = JSON.parse(localStorage.getItem(hiddenStorageKey) || '[]');
          state.hidden = new Set(Array.isArray(hidden) ? hidden.filter(id => typeof id === 'string') : []);
        } catch { state.hidden = new Set(); }
        state.visibilityMode = 'browser';
        saveLocalHidden();
      }
      renderSources(data);
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
  $('selected-filter').addEventListener('click', () => { state.onlySelected = !state.onlySelected; state.onlyHidden = false; if (state.ready) renderGallery(); });
  $('hidden-filter').addEventListener('click', () => { state.onlyHidden = !state.onlyHidden; state.onlySelected = false; if (state.ready) renderGallery(); });
  $('undo-visibility').addEventListener('click', () => { if (state.lastVisibility) setVisibility(state.lastVisibility.id, !state.lastVisibility.hidden); });
  $('reset-filters').addEventListener('click', () => {
    state.search = '';
    state.source = '';
    state.onlySelected = false;
    state.onlyHidden = false;
    $('search').value = '';
    $('source-filter').value = '';
    renderGallery();
  });
  $('retry-load').addEventListener('click', () => { void load(); });
  $('close-dialog').addEventListener('click', () => dialog.close());
  $('detail-select').addEventListener('click', () => { if (state.activeProduct) toggleSelection(state.activeProduct.id); });
  $('detail-visibility').addEventListener('click', () => { if (state.activeProduct) setVisibility(state.activeProduct.id, !currentHidden().has(state.activeProduct.id)); });
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
    (opener || $('selected-filter')).focus({ preventScroll: true });
    state.activeProduct = null;
    delete dialog.dataset.refId;
  });
  void load();
})();
