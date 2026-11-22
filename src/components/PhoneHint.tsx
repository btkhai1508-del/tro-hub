import { normalizeVnPhone, phoneProblem } from '../lib/phone';

/** Under a phone input: the number that will be stored, or why it cannot be saved. Nothing while the field is empty. */
export function PhoneHint({ value, className = '' }: { value: string; className?: string }) {
  if (!value.trim()) return null;
  const problem = phoneProblem(value);
  return problem ? (
    <p role="alert" className={`mt-1.5 text-xs text-rose-600 dark:text-rose-400 ${className}`}>{problem}</p>
  ) : (
    <p className={`mt-1.5 text-xs text-neutral-600 dark:text-neutral-300 ${className}`}>
      Số sẽ lưu: <span className="font-num font-semibold">{normalizeVnPhone(value)}</span>
    </p>
  );
}
