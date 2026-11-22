import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { earnedTrophies, ensureTrophyList, markTrophyCelebrated, useTrophyList } from '../../collections/trophies';
import { noteViewId, useDataQuery, type DataStore, type ParentNote, type Reader } from '../../data';
import { dueNote, firstReadMoments, journeyMoments } from '../../notes/due';
import { isGuarded, markShown, pruneGuard } from '../../notes/guard';
import { isGrownUpPath } from '../../grownups/session';
import { ensureCelebrationList, markCelebrated, nextCelebration, useCelebrationList } from '../../journeys/celebration';
import { getJourney } from '../../journeys/journeys';
import { navigate, useHashPath } from '../../router';
import { useActiveReaderId } from '../../session/activeReader';
import { fmt, strings } from '../../strings';
import { confettiBurst, prefersReducedMotion } from '../../ui/confetti';
import { journeyStyle } from './journeyStyle';
import './journeys.css';

const BURSTS = 6;
const BURST_EVERY_MS = 450;

/**
 * Full-screen "You reached the top!" over whatever screen the reader is on, for a finished
 * journey this device hasn't celebrated yet (journeys/celebration.ts), however it was finished:
 * here, in another tab, or on another device through sync. Dismissing it marks it celebrated on
 * this device. Not shown in the grown-up area.
 *
 * With no journey to celebrate, a collection trophy ("Whole set read!") the reader holds and this
 * device hasn't celebrated (src/collections/trophies.ts) shows the same way, once. After those, a
 * child's due parent note (src/notes/due.ts), one at a time.
 */

/** A child's due note, with its author; and the notes they have seen (for the guard). */
async function loadDueNote(store: DataStore, readerId: string) {
  const reader = await store.getReader(readerId);
  if (!reader || reader.kind !== 'child') return null;
  const [notes, events, history] = await Promise.all([store.listNotesForReader(readerId), store.listReadEvents(readerId), store.listJourneyHistory(readerId)]);
  const recorded = notes.filter((n) => n.seen_at).map((n) => noteViewId(n.note.id, readerId));
  const due = dueNote(notes, { after_book: firstReadMoments(events), journey_done: journeyMoments(history) });
  const author = due?.note.author_id ? await store.getReader(due.note.author_id) : null;
  return { note: due?.note ?? null, author, recorded };
}
export function CelebrationHost() {
  const readerId = useActiveReaderId();
  const path = useHashPath();
  const { celebrated, paused } = useCelebrationList();
  const query = useCallback((s: DataStore) => (readerId ? s.listJourneyHistory(readerId) : Promise.resolve([])), [readerId]);
  const { data: history, store } = useDataQuery(query, ['reader_journeys']);

  // First run of this version: make the list from the completions that already exist.
  useEffect(() => {
    if (store && celebrated === null) void ensureCelebrationList(store).catch((error: unknown) => console.error('[celebration] list', error));
  }, [store, celebrated]);

  const trophies = useTrophyList();
  const trophyQuery = useCallback((s: DataStore) => (readerId ? earnedTrophies(s, readerId) : Promise.resolve([])), [readerId]);
  const { data: earned } = useDataQuery(trophyQuery, ['collections', 'books', 'read_events', 'home_items']);
  useEffect(() => {
    if (store && trophies === null) void ensureTrophyList(store).catch((error: unknown) => console.error('[celebration] trophies', error));
  }, [store, trophies]);

  const noteQuery = useCallback((s: DataStore) => (readerId ? loadDueNote(s, readerId) : Promise.resolve(null)), [readerId]);
  const { data: noteData } = useDataQuery(noteQuery, ['parent_notes', 'note_views', 'read_events', 'reader_journeys', 'readers']);
  // Thanked here just now: hidden at once, before its record is written.
  const [thanked, setThanked] = useState<string | null>(null);
  const recorded = noteData?.recorded.join('|');
  useEffect(() => {
    if (recorded !== undefined) pruneGuard(new Set(recorded ? recorded.split('|') : []));
  }, [recorded]);

  if (!readerId || path === '/' || isGrownUpPath(path) || paused) return null;
  const due = celebrated && history ? nextCelebration(history, celebrated) : null;
  if (due) return <Celebration key={due.id} readerJourneyId={due.id} journeyId={due.journey_id} />;
  const trophy = trophies && earned ? earned.find((t) => !trophies.has(t.key)) : undefined;
  if (trophy) return <TrophyCelebration key={trophy.key} trophyKey={trophy.key} title={trophy.title} />;
  const note = noteData?.note;
  const key = note ? noteViewId(note.id, readerId) : null;
  if (note && key && key !== thanked && !isGuarded(key)) {
    return (
      <NoteCard
        key={key}
        note={note}
        author={noteData.author}
        onDone={() => {
          markShown(key);
          setThanked(key);
          if (store) void store.markNoteSeen(note.id, readerId).catch((error: unknown) => console.error('[notes] seen', error));
        }}
      />
    );
  }
  return null;
}

const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

