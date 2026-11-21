import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { buildCardUrl } from '../cards/cardUrl';
import { useDataQuery, type DataStore, type Household, type Reader } from '../data';
import { AVATARS, DEFAULT_AVATAR } from '../readers/avatars';
import { fmt, strings } from '../strings';
import { useToast } from '../ui/Toast';

const t = strings.dev;

/** Temporary grown-up tool: create readers and show their library card QR codes. */
export function ReadersPanel({ store, household }: { store: DataStore; household: Household }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(DEFAULT_AVATAR);
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  const query = useCallback((s: DataStore) => s.listReaders(household.id), [household.id]);
  const { data: readers } = useDataQuery(query, ['readers']);

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) return;
    setBusy(true);
    try {
      await store.createReader({ household_id: household.id, display_name: displayName, avatar });
      setName('');
      toast({ message: fmt(t.readerCreated, { name: displayName }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack card">
      <h2>{t.readersHeading}</h2>
      <form className="stack" onSubmit={onCreate}>
        <label htmlFor={nameId} className="field-label">
          {t.readerName}
        </label>
        <input
          id={nameId}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder={t.readerNamePlaceholder}
        />
        <fieldset className="avatar-picker">
          <legend className="field-label">{t.readerAvatar}</legend>
          {AVATARS.map((emoji) => (
            <label key={emoji} className="avatar-picker__option">
              <input
                type="radio"
                name="avatar"
                value={emoji}
                checked={avatar === emoji}
                onChange={() => setAvatar(emoji)}
                className="visually-hidden"
              />
              <span className="avatar" aria-hidden="true">
                {emoji}
              </span>
              <span className="visually-hidden">{emoji}</span>
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            {t.createReader}
          </button>
        </div>
      </form>

      {readers && readers.length === 0 && <p className="muted">{t.noReaders}</p>}
      <ul className="reader-list">
        {readers?.map((reader) => (
          <ReaderRow key={reader.id} reader={reader} store={store} />
        ))}
      </ul>
    </section>
  );
}

function ReaderRow({ reader, store }: { reader: Reader; store: DataStore }) {
  const toast = useToast();
  const cardUrl = buildCardUrl(reader.card_token);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const css = getComputedStyle(document.documentElement);
    QRCode.toDataURL(cardUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: {
        dark: css.getPropertyValue('--color-qr-dark').trim(),
        light: css.getPropertyValue('--color-qr-light').trim(),
      },
    }).then((dataUrl) => !cancelled && setQr({ url: cardUrl, dataUrl }));
    return () => {
      cancelled = true;
    };
  }, [cardUrl]);

  const rotate = async () => {
    await store.rotateCardToken(reader.id);
    toast({ message: fmt(t.tokenRotated, { name: reader.display_name }) });
  };

  return (
    <li className="reader-row">
      <div className="reader-row__qr">
        {qr?.url === cardUrl && <img src={qr.dataUrl} alt={fmt(t.qrAlt, { name: reader.display_name })} width={160} height={160} />}
      </div>
      <div className="stack">
        <p className="reader-row__name">
          <span className="avatar" aria-hidden="true">
            {reader.avatar}
          </span>{' '}
          {reader.display_name}
        </p>
        <a className="small reader-row__url" href={cardUrl}>
          {cardUrl}
        </a>
        <div className="row">
          <a className="btn" href={cardUrl}>
            {t.openCard}
          </a>
          <button type="button" className="btn" onClick={() => void rotate()}>
            {t.rotateToken}
          </button>
        </div>
      </div>
    </li>
  );
}
