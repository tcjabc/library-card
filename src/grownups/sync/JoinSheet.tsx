import { useCallback, useState } from 'react';
import { Scanner, type ScanResult } from '../../scan/Scanner';
import { fmt, strings } from '../../strings';
import type { JoinMode, LocalCounts, SyncService } from '../../sync/service';
import { recoveryFromQr } from '../../sync/vendor/qr-scan.js';
import { parseRecovery } from '../../sync/vendor/words.js';
import { ChoiceButton } from '../../ui/ChoiceButton';
import { Sheet } from '../../ui/Sheet';
import { actionErrorText, countsText, totalCount } from './syncText';
import { WordsInput } from './WordsInput';
import { allWordsKnown, emptyWords } from './wordsLogic';

const t = strings.grownups.sync.join;

type Step = { name: 'enter' } | { name: 'choice'; words: string; counts: LocalCounts } | { name: 'replace'; words: string; counts: LocalCounts };

interface JoinSheetProps {
  service: SyncService;
  onJoined: (mode: JoinMode) => void;
  onClose: () => void;
}

/**
 * "Join a household": scan the other device's code (only 12 valid words are
 * accepted; the camera starts only when "Scan the code" is tapped) or type the words; then, if this device has data, combine (the
 * default) or use only the household's data, after a confirm with the counts.
 * An empty device joins straight away.
 */
export function JoinSheet({ service, onJoined, onClose }: JoinSheetProps) {
  // Nothing chosen yet: like every scanner here, the camera starts only on a tap.
  const [tab, setTab] = useState<'scan' | 'type' | null>(null);
  const [typed, setTyped] = useState<string[]>(emptyWords);
  const [step, setStep] = useState<Step>({ name: 'enter' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async (words: string, mode: JoinMode) => {
    setBusy(true);
    setError(null);
    try {
      const out = await service.join(words, mode);
      onJoined(out.mode);
    } catch (e) {
      console.warn('[sync] join failed', e);
      setError(actionErrorText(e));
      setBusy(false);
    }
  };

  /** Words that passed the checks: ask how to join, unless there's nothing here to keep. */
  const proceed = async (words: string) => {
    setError(null);
    const counts = await service.localCounts();
    if (totalCount(counts) === 0) await join(words, 'replace');
    else setStep({ name: 'choice', words, counts });
  };

  const onScan = useCallback(
    ({ value }: ScanResult) => {
      void recoveryFromQr(value).then((words) => {
        if (words) void proceed(words);
        else setNotice(t.notWords);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- proceed only uses the service, which doesn't change
    [service],
  );

  const submitTyped = async () => {
    const words = typed.join(' ');
    try {
      await parseRecovery(words); // the checksum: one word wrong or out of order
    } catch (e) {
      setError(e instanceof Error ? e.message : t.incomplete);
      return;
    }
    await proceed(words);
  };

  return (
    <Sheet title={t.title} onClose={onClose}>
      {step.name === 'enter' && (
        <div className="stack">
          <div className="chip-row" role="group">
            <button type="button" className="chip" aria-pressed={tab === 'scan'} onClick={() => setTab('scan')}>
              📷 {t.scanTab}
            </button>
            <button type="button" className="chip" aria-pressed={tab === 'type'} onClick={() => setTab('type')}>
              ⌨️ {t.typeTab}
            </button>
          </div>
          {tab === 'scan' && (
            <Scanner formats="qr_code" camera="pairing" hint={t.scanHint} notice={notice} onResult={onScan} paused={busy} className="sync-scanner" />
          )}
          {tab === 'type' && (
            <form
              className="stack"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submitTyped();
              }}
            >
              <WordsInput words={typed} onChange={setTyped} />
              <div className="row">
                <button type="submit" className="btn btn--primary" disabled={!allWordsKnown(typed) || busy}>
                  {busy ? t.joining : t.continue}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {step.name === 'choice' && (
        <div className="stack">
          <h3>{t.choiceTitle}</h3>
          <p className="muted">{fmt(t.choiceIntro, { counts: countsText(step.counts) })}</p>
          <ChoiceButton
            primary
            title={busy ? t.joining : t.combine}
            detail={t.combineDetail}
            disabled={busy}
            onClick={() => void join(step.words, 'combine')}
          />
          <ChoiceButton title={t.replace} detail={t.replaceDetail} disabled={busy} onClick={() => setStep({ ...step, name: 'replace' })} />
        </div>
      )}

      {step.name === 'replace' && (
        <div className="stack">
          <h3>{t.replaceTitle}</h3>
          <p>{fmt(t.replaceBody, { counts: countsText(step.counts) })}</p>
          <div className="row">
            <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void join(step.words, 'replace')}>
              {busy ? t.joining : t.replaceConfirm}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setStep({ ...step, name: 'choice' })}>
              {strings.common.cancel}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="alert alert--danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}
