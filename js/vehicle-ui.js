// The "my car" panel: what someone's car uses and how far it goes.
import { CarPreview } from './car-gl.js';
import { t } from './i18n.js';
import { CAR_BODIES, COLORS, PRESETS, cleanVehicle, kmPerLitreToL100, l100ToKmPerLitre } from './vehicle.js';
import { GRADES, cleanGrade } from './fuel-price.js';

const $ = (id) => document.getElementById(id);
const round1 = (n) => Math.round(n * 10) / 10;

export function initVehicleUI({ getVehicle, setVehicle, getLook, setLook, getMode, getFuel = () => null, onDone }) {
  const state = { kind: 'petrol', unit: 'l100', body: 'hatchback', color: COLORS[0].hex, grade: null };
  let preview = null;

  function ensurePreview() {
    if (preview) return preview;
    try {
      preview = new CarPreview($('veh-preview'));
    } catch {
      preview = { ok: false, setLook() {}, start() {}, stop() {} };
    }
    $('veh-preview-wrap').hidden = !preview.ok;
    return preview;
  }

  function renderLook() {
    const moto = getMode() === 'motorcycle';
    $('veh-body-field').hidden = moto;
    $('veh-bodies').replaceChildren(...CAR_BODIES.map((body) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.body === body));
      b.textContent = t(`body_${body}`);
      b.addEventListener('click', () => { state.body = body; renderLook(); });
      return b;
    }));
    $('veh-colors').replaceChildren(...COLORS.map(({ id, hex }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--swatch', hex);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.color === hex));
      b.setAttribute('aria-label', t(`color_${id}`));
      b.title = t(`color_${id}`);
      b.addEventListener('click', () => { state.color = hex; renderLook(); });
      return b;
    }));
    ensurePreview().setLook(moto ? 'motorcycle' : state.body, state.color);
  }

  const preset = $('veh-preset');

  function fillPresets() {
    const groups = [['fuel', t('vehFuelCars')], ['ev', t('vehEv')]];
    preset.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('vehPresetNone');
    preset.append(none);
    for (const [kind, label] of groups) {
      const group = document.createElement('optgroup');
      group.label = label;
      PRESETS.forEach((p, i) => {
        if ((p.kind === 'ev') !== (kind === 'ev')) return;
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.name;
        group.append(opt);
      });
      preset.append(group);
    }
  }

  function renderKind() {
    const ev = state.kind === 'ev';
    for (const k of ['petrol', 'diesel', 'ev']) $(`veh-kind-${k}`).setAttribute('aria-checked', String(state.kind === k));
    $('veh-unit-row').hidden = ev;
    $('veh-consumption-label').textContent = ev ? t('vehUseEv') : state.unit === 'kml' ? t('vehUseKml') : t('vehUseL100');
    $('veh-unit-l100').setAttribute('aria-checked', String(state.unit === 'l100'));
    $('veh-unit-kml').setAttribute('aria-checked', String(state.unit === 'kml'));
    $('veh-range-label').textContent = ev ? t('vehRangeEv') : t('vehRangeFuel');
    $('veh-level-label').textContent = ev ? t('vehLevelEv') : t('vehLevelFuel');
    $('veh-price-label').textContent = ev ? t('vehPriceEv') : t('vehPriceFuel');
    renderGrade();
  }

  // Which pump price to use when no price is typed in, with this week's figure.
  function renderGrade() {
    const grades = GRADES[state.kind] || [];
    $('veh-grade-field').hidden = !grades.length;
    $('veh-grade-label').textContent = t('vehGrade');
    state.grade = cleanGrade(state.kind, state.grade);
    const prices = getFuel()?.prices || {};
    $('veh-grade').replaceChildren(...grades.map((g) => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = prices[g] ? `${t(`grade_${g}`)}, RM${prices[g].toFixed(2)}` : t(`grade_${g}`);
      return opt;
    }));
    if (state.grade) $('veh-grade').value = state.grade;
    const price = prices[state.grade];
    $('veh-price-tip').textContent = state.kind === 'ev' ? t('vehPriceTipEv') : t('vehPriceTip', { price: price ? ` (RM${price.toFixed(2)})` : '' });
  }

  function showLevel() {
    $('veh-level-value').textContent = `${$('veh-level').value}%`;
  }

  function consumptionValue() {
    const n = Number($('veh-consumption').value);
    if (!(n > 0)) return null;
    return state.kind !== 'ev' && state.unit === 'kml' ? kmPerLitreToL100(n) : n;
  }

  function open() {
    fillPresets();
    const v = getVehicle();
    state.kind = v?.kind || 'petrol';
    state.grade = v?.grade || null;
    state.unit = 'l100';
    preset.value = '';
    $('veh-name').value = v?.name || '';
    $('veh-consumption').value = v?.consumption ? round1(v.consumption) : '';
    $('veh-range').value = v?.range || '';
    $('veh-price').value = v?.price || '';
    $('veh-level').value = String(v?.level ?? 100);
    $('veh-remove').hidden = !v;
    const moto = getMode() === 'motorcycle';
    $('veh-title').textContent = t(moto ? 'vehTitleMoto' : 'vehTitleCar');
    $('veh-preset-field').hidden = moto;
    const look = getLook();
    state.body = look.body === 'motorcycle' ? 'hatchback' : look.body;
    state.color = look.color;
    showLevel();
    renderKind();
    renderLook();
    ensurePreview().start();
  }

  function close() { preview?.stop(); }

  preset.addEventListener('change', () => {
    const p = PRESETS[Number(preset.value)];
    if (!preset.value || !p) return;
    state.kind = p.kind;
    state.unit = 'l100';
    $('veh-name').value = p.name;
    $('veh-consumption').value = p.consumption;
    $('veh-range').value = p.range || '';
    state.body = p.body;
    renderKind();
    renderLook();
  });

  for (const k of ['petrol', 'diesel', 'ev']) {
    $(`veh-kind-${k}`).addEventListener('click', () => { state.kind = k; renderKind(); });
  }
  $('veh-grade').addEventListener('change', () => { state.grade = $('veh-grade').value; renderGrade(); });
  for (const [id, unit] of [['veh-unit-l100', 'l100'], ['veh-unit-kml', 'kml']]) {
    $(id).addEventListener('click', () => {
      if (state.unit === unit) return;
      // Whatever is typed in stays the same fuel use, shown the other way.
      const n = Number($('veh-consumption').value);
      if (n > 0) $('veh-consumption').value = round1(unit === 'kml' ? l100ToKmPerLitre(n) : kmPerLitreToL100(n));
      state.unit = unit;
      renderKind();
    });
  }
  $('veh-level').addEventListener('input', showLevel);

  $('veh-save').addEventListener('click', () => {
    const v = cleanVehicle({
      name: $('veh-name').value,
      kind: state.kind,
      consumption: consumptionValue(),
      range: $('veh-range').value,
      price: $('veh-price').value,
      grade: state.grade,
      level: $('veh-level').value,
    });
    // The look saves on its own. Fuel figures only count once there are some.
    setLook({ body: getMode() === 'motorcycle' ? 'motorcycle' : state.body, color: state.color });
    setVehicle(v);
    onDone();
  });

  $('veh-remove').addEventListener('click', () => {
    setVehicle(null);
    onDone();
  });

  return { open, close };
}
