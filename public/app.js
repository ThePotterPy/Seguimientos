// ==========================================================================
// Página sin nombre — Lógica Frontend
// Rastreador unificado Urbano Express, Correo Andreani y Entregar
// ==========================================================================

// Estado de la aplicación
let currentCarrier = localStorage.getItem('selected_carrier') || 'urbano';
const currentShipper = '004185'; // Cuenta consolidada fija (Urbano)
let recentSearches = JSON.parse(localStorage.getItem('urbano_recent_searches') || '[]');
let lastTrackedData = null;
let currentViewMode = 'timeline'; // 'timeline' o 'table'

// Elementos del DOM - Encabezado y Selector de Courier
const carrierUrbanoBtn = document.getElementById('carrierUrbanoBtn');
const carrierAndreaniBtn = document.getElementById('carrierAndreaniBtn');
const carrierEntregarBtn = document.getElementById('carrierEntregarBtn');
const shipperBadgeContainer = document.getElementById('shipperBadgeContainer');
const entregarSessionBtn = document.getElementById('entregarSessionBtn');

// Modal de Sesión Entregar
const sessionModal = document.getElementById('sessionModal');
const closeSessionModalBtn = document.getElementById('closeSessionModalBtn');
const cancelSessionModalBtn = document.getElementById('cancelSessionModalBtn');
const saveSessionCookieBtn = document.getElementById('saveSessionCookieBtn');
const sessionCookieInput = document.getElementById('sessionCookieInput');
const sessionStatusMsg = document.getElementById('sessionStatusMsg');

// Elementos del DOM - Formulario de Búsqueda
const trackForm = document.getElementById('trackForm');
const orderInput = document.getElementById('orderInput');
const searchInputContainer = document.getElementById('searchInputContainer');
const searchLabel = document.getElementById('searchLabel');
const carrierIndicatorTag = document.getElementById('carrierIndicatorTag');
const clearInputBtn = document.getElementById('clearInputBtn');
const pasteBtn = document.getElementById('pasteBtn');
const submitBtn = document.getElementById('submitBtn');

// Elementos de Feedback
const loadingBox = document.getElementById('loadingBox');
const loadingText = document.getElementById('loadingText');
const errorBox = document.getElementById('errorBox');
const errorMessage = document.getElementById('errorMessage');
const errorOfficialLink = document.getElementById('errorOfficialLink');

// Resultado Unificado
const resultBox = document.getElementById('resultBox');
const resultCarrierTag = document.getElementById('resultCarrierTag');
const statusBanner = document.getElementById('statusBanner');
const statusLabelText = document.getElementById('statusLabelText');
const statusDateBadge = document.getElementById('statusDateBadge');
const statusIndicatorDot = document.getElementById('statusIndicatorDot');

// Sub-órdenes (para pedidos de Entregar con múltiples tramos)
const subOrdersContainer = document.getElementById('subOrdersContainer');
const subOrdersList = document.getElementById('subOrdersList');
const subOrdersCount = document.getElementById('subOrdersCount');

// Banner Operativo Entregar (BGH: ZECO, ZECH, ZRE7, ZRE2)
const entregarOperationalBanner = document.getElementById('entregarOperationalBanner');
const operationalIconBox = document.getElementById('operationalIconBox');
const operationalTitle = document.getElementById('operationalTitle');
const operationalCodeBadge = document.getElementById('operationalCodeBadge');
const operationalAuxBadge = document.getElementById('operationalAuxBadge');
const operationalDescription = document.getElementById('operationalDescription');
const operationalLinkedAction = document.getElementById('operationalLinkedAction');
const goToLinkedLegBtn = document.getElementById('goToLinkedLegBtn');
const goToLinkedLegText = document.getElementById('goToLinkedLegText');

const resultOrderTitle = document.getElementById('resultOrderTitle');
const metaGuia = document.getElementById('metaGuia');
const metaRemitente = document.getElementById('metaRemitente');
const metaServicio = document.getElementById('metaServicio');
const metaDestino = document.getElementById('metaDestino');
const metaCiclo = document.getElementById('metaCiclo');

const copyOrderBtn = document.getElementById('copyOrderBtn');
const copyGuiaBtn = document.getElementById('copyGuiaBtn');
const copySummaryBtn = document.getElementById('copySummaryBtn');
const copySummaryText = document.getElementById('copySummaryText');
const officialLinkBtn = document.getElementById('officialLinkBtn');
const officialLinkText = document.getElementById('officialLinkText');

// Vistas de Movimientos
const viewTimelineBtn = document.getElementById('viewTimelineBtn');
const viewTableBtn = document.getElementById('viewTableBtn');
const timelineFeedContainer = document.getElementById('timelineFeedContainer');
const movementsTableContainer = document.getElementById('movementsTableContainer');
const timelineFeed = document.getElementById('timelineFeed');
const timelineTableBody = document.getElementById('timelineTableBody');
const movementsCountBadge = document.getElementById('movementsCountBadge');

// Historial
const recentTags = document.getElementById('recentTags');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Pestañas (Individual vs Masivo)
const tabSingle = document.getElementById('tabSingle');
const tabBatch = document.getElementById('tabBatch');
const singleSearchView = document.getElementById('singleSearchView');
const batchSearchView = document.getElementById('batchSearchView');

// Lote
const batchTextarea = document.getElementById('batchTextarea');
const batchSubmitBtn = document.getElementById('batchSubmitBtn');
const batchClearBtn = document.getElementById('batchClearBtn');
const batchResultsBox = document.getElementById('batchResultsBox');
const batchTableBody = document.getElementById('batchTableBody');
const batchSummaryStats = document.getElementById('batchSummaryStats');

