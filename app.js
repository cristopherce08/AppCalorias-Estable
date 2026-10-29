/* MiCalorías 3.1 — Diario de alimentación, proteínas, peso y gasto calórico.
   Sin servidores externos, sin cuentas, compatible con Safari iOS y GitHub Pages. */
'use strict';

const DB_NAME = 'micalorias-estable-local-v1';
const DB_VERSION = 3;

const MEALS = [
  { id: 'desayuno', title: 'Desayuno', emoji: '☀️' },
  { id: 'almuerzo', title: 'Almuerzo', emoji: '🍽️' },
  { id: 'cena', title: 'Cena', emoji: '🌙' },
  { id: 'snack', title: 'Snacks', emoji: '🍎' }
];

const MEAL_ICONS = {
  desayuno: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  almuerzo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"/><path d="M15 2v18"/><path d="M6 2v20"/><path d="M6 7h4a2 2 0 0 0 2-2V2"/></svg>',
  cena: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  snack: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/></svg>'
};

const $ = selector => document.querySelector(selector);
const numberFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.valueOf()) && date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d;
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[x]));

const fmt = number => {
  if (number === null || number === undefined || !Number.isFinite(Number(number))) return '0';
  return numberFormat.format(Number(number));
};

const keyName = text => String(text || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

const dateText = date => {
  try {
    return new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
  } catch {
    return date;
  }
};

const dateShort = date => {
  try {
    return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
  } catch {
    return date;
  }
};

const offsetDate = (date, days) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// =============================================================
// ESTADO GLOBAL
// =============================================================
let db;
let entries = [];
let foods = [];
let settings = {};
let weightEntries = [];

let currentDate = todayISO();
let currentView = 'diario';
let foodFilter = 'all'; // 'all' | 'favs'
let weightChartPeriod = '4w'; // '4w' | '3m' | 'all'
let toastTimeout;

// Estado de flujos
let stagedMeal = 'desayuno';
let stagedItems = [];
let selectedFoodForQuickAdd = null;
let activeFoodForDirectUse = null;
let editingEntryId = null;
let editingFoodId = null;
let editingWeightId = null;
let activeScenario = 'maintain'; // 'maintain' | 'loss' | 'gain'
let isSaving = false;
let isExporting = false;

// -------------------------------------------------------------
// 1. BASE DE DATOS LOCAL (IndexedDB con migración a v3)
// -------------------------------------------------------------
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const database = req.result;
      if (!database.objectStoreNames.contains('entries')) {
        const entryStore = database.createObjectStore('entries', { keyPath: 'id' });
        entryStore.createIndex('date', 'date', { unique: false });
      }
      if (!database.objectStoreNames.contains('foods')) {
        database.createObjectStore('foods', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('weightEntries')) {
        const weightStore = database.createObjectStore('weightEntries', { keyPath: 'id' });
        weightStore.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña. Ciérrala para continuar.'));
  });
}

function getAll(table) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readonly');
    const req = tx.objectStore(table).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function mutate(table, method, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(table, 'readwrite');
    const store = tx.objectStore(table);
    store[method](value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Error guardando en el dispositivo'));
    tx.onabort = () => reject(tx.error || new Error('Operación cancelada'));
  });
}

async function refresh() {
  const [newEntries, newFoods, newSettings, newWeights] = await Promise.all([
    getAll('entries'),
    getAll('foods'),
    getAll('settings'),
    getAll('weightEntries')
  ]);
  entries = newEntries || [];
  foods = newFoods || [];
  settings = Object.fromEntries((newSettings || []).map(s => [s.key, s.value]));
  weightEntries = newWeights || [];
  renderAll();
}

// -------------------------------------------------------------
// 2. FÓRMULAS DE CÁLCULO NUTRICIONAL (CALORÍAS Y PROTEÍNAS)
// -------------------------------------------------------------
function computeNutrition(item) {
  const amount = Number(item.amount) || 0;
  const isPortion = item.baseType === 'portion';
  let kcal = 0;
  let protein = null;

  if (isPortion) {
    const kpp = Number(item.kcalPerPortion);
    if (Number.isFinite(kpp)) kcal = amount * kpp;
    const ppp = item.proteinPerPortion;
    if (ppp !== null && ppp !== undefined && ppp !== '' && Number.isFinite(Number(ppp))) {
      protein = amount * Number(ppp);
    }
  } else {
    const kp100 = Number(item.kcalPer100);
    if (Number.isFinite(kp100)) kcal = (amount * kp100) / 100;
    const pp100 = item.proteinPer100;
    if (pp100 !== null && pp100 !== undefined && pp100 !== '' && Number.isFinite(Number(pp100))) {
      protein = (amount * Number(pp100)) / 100;
    }
  }

  return {
    kcal: Math.round(kcal * 10) / 10,
    protein: protein !== null ? Math.round(protein * 10) / 10 : null
  };
}

function sumKcal(list) {
  return list.reduce((total, e) => {
    const val = (Number.isFinite(e.kcal)) ? e.kcal : computeNutrition(e).kcal;
    return total + (Number.isFinite(val) ? val : 0);
  }, 0);
}

function sumProtein(list) {
  let total = 0;
  let knownCount = 0;
  let unknownCount = 0;

  for (const e of list) {
    const p = (e.protein !== undefined && e.protein !== null) ? Number(e.protein) : computeNutrition(e).protein;
    if (p !== null && Number.isFinite(p)) {
      total += p;
      knownCount++;
    } else {
      unknownCount++;
    }
  }

  return {
    total: Math.round(total * 10) / 10,
    isPartial: unknownCount > 0 && knownCount > 0,
    allUnknown: knownCount === 0 && list.length > 0,
    hasKnown: knownCount > 0,
    unknownCount
  };
}

function dayEntries(day) {
  return entries.filter(e => e.date === day);
}

// -------------------------------------------------------------
// 3. CALCULADORA DE CALORÍAS (MIFFLIN-ST JEOR & TDEE)
// -------------------------------------------------------------
function calculateMifflinStJeor({ weightKg, heightCm, ageYears, physiologicalParam, activityMultiplier }) {
  const w = Number(weightKg);
  const h = Number(heightCm);
  const a = Number(ageYears);
  const factor = Number(activityMultiplier);

  if (!Number.isFinite(w) || w <= 0 || w > 400) {
    throw new Error('Introduce un peso válido entre 20 y 400 kg');
  }
  if (!Number.isFinite(h) || h <= 0 || h > 260) {
    throw new Error('Introduce una estatura válida entre 80 y 260 cm');
  }
  if (!Number.isFinite(a) || a <= 0 || a > 120) {
    throw new Error('Introduce una edad válida entre 15 y 120 años');
  }
  if (!Number.isFinite(factor) || factor < 1.0 || factor > 2.5) {
    throw new Error('Selecciona un nivel de actividad válido');
  }

  // Base común: 10 * peso + 6.25 * estatura - 5 * edad
  const base = (10 * w) + (6.25 * h) - (5 * a);

  const rmrMale = Math.round(base + 5);
  const rmrFemale = Math.round(base - 161);
  const tdeeMale = Math.round(rmrMale * factor);
  const tdeeFemale = Math.round(rmrFemale * factor);

  if (physiologicalParam === 'male') {
    return {
      isRange: false,
      param: 'male',
      rmr: rmrMale,
      tdee: tdeeMale,
      factor,
      weightKg: w,
      heightCm: h,
      ageYears: a
    };
  } else if (physiologicalParam === 'female') {
    return {
      isRange: false,
      param: 'female',
      rmr: rmrFemale,
      tdee: tdeeFemale,
      factor,
      weightKg: w,
      heightCm: h,
      ageYears: a
    };
  } else {
    // Parámetro no especificado: intervalo orientativo
    const rmrMin = Math.min(rmrMale, rmrFemale);
    const rmrMax = Math.max(rmrMale, rmrFemale);
    const tdeeMin = Math.min(tdeeMale, tdeeFemale);
    const tdeeMax = Math.max(tdeeMale, tdeeFemale);
    return {
      isRange: true,
      param: 'unspecified',
      rmrMin,
      rmrMax,
      tdeeMin,
      tdeeMax,
      rmr: Math.round((rmrMin + rmrMax) / 2),
      tdee: Math.round((tdeeMin + tdeeMax) / 2),
      factor,
      weightKg: w,
      heightCm: h,
      ageYears: a
    };
  }
}

function calculateScenarios(tdee) {
  // Escenarios orientativos moderados y conservadores
  // Déficit moderado (~350 kcal)
  const loss = Math.max(1200, Math.round(tdee - 350));
  // Superávit moderado (~350 kcal)
  const gain = Math.round(tdee + 350);
  return {
    maintain: tdee,
    loss,
    gain
  };
}

// -------------------------------------------------------------
// 4. GESTIÓN DE PESO CORPORAL ("MI PESO")
// -------------------------------------------------------------
function getSortedWeightEntries() {
  return weightEntries.slice().sort((a, b) => a.date.localeCompare(b.date));
}

function getLatestWeightEntry() {
  const sorted = getSortedWeightEntries();
  return sorted.length ? sorted[sorted.length - 1] : null;
}

function computeWeightStats() {
  const sorted = getSortedWeightEntries();
  if (!sorted.length) {
    return {
      latest: null,
      previous: null,
      recentDiff: null,
      totalDiff: null,
      count: 0
    };
  }

  const latest = sorted[sorted.length - 1];
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const first = sorted[0];

  const recentDiff = previous ? Math.round((latest.weight - previous.weight) * 10) / 10 : null;
  const totalDiff = sorted.length >= 2 ? Math.round((latest.weight - first.weight) * 10) / 10 : null;

  return {
    latest,
    previous,
    recentDiff,
    totalDiff,
    count: sorted.length
  };
}

// -------------------------------------------------------------
// 5. RENDERIZADO GENERAL
// -------------------------------------------------------------
function renderAll() {
  renderDiary();
  renderFoods();
  renderWeightView();
  renderCalculatorView();
  renderHistory();
  renderSettings();
}

