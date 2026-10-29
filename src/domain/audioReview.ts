export type AudioReviewFlag = 'short' | 'long' | 'durationMismatch' | 'quiet';

export function audioReviewFlags(input: { measuredDuration?: number; reportedDuration?: number; meanDb?: number }): AudioReviewFlag[] {
  const flags: AudioReviewFlag[] = [];
  const measured = input.measuredDuration;
  if (measured != null && Number.isFinite(measured) && measured > 0) {
    if (measured <= 5) flags.push('short');
    if (measured >= 120) flags.push('long');
    if (input.reportedDuration != null && Number.isFinite(input.reportedDuration) && Math.abs(measured - input.reportedDuration) > Math.max(5, measured * 0.2)) flags.push('durationMismatch');
  }
  if (input.meanDb != null && Number.isFinite(input.meanDb) && input.meanDb <= -45) flags.push('quiet');
  return flags;
}