// Toast
const toastNotification = document.getElementById('toastNotification');
const toastMessage = document.getElementById('toastMessage');
const toastIcon = document.getElementById('toastIcon');
let toastTimeout = null;

// ==========================================================================
// Inicialización
// ==========================================================================
function init() {
  setCarrier(currentCarrier, false);
  renderRecentSearches();

  const urlParams = new URLSearchParams(window.location.search);
  const orderFromUrl = urlParams.get('order');
  const carrierFromUrl = urlParams.get('carrier');

  if (carrierFromUrl && ['andreani', 'urbano', 'entregar'].includes(carrierFromUrl)) {
    setCarrier(carrierFromUrl, false);
  }

  if (orderFromUrl) {
    orderInput.value = orderFromUrl;
    orderInput.dispatchEvent(new Event('input'));
    performTrack(orderFromUrl);
  }

  // Tecla '/' para enfocar el buscador
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== orderInput && document.activeElement !== batchTextarea) {
      e.preventDefault();
      orderInput.focus();
    }
  });

  // Configurar modal de sesión
  if (entregarSessionBtn) {
    entregarSessionBtn.addEventListener('click', openSessionModal);
  }
  if (closeSessionModalBtn) {
    closeSessionModalBtn.addEventListener('click', closeSessionModal);
  }
  if (cancelSessionModalBtn) {
    cancelSessionModalBtn.addEventListener('click', closeSessionModal);
  }
  if (sessionModal) {
    sessionModal.addEventListener('click', (e) => {
      if (e.target === sessionModal) closeSessionModal();
    });
  }
  if (saveSessionCookieBtn) {
    saveSessionCookieBtn.addEventListener('click', handleSaveSessionCookie);
  }
}

// ==========================================================================
// Cambio de Courier (Urbano vs Andreani vs Entregar)
// ==========================================================================
function setCarrier(carrier, clearViews = true) {
  currentCarrier = carrier;
  localStorage.setItem('selected_carrier', currentCarrier);

  if (clearViews) {
    resultBox.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  // Remover activo de todos los botones
  carrierUrbanoBtn.classList.remove('active');
  carrierAndreaniBtn.classList.remove('active');
  if (carrierEntregarBtn) carrierEntregarBtn.classList.remove('active');

  if (carrier === 'andreani') {
    carrierAndreaniBtn.classList.add('active');

    searchInputContainer.className = 'search-input-wrapper active-andreani flex-1';
    submitBtn.className = 'btn-primary-andreani h-[46px] px-6';

    searchLabel.textContent = 'Número de pedido (Mercado Libre) o guía oficial (Andreani):';
    carrierIndicatorTag.textContent = 'Modo Andreani';
    carrierIndicatorTag.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200';
    orderInput.placeholder = 'Ingresá tu pedido de Mercado Libre o guía, ej: 2000018697823352';

    shipperBadgeContainer.classList.add('hidden');
    if (entregarSessionBtn) entregarSessionBtn.classList.add('hidden');
  } else if (carrier === 'entregar') {
    if (carrierEntregarBtn) carrierEntregarBtn.classList.add('active');

    searchInputContainer.className = 'search-input-wrapper active-entregar flex-1';
    submitBtn.className = 'btn-primary-entregar h-[46px] px-6';

    searchLabel.textContent = 'Número de pedido, remito o referencia (Entregar):';
    carrierIndicatorTag.textContent = 'Modo Entregar';
    carrierIndicatorTag.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
    orderInput.placeholder = 'Ingresá tu código o pedido BGH, ej: 1659868563485-01';

    shipperBadgeContainer.classList.add('hidden');
    if (entregarSessionBtn) {
      entregarSessionBtn.classList.remove('hidden');
      entregarSessionBtn.classList.add('inline-flex');
    }
  } else {
    carrierUrbanoBtn.classList.add('active');

    searchInputContainer.className = 'search-input-wrapper active-urbano flex-1';
    submitBtn.className = 'btn-primary-urbano h-[46px] px-6';

    searchLabel.textContent = 'Número de pedido o código de compra (Urbano):';
    carrierIndicatorTag.textContent = 'Modo Urbano Express';
    carrierIndicatorTag.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200';
    orderInput.placeholder = 'Ingresá tu código, ej: 2745296ICBC';

    shipperBadgeContainer.classList.remove('hidden');
    if (entregarSessionBtn) entregarSessionBtn.classList.add('hidden');
  }
}

carrierUrbanoBtn.addEventListener('click', () => setCarrier('urbano'));
carrierAndreaniBtn.addEventListener('click', () => setCarrier('andreani'));
if (carrierEntregarBtn) carrierEntregarBtn.addEventListener('click', () => setCarrier('entregar'));

// Auto-detección inteligente de courier
function autoDetectCarrier(code) {
  const trimmed = (code || '').trim();
  if (trimmed.includes('-0') || /^\d{13}-\d{2}$/.test(trimmed) || trimmed.startsWith('ZRE') || trimmed.startsWith('ZECH') || trimmed.startsWith('ZECO')) {
    return 'entregar';
  }
  if (/^2000\d{10,14}$/.test(trimmed) || trimmed.startsWith('2000') || trimmed.startsWith('4004') || (/^\d{15,16}$/.test(trimmed))) {
    return 'andreani';
  }
  return currentCarrier;
}

// ==========================================================================
// Navegación Pestañas (Individual vs Masivo)
// ==========================================================================
tabSingle.addEventListener('click', () => {
  tabSingle.classList.add('active');
  tabBatch.classList.remove('active');
  singleSearchView.classList.remove('hidden');
  batchSearchView.classList.add('hidden');
});

tabBatch.addEventListener('click', () => {
  tabBatch.classList.add('active');
  tabSingle.classList.remove('active');
  batchSearchView.classList.remove('hidden');
  singleSearchView.classList.add('hidden');
});

// ==========================================================================
// Alternancia de Vistas: Línea de Tiempo vs Tabla
// ==========================================================================
viewTimelineBtn.addEventListener('click', () => {
  currentViewMode = 'timeline';
  viewTimelineBtn.className = 'px-2.5 py-1 rounded-md bg-slate-100 text-slate-900 transition flex items-center gap-1.5';
  viewTableBtn.className = 'px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-900 transition flex items-center gap-1.5';
  timelineFeedContainer.classList.remove('hidden');
  movementsTableContainer.classList.add('hidden');
});

viewTableBtn.addEventListener('click', () => {
  currentViewMode = 'table';
  viewTableBtn.className = 'px-2.5 py-1 rounded-md bg-slate-100 text-slate-900 transition flex items-center gap-1.5';
  viewTimelineBtn.className = 'px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-900 transition flex items-center gap-1.5';
  movementsTableContainer.classList.remove('hidden');
  timelineFeedContainer.classList.add('hidden');
});

// ==========================================================================
// Portapapeles & Pegado
// ==========================================================================
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const code = text.trim();
      const detected = autoDetectCarrier(code);
      if (detected !== currentCarrier) {
        setCarrier(detected, false);
        const name = detected === 'andreani' ? 'Andreani' : (detected === 'entregar' ? 'Entregar' : 'Urbano');
        showToast(`Detectado código de ${name}`, 'info');
      }
      orderInput.value = code;
      orderInput.dispatchEvent(new Event('input'));
      performTrack(code);
    }
  } catch (err) {
    orderInput.focus();
    showToast('Pegá el código usando Ctrl+V o mantené presionado', 'info');
  }
});