function renderDiary() {
  $('#diary-date').value = currentDate;
  $('#date-pretty').textContent = dateText(currentDate);

  const day = dayEntries(currentDate);
  const totalKcal = sumKcal(day);
  const protSummary = sumProtein(day);

  // Totales principales
  $('#day-total-kcal').textContent = fmt(totalKcal);

  if (protSummary.allUnknown) {
    $('#day-total-protein').textContent = '—';
  } else {
    $('#day-total-protein').textContent = fmt(protSummary.total);
  }

  // Indicador de proteínas parciales
  $('#day-protein-partial-badge').hidden = !protSummary.isPartial;
  $('#protein-partial-note').hidden = !protSummary.isPartial;

  // Barra de progreso vs. Mantenimiento informativo de Calorías
  const goalKcal = Number(settings.goal || 0);
  const kcalWrap = $('#goal-kcal-wrapper');
  const maintWrap = $('#maint-ref-wrapper');

  if (goalKcal > 0) {
    // Si existe meta calórica activa: se muestra barra de progreso
    kcalWrap.hidden = false;
    maintWrap.hidden = true;
    const pct = Math.min(100, Math.round((totalKcal / goalKcal) * 100));
    $('#progress-fill-kcal').style.width = `${pct}%`;
    $('#progress-bar-kcal').setAttribute('aria-valuenow', String(Math.round(totalKcal)));
    $('#progress-bar-kcal').setAttribute('aria-valuemax', String(goalKcal));
    if (totalKcal > goalKcal) {
      $('#goal-kcal-text').textContent = `${fmt(totalKcal)} / ${fmt(goalKcal)} kcal (+${fmt(totalKcal - goalKcal)} kcal)`;
    } else {
      $('#goal-kcal-text').textContent = `${fmt(totalKcal)} / ${fmt(goalKcal)} kcal (${pct}%)`;
    }
  } else {
    // Si NO existe meta calórica activa: no se muestran barras obligatorias
    kcalWrap.hidden = true;
    const calcResult = settings.calcResult;
    if (calcResult && (calcResult.tdee || calcResult.tdeeMin)) {
      maintWrap.hidden = false;
      if (calcResult.isRange) {
        $('#maint-ref-text').textContent = `~${fmt(calcResult.tdeeMin)}–${fmt(calcResult.tdeeMax)} kcal/día`;
      } else {
        $('#maint-ref-text').textContent = `~${fmt(calcResult.tdee)} kcal/día`;
      }
    } else {
      maintWrap.hidden = true;
    }
  }

  // Barra de progreso de proteínas
  const goalProt = Number(settings.proteinGoal || 0);
  const protWrap = $('#goal-protein-wrapper');
  if (goalProt > 0) {
    protWrap.hidden = false;
    const pct = Math.min(100, Math.round((protSummary.total / goalProt) * 100));
    $('#progress-fill-protein').style.width = `${pct}%`;
    $('#progress-bar-protein').setAttribute('aria-valuenow', String(Math.round(protSummary.total)));
    $('#progress-bar-protein').setAttribute('aria-valuemax', String(goalProt));
    if (protSummary.total > goalProt) {
      $('#goal-protein-text').textContent = `${fmt(protSummary.total)} / ${fmt(goalProt)} g (+${fmt(protSummary.total - goalProt)} g)`;
    } else {
      $('#goal-protein-text').textContent = `${fmt(protSummary.total)} / ${fmt(goalProt)} g (${pct}%)`;
    }
  } else {
    protWrap.hidden = true;
  }

  // Banner de aviso si cambió la estimación por nuevo peso
  const pending = settings.pendingGoalReview;
  const banner = $('#calc-update-banner');
  if (pending && pending.oldGoal && pending.newTdee) {
    banner.hidden = false;
    $('#calc-update-banner-text').textContent = `Tu mantenimiento se recalculó a ${fmt(pending.newTdee)} kcal/día con tu peso reciente (${fmt(pending.newWeight)} kg). Tu meta actual sigue en ${fmt(pending.oldGoal)} kcal. ¿Deseas revisarla?`;
  } else {
    banner.hidden = true;
  }

  // Renderizado de comidas
  $('#meals-container').innerHTML = MEALS.map(meal => {
    const list = day.filter(e => e.meal === meal.id).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const mealKcal = sumKcal(list);
    const mealProt = sumProtein(list);

    let protBadge = '';
    if (mealProt.hasKnown) {
      protBadge = `<span class="pill-protein">${fmt(mealProt.total)} g prot${mealProt.isPartial ? '*' : ''}</span>`;
    } else if (list.length > 0) {
      protBadge = `<span class="pill-protein" style="opacity:.6">— prot</span>`;
    }

    const detail = list.length ? `<div class="meal-items">${list.map(e => {
      const kcalVal = Number.isFinite(e.kcal) ? e.kcal : computeNutrition(e).kcal;
      const protVal = (e.protein !== undefined && e.protein !== null) ? e.protein : computeNutrition(e).protein;

      let baseTxt = '';
      if (e.baseType === 'portion') {
        baseTxt = `${fmt(e.kcalPerPortion)} kcal${e.proteinPerPortion ? ' · ' + fmt(e.proteinPerPortion) + ' g prot' : ''} / ${esc(e.unit)}`;
      } else {
        baseTxt = `${fmt(e.kcalPer100)} kcal${e.proteinPer100 ? ' · ' + fmt(e.proteinPer100) + ' g prot' : ''} / 100 ${esc(e.unit)}`;
      }

      const brandTag = e.brand ? `<span class="meal-item-brand">${esc(e.brand)}</span>` : '';
      const protDisplay = protVal !== null
        ? `<span class="badge-prot">${fmt(protVal)} g prot</span>`
        : `<span class="badge-prot" style="opacity:.45;background:#f3f4f6;color:#6b7280">— prot</span>`;

      return `
        <div class="meal-item">
          <div>
            <div class="meal-item-name">${esc(e.name)}${brandTag}</div>
            <div class="meal-item-detail">${fmt(e.amount)} ${esc(e.unit)} · ${baseTxt}</div>
          </div>
          <div class="meal-item-side">
            <div class="item-nutri-badges">
              <span class="badge-kcal">${fmt(kcalVal)} kcal</span>
              ${protDisplay}
            </div>
            <button type="button" class="icon-action" data-edit-entry="${esc(e.id)}" aria-label="Editar ${esc(e.name)}">✎</button>
            <button type="button" class="icon-action" data-delete-entry="${esc(e.id)}" aria-label="Eliminar ${esc(e.name)}">×</button>
          </div>
        </div>
      `;
    }).join('')}</div>` : '<div class="meal-empty">Todavía no has registrado alimentos en esta comida</div>';

    return `
      <article class="meal-card">
        <div class="meal-top">
          <div class="meal-title-area">
            <div class="meal-emoji" aria-hidden="true">${MEAL_ICONS[meal.id] || ''}</div>
            <div>
              <div class="meal-name">${meal.title}</div>
              <div class="meal-count">${list.length} ingrediente${list.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div class="meal-totals-pill">
            <span class="pill-kcal">${fmt(mealKcal)} kcal</span>
            ${protBadge}
          </div>
        </div>
        ${detail}
        <button type="button" data-add-meal="${meal.id}" class="meal-add">＋ Añadir a ${meal.title.toLowerCase()}</button>
      </article>
    `;
  }).join('');
}

// -------------------------------------------------------------
// 6. RENDERIZADO: "MI PESO" Y GRÁFICA SVG
// -------------------------------------------------------------
function renderWeightView() {
  const stats = computeWeightStats();
  const sorted = getSortedWeightEntries();

  if (stats.latest) {
    $('#stat-last-weight').textContent = fmt(stats.latest.weight);
    $('#stat-last-date').textContent = dateText(stats.latest.date);
  } else {
    $('#stat-last-weight').textContent = '—';
    $('#stat-last-date').textContent = 'Sin mediciones';
  }

  // Cambio reciente
  const recentEl = $('#stat-diff-recent');
  if (stats.recentDiff !== null) {
    const sign = stats.recentDiff > 0 ? '+' : '';
    recentEl.textContent = `${sign}${fmt(stats.recentDiff)} kg`;
    recentEl.style.color = stats.recentDiff < 0 ? '#047857' : (stats.recentDiff > 0 ? '#be123c' : 'var(--ink)');
  } else {
    recentEl.textContent = '—';
    recentEl.style.color = 'var(--ink)';
  }

  // Cambio total
  const totalEl = $('#stat-diff-total');
  if (stats.totalDiff !== null) {
    const sign = stats.totalDiff > 0 ? '+' : '';
    totalEl.textContent = `${sign}${fmt(stats.totalDiff)} kg`;
    totalEl.style.color = stats.totalDiff < 0 ? '#047857' : (stats.totalDiff > 0 ? '#be123c' : 'var(--ink)');
  } else {
    totalEl.textContent = '—';
    totalEl.style.color = 'var(--ink)';
  }

  $('#weight-count-label').textContent = `${sorted.length} medicion${sorted.length === 1 ? '' : 'es'}`;

  // Filtrar según período de gráfica
  let periodFiltered = sorted.slice();
  const today = todayISO();
  if (weightChartPeriod === '4w') {
    const start = offsetDate(today, -28);
    periodFiltered = periodFiltered.filter(w => w.date >= start);
  } else if (weightChartPeriod === '3m') {
    const start = offsetDate(today, -90);
    periodFiltered = periodFiltered.filter(w => w.date >= start);
  }

  renderWeightSvgChart(periodFiltered);
  renderWeightList(sorted);
  renderAccessibleWeightTable(sorted);
}

