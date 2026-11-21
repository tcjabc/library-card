import { href } from '../router';
import { strings } from '../strings';

export function BackToHub() {
  return (
    <a className="btn btn--quiet back-link" href={href('/hub')}>
      <span aria-hidden="true">←</span> {strings.common.backToHub}
    </a>
  );
}