/**
 * A parent note, full screen: the sticker, the note in large type, who it's from, "Read it to me"
 * (the browser's speech, an English voice; hidden where there is none) and "Thank you!", which
 * closes it and records that the child saw it.
 */
function NoteCard({ note, author, onDone }: { note: ParentNote; author: Reader | null; onDone: () => void }) {
  const t = strings.notes;
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [speech] = useState(canSpeak);

  useEffect(() => {
    button.current?.focus();
    return () => {
      if (canSpeak()) window.speechSynthesis.cancel();
    };
  }, []);

  const readAloud = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(note.text);
    utterance.lang = 'en';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('en'));
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  };

  return (
    <CelebrationDialog labelledBy={titleId} onDone={onDone} className="note-card">
      <div className="celebration__body note-card__body">
        <h2 id={titleId} className="visually-hidden">
          {t.cardLabel}
        </h2>
        {note.sticker && (
          <span className="note-card__sticker" aria-hidden="true">
            {note.sticker}
          </span>
        )}
        <p className="note-card__text">{note.text}</p>
        <p className="note-card__from">
          {author ? (
            <>
              <span className="avatar" aria-hidden="true">
                {author.avatar}
              </span>{' '}
              {fmt(t.from, { name: author.display_name })}
            </>
          ) : (
            t.fromGrownUps
          )}
        </p>
        <div className="note-card__actions">
          {speech && (
            <button type="button" className="btn btn--big" onClick={readAloud}>
              <span aria-hidden="true">🔊</span> {t.readToMe}
            </button>
          )}
          <button ref={button} type="button" className="btn btn--big btn--accent" onClick={onDone}>
            {t.thankYou}
          </button>
        </div>
      </div>
    </CelebrationDialog>
  );
}

/** "🏆 Whole set read!": confetti (a message only with reduced motion), once per reader and set. */
function TrophyCelebration({ trophyKey, title }: { trophyKey: string; title: string }) {
  const t = strings.collections;
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const done = () => markTrophyCelebrated(trophyKey);

  useEffect(() => {
    button.current?.focus();
    if (prefersReducedMotion()) return;
    let fired = 0;
    const fire = () => {
      confettiBurst({ x: window.innerWidth * (0.15 + Math.random() * 0.7), y: window.innerHeight * (0.15 + Math.random() * 0.45) }, { size: 'big' });
      fired += 1;
    };
    fire();
    const timer = setInterval(() => (fired < BURSTS ? fire() : clearInterval(timer)), BURST_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <CelebrationDialog labelledBy={titleId} onDone={done}>
      <div className="celebration__body">
        <span className="celebration__badge" aria-hidden="true">
          🏆
        </span>
        <h2 id={titleId} className="celebration__title">
          {t.trophy}
        </h2>
        <p className="kid-lead">{fmt(t.trophyBody, { title })}</p>
        <button ref={button} type="button" className="btn btn--big btn--accent" onClick={done}>
          {t.trophyNext}
        </button>
      </div>
    </CelebrationDialog>
  );
}

function Celebration({ readerJourneyId, journeyId }: { readerJourneyId: string; journeyId: string }) {
  const t = strings.journey;
  const journey = getJourney(journeyId);
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const done = () => {
    markCelebrated(readerJourneyId);
    navigate('/journeys');
  };

  useEffect(() => {
    button.current?.focus();
    if (prefersReducedMotion()) return;
    let fired = 0;
    const fire = () => {
      confettiBurst(
        { x: window.innerWidth * (0.15 + Math.random() * 0.7), y: window.innerHeight * (0.15 + Math.random() * 0.45) },
        { size: 'big' },
      );
      fired += 1;
    };
    fire();
    const timer = setInterval(() => (fired < BURSTS ? fire() : clearInterval(timer)), BURST_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const down = journey?.direction === 'down';
  return (
    <CelebrationDialog labelledBy={titleId} style={journey ? journeyStyle(journey) : undefined} onDone={done}>
      <div className="celebration__body">
        <span className="celebration__badge" aria-hidden="true">
          {journey?.emoji ?? '🏆'}
        </span>
        <h2 id={titleId} className="celebration__title">
          {down ? t.celebrateDown : t.celebrateUp}
        </h2>
        {journey && <p className="kid-lead">{fmt(t.celebrateBody, { journey: journey.title, steps: journey.steps })}</p>}
        <button ref={button} type="button" className="btn btn--big btn--accent" onClick={done}>
          {t.celebrateNext}
        </button>
      </div>
    </CelebrationDialog>
  );
}

/**
 * The full-screen celebration as a modal dialog, so it opens above any sheet that is open (a set
 * sheet stays open while the last book's read is confirmed) and the page behind stays still.
 * Escape counts as "done".
 */
function CelebrationDialog({
  labelledBy,
  style,
  onDone,
  className,
  children,
}: {
  labelledBy: string;
  style?: CSSProperties;
  onDone: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      onDoneRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.removeEventListener('cancel', cancel);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog ref={ref} className={`celebration${className ? ` ${className}` : ''}`} aria-labelledby={labelledBy} style={style}>
      {children}
    </dialog>
  );
}