function renderWeightSvgChart(points) {
  const svg = $('#weight-svg-chart');
  const empty = $('#chart-empty-state');

  if (!points || points.length < 2) {
    svg.innerHTML = '';
    empty.hidden = false;
    $('#chart-range-info').textContent = 'Se necesitan al menos 2 mediciones';
    return;
  }

  empty.hidden = true;
  const weights = points.map(p => p.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const padding = Math.max(0.8, (maxW - minW) * 0.15);
  const yMin = minW - padding;
  const yMax = maxW + padding;
  const yRange = yMax - yMin;

  const width = 500;
  const height = 220;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  $('#chart-range-info').textContent = `${points.length} puntos (${dateShort(points[0].date)} — ${dateShort(points[points.length - 1].date)})`;

  // Coordenadas
  const coords = points.map((p, idx) => {
    const x = padLeft + (idx / (points.length - 1)) * chartW;
    const y = padTop + chartH - ((p.weight - yMin) / yRange) * chartH;
    return { x, y, weight: p.weight, date: p.date };
  });

  // Líneas de guía horizontal
  const gridCount = 4;
  let gridLines = '';
  for (let i = 0; i <= gridCount; i++) {
    const yVal = yMin + (yRange / gridCount) * i;
    const yPos = padTop + chartH - (i / gridCount) * chartH;
    gridLines += `
      <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="#edf2f7" stroke-width="1" />
      <text x="${padLeft - 8}" y="${yPos + 4}" fill="#8c95a8" font-size="10" font-weight="700" text-anchor="end">${fmt(yVal)}</text>
    `;
  }

  // Trazado de línea
  const pathD = coords.reduce((acc, c, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`, '');
  // Área bajo la curva
  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${padTop + chartH} L ${coords[0].x} ${padTop + chartH} Z`;

  // Puntos
  const circles = coords.map(c => `
    <g class="chart-point">
      <circle cx="${c.x}" cy="${c.y}" r="5" fill="#6352d8" stroke="#ffffff" stroke-width="2.5" />
      <text x="${c.x}" y="${c.y - 9}" fill="#4a3ec6" font-size="10" font-weight="800" text-anchor="middle">${fmt(c.weight)}</text>
      <text x="${c.x}" y="${height - 12}" fill="#8c95a8" font-size="9.5" font-weight="650" text-anchor="middle">${dateShort(c.date)}</text>
    </g>
  `).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6352d8" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#6352d8" stop-opacity="0.0" />
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${areaD}" fill="url(#chartGrad)" />
    <path d="${pathD}" fill="none" stroke="#6352d8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${circles}
  `;
}

function renderAccessibleWeightTable(sorted) {
  const tbody = $('#accessible-weight-tbody');
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center">Sin datos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.slice().reverse().map((w, idx, arr) => {
    const prev = arr[idx + 1];
    let diffTxt = '—';
    if (prev) {
      const diff = Math.round((w.weight - prev.weight) * 10) / 10;
      diffTxt = `${diff > 0 ? '+' : ''}${fmt(diff)} kg`;
    }
    return `
      <tr>
        <td>${esc(dateText(w.date))}</td>
        <td><strong>${fmt(w.weight)} kg</strong></td>
        <td>${diffTxt}</td>
      </tr>
    `;
  }).join('');
}

function renderWeightList(sorted) {
  const container = $('#weights-list-container');
  if (!sorted.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Aún no has registrado tu peso</strong>
        Presiona «＋ Registrar peso» para comenzar tu seguimiento histórico.
      </div>
    `;
    return;
  }

  // Lista en orden inverso (más reciente arriba)
  const reversed = sorted.slice().reverse();

  container.innerHTML = reversed.map((item, idx) => {
    const prevItem = reversed[idx + 1];
    let diffBadge = '';
    if (prevItem) {
      const diff = Math.round((item.weight - prevItem.weight) * 10) / 10;
      if (diff < 0) {
        diffBadge = `<span class="w-diff-badge down">▼ ${fmt(Math.abs(diff))} kg</span>`;
      } else if (diff > 0) {
        diffBadge = `<span class="w-diff-badge up">▲ +${fmt(diff)} kg</span>`;
      } else {
        diffBadge = `<span class="w-diff-badge same">= 0 kg</span>`;
      }
    }

    const noteTxt = item.note ? `<span class="w-row-note">${esc(item.note)}</span>` : '';

    return `
      <article class="weight-row-item">
        <div class="weight-row-left">
          <span class="w-row-date">${esc(dateText(item.date))}</span>
          ${noteTxt}
        </div>
        <div class="weight-row-right">
          <span class="w-row-val">${fmt(item.weight)} kg</span>
          ${diffBadge}
          <button type="button" class="icon-action" data-edit-weight="${esc(item.id)}" aria-label="Editar peso del ${esc(item.date)}">✎</button>
          <button type="button" class="icon-action" data-delete-weight="${esc(item.id)}" aria-label="Eliminar registro">×</button>
        </div>
      </article>
    `;
  }).join('');
}

// -------------------------------------------------------------
// 7. RENDERIZADO: CALCULADORA DE CALORÍAS
// -------------------------------------------------------------
function renderCalculatorView() {
  const profile = settings.calcProfile;
  if (profile) {
    if (profile.weight) $('#calc-weight').value = profile.weight;
    if (profile.height) $('#calc-height').value = profile.height;
    if (profile.age) $('#calc-age').value = profile.age;
    if (profile.activity) $('#calc-activity').value = profile.activity;

    const param = profile.param || 'male';
    document.querySelectorAll('input[name="calc-param"]').forEach(r => {
      r.checked = (r.value === param);
    });
  }

  const res = settings.calcResult;
  const resCard = $('#calc-results-card');
  if (res && (res.tdee || res.tdeeMin)) {
    resCard.hidden = false;
    $('#calc-res-date').textContent = res.date ? dateShort(res.date) : 'Estimación activa';

    if (res.isRange) {
      $('#calc-res-rmr').textContent = `${fmt(res.rmrMin)}–${fmt(res.rmrMax)} kcal`;
      $('#calc-res-tdee').textContent = `${fmt(res.tdeeMin)}–${fmt(res.tdeeMax)} kcal`;
    } else {
      $('#calc-res-rmr').textContent = `${fmt(res.rmr)} kcal`;
      $('#calc-res-tdee').textContent = `${fmt(res.tdee)} kcal`;
    }

    const actMap = {
      '1.20': 'Sedentario (x1.20)',
      '1.375': 'Actividad ligera (x1.375)',
      '1.55': 'Actividad moderada (x1.55)',
      '1.725': 'Actividad alta (x1.725)',
      '1.90': 'Actividad muy alta (x1.90)'
    };

    const paramTxt = res.param === 'male' ? 'Parámetro masculino' : (res.param === 'female' ? 'Parámetro femenino' : 'Sin parámetro específico');
    $('#calc-meta-details').textContent = `Basado en ${fmt(res.weight)} kg · ${fmt(res.height)} cm · ${fmt(res.age)} años · ${actMap[String(res.factor)] || 'Factor ' + res.factor} · ${paramTxt}`;

    // Escenarios orientativos
    const baseTdee = res.tdee || Math.round((res.tdeeMin + res.tdeeMax) / 2);
    const scen = calculateScenarios(baseTdee);
    $('#scen-val-maintain').textContent = `${fmt(scen.maintain)} kcal`;
    $('#scen-val-loss').textContent = `${fmt(scen.loss)} kcal`;
    $('#scen-val-gain').textContent = `${fmt(scen.gain)} kcal`;

    // Resaltar escenario activo
    document.querySelectorAll('.scenario-item').forEach(el => {
      el.classList.toggle('active', el.dataset.scenario === activeScenario);
    });
  } else {
    resCard.hidden = true;
  }
}

function runCalculator() {
  const weight = Number($('#calc-weight').value);
  const height = Number($('#calc-height').value);
  const age = Number($('#calc-age').value);
  const param = document.querySelector('input[name="calc-param"]:checked')?.value || 'male';
  const activity = Number($('#calc-activity').value);

  try {
    const result = calculateMifflinStJeor({
      weightKg: weight,
      heightCm: height,
      ageYears: age,
      physiologicalParam: param,
      activityMultiplier: activity
    });

    const profileData = {
      weight,
      height,
      age,
      param,
      activity: String(activity),
      updatedAt: new Date().toISOString()
    };

    const resultData = {
      ...result,
      weight,
      height,
      age,
      date: todayISO()
    };

    // Guardar perfil y resultado en settings de IndexedDB
    mutate('settings', 'put', { key: 'calcProfile', value: profileData });
    mutate('settings', 'put', { key: 'calcResult', value: resultData });

    settings.calcProfile = profileData;
    settings.calcResult = resultData;

    renderCalculatorView();
    $('#calc-results-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Gasto energético estimado con éxito');
  } catch (err) {
    toast(err.message || 'Error en los datos ingresados');
  }
}

// -------------------------------------------------------------
// 8. BIBLIOTECA "MIS ALIMENTOS" Y HISTORIAL
// -------------------------------------------------------------
function renderFoods() {
  const query = keyName($('#food-search').value);
  const favsCount = foods.filter(f => f.favorite).length;

  $('#count-foods-all').textContent = String(foods.length);
  $('#count-foods-favs').textContent = String(favsCount);

  let filtered = foods.filter(f => {
    const matchesQuery = !query || keyName(f.name).includes(query) || keyName(f.brand || '').includes(query);
    const matchesFilter = (foodFilter === 'all') || (foodFilter === 'favs' && f.favorite);
    return matchesQuery && matchesFilter;
  });

  filtered.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });

  const container = $('#foods-container');
  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No se encontraron alimentos</strong>
        ${query ? 'Intenta con otro término de búsqueda o crea uno nuevo.' : 'Presiona «＋ Nuevo alimento» para crear tu biblioteca personal de ingredientes habituales.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(f => {
    const brandHtml = f.brand ? `<span class="food-brand-tag">${esc(f.brand)}</span>` : '';
    const isPortion = f.baseType === 'portion';
    const kcalVal = isPortion ? f.kcalPerPortion : f.kcalPer100;
    const protVal = isPortion ? f.proteinPerPortion : f.proteinPer100;
    const unitName = isPortion ? (f.portionUnit || 'porción') : (f.unit || 'g');
    const baseTxt = isPortion ? `por ${esc(unitName)}` : `por 100 ${esc(unitName)}`;

    return `
      <article class="food-card">
        <div class="food-top">
          <div class="food-title-group">
            <div class="food-name">${esc(f.name)}${brandHtml}</div>
            <div class="food-nutri-line">
              <span class="nutri-pill-kcal">${fmt(kcalVal)} kcal ${baseTxt}</span>
              <span class="nutri-pill-prot">${protVal !== null && protVal !== undefined ? fmt(protVal) + ' g prot' : '— prot'}</span>
            </div>
            ${(isPortion && f.portionGrams) ? `<div class="food-portion-hint">Equivalencia: 1 ${esc(unitName)} = ${fmt(f.portionGrams)} g</div>` : ''}
          </div>
          <button type="button" class="btn-fav ${f.favorite ? 'active' : ''}" data-toggle-fav="${esc(f.id)}" aria-label="${f.favorite ? 'Quitar de favoritos' : 'Marcar favorito'}">
            ${f.favorite ? '★' : '☆'}
          </button>
        </div>
        <div class="food-actions-bar">
          <button type="button" class="btn-use-food" data-use-food-direct="${esc(f.id)}">＋ Usar en comida</button>
          <div class="food-left-actions">
            <button type="button" class="mini-action-btn" data-duplicate-food="${esc(f.id)}" title="Duplicar">Copiar</button>
            <button type="button" class="mini-action-btn" data-edit-food="${esc(f.id)}" aria-label="Editar">✎</button>
            <button type="button" class="mini-action-btn danger" data-delete-food="${esc(f.id)}" aria-label="Eliminar">×</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderHistory() {
  const days = [...new Set(entries.map(e => e.date))].sort().reverse();
  const container = $('#history-container');

  if (!days.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Tu historial está vacío</strong>
        Cuando registres tus primeras comidas, podrás consultar aquí el resumen diario y tus avances.
      </div>
    `;
    return;
  }

  container.innerHTML = days.map(day => {
    const list = dayEntries(day);
    const dayKcal = sumKcal(list);
    const dayProt = sumProtein(list);

    let protTxt = '—';
    if (dayProt.hasKnown) {
      protTxt = `${fmt(dayProt.total)} g prot${dayProt.isPartial ? '*' : ''}`;
    }

    return `
      <button type="button" class="history-card" data-open-date="${day}">
        <span>
          <span class="history-name">${esc(dateText(day))}</span>
          <span class="history-meta">${list.length} ingrediente${list.length === 1 ? '' : 's'} registrado${list.length === 1 ? '' : 's'}</span>
        </span>
        <span class="history-right-stats">
          <span class="history-kcal">${fmt(dayKcal)} kcal</span>
          <span class="history-prot">${protTxt}</span>
        </span>
      </button>
    `;
  }).join('');
}

function renderSettings() {
  $('#goal-input').value = settings.goal ?? '';
  $('#protein-goal-input').value = settings.proteinGoal ?? '';
}

// -------------------------------------------------------------
// 9. FLUJO DE REGISTRO RÁPIDO DE COMIDAS (QUICK ADD)
// -------------------------------------------------------------
function openQuickAdd(meal = 'desayuno') {
  stagedMeal = meal;
  stagedItems = [];
  selectedFoodForQuickAdd = null;

  document.querySelectorAll('.meal-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.mealChoice === stagedMeal);
  });

  setQuickAddMode('library');
  $('#quick-search-input').value = '';
  renderQuickFoodsList();
  hideSelectedFoodPanel();
  renderStagedSection();

  $('#quick-add-dialog').showModal();
}

function setQuickAddMode(mode) {
  const isLib = mode === 'library';
  $('#tab-mode-library').classList.toggle('active', isLib);
  $('#tab-mode-manual').classList.toggle('active', !isLib);
  $('#quick-add-library-panel').hidden = !isLib;
  $('#quick-add-manual-form').hidden = isLib;
}

function renderQuickFoodsList() {
  const query = keyName($('#quick-search-input').value);
  let list = foods.slice();

  if (query) {
    list = list.filter(f => keyName(f.name).includes(query) || keyName(f.brand || '').includes(query));
  }

  list.sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });

  const container = $('#quick-foods-list');
  if (!list.length) {
    container.innerHTML = `
      <div style="padding:16px;text-align:center;color:#8f98ae;font-size:12px">
        No hay alimentos coincidentes.<br>
        <button type="button" class="text-button-mini" id="btn-switch-to-manual" style="margin-top:6px">Usar ingreso manual</button>
      </div>
    `;
    const btn = $('#btn-switch-to-manual');
    if (btn) btn.addEventListener('click', () => setQuickAddMode('manual'));
    return;
  }

  container.innerHTML = list.map(f => {
    const isPortion = f.baseType === 'portion';
    const kcal = isPortion ? f.kcalPerPortion : f.kcalPer100;
    const prot = isPortion ? f.proteinPerPortion : f.proteinPer100;
    const unit = isPortion ? (f.portionUnit || 'scoop') : (f.unit || 'g');
    const brandTxt = f.brand ? ` · ${esc(f.brand)}` : '';
    const favStar = f.favorite ? ' ⭐' : '';

    return `
      <button type="button" class="quick-food-item ${selectedFoodForQuickAdd?.id === f.id ? 'selected' : ''}" data-select-quick-food="${esc(f.id)}">
        <div>
          <div class="qf-name">${esc(f.name)}${favStar}</div>
          <div class="qf-meta">${fmt(kcal)} kcal${prot ? ' · ' + fmt(prot) + ' g prot' : ''} / ${esc(unit)}${brandTxt}</div>
        </div>
        <div class="qf-badges">
          <span style="font-size:11px;font-weight:750;color:var(--purple)">Elegir ›</span>
        </div>
      </button>
    `;
  }).join('');
}

