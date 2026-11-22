import { useCallback, useEffect, useRef, useState } from 'react';
import { normaliseIsbn } from '../books/isbn';
import { strings } from '../strings';
import { Scanner, type ScanFormat, type ScanResult, type ScannerErrorKind } from './Scanner';

/**
 * Scanner for books and library stickers.
 *
 * "book" mode: looks for book barcodes (EAN-13) and the barcodes libraries
 * stick on books (Code 128, Code 39, Codabar, ITF). Only an EAN-13 starting
 * 978/979 counts as a book; anything else shows a hint, goes to
 * onOtherBarcode, and scanning continues.
 *
 * "sticker" mode: the opposite. Any non-ISBN barcode is a library sticker and
 * goes to onSticker as its raw value; the book's own ISBN barcode gets a hint.
 */

const SCAN_FORMATS: readonly ScanFormat[] = ['ean_13', 'code_128', 'code_39', 'codabar', 'itf'];

const NOTICE_MS = 3500;

export interface BookScannerProps {
  mode?: 'book' | 'sticker';
  /** Book mode: a normalised ISBN-13. */
  onIsbn?: (isbn: string) => void;
  /** Book mode: any other barcode, raw. */
  onOtherBarcode?: (value: string, format: ScanFormat) => void;
  /** Sticker mode: the sticker's raw value. */
  onSticker?: (value: string, format: ScanFormat) => void;
  /** A message from the caller (e.g. "I don't know this book"), shown like a hint. */
  message?: string | null;
  onError?: (kind: ScannerErrorKind, error: unknown) => void;
  paused?: boolean;
  className?: string;
  /** Replaces the mode's own hint (e.g. "Point the camera at the barcode on the library card"). */
  hint?: string;
}

export function BookScanner({
  mode = 'book',
  onIsbn,
  onOtherBarcode,
  onSticker,
  message,
  onError,
  paused,
  className,
  hint,
}: BookScannerProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const onResult = useCallback(
    ({ value, format }: ScanResult) => {
      const isbn = format === 'ean_13' && /^97[89]/.test(value) ? normaliseIsbn(value) : null;
      if (mode === 'sticker') {
        if (isbn) {
          flash(strings.scanner.notTheSticker);
          return;
        }
        clearTimeout(timer.current);
        setNotice(null);
        onSticker?.(value.trim(), format);
        return;
      }
      if (isbn) {
        clearTimeout(timer.current);
        setNotice(null);
        onIsbn?.(isbn);
        return;
      }
      onOtherBarcode?.(value, format);
      flash(strings.scanner.otherBarcode);
    },
    [mode, onIsbn, onOtherBarcode, onSticker, flash],
  );

  return (
    <Scanner
      formats={SCAN_FORMATS}
      onResult={onResult}
      onError={onError}
      paused={paused}
      hint={hint ?? (mode === 'sticker' ? strings.scanner.stickerHint : undefined)}
      notice={message ?? notice}
      className={className}
    />
  );
}
