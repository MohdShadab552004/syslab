import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '@/lib/utils/cx';

interface BaseProps { label?: string; small?: boolean; className?: string }

export function TextField({ label, small, className, value, onValue, ...rest }: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onValue: (v: string) => void }) {
  const id = useId();
  return (
    <div className={cx('fieldwrap', className)}>
      {label && <label className="flab" htmlFor={id}>{label}</label>}
      <input id={id} className={cx('field', small && 'sm')} type="text" value={value} onChange={(e) => onValue(e.target.value)} {...rest} />
    </div>
  );
}

export function NumberField({ label, small, className, value, onValue, ...rest }: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: number; onValue: (v: number) => void }) {
  const id = useId();
  return (
    <div className={cx('fieldwrap', className)}>
      {label && <label className="flab" htmlFor={id}>{label}</label>}
      <input id={id} className={cx('field', small && 'sm')} type="number" value={value} onChange={(e) => onValue(Number(e.target.value))} {...rest} />
    </div>
  );
}

export interface SelectOption { value: string; label: string; disabled?: boolean }

export function SelectField({ label, value, options, onValue }: { label?: string; value: string; options: (string | SelectOption)[]; onValue: (v: string) => void }) {
  const id = useId();
  return (
    <div className="fieldwrap">
      {label && <label className="flab" htmlFor={id}>{label}</label>}
      <select id={id} className="field sm" value={value} onChange={(e) => onValue(e.target.value)}>
        {options.map((o) => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
      </select>
    </div>
  );
}

export function RangeField({ label, value, min, max, step, onValue, aside }: { label: string; value: number; min: number; max: number; step: number; onValue: (v: number) => void; aside?: string }) {
  const id = useId();
  return (
    <div className="fieldwrap">
      <div className="row"><label className="flab" htmlFor={id}>{label}</label>{aside && <span className="v">{aside}</span>}</div>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onValue(Number(e.target.value))} />
    </div>
  );
}
