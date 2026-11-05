// The "my car" panel: what someone's car uses and how far it goes.
import { PRESETS, cleanVehicle, kmPerLitreToL100, l100ToKmPerLitre } from './vehicle.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const round1 = (n) => Math.round(n * 10) / 10;

export function initVehicleUI({ getVehicle, setVehicle, getMode, onDone }) {
  const state = { kind: 'petrol', unit: 'l100' };

  const preset = $('veh-preset');

  function fillPresets() {
    const groups = [['petrol', t('vehPetrol')], ['ev', t('vehEv')]];
    preset.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('vehPresetNone');
    preset.append(none);
    for (const [kind, label] of groups) {
      const group = document.createElement('optgroup');
      group.label = label;
      PRESETS.forEach((p, i) => {
        if (p.kind !== kind) return;
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
    state.unit = 'l100';
    preset.value = '';
    $('veh-name').value = v?.name || '';
    $('veh-consumption').value = v?.consumption ? round1(v.consumption) : '';
    $('veh-range').value = v?.range || '';
    $('veh-price').value = v?.price || '';
    $('veh-level').value = String(v?.level ?? 100);
    $('veh-remove').hidden = !v;
    $('veh-error').textContent = '';
    $('veh-title').textContent = t(getMode() === 'motorcycle' ? 'vehTitleMoto' : 'vehTitleCar');
    showLevel();
    renderKind();
  }

  preset.addEventListener('change', () => {
    const p = PRESETS[Number(preset.value)];
    if (!preset.value || !p) return;
    state.kind = p.kind;
    state.unit = 'l100';
    $('veh-name').value = p.name;
    $('veh-consumption').value = p.consumption;
    $('veh-range').value = p.range || '';
    renderKind();
  });

  for (const k of ['petrol', 'diesel', 'ev']) {
    $(`veh-kind-${k}`).addEventListener('click', () => { state.kind = k; renderKind(); });
  }
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
      level: $('veh-level').value,
    });
    if (!v) {
      $('veh-error').textContent = t('vehNeedOne');
      return;
    }
    setVehicle(v);
    onDone();
  });

  $('veh-remove').addEventListener('click', () => {
    setVehicle(null);
    onDone();
  });

  return { open };
}