// Input de búsqueda
orderInput.addEventListener('input', () => {
  if (orderInput.value.length > 0) {
    clearInputBtn.classList.remove('hidden');
  } else {
    clearInputBtn.classList.add('hidden');
  }
});

clearInputBtn.addEventListener('click', () => {
  orderInput.value = '';
  clearInputBtn.classList.add('hidden');
  orderInput.focus();
});

trackForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const order = orderInput.value.trim();
  if (order) {
    const detected = autoDetectCarrier(order);
    if (detected !== currentCarrier) {
      setCarrier(detected, false);
      const name = detected === 'andreani' ? 'Andreani' : (detected === 'entregar' ? 'Entregar' : 'Urbano');
      showToast(`Detectado código de ${name}`, 'info');
    }
    performTrack(order);
  }
});

// ==========================================================================
// Consulta al Servidor (API Tracking)
// ==========================================================================
async function performTrack(order) {
  const newUrl = new URL(window.location);
  newUrl.searchParams.set('order', order);
  newUrl.searchParams.set('carrier', currentCarrier);
  window.history.pushState({}, '', newUrl);

  if (currentCarrier === 'entregar') {
    loadingText.textContent = 'Consultando estado oficial en Entregar...';
  } else if (currentCarrier === 'andreani') {
    loadingText.textContent = 'Consultando estado oficial en Andreani...';
  } else {
    loadingText.textContent = 'Consultando estado oficial en Urbano...';
  }

  loadingBox.classList.remove('hidden');
  errorBox.classList.add('hidden');
  resultBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-50');

  try {
    const res = await fetch(`/api/track?order=${encodeURIComponent(order)}&shipper=${encodeURIComponent(currentShipper)}&carrier=${encodeURIComponent(currentCarrier)}`);
    const data = await res.json();

    if (!data.success) {
      showError(data.message || 'No se encontró el envío.', data.officialUrl, data.needSession);
      return;
    }

    lastTrackedData = data;
    renderResult(data);
    addToRecent(order, data.carrier || currentCarrier);
  } catch (err) {
    let fallbackUrl = `https://apis.urbano.com.ar/cespecifica/?tracking=${currentShipper}${order}`;
    if (currentCarrier === 'andreani') fallbackUrl = `https://www.andreani.com/envio/${encodeURIComponent(order)}`;
    if (currentCarrier === 'entregar') fallbackUrl = `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(order)}&numero_hash=&boton=Consultar`;
    showError(`Error de conexión con el servidor: ${err.message}`, fallbackUrl);
  } finally {
    loadingBox.classList.add('hidden');
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-50');
  }
}

