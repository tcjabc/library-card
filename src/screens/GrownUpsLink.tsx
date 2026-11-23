import { href } from '../router';
import { strings } from '../strings';

/**
 * The small "Grown-ups" link (splash and hub). It opens #/grownups, whose route shows the
 * parent gate first (see App), so every entry point goes through the same gate.
 */
export function GrownUpsLink({ className }: { className?: string }) {
  return (
    <a className={className ? `link-quiet ${className}` : 'link-quiet'} href={href('/grownups')}>
      {strings.splash.grownUps}
    </a>
  );
}
