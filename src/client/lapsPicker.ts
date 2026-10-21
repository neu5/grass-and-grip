import { clampLaps, DEFAULT_LAPS } from '../net/protocol';

/** − / number / + control. Commits 1–99 on step, change, or blur. */
export function mountLapsPicker(root: HTMLElement, onChange?: (laps: number) => void) {
  const input = root.querySelector<HTMLInputElement>('input[name="laps"]')!;
  const minus = root.querySelector<HTMLButtonElement>('[data-laps-delta="-1"]')!;
  const plus = root.querySelector<HTMLButtonElement>('[data-laps-delta="1"]')!;

  const commit = (raw: unknown) => {
    const n = clampLaps(raw);
    input.value = String(n);
    onChange?.(n);
    return n;
  };

  minus.addEventListener('click', () => {
    if (input.disabled) return;
    commit(Number(input.value || DEFAULT_LAPS) - 1);
  });
  plus.addEventListener('click', () => {
    if (input.disabled) return;
    commit(Number(input.value || DEFAULT_LAPS) + 1);
  });
  input.addEventListener('change', () => commit(input.value));

  return {
    setValue(n: number) {
      input.value = String(clampLaps(n));
    },
    setDisabled(disabled: boolean) {
      input.disabled = disabled;
      minus.disabled = disabled;
      plus.disabled = disabled;
    },
  };
}
