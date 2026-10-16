// Estado de la aplicación
let currentCarrier = localStorage.getItem('selected_carrier') || 'urbano';
const currentShipper = '004185'; // Cuenta fija consolidada
let recentSearches = JSON.parse(localStorage.getItem('urbano_recent_searches') || '[]');
let lastTrackedData = null;

// Elementos del DOM - Encabezado y Selector de Courier
const carrierUrbanoBtn = document.getElementById('carrierUrbanoBtn');
const carrierAndreaniBtn = document.getElementById('carrierAndreaniBtn');
const shipperBadgeContainer = document.getElementById('shipperBadgeContainer');

// Elementos del DOM - Formulario de Búsqueda
const trackForm = document.getElementById('trackForm');
const orderInput = document.getElementById('orderInput');
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
const resultOrderTitle = document.getElementById('resultOrderTitle');
const metaGuia = document.getElementById('metaGuia');
const metaRemitente = document.getElementById('metaRemitente');
const metaServicio = document.getElementById('metaServicio');
const metaDestino = document.getElementById('metaDestino');
const metaCiclo = document.getElementById('metaCiclo');
const officialLinkBtn = document.getElementById('officialLinkBtn');
const officialLinkText = document.getElementById('officialLinkText');
const copySummaryBtn = document.getElementById('copySummaryBtn');
const copySummaryText = document.getElementById('copySummaryText');
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
const batchResultsBox = document.getElementById('batchResultsBox');
const batchTableBody = document.getElementById('batchTableBody');
const batchSummaryStats = document.getElementById('batchSummaryStats');

// Inicialización
function init() {
  setCarrier(currentCarrier, false);
  renderRecentSearches();

  const urlParams = new URLSearchParams(window.location.search);
  const orderFromUrl = urlParams.get('order');
  const carrierFromUrl = urlParams.get('carrier');

  if (carrierFromUrl && (carrierFromUrl === 'andreani' || carrierFromUrl === 'urbano')) {
    setCarrier(carrierFromUrl, false);
  }

  if (orderFromUrl) {
    orderInput.value = orderFromUrl;
    orderInput.dispatchEvent(new Event('input'));
    performTrack(orderFromUrl);
  }
}

// Cambio de Courier (Urbano vs Andreani)
function setCarrier(carrier, clearViews = true) {
  currentCarrier = carrier;
  localStorage.setItem('selected_carrier', currentCarrier);

  if (clearViews) {
    resultBox.classList.add('hidden');
    errorBox.classList.add('hidden');
  }

  if (carrier === 'andreani') {
    carrierAndreaniBtn.classList.add('active');
    carrierAndreaniBtn.classList.remove('text-gray-500');
    carrierUrbanoBtn.classList.remove('active');
    carrierUrbanoBtn.classList.add('text-gray-500');

    searchLabel.textContent = 'Número de pedido (Mercado Libre) o guía (Andreani):';
    carrierIndicatorTag.textContent = 'Modo Andreani';
    carrierIndicatorTag.className = 'text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200';
    orderInput.placeholder = 'Ingresá tu pedido de Mercado Libre o guía, ej: 2000018697823352';

    shipperBadgeContainer.classList.add('hidden');
  } else {
    carrierUrbanoBtn.classList.add('active');
    carrierUrbanoBtn.classList.remove('text-gray-500');
    carrierAndreaniBtn.classList.remove('active');
    carrierAndreaniBtn.classList.add('text-gray-500');

    searchLabel.textContent = 'Número de pedido o código de compra (Urbano):';
    carrierIndicatorTag.textContent = 'Modo Urbano Express';
    carrierIndicatorTag.className = 'text-xs font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200';
    orderInput.placeholder = 'Ingresá tu código, ej: 2745296ICBC';

    shipperBadgeContainer.classList.remove('hidden');
  }
}

carrierUrbanoBtn.addEventListener('click', () => setCarrier('urbano'));
carrierAndreaniBtn.addEventListener('click', () => setCarrier('andreani'));

