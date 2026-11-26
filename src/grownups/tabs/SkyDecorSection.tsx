import { useId } from 'react';
import { strings } from '../../strings';
import { DECOR_CHOICES, useStackDecor, writeStackDecor } from '../../staircase/decorSetting';
import type { Decor } from '../../staircase/drawBudget';
import { ChoiceButton } from '../../ui/ChoiceButton';

interface SkyDecorChoicesProps {
  value: Decor;
  onChange: (decor: Decor) => void;
  /** The group's name: the section heading's id. */
  labelledBy?: string;
}

/** Full / Reduced / None as three big choices (a full grown-up tap target each), the current one pressed. No hooks: rendered and tested as is. */
export function SkyDecorChoices({ value, onChange, labelledBy }: SkyDecorChoicesProps) {
  const t = strings.grownups.settings;
  const text: Record<Decor, { title: string; detail: string }> = {
    full: { title: t.skyFull, detail: t.skyFullDetail },
    reduced: { title: t.skyReduced, detail: t.skyReducedDetail },
    none: { title: t.skyNone, detail: t.skyNoneDetail },
  };
  return (
    <div className="stack" role="group" aria-labelledby={labelledBy}>
      {DECOR_CHOICES.map((level) => (
        <ChoiceButton key={level} title={text[level].title} detail={text[level].detail} pressed={value === level} onClick={() => onChange(level)} />
      ))}
    </div>
  );
}

/**
 * "Sky decoration": the clouds over the Family Staircase on this device (localStorage
 * `library-card:stack-decor`, the same setting as the developer tools' decor chips; not synced,
 * not in backups, cleared by "Reset this device"). Followed live by an open pile.
 */
export function SkyDecorSection() {
  const t = strings.grownups.settings;
  const headingId = useId();
  const decor = useStackDecor();
  return (
    <section className="stack card">
      <h2 id={headingId}>{t.skyHeading}</h2>
      <p className="small muted">{t.skyIntro}</p>
      <SkyDecorChoices value={decor} onChange={writeStackDecor} labelledBy={headingId} />
      <p className="small muted">{t.skyNote}</p>
    </section>
  );
}
