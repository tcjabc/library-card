import { fmt, strings } from '../strings';

/**
 * Gate questions: "What's nine times three?", factors 3-9. Written in words
 * so a child who can do sums but not read yet can't just tap the answer.
 */

export interface GateQuestion {
  a: number;
  b: number;
  text: string;
  answer: number;
}

const MIN_FACTOR = 3;
const MAX_FACTOR = 9;

function randomFactor(): number {
  const span = MAX_FACTOR - MIN_FACTOR + 1;
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return MIN_FACTOR + (n % span);
}

export function numberWord(n: number): string {
  const word = strings.numbers[n as keyof typeof strings.numbers];
  return word ?? String(n);
}

/** A new question, never the same pair as `previous`. */
export function newGateQuestion(previous?: GateQuestion | null): GateQuestion {
  for (;;) {
    const a = randomFactor();
    const b = randomFactor();
    const same = previous && ((previous.a === a && previous.b === b) || (previous.a === b && previous.b === a));
    if (same) continue;
    return { a, b, answer: a * b, text: fmt(strings.gate.question, { a: numberWord(a), b: numberWord(b) }) };
  }
}
