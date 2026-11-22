import type { Reader } from '../data';
import { signInStep } from '../session/grownUpReader';
import { strings } from '../strings';
import { GrownUpCheck } from './GrownUpCheck';

const t = strings.grownUpSignIn;

interface GrownUpSignInProps {
  reader: Reader;
  onPass: () => void;
  onCancel: () => void;
}

/**
 * A grown-up reader proves they are one before their space opens: the household PIN, or the
 * multiplication gate if the household has no PIN (GrownUpCheck). Passing here only signs them in
 * as a reader: it doesn't open the grown-up area or the 2-minute window for guarded Settings
 * actions. A child never gets here (their card is enough).
 */
export function GrownUpSignIn({ reader, onPass, onCancel }: GrownUpSignInProps) {
  if (signInStep(reader.kind, true) === 'none') return null;
  return <GrownUpCheck pinReason={t.pinReason} gateReason={t.gateReason} onPass={onPass} onCancel={onCancel} />;
}
