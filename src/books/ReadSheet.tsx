import { useState } from 'react';
import type { MarkReadOptions, ReadHow, Reader } from '../data';
import { GrownUpCheck } from '../screens/GrownUpCheck';
import { strings } from '../strings';
import { ChoiceButton } from '../ui/ChoiceButton';
import { Sheet } from '../ui/Sheet';
import { readRecord, readSteps } from './readFlow';

const t = strings.reads;

interface ReadSheetProps {
  reader: Reader;
  title: string;
  /** What to record (the sheet has closed itself by then). */
  onDone: (options: MarkReadOptions) => void;
  /** Tapped outside, ✕ or Back: nothing is recorded. */
  onCancel: () => void;
}

/**
 * A child's "I read this!": "⭐ By myself" or "🤝 With help", then (if their reads need a
 * grown-up's check) "Send for a grown-up to check" or "Grown-up here? Confirm now" with the
 * household PIN (or the gate). See readFlow.ts.
 */
export function ReadSheet({ reader, title, onDone, onCancel }: ReadSheetProps) {
  const needsCheck = readSteps(reader).includes('check');
  const [how, setHow] = useState<ReadHow | null>(null);
  const [step, setStep] = useState<'how' | 'check' | 'confirm'>('how');

  const chooseHow = (value: ReadHow) => {
    if (needsCheck) {
      setHow(value);
      setStep('check');
    } else {
      onDone(readRecord(value, 'none'));
    }
  };

  const heading = step === 'how' ? t.howTitle : step === 'check' ? t.checkTitle : t.confirmTitle;

  return (
    <Sheet title={heading} onClose={onCancel}>
      {step === 'how' && (
        <div className="stack">
          <p className="read-sheet__book">{title}</p>
          <div className="read-sheet__how">
            <button type="button" className="btn btn--big read-sheet__choice" onClick={() => chooseHow('self')}>
              <span aria-hidden="true">⭐</span> {t.bySelf}
            </button>
            <button type="button" className="btn btn--big read-sheet__choice" onClick={() => chooseHow('help')}>
              <span aria-hidden="true">🤝</span> {t.withHelp}
            </button>
          </div>
          <div className="row row--center">
            <button type="button" className="btn btn--quiet" onClick={onCancel}>
              {t.back}
            </button>
          </div>
        </div>
      )}
      {step === 'check' && (
        <div className="stack">
          <p className="read-sheet__book">{title}</p>
          <ChoiceButton title={t.send} detail={t.sendDetail} primary onClick={() => onDone(readRecord(how, 'send'))} />
          <ChoiceButton title={t.confirmNow} detail={t.confirmNowDetail} onClick={() => setStep('confirm')} />
          <div className="row row--center">
            <button type="button" className="btn btn--quiet" onClick={() => setStep('how')}>
              {t.back}
            </button>
          </div>
        </div>
      )}
      {step === 'confirm' && (
        <GrownUpCheck
          pinReason={t.pinReason}
          gateReason={t.gateReason}
          onPass={() => onDone(readRecord(how, 'confirm-now'))}
          onCancel={() => setStep('check')}
        />
      )}
    </Sheet>
  );
}
