import { useCallback, useEffect, useRef, useState } from 'react';
import { normaliseIsbn } from '../books/isbn';
import { strings } from '../strings';
import { Scanner, type ScanFormat, type ScanResult, type ScannerErrorKind } from './Scanner';

/**
 * Scanner in "book mode". Looks for book barcodes (EAN-13) and the barcodes
 * libraries stick on books (Code 128, Code 39, Codabar, ITF). Only an EAN-13
 * starting 978/979 counts as a book; anything else shows a hint and scanning
 * continues. Non-book values go to onOtherBarcode (library stickers, Phase 3).
 */

const BOOK_MODE_FORMATS: readonly ScanFormat[] = ['ean_13', 'code_128', 'code_39', 'codabar', 'itf'];

const NOTICE_MS = 3500;

export interface BookScannerProps {
  /** Called with a normalised ISBN-13. */
  onIsbn: (isbn: string) => void;
  /** Any other barcode, raw. */
  onOtherBarcode?: (value: string, format: ScanFormat) => void;
  onError?: (kind: ScannerErrorKind, error: unknown) => void;
  paused?: boolean;
  className?: string;
}

export function BookScanner({ onIsbn, onOtherBarcode, onError, paused, className }: BookScannerProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onResult = useCallback(
    ({ value, format }: ScanResult) => {
      const isbn = format === 'ean_13' && /^97[89]/.test(value) ? normaliseIsbn(value) : null;
      if (isbn) {
        clearTimeout(timer.current);
        setNotice(null);
        onIsbn(isbn);
        return;
      }
      onOtherBarcode?.(value, format);
      setNotice(strings.scanner.otherBarcode);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    },
    [onIsbn, onOtherBarcode],
  );

  return (
    <Scanner
      formats={BOOK_MODE_FORMATS}
      onResult={onResult}
      onError={onError}
      paused={paused}
      notice={notice}
      className={className}
    />
  );
}
