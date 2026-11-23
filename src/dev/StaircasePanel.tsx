import { href } from '../router';
import { FAKE_STAIRCASE_STEPS, setFakeStaircaseSteps, useFakeStaircaseSteps } from '../screens/journeys/fakeStaircase';
import { fmt, strings } from '../strings';

const t = strings.dev;

/** Dev only: the old zig-zag staircase (kept for comparison), and showing it with lots of pretend steps (this tab, nothing saved). */
export function StaircasePanel() {
  const fake = useFakeStaircaseSteps();
  const count = FAKE_STAIRCASE_STEPS.toLocaleString();
  return (
    <section className="stack card">
      <h2>{t.staircaseHeading}</h2>
      <p className="muted small">{t.staircaseOldIntro}</p>
      <div className="row">
        <a className="btn" href={href('/staircase/old')}>
          {t.staircaseOld}
        </a>
      </div>
      <p className="muted small">{t.staircaseIntro}</p>
      {fake && (
        <p className="small" role="status">
          {fmt(t.staircaseFakeOn, { count: fake.toLocaleString() })} <a href={href('/staircase/old')}>{t.staircaseOld}</a>
        </p>
      )}
      <div className="row">
        {fake ? (
          <button type="button" className="btn" onClick={() => setFakeStaircaseSteps(null)}>
            {t.staircaseFakeOff}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setFakeStaircaseSteps(FAKE_STAIRCASE_STEPS)}>
            {fmt(t.staircaseFake, { count })}
          </button>
        )}
      </div>
    </section>
  );
}
