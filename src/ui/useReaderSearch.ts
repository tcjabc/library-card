import { useCallback, useState } from 'react';

/**
 * The "Find a book" text for one reader's screen: not remembered between visits (plain state),
 * and empty again as soon as the active reader changes.
 */
export function useReaderSearch(readerId: string): [string, (text: string) => void] {
  const [state, setState] = useState({ readerId, text: '' });
  const text = state.readerId === readerId ? state.text : '';
  const setText = useCallback((next: string) => setState({ readerId, text: next }), [readerId]);
  return [text, setText];
}
