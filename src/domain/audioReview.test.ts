import { describe, expect, it } from 'vitest';
import { audioReviewFlags } from './audioReview';

describe('audioReviewFlags', () => {
  it('flags short and long audio using measured duration', () => {
    expect(audioReviewFlags({ measuredDuration: 4, reportedDuration: 4 })).toContain('short');
    expect(audioReviewFlags({ measuredDuration: 120, reportedDuration: 120 })).toContain('long');
  });
  it('flags mismatched durations and very quiet audio', () => {
    expect(audioReviewFlags({ measuredDuration: 40, reportedDuration: 5, meanDb: -50 })).toEqual(['durationMismatch', 'quiet']);
  });
  it('does not interpret missing measurements as silence or zero duration', () => {
    expect(audioReviewFlags({ reportedDuration: 30 })).toEqual([]);
  });
});