// ==========================================================================
// Renderizado del Resultado
// ==========================================================================
function renderResult(data) {
  const carrier = data.carrier || currentCarrier;

  // Configurar distintivo de la empresa y botón oficial
  if (carrier === 'andreani') {
    resultCarrierTag.textContent = 'Correo Andreani';
    resultCarrierTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200';
    officialLinkBtn.className = 'btn-primary-andreani px-4 py-2 text-xs';
    officialLinkText.textContent = 'Ver en Andreani Oficial';
  } else if (carrier === 'entregar') {
    resultCarrierTag.textContent = 'Entregar';
    resultCarrierTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200';
    officialLinkBtn.className = 'btn-primary-entregar px-4 py-2 text-xs';
    officialLinkText.textContent = 'Ver en Entregar Oficial';
  } else {
    resultCarrierTag.textContent = 'Urbano Express';
    resultCarrierTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-50 text-red-800 border border-red-200';
    officialLinkBtn.className = 'btn-primary-urbano px-4 py-2 text-xs';
    officialLinkText.textContent = 'Ver en Urbano Oficial';
  }

  officialLinkBtn.href = data.officialUrl;

  // Manejo de múltiples tramos / sub-órdenes (Despacho / Retiro)
  if (data.allOrders && data.allOrders.length > 1) {
    subOrdersContainer.classList.remove('hidden');
    subOrdersCount.textContent = data.allOrders.length;
    subOrdersList.innerHTML = '';

    const selectedIdx = data.selectedSubOrderIndex !== undefined ? data.selectedSubOrderIndex : 0;

    data.allOrders.forEach((sub, sIdx) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      const isActive = sIdx === selectedIdx;
      
      const cls = sub.classification || {};
      const typeKey = cls.type || 'general';
      const codeKey = (cls.code || 'otro').toLowerCase();
      
      pill.className = `suborder-pill type-${typeKey} ${isActive ? 'active' : ''}`;
      
      const badgeSnippet = cls.code ? `<span class="pill-badge pill-badge-${codeKey}">${escapeHtml(cls.code)}</span>` : '';
      const op = sub.operacion || 'Envío';
      const remitoStr = sub.remito ? `${sub.remito}` : (sub.idpedido ? `#${sub.idpedido}` : '');
      const st = sub.status || 'En proceso';
      const myRef = cls.shortRef || sub.referencia || '';

      // Armado de la sección de referencias pedida por el usuario:
      // "debajo de donde dice que es retiro o despacho por cambio ver cuál es el zech y su vinculado el zre7"
      let refPairSnippet = '';
      if (cls.isExchange && cls.pairedOrder) {
        const partnerRef = cls.pairedOrder.shortRef || cls.pairedOrder.referencia;
        refPairSnippet = `
          <div class="suborder-ref-row">
            <span class="suborder-ref-current" title="Referencia completa: ${escapeHtml(sub.referencia)}">${escapeHtml(myRef)}</span>
            <span class="suborder-ref-sep">↔</span>
            <span class="suborder-ref-linked" title="Vinculado con: ${escapeHtml(cls.pairedOrder.referencia)} (Remito ${escapeHtml(cls.pairedOrder.remito || '')})">
              <i class="fa-solid fa-link text-[9px]"></i>
              <span>Vinc: <strong>${escapeHtml(partnerRef)}</strong></span>
            </span>
          </div>
        `;
      } else if (cls.code === 'ZECO') {
        refPairSnippet = `
          <div class="suborder-ref-row">
            <span class="suborder-ref-current" title="Referencia completa: ${escapeHtml(sub.referencia)}">${escapeHtml(myRef)}</span>
            <span class="suborder-ref-single-tag text-emerald-700 bg-emerald-50 border border-emerald-200">Entrega original</span>
          </div>
        `;
      } else if (cls.code === 'ZRE2') {
        refPairSnippet = `
          <div class="suborder-ref-row">
            <span class="suborder-ref-current" title="Referencia completa: ${escapeHtml(sub.referencia)}">${escapeHtml(myRef)}</span>
            <span class="suborder-ref-single-tag text-rose-700 bg-rose-50 border border-rose-200">Devolución directa</span>
          </div>
        `;
      } else if (myRef) {
        refPairSnippet = `
          <div class="suborder-ref-row">
            <span class="suborder-ref-current">${escapeHtml(myRef)}</span>
          </div>
        `;
      }

      pill.innerHTML = `
        <span class="suborder-dot"></span>
        ${badgeSnippet}
        <span class="suborder-text">
          <div class="suborder-top-row">
            <span class="suborder-title">${escapeHtml(cls.label || op)}</span>
            <span class="suborder-status-tag">${escapeHtml(st)}</span>
          </div>
          ${refPairSnippet}
          <div class="suborder-sub">
            <span>Remito: <strong>${escapeHtml(remitoStr || 'S/N')}</strong></span>
          </div>
        </span>
      `;

      pill.addEventListener('click', () => {
        data.selectedSubOrderIndex = sIdx;
        applySubOrderData(data, sub);
        // Actualizar active state de las píldoras
        [...subOrdersList.children].forEach((c, idx) => {
          c.classList.toggle('active', idx === sIdx);
        });
      });

      subOrdersList.appendChild(pill);
    });

    // Aplicar los datos del tramo seleccionado
    applySubOrderData(data, data.allOrders[selectedIdx]);
  } else {
    subOrdersContainer.classList.add('hidden');
    applySubOrderData(data, null);
  }

  resultBox.classList.remove('hidden');
}