// Auto-detección inteligente de courier
function autoDetectCarrier(code) {
  const trimmed = (code || '').trim();
  if (/^2000\d{10,14}$/.test(trimmed) || trimmed.startsWith('2000') || trimmed.startsWith('4004') || (/^\d{15,16}$/.test(trimmed))) {
    return 'andreani';
  }
  return currentCarrier;
}

// Navegación Pestañas
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

// Chips de ejemplo rápido
document.querySelectorAll('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const code = chip.getAttribute('data-code');
    const carrier = chip.getAttribute('data-carrier') || 'urbano';
    setCarrier(carrier, false);
    orderInput.value = code;
    orderInput.dispatchEvent(new Event('input'));
    performTrack(code);
  });
});

// Pegar del portapapeles
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const code = text.trim();
      const detected = autoDetectCarrier(code);
      if (detected !== currentCarrier) {
        setCarrier(detected, false);
      }
      orderInput.value = code;
      orderInput.dispatchEvent(new Event('input'));
      performTrack(code);
    }
  } catch (err) {
    orderInput.focus();
  }
});

// Botón limpiar input
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

// Envío formulario
trackForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const order = orderInput.value.trim();
  if (order) {
    const detected = autoDetectCarrier(order);
    if (detected !== currentCarrier) {
      setCarrier(detected, false);
    }
    performTrack(order);
  }
});

// Consulta a la API
async function performTrack(order) {
  const newUrl = new URL(window.location);
  newUrl.searchParams.set('order', order);
  newUrl.searchParams.set('carrier', currentCarrier);
  window.history.pushState({}, '', newUrl);

  loadingText.textContent = currentCarrier === 'andreani' 
    ? 'Consultando estado oficial en Andreani...' 
    : 'Consultando estado oficial en Urbano...';

  loadingBox.classList.remove('hidden');
  errorBox.classList.add('hidden');
  resultBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-50');

  try {
    const res = await fetch(`/api/track?order=${encodeURIComponent(order)}&shipper=${encodeURIComponent(currentShipper)}&carrier=${encodeURIComponent(currentCarrier)}`);
    const data = await res.json();

    if (!data.success) {
      showError(data.message || 'No se encontró el envío.', data.officialUrl);
      return;
    }

    lastTrackedData = data;
    renderResult(data);
    addToRecent(order, data.carrier || currentCarrier);
  } catch (err) {
    const fallbackUrl = currentCarrier === 'andreani'
      ? `https://www.andreani.com/envio/${encodeURIComponent(order)}`
      : `https://apis.urbano.com.ar/cespecifica/?tracking=${currentShipper}${order}`;
    showError(`Error de conexión con el servidor: ${err.message}`, fallbackUrl);
  } finally {
    loadingBox.classList.add('hidden');
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-50');
  }
}