function selectFoodForQuickAdd(food) {
  selectedFoodForQuickAdd = food;
  const isPortion = food.baseType === 'portion';
  const unit = isPortion ? (food.portionUnit || 'porción') : (food.unit || 'g');

  $('#q-selected-name').textContent = `${food.name}${food.brand ? ' (' + food.brand + ')' : ''}`;
  const kcalBase = isPortion ? food.kcalPerPortion : food.kcalPer100;
  const protBase = isPortion ? food.proteinPerPortion : food.proteinPer100;
  $('#q-selected-meta').textContent = `${fmt(kcalBase)} kcal${protBase !== null && protBase !== undefined ? ' · ' + fmt(protBase) + ' g prot' : ''} por ${unit}`;
  $('#q-selected-unit-label').textContent = unit;

  const defAmount = food.defaultAmount || (isPortion ? 1 : 100);
  $('#q-amount-input').value = defAmount;

  renderQuickAmountChips(isPortion, unit);
  updateQuickPreview();

  $('#quick-selected-panel').hidden = false;
  $('#q-amount-input').focus();
}

function renderQuickAmountChips(isPortion, unit) {
  const chipsContainer = $('#quick-amount-chips');
  let values = [];
  if (isPortion) {
    values = [0.5, 1, 1.5, 2, 3];
  } else {
    values = (unit === 'ml') ? [100, 150, 200, 250, 300] : [50, 100, 150, 200, 250];
  }

  chipsContainer.innerHTML = values.map(v => `
    <button type="button" class="qty-chip" data-set-qty="${v}">${v} ${unit}</button>
  `).join('');
}

function hideSelectedFoodPanel() {
  selectedFoodForQuickAdd = null;
  $('#quick-selected-panel').hidden = true;
}

function updateQuickPreview() {
  if (!selectedFoodForQuickAdd) return;
  const amount = Number($('#q-amount-input').value) || 0;
  const item = {
    amount,
    baseType: selectedFoodForQuickAdd.baseType,
    kcalPerPortion: selectedFoodForQuickAdd.kcalPerPortion,
    proteinPerPortion: selectedFoodForQuickAdd.proteinPerPortion,
    kcalPer100: selectedFoodForQuickAdd.kcalPer100,
    proteinPer100: selectedFoodForQuickAdd.proteinPer100
  };
  const computed = computeNutrition(item);
  $('#q-preview-kcal').textContent = `${fmt(computed.kcal)} kcal`;
  $('#q-preview-protein').textContent = computed.protein !== null ? `${fmt(computed.protein)} g` : '—';
}

function addStagedItemFromLibrary() {
  if (!selectedFoodForQuickAdd) return;
  const amount = Number($('#q-amount-input').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Introduce una cantidad válida mayor a 0');
    return;
  }

  const isPortion = selectedFoodForQuickAdd.baseType === 'portion';
  const computed = computeNutrition({
    amount,
    baseType: selectedFoodForQuickAdd.baseType,
    kcalPerPortion: selectedFoodForQuickAdd.kcalPerPortion,
    proteinPerPortion: selectedFoodForQuickAdd.proteinPerPortion,
    kcalPer100: selectedFoodForQuickAdd.kcalPer100,
    proteinPer100: selectedFoodForQuickAdd.proteinPer100
  });

  const staged = {
    id: makeId(),
    date: currentDate,
    meal: stagedMeal,
    name: selectedFoodForQuickAdd.name,
    brand: selectedFoodForQuickAdd.brand || '',
    baseType: selectedFoodForQuickAdd.baseType || 'weight_volume',
    amount,
    unit: isPortion ? (selectedFoodForQuickAdd.portionUnit || 'porción') : (selectedFoodForQuickAdd.unit || 'g'),
    portionGrams: selectedFoodForQuickAdd.portionGrams || null,
    kcalPer100: selectedFoodForQuickAdd.kcalPer100 || null,
    proteinPer100: selectedFoodForQuickAdd.proteinPer100 ?? null,
    kcalPerPortion: selectedFoodForQuickAdd.kcalPerPortion || null,
    proteinPerPortion: selectedFoodForQuickAdd.proteinPerPortion ?? null,
    kcal: computed.kcal,
    protein: computed.protein,
    createdAt: new Date().toISOString()
  };

  stagedItems.push(staged);
  hideSelectedFoodPanel();
  renderStagedSection();
  toast(`“${staged.name}” añadido a la lista`);
}

function addStagedItemFromManual() {
  const name = $('#manual-name').value.trim();
  const brand = $('#manual-brand').value.trim();
  const baseType = document.querySelector('input[name="manual-base-type"]:checked').value;
  const saveToLibrary = $('#manual-save-to-library').checked;

  if (!name) {
    toast('Introduce el nombre del alimento');
    return;
  }

  let amount, unit, kcalPer100 = null, proteinPer100 = null, kcalPerPortion = null, proteinPerPortion = null, portionGrams = null;

  if (baseType === 'weight_volume') {
    amount = Number($('#manual-w-amount').value);
    unit = $('#manual-w-unit').value;
    const kcalRaw = Number($('#manual-w-kcal').value);
    const protRaw = $('#manual-w-protein').value.trim();

    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(kcalRaw) || kcalRaw < 0) {
      toast('Verifica la cantidad y las calorías');
      return;
    }
    kcalPer100 = kcalRaw;
    if (protRaw !== '' && Number.isFinite(Number(protRaw)) && Number(protRaw) >= 0) {
      proteinPer100 = Number(protRaw);
    }
  } else {
    amount = Number($('#manual-p-amount').value);
    unit = $('#manual-p-unit').value.trim();
    const kcalRaw = Number($('#manual-p-kcal').value);
    const protRaw = $('#manual-p-protein').value.trim();
    const pGramsRaw = $('#manual-p-grams').value.trim();

    if (!Number.isFinite(amount) || amount <= 0 || !unit || !Number.isFinite(kcalRaw) || kcalRaw < 0) {
      toast('Verifica la cantidad, unidad y calorías por porción');
      return;
    }
    kcalPerPortion = kcalRaw;
    if (protRaw !== '' && Number.isFinite(Number(protRaw)) && Number(protRaw) >= 0) {
      proteinPerPortion = Number(protRaw);
    }
    if (pGramsRaw !== '' && Number.isFinite(Number(pGramsRaw)) && Number(pGramsRaw) > 0) {
      portionGrams = Number(pGramsRaw);
    }
  }

  const computed = computeNutrition({
    amount,
    baseType,
    kcalPer100,
    proteinPer100,
    kcalPerPortion,
    proteinPerPortion
  });

  const staged = {
    id: makeId(),
    date: currentDate,
    meal: stagedMeal,
    name,
    brand,
    baseType,
    amount,
    unit,
    portionGrams,
    kcalPer100,
    proteinPer100,
    kcalPerPortion,
    proteinPerPortion,
    kcal: computed.kcal,
    protein: computed.protein,
    saveToLibrary,
    createdAt: new Date().toISOString()
  };

  stagedItems.push(staged);
  $('#quick-add-manual-form').reset();
  $('#manual-save-to-library').checked = true;
  updateManualPreview();
  renderStagedSection();
  toast(`“${staged.name}” añadido a la lista`);
}

function updateManualPreview() {
  const baseType = document.querySelector('input[name="manual-base-type"]:checked')?.value || 'weight_volume';
  let amount = 0, kcalBase = 0, protBase = null;

  if (baseType === 'weight_volume') {
    amount = Number($('#manual-w-amount').value) || 0;
    kcalBase = Number($('#manual-w-kcal').value) || 0;
    const p = $('#manual-w-protein').value.trim();
    if (p !== '' && Number.isFinite(Number(p))) protBase = Number(p);
  } else {
    amount = Number($('#manual-p-amount').value) || 0;
    kcalBase = Number($('#manual-p-kcal').value) || 0;
    const p = $('#manual-p-protein').value.trim();
    if (p !== '' && Number.isFinite(Number(p))) protBase = Number(p);
  }

  const computed = computeNutrition({
    amount,
    baseType,
    kcalPer100: baseType === 'weight_volume' ? kcalBase : null,
    proteinPer100: baseType === 'weight_volume' ? protBase : null,
    kcalPerPortion: baseType === 'portion' ? kcalBase : null,
    proteinPerPortion: baseType === 'portion' ? protBase : null
  });

  $('#manual-preview-kcal').textContent = `${fmt(computed.kcal)} kcal`;
  $('#manual-preview-protein').textContent = computed.protein !== null ? `${fmt(computed.protein)} g` : '—';
}

