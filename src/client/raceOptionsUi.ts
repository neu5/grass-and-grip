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

/** AI level presets; any other value shows as Custom. */
export const AI_PRESETS = [
  { value: 40, label: 'Easy' },
  { value: 70, label: 'Medium' },
  { value: 90, label: 'Hard' },
] as const;

/** AI level row: Easy / Medium / Hard / Custom plus a 0–100% slider. */
function mountAiLevel(container: HTMLElement, prefix: string, onInput: () => void) {
  const fs = group(container, `${prefix}-ai`, 'AI level <i id="' + prefix + '-ai-pct"></i>', [
    ...AI_PRESETS.map((p) => ({ value: String(p.value), label: p.label })),
    { value: 'custom', label: 'Custom' },
  ]);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.className = 'ai-slider';
  slider.setAttribute('aria-label', 'AI level percent');
  fs.append(slider);
  const pct = fs.querySelector<HTMLElement>(`#${prefix}-ai-pct`)!;
  const show = (level: number) => {
    slider.value = String(level);
    pct.textContent = `${level}%`;
    const preset = AI_PRESETS.find((p) => p.value === level);
    check(fs, `${prefix}-ai`, preset ? String(preset.value) : 'custom');
  };
  fs.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name === `${prefix}-ai` && input.value !== 'custom') show(Number(input.value));
    onInput();
  });
  slider.addEventListener('input', () => show(Number(slider.value)));
  return {
    get: () => Number(slider.value),
    set: show,
    setDisabled: (d: boolean) => {
      for (const input of fs.querySelectorAll<HTMLInputElement>('input')) input.disabled = d;
    },
  };
}

/**
 * Damage / tyre wear / fuel (off, normal, double) and car contact, plus the
 * AI level picker, which goes in `aiContainer` when given (it is worth showing
 * outside a folded options box).
 */
export function mountRulesFields(
  container: HTMLElement,
  prefix: string,
  onChange?: (rules: RaceRules) => void,
  aiContainer: HTMLElement = container,
): RulesFields {
  const ai = mountAiLevel(aiContainer, prefix, () => {});
  for (const [key, legend] of RATE_ROWS) group(container, `${prefix}-${key}`, legend, RATES);
  group(container, `${prefix}-collisions`, 'Car contact', [
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ]);
  const fields: RulesFields = {
    get() {
      return normalizeRules({
        damage: pick(container, `${prefix}-damage`),
        tyreWear: pick(container, `${prefix}-tyreWear`),
        fuel: pick(container, `${prefix}-fuel`),
        collisions: pick(container, `${prefix}-collisions`) !== 'off',
        aiLevel: ai.get(),
      });
    },
    set(rules) {
      const r = normalizeRules(rules);
      for (const [key] of RATE_ROWS) check(container, `${prefix}-${key}`, String(r[key]));
      check(container, `${prefix}-collisions`, r.collisions ? 'on' : 'off');
      ai.set(r.aiLevel);
    },
    setDisabled(disabled) {
      for (const input of container.querySelectorAll<HTMLInputElement>('input')) input.disabled = disabled;
      ai.setDisabled(disabled);
    },
  };
  fields.set(DEFAULT_RULES);
  const changed = () => onChange?.(fields.get());
  container.addEventListener('change', changed);
  // The slider sends once on release, not on every step.
  if (aiContainer !== container) aiContainer.addEventListener('change', changed);
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
