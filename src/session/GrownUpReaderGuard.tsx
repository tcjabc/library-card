import { useEffect, useRef } from 'react';
import { getActiveReaderId, useActiveReader } from './activeReader';
import { watchGrownUpReader } from './grownUpReader';

/**
 * While a grown-up reader is signed in, signs them out after 5 minutes without interaction, when
 * the page is hidden, or if the app was closed since (see watchGrownUpReader). Mount once, near
 * the app root. Children are left alone.
 */
export function GrownUpReaderGuard() {
  const { reader } = useActiveReader();
  // Who was signed in when this tab opened (a later change came from this tab or another).
  const openedWith = useRef(getActiveReaderId());
  const grownUpId = reader?.kind === 'grown_up' ? reader.id : null;
  useEffect(
    () => (grownUpId ? watchGrownUpReader(grownUpId, undefined, { openedWithThem: grownUpId === openedWith.current }) : undefined),
    [grownUpId],
  );
  return null;
}