function renderStagedSection() {
  const section = $('#staged-section');
  if (!stagedItems.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  const mealObj = MEALS.find(m => m.id === stagedMeal) || MEALS[0];
  $('#staged-meal-name').textContent = mealObj.title;
  $('#staged-count').textContent = String(stagedItems.length);

  const totalKcal = sumKcal(stagedItems);
  const protSummary = sumProtein(stagedItems);

  $('#staged-total-kcal').textContent = `${fmt(totalKcal)} kcal`;
  $('#staged-total-protein').textContent = protSummary.hasKnown ? `${fmt(protSummary.total)} g prot` : '— prot';

  $('#staged-items-list').innerHTML = stagedItems.map((item, idx) => `
    <div class="staged-item">
      <div>
        <div class="staged-item-info">${esc(item.name)} (${fmt(item.amount)} ${esc(item.unit)})</div>
        <div class="staged-item-sub">${fmt(item.kcal)} kcal${item.protein !== null ? ' · ' + fmt(item.protein) + ' g prot' : ''}</div>
      </div>
      <button type="button" class="mini-action-btn danger" data-remove-staged="${idx}" aria-label="Eliminar">×</button>
    </div>
  `).join('');
}

async function saveEntireMeal() {
  if (!stagedItems.length || isSaving) return;
  isSaving = true;
  const saveBtn = $('#btn-save-entire-meal');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  try {
    for (const item of stagedItems) {
      const entryRecord = { ...item };
      delete entryRecord.saveToLibrary;
      await mutate('entries', 'put', entryRecord);

      if (item.saveToLibrary) {
        const existing = foods.find(f => keyName(f.name) === keyName(item.name));
        const foodRecord = {
          id: existing?.id || makeId(),
          name: item.name,
          brand: item.brand || '',
          baseType: item.baseType,
          unit: item.baseType === 'weight_volume' ? item.unit : 'g',
          portionUnit: item.baseType === 'portion' ? item.unit : '',
          portionGrams: item.portionGrams || null,
          kcalPer100: item.kcalPer100,
          proteinPer100: item.proteinPer100,
          kcalPerPortion: item.kcalPerPortion,
          proteinPerPortion: item.proteinPerPortion,
          defaultAmount: item.amount,
          favorite: existing?.favorite || false,
          updatedAt: new Date().toISOString()
        };
        await mutate('foods', 'put', foodRecord);
      }
    }

    stagedItems = [];
    $('#quick-add-dialog').close();
    await refresh();
    showView('diario');
    toast('¡Comida guardada exitosamente!');
  } catch (error) {
    console.error(error);
    toast('Error al guardar la comida');
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar comida';
  }
}

// -------------------------------------------------------------
// 10. GESTIÓN DE PESO (CREAR, EDITAR, ELIMINAR, RECALCULAR)
// -------------------------------------------------------------
function openWeightDialog(weightItem = null) {
  editingWeightId = weightItem?.id || null;
  $('#weight-form').reset();
  $('#weight-dialog-title').textContent = weightItem ? 'Editar peso' : 'Registrar peso';
  $('#w-date-input').value = weightItem ? weightItem.date : todayISO();
  $('#w-val-input').value = weightItem ? weightItem.weight : '';
  $('#w-note-input').value = weightItem ? (weightItem.note || '') : '';
  $('#weight-dialog').showModal();
}

async function saveWeightEntry(event) {
  event.preventDefault();
  const date = $('#w-date-input').value;
  const weight = Number($('#w-val-input').value);
  const note = $('#w-note-input').value.trim();

  if (!validDate(date)) {
    toast('Fecha inválida');
    return;
  }
  if (!Number.isFinite(weight) || weight < 20 || weight > 400) {
    toast('Introduce un peso válido entre 20 y 400 kg');
    return;
  }

  // Prevenir duplicado el mismo día: si ya existe una entrada para esta fecha y no es la que editamos, actualizarla
  const existingSameDate = weightEntries.find(w => w.date === date && w.id !== editingWeightId);
  const targetId = editingWeightId || (existingSameDate ? existingSameDate.id : makeId());

  const entry = {
    id: targetId,
    date,
    weight,
    note,
    createdAt: existingSameDate?.createdAt || new Date().toISOString()
  };

  try {
    await mutate('weightEntries', 'put', entry);
    $('#weight-dialog').close();

    // Actualizar en memoria temporalmente para verificar si es la medición más reciente
    const updatedWeights = weightEntries.filter(w => w.id !== targetId).concat(entry);
    const sorted = updatedWeights.slice().sort((a, b) => a.date.localeCompare(b.date));
    const isLatest = (sorted[sorted.length - 1].id === targetId);

    // Si es la medición más reciente y existe un perfil de cálculo, actualizar estimación
    if (isLatest && settings.calcProfile) {
      try {
        const prof = settings.calcProfile;
        const newResult = calculateMifflinStJeor({
          weightKg: weight,
          heightCm: prof.height,
          ageYears: prof.age,
          physiologicalParam: prof.param,
          activityMultiplier: Number(prof.activity)
        });

        prof.weight = weight;
        prof.updatedAt = new Date().toISOString();
        const updatedResultData = {
          ...newResult,
          weight,
          height: prof.height,
          age: prof.age,
          date: todayISO()
        };

        await mutate('settings', 'put', { key: 'calcProfile', value: prof });
        await mutate('settings', 'put', { key: 'calcResult', value: updatedResultData });

        // Si existe una meta activa que difiere de la nueva estimación, marcar sugerencia de revisión
        if (settings.goal > 0 && Math.abs(settings.goal - updatedResultData.tdee) >= 20) {
          const pending = {
            oldGoal: settings.goal,
            newTdee: updatedResultData.tdee,
            newWeight: weight
          };
          await mutate('settings', 'put', { key: 'pendingGoalReview', value: pending });
        }
      } catch (errCalc) {
        console.warn('No se pudo recalcular automáticamente el gasto:', errCalc);
      }
    }

    await refresh();
    toast(existingSameDate && !editingWeightId ? 'Medición de esta fecha actualizada' : 'Peso guardado');
  } catch (err) {
    console.error(err);
    toast('Error al guardar el peso');
  }
}

async function deleteWeightEntry(id) {
  const item = weightEntries.find(w => w.id === id);
  if (!item) return;
  if (!confirm(`¿Eliminar el registro de peso de ${item.weight} kg (${dateText(item.date)})?`)) return;

  try {
    await mutate('weightEntries', 'delete', id);
    await refresh();
    toast('Registro de peso eliminado');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar');
  }
}

// -------------------------------------------------------------
// 11. FLUJO DE DECISIÓN DE LA CALCULADORA (OPCIÓN A vs OPCIÓN B)
// -------------------------------------------------------------
function selectScenario(scenario) {
  activeScenario = scenario;
  document.querySelectorAll('.scenario-item').forEach(el => {
    el.classList.toggle('active', el.dataset.scenario === scenario);
  });
}

function handleOptionA() {
  if (!settings.calcResult) {
    toast('Primero realiza un cálculo');
    return;
  }
  // Opción A: Solo guardar estimación sin crear meta activa
  showView('diario');
  toast('Estimación guardada como referencia informativa en Hoy');
}

function handleOptionB() {
  if (!settings.calcResult) {
    toast('Primero realiza un cálculo');
    return;
  }

  const baseTdee = settings.calcResult.tdee || Math.round((settings.calcResult.tdeeMin + settings.calcResult.tdeeMax) / 2);
  const scen = calculateScenarios(baseTdee);
  const proposed = scen[activeScenario] || baseTdee;

  $('#goal-confirm-input').value = proposed;
  $('#goal-preview-display').textContent = `${fmt(proposed)} kcal`;
  $('#goal-confirm-dialog').showModal();
}

async function confirmSetGoal(event) {
  event.preventDefault();
  const val = Number($('#goal-confirm-input').value);
  if (!Number.isFinite(val) || val < 500 || val > 15000) {
    toast('Introduce una meta válida entre 500 y 15 000 kcal');
    return;
  }

  try {
    await mutate('settings', 'put', { key: 'goal', value: val });
    // Limpiar aviso pendiente de revisión si existía
    if (settings.pendingGoalReview) {
      await mutate('settings', 'put', { key: 'pendingGoalReview', value: null });
    }
    $('#goal-confirm-dialog').close();
    await refresh();
    showView('diario');
    toast(`Meta de ${fmt(val)} kcal activada en Hoy`);
  } catch (err) {
    console.error(err);
    toast('Error al guardar la meta');
  }
}

async function clearCalorieGoal() {
  if (!confirm('¿Quitar tu meta calórica activa?\n\nTu diario volverá a mostrar solo el total consumido y la estimación de mantenimiento como referencia, sin barras de progreso.')) {
    return;
  }

  try {
    await mutate('settings', 'put', { key: 'goal', value: null });
    if (settings.pendingGoalReview) {
      await mutate('settings', 'put', { key: 'pendingGoalReview', value: null });
    }
    await refresh();
    toast('Meta calórica quitada (modo solo informativo)');
  } catch (err) {
    console.error(err);
    toast('No se pudo quitar la meta');
  }
}

// -------------------------------------------------------------
// 12. CRUD DE ALIMENTOS Y DIARIO (CONSERVADO DE V2)
// -------------------------------------------------------------
function openFoodEditor(food = null) {
  editingFoodId = food?.id || null;
  const isPortion = food?.baseType === 'portion';

  $('#food-form').reset();
  $('#food-dialog-title').textContent = food ? 'Editar alimento' : 'Nuevo alimento recurrente';
  $('#f-name').value = food?.name || '';
  $('#f-brand').value = food?.brand || '';

  document.querySelectorAll('input[name="f-base-type"]').forEach(r => {
    r.checked = isPortion ? (r.value === 'portion') : (r.value === 'weight_volume');
  });

  $('#f-fields-weight').hidden = isPortion;
  $('#f-fields-portion').hidden = !isPortion;

  if (isPortion) {
    $('#f-portion-unit').value = food?.portionUnit || 'scoop';
    $('#f-default-amount-p').value = food?.defaultAmount ?? 1;
    $('#f-kcal-portion').value = food?.kcalPerPortion ?? '';
    $('#f-protein-portion').value = food?.proteinPerPortion ?? '';
    $('#f-portion-grams').value = food?.portionGrams ?? '';
  } else {
    $('#f-unit').value = food?.unit || 'g';
    $('#f-default-amount-w').value = food?.defaultAmount ?? 100;
    $('#f-kcal100').value = food?.kcalPer100 ?? '';
    $('#f-protein100').value = food?.proteinPer100 ?? '';
  }

  $('#f-favorite').checked = Boolean(food?.favorite);
  $('#food-dialog').showModal();
}

async function saveFoodItem(event) {
  event.preventDefault();
  const name = $('#f-name').value.trim();
  const brand = $('#f-brand').value.trim();
  const baseType = document.querySelector('input[name="f-base-type"]:checked').value;
  const favorite = $('#f-favorite').checked;

  if (!name) {
    toast('Introduce el nombre del alimento');
    return;
  }

  let unit = 'g', portionUnit = '', portionGrams = null;
  let kcalPer100 = null, proteinPer100 = null, kcalPerPortion = null, proteinPerPortion = null;
  let defaultAmount = 1;

  if (baseType === 'weight_volume') {
    unit = $('#f-unit').value;
    const def = Number($('#f-default-amount-w').value);
    defaultAmount = (Number.isFinite(def) && def > 0) ? def : 100;
    const k = Number($('#f-kcal100').value);
    const p = $('#f-protein100').value.trim();

    if (!Number.isFinite(k) || k < 0 || k > 10000) {
      toast('Introduce calorías válidas por 100g/ml');
      return;
    }
    kcalPer100 = k;
    if (p !== '' && Number.isFinite(Number(p)) && Number(p) >= 0) {
      proteinPer100 = Number(p);
    }
  } else {
    portionUnit = $('#f-portion-unit').value.trim();
    if (!portionUnit) {
      toast('Introduce el nombre de la unidad o porción (ej.: scoop, lata)');
      return;
    }
    const def = Number($('#f-default-amount-p').value);
    defaultAmount = (Number.isFinite(def) && def > 0) ? def : 1;
    const k = Number($('#f-kcal-portion').value);
    const p = $('#f-protein-portion').value.trim();
    const g = $('#f-portion-grams').value.trim();

    if (!Number.isFinite(k) || k < 0 || k > 10000) {
      toast('Introduce calorías válidas por porción');
      return;
    }
    kcalPerPortion = k;
    if (p !== '' && Number.isFinite(Number(p)) && Number(p) >= 0) {
      proteinPerPortion = Number(p);
    }
    if (g !== '' && Number.isFinite(Number(g)) && Number(g) > 0) {
      portionGrams = Number(g);
    }
  }

  const record = {
    id: editingFoodId || makeId(),
    name,
    brand,
    baseType,
    unit,
    portionUnit,
    portionGrams,
    kcalPer100,
    proteinPer100,
    kcalPerPortion,
    proteinPerPortion,
    defaultAmount,
    favorite,
    updatedAt: new Date().toISOString()
  };

  try {
    await mutate('foods', 'put', record);
    $('#food-dialog').close();
    await refresh();
    toast(editingFoodId ? 'Alimento actualizado' : 'Alimento guardado');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar');
  }
}

async function duplicateFood(id) {
  const f = foods.find(x => x.id === id);
  if (!f) return;
  const clone = {
    ...f,
    id: null,
    name: `${f.name} (copia)`,
    favorite: false
  };
  openFoodEditor(clone);
}

async function toggleFoodFavorite(id) {
  const f = foods.find(x => x.id === id);
  if (!f) return;
  f.favorite = !f.favorite;
  f.updatedAt = new Date().toISOString();
  await mutate('foods', 'put', f);
  await refresh();
  toast(f.favorite ? 'Marcado como favorito ⭐' : 'Quitado de favoritos');
}

async function deleteFood(id) {
  const f = foods.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`¿Eliminar “${f.name}” de tu biblioteca?\n\nLos registros que ya guardaste en tu historial se mantendrán intactos con sus calorías y proteínas originales.`)) {
    return;
  }
  try {
    await mutate('foods', 'delete', id);
    await refresh();
    toast('Alimento eliminado');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar');
  }
}