function applySubOrderData(data, subOrder) {
  const isSub = Boolean(subOrder);
  const cat = isSub ? subOrder.statusCategory : (data.statusCategory || 'in_transit');
  const label = isSub ? (subOrder.statusLabel || subOrder.status) : (data.statusLabel || data.summary.estadoRaw || 'En proceso');
  const dateStr = isSub ? subOrder.fechaStatus : data.summary.fechaEstado;

  statusLabelText.textContent = label;
  statusDateBadge.textContent = dateStr ? `(${dateStr})` : '';

  statusBanner.className = 'p-4 sm:p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4';

  if (cat === 'delivered') {
    statusBanner.classList.add('bg-emerald-50/80', 'border-emerald-100');
    statusLabelText.className = 'text-lg sm:text-xl font-extrabold text-emerald-950';
    statusIndicatorDot.className = 'pulse-indicator text-emerald-600';
  } else if (cat === 'out_for_delivery') {
    statusBanner.classList.add('bg-sky-50/80', 'border-sky-100');
    statusLabelText.className = 'text-lg sm:text-xl font-extrabold text-sky-950';
    statusIndicatorDot.className = 'pulse-indicator text-sky-600';
  } else if (cat === 'received') {
    statusBanner.classList.add('bg-amber-50/80', 'border-amber-100');
    statusLabelText.className = 'text-lg sm:text-xl font-extrabold text-amber-950';
    statusIndicatorDot.className = 'pulse-indicator text-amber-600';
  } else if (cat === 'incident') {
    statusBanner.classList.add('bg-rose-50/80', 'border-rose-100');
    statusLabelText.className = 'text-lg sm:text-xl font-extrabold text-rose-950';
    statusIndicatorDot.className = 'pulse-indicator text-rose-600';
  } else {
    statusBanner.classList.add('bg-slate-50', 'border-slate-200');
    statusLabelText.className = 'text-lg sm:text-xl font-extrabold text-slate-900';
    statusIndicatorDot.className = 'pulse-indicator text-slate-600';
  }

  // Metadatos clave
  const refCode = isSub ? (subOrder.referencia || data.order) : (data.referenciaEnvio || data.order);
  resultOrderTitle.textContent = refCode;

  // Actualizar enlace oficial según transportista y sub-orden
  const carrier = data.carrier || currentCarrier;
  if (carrier === 'entregar') {
    const activeRef = isSub ? (subOrder.referencia || refCode) : (data.referenciaEnvio || refCode);
    officialLinkBtn.href = `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(activeRef)}&numero_hash=&boton=Consultar`;
  } else {
    officialLinkBtn.href = isSub ? (subOrder.officialUrl || data.officialUrl) : data.officialUrl;
  }

  // Banner Operativo Entregar (BGH: ZECO, ZECH, ZRE7, ZRE2)
  const activeSub = isSub ? subOrder : data;
  const cls = activeSub.classification || data.classification;

  if (carrier === 'entregar' && cls && cls.code) {
    entregarOperationalBanner.classList.remove('hidden');
    entregarOperationalBanner.className = `px-5 py-3.5 border-b flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs transition-all banner-${cls.type || 'general'}`;

    // Iconos temáticos según clasificación
    let iconHtml = '<i class="fa-solid fa-box"></i>';
    if (cls.type === 'original') {
      iconHtml = '<i class="fa-solid fa-box-open"></i>';
    } else if (cls.type === 'swap_dispatch') {
      iconHtml = '<i class="fa-solid fa-truck-ramp-box"></i>';
    } else if (cls.type === 'swap_pickup') {
      iconHtml = '<i class="fa-solid fa-arrow-right-arrow-left"></i>';
    } else if (cls.type === 'return_pickup') {
      iconHtml = '<i class="fa-solid fa-arrow-rotate-left"></i>';
    }
    operationalIconBox.innerHTML = iconHtml;

    operationalTitle.textContent = cls.shortRef ? `${cls.label} (${cls.shortRef})` : (cls.label || 'Envío Entregar');
    operationalCodeBadge.textContent = cls.code || 'BGH';

    // Referencia de texto auxiliar
    const aux2Text = activeSub.campoAuxiliar2 || data.campoAuxiliar2 || '';
    if (aux2Text) {
      operationalAuxBadge.textContent = aux2Text;
      operationalAuxBadge.classList.remove('hidden');
    } else {
      operationalAuxBadge.classList.add('hidden');
    }

    // Manejo de tramo vinculado de cambio (ZECH <-> ZRE7)
    if (cls.pairedOrder && cls.pairedOrder.index !== undefined) {
      const paired = cls.pairedOrder;
      const targetLabel = paired.type === 'swap_pickup' ? 'Retiro' : 'Despacho';
      const targetIdentifier = paired.shortRef || paired.remito || paired.referencia || `#${paired.idpedido}`;
      operationalDescription.textContent = `${cls.description} Vinculado operativamente al ${targetLabel.toLowerCase()} ${targetIdentifier} (Remito ${paired.remito || 'S/N'}). Ambos deben coordinarse simultáneamente.`;

      operationalLinkedAction.classList.remove('hidden');
      goToLinkedLegText.textContent = `Ver ${targetLabel} (${targetIdentifier})`;
      
      goToLinkedLegBtn.onclick = () => {
        if (data.allOrders && data.allOrders[paired.index]) {
          data.selectedSubOrderIndex = paired.index;
          applySubOrderData(data, data.allOrders[paired.index]);
          if (subOrdersList && subOrdersList.children[paired.index]) {
            [...subOrdersList.children].forEach((c, idx) => {
              c.classList.toggle('active', idx === paired.index);
            });
            subOrdersList.children[paired.index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }
      };
    } else {
      operationalDescription.textContent = cls.description || '';
      operationalLinkedAction.classList.add('hidden');
    }
  } else {
    entregarOperationalBanner.classList.add('hidden');
  }

  const guia = isSub ? (subOrder.remito || subOrder.idpedido) : (data.guiaNumero || data.summary.guiaNumero || 'Sin asignar');
  metaGuia.textContent = guia;

  const remit = isSub ? (subOrder.empresa ? `Empresa ${subOrder.empresa}` : 'Entregar') : (data.summary.remitente || 'Distribución');
  metaRemitente.textContent = remit;

  const serv = isSub ? [subOrder.servicio, subOrder.operacion].filter(Boolean).join(' • ') : (data.summary.servicio || 'Distribución Estándar');
  metaServicio.textContent = serv;
  
  const destInfo = isSub 
    ? (subOrder.destinatario ? `${subOrder.destinatario} - ${subOrder.direccion || ''}` : subOrder.direccion || 'Nacional')
    : (data.detail.destinatario ? `${data.detail.destinatario} - ${data.detail.direccion || ''}` : data.detail.observaciones || data.detail.direccion || 'Nacional');
  metaDestino.textContent = destInfo;

  const prodInfo = isSub ? subOrder.producto : (data.summary.producto || data.detail.producto);
  metaCiclo.textContent = prodInfo ? `Producto: ${prodInfo}` : (data.summary.ciclo ? `Ciclo: ${data.summary.ciclo}` : '');

  // Renderizar Movimientos
  const movements = isSub ? (subOrder.movements || []) : (data.movements || []);
  movementsCountBadge.textContent = `${movements.length} eventos`;

  renderTimeline(movements, cat);
  renderTable(movements);
}

// Renderizado del Feed Timeline Vertical
function renderTimeline(movements, statusCategory) {
  timelineFeed.innerHTML = '';

  if (movements.length === 0) {
    timelineFeed.innerHTML = `
      <div class="py-8 text-center text-slate-400 italic text-xs">
        El envío está registrado pero aún no cuenta con escaneos de sucursal en el sistema.
      </div>
    `;
    return;
  }

  // Mostramos los eventos en orden inverso (el más reciente arriba)
  const reversed = [...movements].reverse();

  reversed.forEach((m, idx) => {
    const isLatest = idx === 0;
    const stepDiv = document.createElement('div');
    stepDiv.className = `timeline-step ${isLatest ? 'latest' : ''} ${statusCategory === 'delivered' ? 'delivered' : 'in-transit'}`;

    const iconHtml = isLatest 
      ? (statusCategory === 'delivered' ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-truck-fast"></i>')
      : '<i class="fa-regular fa-circle-dot text-[8px]"></i>';

    const phaseTag = m.phase 
      ? `<span class="inline-block bg-slate-100 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded-full mr-2">${escapeHtml(m.phase)}</span>` 
      : '';

    const agencyTag = m.agency 
      ? `<span class="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium bg-slate-50 border border-slate-200/60 px-2 py-0.5 rounded-md mt-1.5"><i class="fa-solid fa-location-dot text-[9px] text-slate-400"></i> ${escapeHtml(m.agency)}</span>`
      : '';

    const zoneTag = m.zone 
      ? `<span class="text-[10px] text-slate-400 font-mono-code ml-2">Zona ${escapeHtml(m.zone)}</span>`
      : '';

    const descTag = m.description 
      ? `<div class="text-[11px] text-slate-500 mt-1 italic">${escapeHtml(m.description)}</div>`
      : '';

    stepDiv.innerHTML = `
      <div class="timeline-step-node">
        ${iconHtml}
      </div>
      <div class="timeline-card">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
          <div class="flex items-center gap-2 font-mono-code text-slate-500 font-semibold">
            <span>${escapeHtml(m.date)}</span>
            <span class="text-slate-400 font-normal">${escapeHtml(m.time)}</span>
          </div>
          ${isLatest ? '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full self-start sm:self-auto">Último movimiento registrado</span>' : ''}
        </div>
        <div class="mt-1">
          <div class="flex items-baseline flex-wrap">
            ${phaseTag}
            <span class="text-xs sm:text-sm font-semibold text-slate-900">${escapeHtml(m.status)}</span>
            ${zoneTag}
          </div>
          ${descTag}
          ${agencyTag}
        </div>
      </div>
    `;

    timelineFeed.appendChild(stepDiv);
  });
}

// Renderizado de la Tabla Clásica
function renderTable(movements) {
  timelineTableBody.innerHTML = '';

  if (movements.length === 0) {
    timelineTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="py-6 text-center text-slate-400 italic text-xs">
          El envío está registrado pero aún no cuenta con escaneos de sucursal en el sistema.
        </td>
      </tr>
    `;
    return;
  }

  movements.forEach((m, idx) => {
    const isLatest = idx === movements.length - 1;
    const tr = document.createElement('tr');
    if (isLatest) {
      tr.className = 'latest-row';
    }

    const phaseTag = m.phase 
      ? `<span class="inline-block bg-slate-100 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded mr-1.5">${escapeHtml(m.phase)}</span>` 
      : '';

    const zoneTag = m.zone 
      ? `<span class="text-[10px] text-slate-400 font-mono-code block mt-0.5">Zona: ${escapeHtml(m.zone)}</span>` 
      : '';

    const descTag = m.description 
      ? `<div class="text-[11px] text-slate-500 italic mt-0.5">${escapeHtml(m.description)}</div>`
      : '';

    tr.innerHTML = `
      <td class="font-mono-code text-slate-400 text-xs">${idx + 1}</td>
      <td class="font-mono-code text-xs whitespace-nowrap">${escapeHtml(m.date)} <span class="text-slate-500 font-normal">${escapeHtml(m.time)}</span></td>
      <td>
        <div class="flex items-baseline flex-wrap">
          ${phaseTag}
          <span class="text-xs text-slate-900">${escapeHtml(m.status)}</span>
        </div>
        ${descTag}
        ${zoneTag}
      </td>
      <td class="text-xs text-slate-600 font-medium">${escapeHtml(m.agency || '-')}</td>
    `;
    timelineTableBody.appendChild(tr);
  });
}

// ==========================================================================
// Copiado Rápido & Toasts
// ==========================================================================
copyOrderBtn.addEventListener('click', async () => {
  const val = resultOrderTitle.textContent.trim();
  if (val && val !== '--') {
    await copyText(val, 'Referencia copiada al portapapeles');
  }
});

copyGuiaBtn.addEventListener('click', async () => {
  const val = metaGuia.textContent.trim();
  if (val && val !== '--' && val !== 'Sin asignar') {
    await copyText(val, 'N° de Guía copiado al portapapeles');
  }
});

copySummaryBtn.addEventListener('click', async () => {
  if (!lastTrackedData) return;
  const d = lastTrackedData;
  const carrierName = d.carrier === 'andreani' ? 'Correo Andreani' : (d.carrier === 'entregar' ? 'Entregar (BGH)' : 'Urbano Express');
  const currentLink = officialLinkBtn?.href || d.officialUrl;
  const currentRef = resultOrderTitle?.textContent.trim() || d.order;
  const currentGuia = metaGuia?.textContent.trim() || d.guiaNumero || 'N/A';
  const currentRemitente = metaRemitente?.textContent.trim() || d.summary?.remitente || 'N/A';
  const currentStatus = statusLabelText?.textContent.trim() || d.statusLabel;
  const currentDate = statusDateBadge?.textContent.replace(/[()]/g, '').trim() || '';

  let extraLines = '';
  if (d.carrier === 'entregar') {
    const activeSub = (d.allOrders && d.selectedSubOrderIndex !== undefined) ? d.allOrders[d.selectedSubOrderIndex] : d;
    const cls = activeSub.classification || d.classification;
    if (cls && cls.label) {
      extraLines += `Operación: ${cls.badgeText || cls.label}\n`;
      if (cls.pairedOrder) {
        const pairedLabel = cls.pairedOrder.type === 'swap_pickup' ? 'Retiro' : 'Despacho';
        extraLines += `Vinculado a: ${pairedLabel} ${cls.pairedOrder.referencia} (Remito ${cls.pairedOrder.remito || 'S/N'})\n`;
      }
    }
  }

  const text = `Seguimiento ${carrierName}\nReferencia / Pedido: ${currentRef}\nGuía / Remito: ${currentGuia}\n${extraLines}Remitente: ${currentRemitente}\nEstado: ${currentStatus} ${currentDate ? `(${currentDate})` : ''}\nEnlace oficial: ${currentLink}`;

  await copyText(text, 'Ficha del envío copiada para enviar');
});

async function copyText(text, toastMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(toastMsg, 'success');
  } catch (err) {
    prompt('Copiar texto:', text);
  }
}

function showToast(message, type = 'success') {
  if (!toastNotification) return;
  toastMessage.textContent = message;
  toastNotification.className = `toast-notification show ${type}`;

  if (type === 'success') {
    toastIcon.className = 'fa-solid fa-circle-check text-emerald-400';
  } else if (type === 'info') {
    toastIcon.className = 'fa-solid fa-circle-info text-sky-400';
  } else {
    toastIcon.className = 'fa-solid fa-triangle-exclamation text-amber-400';
  }

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastNotification.classList.remove('show');
  }, 2500);
}

// ==========================================================================
// Manejo de Errores
// ==========================================================================
function showError(msg, officialUrl, needSession = false) {
  if (needSession) {
    errorMessage.innerHTML = `
      <span>${escapeHtml(msg)}</span>
      <div class="mt-2.5">
        <button type="button" id="renewSessionFromErrorBtn" class="text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition">
          <i class="fa-solid fa-key text-[10px]"></i>
          <span>Renovar sesión de Entregar</span>
        </button>
      </div>
    `;
    const btn = document.getElementById('renewSessionFromErrorBtn');
    if (btn) btn.onclick = openSessionModal;
  } else {
    errorMessage.textContent = msg;
  }

  if (officialUrl) {
    errorOfficialLink.href = officialUrl;
    errorOfficialLink.classList.remove('hidden');
  } else {
    errorOfficialLink.classList.add('hidden');
  }
  resultBox.classList.add('hidden');
  errorBox.classList.remove('hidden');
}

// ==========================================================================
// Modal de Sesión de Entregar
// ==========================================================================
async function openSessionModal() {
  if (!sessionModal) return;
  sessionModal.classList.add('open');
  sessionStatusMsg.className = 'hidden';

  try {
    const res = await fetch('/api/entregar/session');
    const data = await res.json();
    if (data.success) {
      if (data.hasCookie) {
        sessionStatusMsg.className = 'p-2.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200';
        sessionStatusMsg.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i> Sesión actualmente activa en el servidor. ${data.lastPing ? '(Último ping: ' + new Date(data.lastPing).toLocaleTimeString() + ')' : ''}`;
      } else {
        sessionStatusMsg.className = 'p-2.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200';
        sessionStatusMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-amber-600 mr-1.5"></i> No hay cookie configurada en el servidor.';
      }
    }
  } catch (e) {
    console.error('Error fetching session status:', e);
  }
}

function closeSessionModal() {
  if (sessionModal) sessionModal.classList.remove('open');
}

async function handleSaveSessionCookie() {
  const cookie = (sessionCookieInput.value || '').trim();
  if (!cookie) {
    showToast('Ingresá una cookie válida', 'error');
    return;
  }

  saveSessionCookieBtn.disabled = true;
  saveSessionCookieBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Verificando...';

  try {
    const res = await fetch('/api/entregar/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie })
    });
    const data = await res.json();

    if (data.success) {
      showToast('Sesión de Entregar actualizada con éxito', 'success');
      closeSessionModal();
      sessionCookieInput.value = '';
    } else {
      showToast(data.message || 'Error al guardar la cookie', 'error');
    }
  } catch (err) {
    showToast(`Error de conexión: ${err.message}`, 'error');
  } finally {
    saveSessionCookieBtn.disabled = false;
    saveSessionCookieBtn.innerHTML = '<span>Guardar y Verificar</span>';
  }
}

