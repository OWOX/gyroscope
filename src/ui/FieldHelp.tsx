import { CircleHelp } from 'lucide-react';
import { useId } from 'react';

/** A (?) after a Data Mart field's label: hover or focus shows the field's schema description in a small tooltip. Nothing renders without one. */
export function FieldHelp({ label, description }: { label: string; description?: string }) {
  const id = useId();
  if (!description) return null;
  return (
    <span className="gy-fieldtip">
      <button type="button" className="gy-fieldtip-btn" aria-label={`About ${label}`} aria-describedby={id}><CircleHelp size={12} aria-hidden="true" /></button>
      <span id={id} role="tooltip" className="gy-fieldtip-body">{description}</span>
    </span>
  );
}