function openDirectUseFood(food) {
  activeFoodForDirectUse = food;
  const isPortion = food.baseType === 'portion';
  const unit = isPortion ? (food.portionUnit || 'porción') : (food.unit || 'g');

  $('#u-food-name').textContent = `${food.name}${food.brand ? ' (' + food.brand + ')' : ''}`;
  const kcal = isPortion ? food.kcalPerPortion : food.kcalPer100;
  const prot = isPortion ? food.proteinPerPortion : food.proteinPer100;
  $('#u-food-meta').textContent = `${fmt(kcal)} kcal${prot ? ' · ' + fmt(prot) + ' g prot' : ''} por ${isPortion ? unit : '100 ' + unit}`;
  $('#u-unit-label').textContent = unit;

  const defAmount = food.defaultAmount || (isPortion ? 1 : 100);
  $('#u-amount-input').value = defAmount;

  const h = new Date().getHours();
  $('#u-meal-select').value = h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : 'cena';

  const chipsContainer = $('#u-amount-chips');
  const values = isPortion ? [0.5, 1, 1.5, 2, 3] : (unit === 'ml' ? [100, 150, 200, 250, 300] : [50, 100, 150, 200, 250]);
  chipsContainer.innerHTML = values.map(v => `
    <button type="button" class="qty-chip" data-set-u-qty="${v}">${v} ${unit}</button>
  `).join('');

  updateDirectUsePreview();
  $('#use-food-dialog').showModal();
}

function updateDirectUsePreview() {
  if (!activeFoodForDirectUse) return;
  const amount = Number($('#u-amount-input').value) || 0;
  const computed = computeNutrition({
    amount,
    baseType: activeFoodForDirectUse.baseType,
    kcalPerPortion: activeFoodForDirectUse.kcalPerPortion,
    proteinPerPortion: activeFoodForDirectUse.proteinPerPortion,
    kcalPer100: activeFoodForDirectUse.kcalPer100,
    proteinPer100: activeFoodForDirectUse.proteinPer100
  });

  $('#u-preview-kcal').textContent = `${fmt(computed.kcal)} kcal`;
  $('#u-preview-protein').textContent = computed.protein !== null ? `${fmt(computed.protein)} g` : '—';
}

async function confirmDirectUseFood(event) {
  event.preventDefault();
  if (!activeFoodForDirectUse || isSaving) return;
  const amount = Number($('#u-amount-input').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Introduce una cantidad válida');
    return;
  }

  isSaving = true;
  const meal = $('#u-meal-select').value;
  const isPortion = activeFoodForDirectUse.baseType === 'portion';
  const computed = computeNutrition({
    amount,
    baseType: activeFoodForDirectUse.baseType,
    kcalPerPortion: activeFoodForDirectUse.kcalPerPortion,
    proteinPerPortion: activeFoodForDirectUse.proteinPerPortion,
    kcalPer100: activeFoodForDirectUse.kcalPer100,
    proteinPer100: activeFoodForDirectUse.proteinPer100
  });

  const entry = {
    id: makeId(),
    date: currentDate,
    meal,
    name: activeFoodForDirectUse.name,
    brand: activeFoodForDirectUse.brand || '',
    baseType: activeFoodForDirectUse.baseType || 'weight_volume',
    amount,
    unit: isPortion ? (activeFoodForDirectUse.portionUnit || 'porción') : (activeFoodForDirectUse.unit || 'g'),
    portionGrams: activeFoodForDirectUse.portionGrams || null,
    kcalPer100: activeFoodForDirectUse.kcalPer100 || null,
    proteinPer100: activeFoodForDirectUse.proteinPer100 ?? null,
    kcalPerPortion: activeFoodForDirectUse.kcalPerPortion || null,
    proteinPerPortion: activeFoodForDirectUse.proteinPerPortion ?? null,
    kcal: computed.kcal,
    protein: computed.protein,
    createdAt: new Date().toISOString()
  };

  try {
    await mutate('entries', 'put', entry);
    $('#use-food-dialog').close();
    await refresh();
    showView('diario');
    toast(`Añadido a ${MEALS.find(m => m.id === meal)?.title || 'tu diario'}`);
  } catch (err) {
    console.error(err);
    toast('Error al guardar');
  } finally {
    isSaving = false;
  }
}

function openEditEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingEntryId = id;

  $('#entry-form').reset();
  $('#edit-entry-meal').value = e.meal;
  $('#edit-entry-name').value = e.name;
  $('#edit-entry-brand').value = e.brand || '';
  $('#edit-entry-amount').value = e.amount;
  $('#edit-entry-unit').value = e.unit;

  const isPortion = e.baseType === 'portion';
  if (isPortion) {
    $('#edit-kcal-label').firstChild.textContent = `Calorías por ${e.unit}`;
    $('#edit-protein-label').firstChild.textContent = `Proteínas por ${e.unit} (opcional)`;
    $('#edit-entry-density-kcal').value = e.kcalPerPortion ?? '';
    $('#edit-entry-density-protein').value = e.proteinPerPortion ?? '';
  } else {
    $('#edit-kcal-label').firstChild.textContent = `Calorías por 100 ${e.unit}`;
    $('#edit-protein-label').firstChild.textContent = `Proteínas por 100 ${e.unit} (opcional)`;
    $('#edit-entry-density-kcal').value = e.kcalPer100 ?? '';
    $('#edit-entry-density-protein').value = e.proteinPer100 ?? '';
  }

  updateEditEntryPreview();
  $('#entry-dialog').showModal();
}

function updateEditEntryPreview() {
  const e = entries.find(x => x.id === editingEntryId);
  const isPortion = e?.baseType === 'portion';
  const amount = Number($('#edit-entry-amount').value) || 0;
  const kcalDensity = Number($('#edit-entry-density-kcal').value) || 0;
  const protRaw = $('#edit-entry-density-protein').value.trim();
  const protDensity = (protRaw !== '' && Number.isFinite(Number(protRaw))) ? Number(protRaw) : null;

  const computed = computeNutrition({
    amount,
    baseType: isPortion ? 'portion' : 'weight_volume',
    kcalPer100: !isPortion ? kcalDensity : null,
    proteinPer100: !isPortion ? protDensity : null,
    kcalPerPortion: isPortion ? kcalDensity : null,
    proteinPerPortion: isPortion ? protDensity : null
  });

  $('#edit-preview-kcal').textContent = `${fmt(computed.kcal)} kcal`;
  $('#edit-preview-protein').textContent = computed.protein !== null ? `${fmt(computed.protein)} g` : '—';
}

async function saveEditEntry(event) {
  event.preventDefault();
  const e = entries.find(x => x.id === editingEntryId);
  if (!e || isSaving) return;

  const name = $('#edit-entry-name').value.trim();
  const brand = $('#edit-entry-brand').value.trim();
  const meal = $('#edit-entry-meal').value;
  const amount = Number($('#edit-entry-amount').value);
  const unit = $('#edit-entry-unit').value.trim();
  const kcalDensity = Number($('#edit-entry-density-kcal').value);
  const protRaw = $('#edit-entry-density-protein').value.trim();

  if (!name || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(kcalDensity) || kcalDensity < 0) {
    toast('Revisa los valores del ingrediente');
    return;
  }

  isSaving = true;
  const isPortion = e.baseType === 'portion';
  let protDensity = null;
  if (protRaw !== '' && Number.isFinite(Number(protRaw)) && Number(protRaw) >= 0) {
    protDensity = Number(protRaw);
  }

  const computed = computeNutrition({
    amount,
    baseType: isPortion ? 'portion' : 'weight_volume',
    kcalPer100: !isPortion ? kcalDensity : null,
    proteinPer100: !isPortion ? protDensity : null,
    kcalPerPortion: isPortion ? kcalDensity : null,
    proteinPerPortion: isPortion ? protDensity : null
  });

  const updated = {
    ...e,
    meal,
    name,
    brand,
    amount,
    unit,
    kcalPer100: !isPortion ? kcalDensity : null,
    proteinPer100: !isPortion ? protDensity : null,
    kcalPerPortion: isPortion ? kcalDensity : null,
    proteinPerPortion: isPortion ? protDensity : null,
    kcal: computed.kcal,
    protein: computed.protein
  };

  try {
    await mutate('entries', 'put', updated);
    $('#entry-dialog').close();
    await refresh();
    toast('Ingrediente actualizado');
  } catch (err) {
    console.error(err);
    toast('Error al actualizar');
  } finally {
    isSaving = false;
  }
}

async function deleteEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`¿Eliminar “${e.name}” de este día?`)) return;
  try {
    await mutate('entries', 'delete', id);
    await refresh();
    toast('Ingrediente eliminado');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar');
  }
}

// -------------------------------------------------------------
// 13. AJUSTES (OBJETIVOS Y RESPALDOS COMPATIBLES V1, V2 Y V3)
// -------------------------------------------------------------
async function saveGoals() {
  const rawKcal = $('#goal-input').value.trim();
  const valKcal = rawKcal === '' ? null : Number(rawKcal);
  if (valKcal !== null && (!Number.isFinite(valKcal) || valKcal < 0 || valKcal > 20000)) {
    toast('Introduce una meta de calorías entre 0 y 20 000');
    return;
  }

  const rawProt = $('#protein-goal-input').value.trim();
  const valProt = rawProt === '' ? null : Number(rawProt);
  if (valProt !== null && (!Number.isFinite(valProt) || valProt < 0 || valProt > 1000)) {
    toast('Introduce una meta de proteínas entre 0 y 1 000');
    return;
  }

  try {
    await mutate('settings', 'put', { key: 'goal', value: valKcal });
    await mutate('settings', 'put', { key: 'proteinGoal', value: valProt });
    await refresh();
    toast('Metas guardadas');
  } catch (err) {
    console.error(err);
    toast('No se pudieron guardar las metas');
  }
}

function getExportData() {
  return {
    app: 'MiCalorías',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    entries,
    foods,
    weightEntries,
    settings: Object.entries(settings).map(([key, value]) => ({ key, value }))
  };
}

function getBackupFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `MiCalorias_Estable_Respaldo_${y}-${m}-${d}_${hh}-${mm}.json`;
}

async function exportData(event) {
  if (event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  // Prevenir pulsaciones rápidas y ejecuciones simultáneas
  if (isExporting) return;
  isExporting = true;

  const exportBtn = $('#btn-export');
  const originalText = exportBtn ? exportBtn.textContent : '';

  try {
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.setAttribute('aria-busy', 'true');
      exportBtn.textContent = 'Preparando respaldo...';
    }

    const payload = getExportData();
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const filename = getBackupFilename();

    // Detección de entorno iOS en modo PWA instalada (standalone)
    const isIOSStandalone = (
      (typeof window !== 'undefined' && window.navigator && window.navigator.standalone === true) ||
      (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches && /iphone|ipad|ipod/i.test(navigator.userAgent || ''))
    );

    // En iOS PWA standalone, WebKit carece de gestor de descargas estándar; se recurre a Web Share API.
    // Esta rama es estrictamente terminal: jamás continúa al fallback de ancla para imposibilitar la doble descarga.
    if (isIOSStandalone && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], filename, { type: 'application/json' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Respaldo de MiCalorías'
          });
          toast('Respaldo listo para guardar en Archivos');
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
          return;
        }
        console.warn('No se pudo compartir archivo en PWA standalone:', err);
        toast('No se pudo compartir el archivo de respaldo');
        return;
      }
    }

    // Para Safari iOS estándar, macOS, Chrome, Firefox y resto de navegadores:
    // Se ejecuta una única descarga determinista mediante un ancla temporal aislada
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);

    toast('Copia de seguridad descargada');
  } catch (err) {
    console.error('Error al exportar datos:', err);
    toast('No se pudo exportar el respaldo');
  } finally {
    // Restaurar estado del botón con ventana de seguridad (600ms) contra rebotes táctiles
    setTimeout(() => {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.removeAttribute('aria-busy');
        exportBtn.textContent = originalText;
      }
      isExporting = false;
    }, 600);
  }
}