// ==========================================================================
// Historial de Búsquedas Recientes
// ==========================================================================
function addToRecent(order, carrier = 'urbano') {
  if (!order) return;
  const item = { order, carrier };
  recentSearches = [
    item,
    ...recentSearches.filter(s => (typeof s === 'string' ? s : s.order).toLowerCase() !== order.toLowerCase())
  ].slice(0, 8);

  localStorage.setItem('urbano_recent_searches', JSON.stringify(recentSearches));
  renderRecentSearches();
}

function renderRecentSearches() {
  if (recentSearches.length === 0) {
    recentTags.innerHTML = '<span class="text-slate-400 italic">No hay pedidos recientes en este dispositivo.</span>';
    return;
  }

  recentTags.innerHTML = '';
  recentSearches.forEach(rawItem => {
    const item = typeof rawItem === 'string' ? { order: rawItem, carrier: 'urbano' } : rawItem;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-slate-100 hover:bg-slate-200 text-slate-800 font-mono-code text-xs px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer border border-slate-200/60';
    
    let carrierBadge = '<span class="text-[9px] font-bold text-red-700 bg-red-100/80 px-1 py-0.5 rounded">URB</span>';
    if (item.carrier === 'andreani') {
      carrierBadge = '<span class="text-[9px] font-bold text-blue-700 bg-blue-100/80 px-1 py-0.5 rounded">AND</span>';
    } else if (item.carrier === 'entregar') {
      carrierBadge = '<span class="text-[9px] font-bold text-emerald-700 bg-emerald-100/80 px-1 py-0.5 rounded">ENT</span>';
    }

    btn.innerHTML = `${carrierBadge}<span>${escapeHtml(item.order)}</span>`;
    btn.addEventListener('click', () => {
      setCarrier(item.carrier || 'urbano', false);
      orderInput.value = item.order;
      orderInput.dispatchEvent(new Event('input'));
      performTrack(item.order);
    });
    recentTags.appendChild(btn);
  });
}