// Renderizar resultado unificado
function renderResult(data) {
  const isAndreani = data.carrier === 'andreani';

  // Configurar distintivo de la empresa
  if (isAndreani) {
    resultCarrierTag.textContent = 'Correo Andreani';
    resultCarrierTag.className = 'text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800';
    officialLinkBtn.className = 'inline-flex items-center gap-2 bg-[#005195] hover:bg-[#003d73] text-white px-4 py-2 rounded text-xs font-bold transition shadow-xs';
    officialLinkText.textContent = 'Ver en Andreani Oficial';
  } else {
    resultCarrierTag.textContent = 'Urbano Express';
    resultCarrierTag.className = 'text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-800';
    officialLinkBtn.className = 'inline-flex items-center gap-2 bg-[#e60012] hover:bg-[#cc0010] text-white px-4 py-2 rounded text-xs font-bold transition shadow-xs';
    officialLinkText.textContent = 'Ver en Urbano Oficial';
  }

  officialLinkBtn.href = data.officialUrl;

  // Franja de estado
  const cat = data.statusCategory || 'in_transit';
  const label = data.statusLabel || data.summary.estadoRaw || 'En proceso';

  statusLabelText.textContent = label;
  statusDateBadge.textContent = data.summary.fechaEstado ? `(${data.summary.fechaEstado})` : '';

  statusBanner.className = 'p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3';
  if (cat === 'delivered') {
    statusBanner.classList.add('bg-green-50', 'border-green-200');
    statusLabelText.className = 'text-lg font-bold text-green-800';
  } else if (cat === 'out_for_delivery') {
    statusBanner.classList.add('bg-blue-50', 'border-blue-200');
    statusLabelText.className = 'text-lg font-bold text-blue-800';
  } else if (cat === 'received') {
    statusBanner.classList.add('bg-amber-50', 'border-amber-200');
    statusLabelText.className = 'text-lg font-bold text-amber-800';
  } else {
    statusBanner.classList.add('bg-gray-50', 'border-gray-200');
    statusLabelText.className = 'text-lg font-bold text-gray-800';
  }

  // Metadatos clave
  resultOrderTitle.textContent = data.referenciaEnvio || data.order;
  metaGuia.textContent = data.guiaNumero || data.summary.guiaNumero || 'Sin asignar';
  metaRemitente.textContent = data.summary.remitente || (isAndreani ? 'Andreani' : `Cuenta ${data.shipper || currentShipper}`);
  metaServicio.textContent = data.summary.servicio || 'Distribución Estándar';
  
  const destInfo = data.detail.observaciones || data.detail.referencia || data.detail.direccion || 'Nacional';
  metaDestino.textContent = destInfo;

  metaCiclo.textContent = data.summary.ciclo 
    ? `Ciclo de despacho: ${data.summary.ciclo}` 
    : (data.detail.observaciones ? `Observaciones: ${data.detail.observaciones}` : '');

  // Tabla de movimientos
  timelineTableBody.innerHTML = '';
  const movements = data.movements || [];
  movementsCountBadge.textContent = `${movements.length} eventos`;

  if (movements.length === 0) {
    timelineTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="py-6 text-center text-gray-400 italic">
          El envío está registrado pero aún no cuenta con escaneos de sucursal en el sistema.
        </td>
      </tr>
    `;
  } else {
    movements.forEach((m, idx) => {
      const isLatest = idx === movements.length - 1;
      const tr = document.createElement('tr');
      if (isLatest) {
        tr.className = 'latest-row';
      }

      const phaseTag = m.phase ? `<span class="inline-block bg-gray-100 text-gray-700 text-[11px] font-semibold px-2 py-0.5 rounded mr-1.5">${escapeHtml(m.phase)}</span>` : '';
      const zoneTag = m.zone ? `<span class="text-[11px] text-gray-400 font-mono block mt-0.5">Zona: ${escapeHtml(m.zone)}</span>` : '';

      tr.innerHTML = `
        <td class="font-mono text-gray-400 text-xs">${idx + 1}</td>
        <td class="font-mono text-xs whitespace-nowrap">${escapeHtml(m.date)} <span class="text-gray-500 font-normal">${escapeHtml(m.time)}</span></td>
        <td>
          <div class="flex items-baseline flex-wrap">
            ${phaseTag}
            <span class="text-xs text-gray-800">${escapeHtml(m.status)}</span>
          </div>
          ${zoneTag}
        </td>
        <td class="text-xs text-gray-600 font-medium">${escapeHtml(m.agency || '-')}</td>
      `;
      timelineTableBody.appendChild(tr);
    });
  }

  resultBox.classList.remove('hidden');
}

// Copiar datos del envío
copySummaryBtn.addEventListener('click', async () => {
  if (!lastTrackedData) return;
  const d = lastTrackedData;
  const carrierName = d.carrier === 'andreani' ? 'Correo Andreani' : 'Urbano Express';
  const text = `Seguimiento ${carrierName}\nReferencia / Pedido: ${d.order}\nGuía Oficial: ${d.guiaNumero || d.summary.guiaNumero || 'N/A'}\nRemitente: ${d.summary.remitente || 'N/A'}\nEstado: ${d.statusLabel} (${d.summary.fechaEstado || ''})\nEnlace oficial: ${d.officialUrl}`;

  try {
    await navigator.clipboard.writeText(text);
    copySummaryText.textContent = '¡Copiado!';
    setTimeout(() => { copySummaryText.textContent = 'Copiar datos para enviar'; }, 2000);
  } catch (err) {
    prompt('Copiar datos:', text);
  }
});

// Mostrar Error
function showError(msg, officialUrl) {
  errorMessage.textContent = msg;
  if (officialUrl) {
    errorOfficialLink.href = officialUrl;
    errorOfficialLink.classList.remove('hidden');
  } else {
    errorOfficialLink.classList.add('hidden');
  }
  resultBox.classList.add('hidden');
  errorBox.classList.remove('hidden');
}

// Historial de Búsquedas Recientes
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
    recentTags.innerHTML = '<span class="text-gray-400 italic">No hay pedidos recientes.</span>';
    return;
  }

  recentTags.innerHTML = '';
  recentSearches.forEach(rawItem => {
    const item = typeof rawItem === 'string' ? { order: rawItem, carrier: 'urbano' } : rawItem;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bg-gray-100 hover:bg-gray-200 text-gray-800 font-mono text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 cursor-pointer';
    
    const carrierBadge = item.carrier === 'andreani' 
      ? '<span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-1 rounded">AND</span>'
      : '<span class="text-[10px] font-bold text-red-600 bg-red-50 px-1 rounded">URB</span>';

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
});

// Búsqueda por lotes
batchSubmitBtn.addEventListener('click', async () => {
  const text = batchTextarea.value.trim();
  if (!text) return;

  const orders = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (orders.length === 0) return;

  batchSubmitBtn.disabled = true;
  batchSubmitBtn.classList.add('opacity-50');
  batchSubmitBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Consultando...';
  batchResultsBox.classList.remove('hidden');
  batchTableBody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-400">Consultando ${orders.length} pedidos...</td></tr>`;

  try {
    const res = await fetch('/api/track-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, shipper: currentShipper, carrier: currentCarrier })
    });
    const data = await res.json();

    if (!data.success) {
      batchTableBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-600">${escapeHtml(data.message)}</td></tr>`;
      return;
    }

    renderBatchResults(data.results || []);
  } catch (err) {
    batchTableBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-600">Error: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    batchSubmitBtn.disabled = false;
    batchSubmitBtn.classList.remove('opacity-50');
    batchSubmitBtn.innerHTML = '<i class="fa-solid fa-play text-[10px]"></i> Consultar lote';
  }
});

function renderBatchResults(results) {
  batchTableBody.innerHTML = '';
  let delivered = 0;

  results.forEach(item => {
    if (item.success && item.statusCategory === 'delivered') delivered++;

    const tr = document.createElement('tr');
    const badge = item.success 
      ? `<span class="badge-status ${item.statusCategory}">${escapeHtml(item.statusLabel || item.summary.estadoRaw || 'En proceso')}</span>`
      : `<span class="badge-status" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;">No encontrado</span>`;

    const carrierName = item.carrier === 'andreani' ? 'Andreani' : 'Urbano';

    tr.innerHTML = `
      <td class="font-mono font-bold text-gray-900">${escapeHtml(item.order)}</td>
      <td class="font-mono text-gray-600">${item.success ? escapeHtml(item.guiaNumero || item.summary.guiaNumero || '-') : '-'}</td>
      <td>${badge}</td>
      <td class="font-mono text-xs text-gray-500">${item.success ? escapeHtml(item.summary.fechaEstado || '-') : '-'}</td>
      <td style="text-align: right;">
        <a href="${escapeHtml(item.officialUrl)}" target="_blank" class="text-blue-600 hover:underline text-xs font-semibold inline-flex items-center gap-1">
          Abrir en ${carrierName} <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
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