function validateAndMigrateImport(json) {
  if (!json || json.app !== 'MiCalorías' || ![1, 2, 3].includes(json.schemaVersion) || !Array.isArray(json.entries) || !Array.isArray(json.foods) || !Array.isArray(json.settings)) {
    throw new Error('El archivo no es un respaldo compatible de MiCalorías');
  }

  if (json.entries.length > 200000 || json.foods.length > 20000 || json.settings.length > 100) {
    throw new Error('El archivo contiene demasiados registros');
  }

  const migratedEntries = [];
  const migratedFoods = [];
  const migratedWeights = [];
  const seenEntries = new Set();
  const seenFoods = new Set();
  const seenWeights = new Set();

  for (const e of json.entries) {
    if (!e || typeof e.id !== 'string' || e.id.length > 150 || !validDate(e.date) || !MEALS.some(m => m.id === e.meal) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 || !Number.isFinite(e.amount) || e.amount <= 0 || seenEntries.has(e.id)) {
      throw new Error(`Entrada inválida en el respaldo: ${e?.name || 'sin nombre'}`);
    }
    seenEntries.add(e.id);

    const baseType = e.baseType || 'weight_volume';
    const computed = computeNutrition({
      amount: e.amount,
      baseType,
      kcalPer100: e.kcalPer100 ?? null,
      proteinPer100: e.proteinPer100 ?? null,
      kcalPerPortion: e.kcalPerPortion ?? null,
      proteinPerPortion: e.proteinPerPortion ?? null
    });

    migratedEntries.push({
      id: e.id,
      date: e.date,
      meal: e.meal,
      name: e.name,
      brand: e.brand || '',
      baseType,
      amount: e.amount,
      unit: e.unit || 'g',
      portionGrams: e.portionGrams || null,
      kcalPer100: e.kcalPer100 ?? null,
      proteinPer100: e.proteinPer100 ?? null,
      kcalPerPortion: e.kcalPerPortion ?? null,
      proteinPerPortion: e.proteinPerPortion ?? null,
      kcal: (Number.isFinite(e.kcal)) ? e.kcal : computed.kcal,
      protein: (e.protein !== undefined && e.protein !== null) ? e.protein : computed.protein,
      createdAt: e.createdAt || new Date().toISOString()
    });
  }

  for (const f of json.foods) {
    if (!f || typeof f.id !== 'string' || f.id.length > 150 || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 120 || seenFoods.has(f.id)) {
      throw new Error(`Alimento inválido en el respaldo: ${f?.name || 'sin nombre'}`);
    }
    seenFoods.add(f.id);

    migratedFoods.push({
      id: f.id,
      name: f.name,
      brand: f.brand || '',
      baseType: f.baseType || 'weight_volume',
      unit: f.unit || 'g',
      portionUnit: f.portionUnit || '',
      portionGrams: f.portionGrams || null,
      kcalPer100: f.kcalPer100 ?? null,
      proteinPer100: f.proteinPer100 ?? null,
      kcalPerPortion: f.kcalPerPortion ?? null,
      proteinPerPortion: f.proteinPerPortion ?? null,
      defaultAmount: f.defaultAmount || 1,
      favorite: Boolean(f.favorite),
      updatedAt: f.updatedAt || new Date().toISOString()
    });
  }

  if (Array.isArray(json.weightEntries)) {
    for (const w of json.weightEntries) {
      if (!w || typeof w.id !== 'string' || !validDate(w.date) || !Number.isFinite(w.weight) || w.weight <= 0 || seenWeights.has(w.id)) {
        continue;
      }
      seenWeights.add(w.id);
      migratedWeights.push({
        id: w.id,
        date: w.date,
        weight: Number(w.weight),
        note: w.note || '',
        createdAt: w.createdAt || new Date().toISOString()
      });
    }
  }

  const seenSettings = new Set();
  const migratedSettings = [];
  for (const s of json.settings) {
    if (!s || seenSettings.has(s.key)) continue;
    seenSettings.add(s.key);
    migratedSettings.push(s);
  }

  return {
    entries: migratedEntries,
    foods: migratedFoods,
    weightEntries: migratedWeights,
    settings: migratedSettings
  };
}

function importTransaction(data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'foods', 'settings', 'weightEntries'], 'readwrite');
    for (const name of ['entries', 'foods', 'settings', 'weightEntries']) tx.objectStore(name).clear();
    for (const e of data.entries) tx.objectStore('entries').put(e);
    for (const f of data.foods) tx.objectStore('foods').put(f);
    for (const s of data.settings) tx.objectStore('settings').put(s);
    for (const w of data.weightEntries) tx.objectStore('weightEntries').put(w);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function importData(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    if (file.size > 50_000_000) throw new Error('El archivo supera los 50 MB permitidos');
    const parsed = JSON.parse(await file.text());
    const migrated = validateAndMigrateImport(parsed);

    const versionNote = parsed.schemaVersion < 3 ? ` (migrado desde v${parsed.schemaVersion}.0)` : '';
    if (!confirm(`Este respaldo contiene:\n- ${migrated.entries.length} comidas registradas\n- ${migrated.foods.length} alimentos en biblioteca\n- ${migrated.weightEntries.length} mediciones de peso${versionNote}\n\n¿Sustituir TODOS los datos actuales en este iPhone? Esta acción no se puede deshacer.`)) {
      return;
    }

    await importTransaction(migrated);
    currentDate = todayISO();
    await refresh();
    showView('diario');
    toast('Respaldo importado correctamente');
  } catch (err) {
    console.error(err);
    alert(`No se importó el respaldo: ${err.message || 'formato inválido'}`);
  }
}

// -------------------------------------------------------------
// 14. PERSISTENCIA Y NAVEGACIÓN
// -------------------------------------------------------------
async function checkStorage() {
  try {
    const protectedStorage = await navigator.storage?.persisted?.();
    $('#storage-status').textContent = protectedStorage
      ? '✓ Almacenamiento persistente concedido en este iPhone'
      : 'Almacenamiento local activo (sin garantía de permanencia)';
  } catch {
    $('#storage-status').textContent = 'Los datos están guardados localmente en tu iPhone';
  }
}

async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) {
      toast('Tu navegador no admite solicitar protección persistente');
      return;
    }
    const granted = await navigator.storage.persist();
    await checkStorage();
    toast(granted ? 'Protección de almacenamiento concedida' : 'No se concedió protección; mantén respaldos periódicos');
  } catch {
    toast('No se pudo solicitar la protección');
  }
}

function showView(view) {
  const allowed = ['diario', 'alimentos', 'peso', 'calculadora', 'historial', 'ajustes'];
  if (!allowed.includes(view)) return;
  currentView = view;

  document.querySelectorAll('.view').forEach(el => {
    el.hidden = el.id !== `view-${view}`;
  });

  document.querySelectorAll('.nav-item').forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.hidden = true; }, 3200);
}