clearHistoryBtn.addEventListener('click', () => {
  recentSearches = [];
  localStorage.removeItem('urbano_recent_searches');
  renderRecentSearches();
  showToast('Historial limpiado', 'info');
});

// ==========================================================================
// Búsqueda por Lotes (Batch)
// ==========================================================================
if (batchClearBtn) {
  batchClearBtn.addEventListener('click', () => {
    batchTextarea.value = '';
    batchResultsBox.classList.add('hidden');
    batchTextarea.focus();
  });
}

batchSubmitBtn.addEventListener('click', async () => {
  const text = batchTextarea.value.trim();
  if (!text) {
    showToast('Ingresá al menos un número de pedido', 'info');
    return;
  }

  const orders = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (orders.length === 0) return;

  batchSubmitBtn.disabled = true;
  batchSubmitBtn.classList.add('opacity-50');
  batchSubmitBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Consultando...';
  batchResultsBox.classList.remove('hidden');
  batchTableBody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">Consultando ${orders.length} pedidos en el sistema...</td></tr>`;

  try {
    const res = await fetch('/api/track-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, shipper: currentShipper, carrier: currentCarrier })
    });
    const data = await res.json();

    if (!data.success) {
      batchTableBody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-red-600">${escapeHtml(data.message)}</td></tr>`;
      return;
    }

    renderBatchResults(data.results || []);
  } catch (err) {
    batchTableBody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-red-600">Error: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    batchSubmitBtn.disabled = false;
    batchSubmitBtn.classList.remove('opacity-50');
    batchSubmitBtn.innerHTML = '<i class="fa-solid fa-play text-[10px]"></i> Consultar lote de pedidos';
  }
});

