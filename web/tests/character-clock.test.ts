import { describe, expect, it } from 'vitest';
import { ProofClock } from '../src/render/character/clock.js';

describe('appearance proof clock', () => {
  it('preserves travel and phase when pausing after several cycles', () => {
    const c = new ProofClock(); c.play(true);
    for (let i=0;i<137;i++) c.advance(16);
    const before=c.time;
    c.play(false); c.advance(1000); expect(c.time).toBe(before);
    c.play(true); expect(c.time).toBe(before); c.advance(10); expect(c.time).toBeCloseTo(before+.1,8);
  });
  it('resumes from a manually stepped phase and agrees across display rates', () => {
    const c=new ProofClock(); c.step(.5); c.step(.5); expect(c.time).toBe(1);
    c.play(true); c.advance(50); expect(c.time).toBeCloseTo(1.5,8);
    const a=new ProofClock(),b=new ProofClock();a.play(true);b.play(true);
    for(let i=0;i<60;i++)a.advance(1000/60);
    for(let i=0;i<30;i++)b.advance(1000/30);
    expect(a.time).toBeCloseTo(b.time,8);
  });
});