// -------------------------------------------------------------
// 15. VINCULACIÓN DE EVENTOS DEL DOM
// -------------------------------------------------------------
function attachEvents() {
  // Navegación principal inferior
  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });

  $('#nav-btn-add').addEventListener('click', () => {
    const h = new Date().getHours();
    openQuickAdd(h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : 'cena');
  });

  // Banner de actualización de estimación
  $('#btn-review-goal-banner').addEventListener('click', () => {
    handleOptionB();
  });
  $('#btn-dismiss-goal-banner').addEventListener('click', async () => {
    await mutate('settings', 'put', { key: 'pendingGoalReview', value: null });
    settings.pendingGoalReview = null;
    $('#calc-update-banner').hidden = true;
    toast('Aviso descartado (meta mantenida)');
  });

  // Diario: navegación por fecha
  $('#btn-today').addEventListener('click', () => { currentDate = todayISO(); renderDiary(); });
  $('#btn-prev-date').addEventListener('click', () => { currentDate = offsetDate(currentDate, -1); renderDiary(); });
  $('#btn-next-date').addEventListener('click', () => { currentDate = offsetDate(currentDate, 1); renderDiary(); });
  $('#diary-date').addEventListener('change', event => {
    if (validDate(event.target.value)) {
      currentDate = event.target.value;
      renderDiary();
    }
  });

  $('#btn-quick-add-main').addEventListener('click', () => {
    const h = new Date().getHours();
    openQuickAdd(h < 11 ? 'desayuno' : h < 16 ? 'almuerzo' : 'cena');
  });

  $('#meals-container').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.addMeal) openQuickAdd(btn.dataset.addMeal);
    if (btn.dataset.editEntry) openEditEntry(btn.dataset.editEntry);
    if (btn.dataset.deleteEntry) deleteEntry(btn.dataset.deleteEntry);
  });

  // Historial de comidas
  $('#history-container').addEventListener('click', event => {
    const btn = event.target.closest('[data-open-date]');
    if (btn) {
      currentDate = btn.dataset.openDate;
      showView('diario');
      renderDiary();
    }
  });

  // Biblioteca: Búsqueda y Filtros
  $('#food-search').addEventListener('input', renderFoods);
  $('#chip-filter-all').addEventListener('click', () => {
    foodFilter = 'all';
    $('#chip-filter-all').classList.add('active');
    $('#chip-filter-favs').classList.remove('active');
    renderFoods();
  });
  $('#chip-filter-favs').addEventListener('click', () => {
    foodFilter = 'favs';
    $('#chip-filter-favs').classList.add('active');
    $('#chip-filter-all').classList.remove('active');
    renderFoods();
  });

  $('#foods-container').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.useFoodDirect) {
      const f = foods.find(x => x.id === btn.dataset.useFoodDirect);
      if (f) openDirectUseFood(f);
    }
    if (btn.dataset.toggleFav) toggleFoodFavorite(btn.dataset.toggleFav);
    if (btn.dataset.duplicateFood) duplicateFood(btn.dataset.duplicateFood);
    if (btn.dataset.editFood) {
      const f = foods.find(x => x.id === btn.dataset.editFood);
      if (f) openFoodEditor(f);
    }
    if (btn.dataset.deleteFood) deleteFood(btn.dataset.deleteFood);
  });

  $('#btn-create-food').addEventListener('click', () => openFoodEditor());
  $('#btn-close-food-dialog').addEventListener('click', () => $('#food-dialog').close());
  $('#food-form').addEventListener('submit', saveFoodItem);

  document.querySelectorAll('input[name="f-base-type"]').forEach(radio => {
    radio.addEventListener('change', event => {
      const isPortion = event.target.value === 'portion';
      $('#f-fields-weight').hidden = isPortion;
      $('#f-fields-portion').hidden = !isPortion;
    });
  });

  // Eventos de Peso (Mi peso)
  $('#btn-add-weight').addEventListener('click', () => openWeightDialog());
  $('#btn-close-weight-dialog').addEventListener('click', () => $('#weight-dialog').close());
  $('#weight-form').addEventListener('submit', saveWeightEntry);

  $('#weights-list-container').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.editWeight) {
      const item = weightEntries.find(w => w.id === btn.dataset.editWeight);
      if (item) openWeightDialog(item);
    }
    if (btn.dataset.deleteWeight) {
      deleteWeightEntry(btn.dataset.deleteWeight);
    }
  });

  document.querySelectorAll('[data-chart-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      weightChartPeriod = btn.dataset.chartPeriod;
      document.querySelectorAll('[data-chart-period]').forEach(b => b.classList.toggle('active', b === btn));
      renderWeightView();
    });
  });

  $('#btn-toggle-accessible-table').addEventListener('click', () => {
    const wrap = $('#accessible-weight-table-wrap');
    wrap.hidden = !wrap.hidden;
    $('#btn-toggle-accessible-table').textContent = wrap.hidden
      ? 'Ver tabla de datos accesible'
      : 'Ocultar tabla de datos';
  });

  // Eventos de la Calculadora de Calorías
  $('#btn-calc-back-diario').addEventListener('click', () => showView('diario'));
  $('#btn-use-latest-weight').addEventListener('click', () => {
    const latest = getLatestWeightEntry();
    if (latest) {
      $('#calc-weight').value = latest.weight;
      toast(`Peso de ${fmt(latest.weight)} kg aplicado al cálculo`);
    } else {
      toast('Aún no has registrado ningún peso');
    }
  });

  $('#btn-run-calculation').addEventListener('click', runCalculator);

  document.querySelectorAll('.scenario-item').forEach(el => {
    el.addEventListener('click', () => selectScenario(el.dataset.scenario));
  });

  $('#btn-calc-opt-a').addEventListener('click', handleOptionA);
  $('#btn-calc-opt-b').addEventListener('click', handleOptionB);

  $('#btn-close-goal-dialog').addEventListener('click', () => $('#goal-confirm-dialog').close());
  $('#goal-confirm-input').addEventListener('input', () => {
    const val = Number($('#goal-confirm-input').value) || 0;
    $('#goal-preview-display').textContent = `${fmt(val)} kcal`;
  });
  $('#goal-confirm-form').addEventListener('submit', confirmSetGoal);

  // Accesos desde Ajustes
  $('#btn-goto-calc').addEventListener('click', () => showView('calculadora'));
  $('#btn-goto-peso').addEventListener('click', () => showView('peso'));
  $('#btn-goto-historial').addEventListener('click', () => showView('historial'));

  $('#btn-save-goal').addEventListener('click', saveGoals);
  $('#btn-clear-kcal-goal').addEventListener('click', clearCalorieGoal);
  $('#btn-export').addEventListener('click', exportData);
  $('#file-import').addEventListener('change', importData);
  $('#btn-persist').addEventListener('click', requestPersistence);

  // Modales existentes
  $('#btn-close-quick-add').addEventListener('click', () => $('#quick-add-dialog').close());
  document.querySelectorAll('.meal-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      stagedMeal = chip.dataset.mealChoice;
      document.querySelectorAll('.meal-chip').forEach(c => c.classList.toggle('active', c === chip));
      renderStagedSection();
    });
  });

  $('#tab-mode-library').addEventListener('click', () => setQuickAddMode('library'));
  $('#tab-mode-manual').addEventListener('click', () => setQuickAddMode('manual'));
  $('#quick-search-input').addEventListener('input', renderQuickFoodsList);

  $('#quick-foods-list').addEventListener('click', event => {
    const btn = event.target.closest('[data-select-quick-food]');
    if (!btn) return;
    const f = foods.find(x => x.id === btn.dataset.selectQuickFood);
    if (f) selectFoodForQuickAdd(f);
  });

  $('#btn-clear-selection').addEventListener('click', hideSelectedFoodPanel);
  $('#q-amount-input').addEventListener('input', updateQuickPreview);

  $('#quick-amount-chips').addEventListener('click', event => {
    const btn = event.target.closest('[data-set-qty]');
    if (!btn) return;
    $('#q-amount-input').value = btn.dataset.setQty;
    updateQuickPreview();
  });

  $('#btn-add-staged-item').addEventListener('click', addStagedItemFromLibrary);

  document.querySelectorAll('input[name="manual-base-type"]').forEach(r => {
    r.addEventListener('change', event => {
      const isPortion = event.target.value === 'portion';
      $('#manual-weight-fields').hidden = isPortion;
      $('#manual-portion-fields').hidden = !isPortion;
      updateManualPreview();
    });
  });

  $('#manual-w-unit').addEventListener('change', event => {
    document.querySelectorAll('.manual-unit-txt').forEach(el => { el.textContent = event.target.value; });
    updateManualPreview();
  });

  ['#manual-w-amount', '#manual-w-kcal', '#manual-w-protein', '#manual-p-amount', '#manual-p-kcal', '#manual-p-protein'].forEach(sel => {
    $(sel).addEventListener('input', updateManualPreview);
  });

  $('#btn-add-manual-item').addEventListener('click', addStagedItemFromManual);

  $('#staged-items-list').addEventListener('click', event => {
    const btn = event.target.closest('[data-remove-staged]');
    if (!btn) return;
    const idx = Number(btn.dataset.removeStaged);
    stagedItems.splice(idx, 1);
    renderStagedSection();
  });

  $('#btn-save-entire-meal').addEventListener('click', saveEntireMeal);

  $('#btn-close-use-dialog').addEventListener('click', () => $('#use-food-dialog').close());
  $('#u-amount-input').addEventListener('input', updateDirectUsePreview);
  $('#u-amount-chips').addEventListener('click', event => {
    const btn = event.target.closest('[data-set-u-qty]');
    if (!btn) return;
    $('#u-amount-input').value = btn.dataset.setUQty;
    updateDirectUsePreview();
  });
  $('#use-food-form').addEventListener('submit', confirmDirectUseFood);

  $('#btn-close-entry-dialog').addEventListener('click', () => $('#entry-dialog').close());
  ['#edit-entry-amount', '#edit-entry-density-kcal', '#edit-entry-density-protein'].forEach(sel => {
    $(sel).addEventListener('input', updateEditEntryPreview);
  });
  $('#entry-form').addEventListener('submit', saveEditEntry);

  // Botón de aplicación manual de actualización PWA
  $('#btn-apply-update').addEventListener('click', applyPendingUpdate);
}

// -------------------------------------------------------------
// 16. EXPERIENCIA TÁCTIL NATIVA Y CONTROL DE ESCALA (iOS PWA)
// -------------------------------------------------------------
function isStandalonePWA() {
  return (
    (typeof window !== 'undefined' && window.navigator && window.navigator.standalone === true) ||
    (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

// Configurar viewport estricto para experiencia nativa sin zoom accidental en PWA instalada
function enforceStandaloneViewport() {
  if (typeof document !== 'undefined' && isStandalonePWA()) {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.appendChild(vp);
    }
    vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }
}

if (typeof document !== 'undefined') {
  // Aplicar inmediatamente y al cargar el DOM
  enforceStandaloneViewport();
  document.addEventListener('DOMContentLoaded', enforceStandaloneViewport);

  // 1. Bloqueo de gestos multitáctiles (pinch-to-zoom) exclusivamente en PWA instalada
  document.addEventListener('gesturestart', event => {
    if (isStandalonePWA()) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('gesturechange', event => {
    if (isStandalonePWA()) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('gestureend', event => {
    if (isStandalonePWA()) {
      event.preventDefault();
    }
  }, { passive: false });

  // Bloqueo de inicio de gestos multitáctiles con 2 o más dedos
  document.addEventListener('touchstart', event => {
    if (isStandalonePWA() && event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  // 2. Bloqueo activo del doble toque accidental (double-tap to zoom)
  let lastTapEndTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  document.addEventListener('touchend', event => {
    if (!isStandalonePWA()) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const now = Date.now();
    const delta = now - lastTapEndTime;
    const dist = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);

    lastTapEndTime = now;
    lastTapX = touch.clientX;
    lastTapY = touch.clientY;

    // Detectar si ocurre un segundo toque rápido en la misma zona (<= 350ms y <= 32px)
    if (delta > 0 && delta <= 350 && dist <= 32) {
      const target = event.target;
      const isInteractive = target && target.closest && target.closest(
        'button, input, select, textarea, a, label, [role="button"], [contenteditable="true"]'
      );
      // Prevenir zoom de doble toque sobre tarjetas, contenedores, fondos y textos
      if (!isInteractive) {
        event.preventDefault();
      }
    }
  }, { passive: false });

  // 3. Prevenir evento dblclick nativo de ampliación
  document.addEventListener('dblclick', event => {
    if (isStandalonePWA()) {
      const isInteractive = event.target?.closest?.(
        'button, input, select, textarea, a, label, [role="button"], [contenteditable="true"]'
      );
      if (!isInteractive) {
        event.preventDefault();
      }
    }
  }, { passive: false });
}

// -------------------------------------------------------------
// 17. GESTIÓN INTELIGENTE DE ACTUALIZACIONES PWA (iOS Safari & SW)
// -------------------------------------------------------------
let swRegistration = null;
let waitingWorker = null;
let lastUpdateCheck = 0;
const MIN_CHECK_INTERVAL_MS = 60 * 1000; // Mínimo 1 minuto entre consultas para evitar peticiones redundantes

function isUserBusy() {
  if (isSaving || isExporting) return true;
  if (Array.isArray(stagedItems) && stagedItems.length > 0) return true;

  // Comprobar si algún diálogo modal se encuentra abierto
  const openDialogs = document.querySelectorAll('dialog[open]');
  if (openDialogs.length > 0) return true;

  // Comprobar si hay foco activo en campos de entrada
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    return true;
  }

  return false;
}

function showUpdateBanner() {
  const banner = $('#update-banner');
  if (banner) {
    banner.hidden = false;
  }
}

function hideUpdateBanner() {
  const banner = $('#update-banner');
  if (banner) {
    banner.hidden = true;
  }
}

function applyPendingUpdate() {
  const targetWorker = waitingWorker || swRegistration?.waiting;
  if (targetWorker) {
    targetWorker.postMessage({ type: 'SKIP_WAITING' });
  }
}

function checkPendingUpdateOnIdle() {
  if (waitingWorker && !isUserBusy()) {
    showUpdateBanner();
  }
}

function handleWaitingWorker(worker) {
  waitingWorker = worker;

  if (!isUserBusy()) {
    // Si no hay tareas activas en curso, permitimos aplicar la nueva versión automáticamente
    applyPendingUpdate();
  } else {
    // Si está ocupado registrando una comida o editando información, mostramos aviso sin forzar recarga
    showUpdateBanner();
  }
}

async function checkForUpdates(registration = swRegistration) {
  if (!registration || !navigator.onLine) return;
  const now = Date.now();
  if (now - lastUpdateCheck < MIN_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = now;

  try {
    await registration.update();
  } catch (err) {
    // Sin conexión o fallo temporal del servidor; se preserva la sesión local sin errores visibles
    console.debug('Comprobación de actualización omitida o sin conexión:', err);
  }
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Evitar ciclos infinitos de recarga: bandera única por ciclo de vida de la página
  let isRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./sw.js', { scope: './' })
    .then(registration => {
      swRegistration = registration;

      // 1. Detectar si ya hay un nuevo Service Worker esperando ser activado
      if (registration.waiting) {
        handleWaitingWorker(registration.waiting);
      }

      // 2. Escuchar cuando se descubre un Service Worker nuevo
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed') {
            // Solo si ya hay un controlador previo activo se trata de una actualización
            if (navigator.serviceWorker.controller) {
              handleWaitingWorker(newWorker);
            }
          }
        });
      });

      // 3. Comprobación inicial si hay conexión
      checkForUpdates(registration);

      // 4. Comprobaciones inteligentes al volver a primer plano (multitarea iOS) o recuperar conexión
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (waitingWorker && !isUserBusy()) {
            applyPendingUpdate();
          } else {
            checkForUpdates(registration);
          }
        }
      });

      window.addEventListener('focus', () => {
        if (waitingWorker && !isUserBusy()) {
          applyPendingUpdate();
        } else {
          checkForUpdates(registration);
        }
      });

      window.addEventListener('online', () => {
        checkForUpdates(registration);
      });
    })
    .catch(err => console.warn('Offline no disponible aún:', err));
}

// -------------------------------------------------------------
// 17. INICIALIZACIÓN DE LA APLICACIÓN
// -------------------------------------------------------------
async function init() {
  try {
    db = await openDatabase();
    attachEvents();
    await refresh();
    await checkStorage();
    setupServiceWorker();
  } catch (error) {
    console.error(error);
    $('#main-content').innerHTML = `
      <section class="empty-state">
        <strong>No se pudo iniciar el almacenamiento local</strong>
        Asegúrate de no estar usando navegación privada restrictiva y de tener espacio disponible en tu dispositivo.
      </section>
    `;
  }
}

init();
