import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { strings } from '../strings';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  /** A destructive action (Delete, Remove): shown in the danger colour. */
  danger?: boolean;
}

interface MoreMenuProps {
  items: readonly MoreMenuItem[];
  /** The button's accessible name, e.g. "More for The Gruffalo". */
  label?: string;
  className?: string;
}

/** Room the menu needs below its button before it opens upwards instead (px). */
const ROOM_BELOW = 220;
/** Room the menu needs to the left of its button's right edge; less, and it opens rightwards from the button (px). */
const ROOM_LEFT = 200;

/**
 * "⋯ More": a menu button for a tile's actions (the WAI-ARIA menu button pattern). Enter, Space or
 * ↓ opens it on the first item, ↑ on the last; ↑ ↓ Home End move; Enter picks; Escape closes it
 * and returns to the button; Tab or a tap outside closes it. It opens upwards near the bottom of
 * the screen, and rightwards near its left edge (so it always stays on the screen).
 */
export function MoreMenu({ items, label, className }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [rightwards, setRightwards] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();

  const show = (focus: 'first' | 'last') => {
    const rect = button.current?.getBoundingClientRect();
    setUp(!!rect && window.innerHeight - rect.bottom < ROOM_BELOW && rect.top > ROOM_BELOW);
    setRightwards(!!rect && rect.right < ROOM_LEFT);
    firstFocus.current = focus;
    setOpen(true);
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // Focus an item once the menu is on the page.
  useEffect(() => {
    if (!open) return;
    const options = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (options?.length) options[firstFocus.current === 'first' ? 0 : options.length - 1].focus();
  }, [open]);

  // A tap or click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      show(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const go = (index: number) => options[(index + options.length) % options.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        go(at + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        go(at - 1);
        break;
      case 'Home':
        event.preventDefault();
        go(0);
        break;
      case 'End':
        event.preventDefault();
        go(options.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // not the sheet or dialog around it
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={wrapper} className={`more-menu${className ? ` ${className}` : ''}`}>
      <button
        ref={button}
        type="button"
        className="btn btn--small btn--quiet more-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label ?? strings.common.more}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <ul ref={menu} id={menuId} role="menu" aria-label={label ?? strings.common.more} className={`more-menu__list${up ? ' more-menu__list--up' : ''}${rightwards ? ' more-menu__list--start' : ''}`} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`more-menu__item${item.danger ? ' more-menu__item--danger' : ''}`}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
