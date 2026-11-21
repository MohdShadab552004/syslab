import { Button } from './Button';
import { ICON } from './Icon';

export interface StepperProps { value: string | number; onDec: () => void; onInc: () => void; label: string; wide?: boolean }

export function Stepper({ value, onDec, onInc, label, wide }: StepperProps) {
  return (
    <span className="stepper">
      <Button size="sm" iconOnly icon={ICON.minus} onClick={onDec} aria-label={`Decrease ${label}`} />
      <span className={wide ? 'num wide' : 'num'}>{value}</span>
      <Button size="sm" iconOnly icon={ICON.plus} onClick={onInc} aria-label={`Increase ${label}`} />
    </span>
  );
}
