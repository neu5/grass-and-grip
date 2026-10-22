import {
  DEFAULT_RULES,
  DEFAULT_SETUP,
  normalizeRules,
  normalizeSetup,
  SETUP_MAX,
  SETUP_MIN,
  type CarSetup,
  type RaceRules,
} from '../sim';

interface Choice {
  value: string;
  label: string;
}

function group(container: HTMLElement, name: string, legend: string, choices: Choice[]): HTMLFieldSetElement {
  const fs = document.createElement('fieldset');
  fs.className = 'compact';
  fs.innerHTML = `<legend>${legend}</legend>`;
  for (const c of choices) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="${name}" value="${c.value}" /><span>${c.label}</span>`;
    fs.append(l);
  }
  container.append(fs);
  return fs;
}

function pick(root: HTMLElement, name: string): string | undefined {
  return root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
}

function check(root: HTMLElement, name: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

const RATES: Choice[] = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Normal' },
  { value: '2', label: '×2' },
];

const RATE_ROWS: [keyof Pick<RaceRules, 'damage' | 'tyreWear' | 'fuel'>, string][] = [
  ['damage', 'Damage'],
  ['tyreWear', 'Tyre wear'],
  ['fuel', 'Fuel use'],
];

export interface RulesFields {
  get(): RaceRules;
  set(rules: RaceRules): void;
  setDisabled(disabled: boolean): void;
}

/**
 * Damage / tyre wear / fuel (off, normal, double) and car contact. AI level is
 * left to its own picker; `get()` keeps whatever level was last `set()`.
 */
export function mountRulesFields(container: HTMLElement, prefix: string, onChange?: (rules: RaceRules) => void): RulesFields {
  for (const [key, legend] of RATE_ROWS) group(container, `${prefix}-${key}`, legend, RATES);
  group(container, `${prefix}-collisions`, 'Car contact', [
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ]);
  let aiLevel = DEFAULT_RULES.aiLevel;
  const fields: RulesFields = {
    get() {
      return normalizeRules({
        damage: pick(container, `${prefix}-damage`),
        tyreWear: pick(container, `${prefix}-tyreWear`),
        fuel: pick(container, `${prefix}-fuel`),
        collisions: pick(container, `${prefix}-collisions`) !== 'off',
        aiLevel,
      });
    },
    set(rules) {
      const r = normalizeRules(rules);
      for (const [key] of RATE_ROWS) check(container, `${prefix}-${key}`, String(r[key]));
      check(container, `${prefix}-collisions`, r.collisions ? 'on' : 'off');
      aiLevel = r.aiLevel;
    },
    setDisabled(disabled) {
      for (const input of container.querySelectorAll<HTMLInputElement>('input')) input.disabled = disabled;
    },
  };
  fields.set(DEFAULT_RULES);
  container.addEventListener('change', () => onChange?.(fields.get()));
  return fields;
}

const STEPS: Choice[] = Array.from({ length: SETUP_MAX - SETUP_MIN + 1 }, (_, i) => {
  const v = SETUP_MIN + i;
  return { value: String(v), label: v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0' };
});

const SETUP_ROWS: [keyof CarSetup, string][] = [
  ['gearing', 'Gearing <i>accel ← → top speed</i>'],
  ['steering', 'Steering <i>slow ← → quick</i>'],
  ['grip', 'Wings <i>low drag ← → grip</i>'],
];

export interface SetupFields {
  get(): CarSetup;
  set(setup: CarSetup): void;
}

export function mountSetupFields(container: HTMLElement, prefix: string, onChange?: (setup: CarSetup) => void): SetupFields {
  for (const [key, legend] of SETUP_ROWS) group(container, `${prefix}-${key}`, legend, STEPS);
  const fields: SetupFields = {
    get() {
      return normalizeSetup({
        gearing: pick(container, `${prefix}-gearing`),
        steering: pick(container, `${prefix}-steering`),
        grip: pick(container, `${prefix}-grip`),
      });
    },
    set(setup) {
      const s = normalizeSetup(setup);
      for (const [key] of SETUP_ROWS) check(container, `${prefix}-${key}`, String(s[key]));
    },
  };
  fields.set(DEFAULT_SETUP);
  container.addEventListener('change', () => onChange?.(fields.get()));
  return fields;
}
