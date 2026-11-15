import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * Mirrors OWOX's CollapsibleCard (the plugin can't import it): icon and title left, status and chevron right, content folds.
 * `section` is OWOX's muted card; `band` is Data Flow's block chrome (muted panel, icon tile, bare chevron); `block` is its white `dm-card-block`, bordered, for cards inside a section.
 * The whole header toggles, as in OWOX; the chevron is the keyboard's button.
 * `collapsed` seeds the state and re-applies whenever it changes, so results can fold or open a card the user may still toggle;
 * `attention` opens it when it turns true, even if the user folded it.
 */
export function CollapsibleCard({ title, icon: Icon, iconSeverity, iconLabel, status, hint, variant = 'block', collapsed = false, attention = false, label, children }: {
  title: ReactNode; icon?: LucideIcon; status?: ReactNode; variant?: 'section' | 'block' | 'band'; collapsed?: boolean; attention?: boolean; label?: string; children: ReactNode;
  /** Tints the icon tile; with `iconLabel` the tile is an image with that name. */
  iconSeverity?: string | null; iconLabel?: string;
  /** Shown under the header, indented past the icon tile, outside the clickable header. */
  hint?: ReactNode;
}) {
  const [folded, setFolded] = useState(collapsed);
  const bodyId = useId();
  useEffect(() => { setFolded(collapsed); }, [collapsed]);
  useEffect(() => { if (attention) setFolded(false); }, [attention]);
  const toggle = () => setFolded((f) => !f);
  return (
    <div className="dm-collapsible" data-variant={variant} data-folded={folded} role="group" aria-label={label}>
      <div className="dm-collapsible-header" onClick={toggle}>
        <span className="dm-collapsible-title">
          {Icon && <span className="dm-collapsible-icon" data-severity={iconSeverity ?? undefined} {...(iconLabel ? { role: 'img', 'aria-label': iconLabel } : { 'aria-hidden': true })}><Icon size={18} aria-hidden="true" /></span>}
          {title}
        </span>
        <span className="dm-collapsible-actions">
          {status}
          <button type="button" className="dm-collapsible-toggle" aria-expanded={!folded} aria-controls={bodyId} aria-label={label ?? 'section'} onClick={(e) => { e.stopPropagation(); toggle(); }}>
            <ChevronDown size={16} data-folded={folded} aria-hidden="true" />
          </button>
        </span>
      </div>
      {hint && <div className="dm-collapsible-hint">{hint}</div>}
      <div className="dm-collapsible-grid" data-folded={folded}>
        <div id={bodyId} className="dm-collapsible-clip" aria-hidden={folded} inert={folded}>
          <div className="dm-collapsible-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