function renderBatchResults(results) {
  batchTableBody.innerHTML = '';
  let delivered = 0;

  results.forEach(item => {
    if (item.success && item.statusCategory === 'delivered') delivered++;

    const tr = document.createElement('tr');
    const badgeColor = item.success
      ? (item.statusCategory === 'delivered' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-sky-50 text-sky-800 border-sky-200')
      : 'bg-red-50 text-red-800 border-red-200';

    const badge = item.success 
      ? `<span class="text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badgeColor}">${escapeHtml(item.statusLabel || item.summary.estadoRaw || 'En proceso')}</span>`
      : `<span class="text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-red-50 text-red-800 border-red-200">No encontrado</span>`;

    let carrierName = 'Urbano';
    let carrierTag = '<span class="text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">Urbano</span>';
    if (item.carrier === 'andreani') {
      carrierName = 'Andreani';
      carrierTag = '<span class="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">Andreani</span>';
    } else if (item.carrier === 'entregar') {
      carrierName = 'Entregar';
      carrierTag = '<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Entregar</span>';
    }

    tr.innerHTML = `
      <td class="font-mono-code font-bold text-slate-900">${escapeHtml(item.order)}</td>
      <td>${carrierTag}</td>
      <td class="font-mono-code text-slate-600">${item.success ? escapeHtml(item.guiaNumero || item.summary.guiaNumero || '-') : '-'}</td>
      <td>${badge}</td>
      <td class="font-mono-code text-xs text-slate-500">${item.success ? escapeHtml(item.summary.fechaEstado || '-') : '-'}</td>
      <td style="text-align: right;">
        <a href="${escapeHtml(item.officialUrl)}" target="_blank" class="text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold inline-flex items-center gap-1">
          <span>Portal ${carrierName}</span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
        </a>
      </td>
    `;
    batchTableBody.appendChild(tr);
  });

  batchSummaryStats.textContent = `Total: ${results.length} | Entregados: ${delivered}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

init();
