import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  src: string;
  purpose: 'recording' | 'preview';
  onPlaybackError?: () => void;
};

export function VisitorAudioPlayer({ src, purpose, onPlaybackError }: Props) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const preview = purpose === 'preview';
  const actionLabel = playing
    ? t('visitor.pause')
    : ended
      ? t(preview ? 'visitor.replayPreview' : 'visitor.replay')
      : t(preview ? 'visitor.preview' : 'visitor.player');

  useEffect(() => {
    const audio = audioRef.current;
    return () => { audio?.pause(); };
  }, []);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (ended) audio.currentTime = 0;
    setFailed(false);
    try {
      await audio.play();
      setPlaying(true);
      setEnded(false);
    } catch {
      setPlaying(false);
      setFailed(true);
      onPlaybackError?.();
    }
  }

  function seek(value: string) {
    const nextTime = Number(value);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function handleError() {
    setPlaying(false);
    setFailed(true);
    onPlaybackError?.();
  }

  return <div className="visitor-audio-player" data-purpose={purpose}>
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
      onLoadStart={() => { setPlaying(false); setEnded(false); setFailed(false); setCurrentTime(0); setDuration(0); }}
      onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={event => { setPlaying(false); setEnded(true); setCurrentTime(event.currentTarget.currentTime); }}
      onError={handleError}
    />
    <button className="visitor-audio-toggle" type="button" onClick={() => void togglePlayback()} aria-label={actionLabel} aria-pressed={playing}>
      {playing ? <Pause size={30} fill="currentColor" aria-hidden="true" /> : ended ? <RotateCcw size={30} aria-hidden="true" /> : <Play size={30} fill="currentColor" aria-hidden="true" />}
      <span>{actionLabel}</span>
    </button>
    <div className="visitor-audio-timeline">
      <span className="visitor-audio-time">{formatAudioTime(currentTime)}</span>
      <input
        type="range"
        min="0"
        max={Math.max(duration, 0)}
        step="0.1"
        value={Math.min(currentTime, duration)}
        disabled={!duration}
        aria-label={t('visitor.seek')}
        aria-valuetext={formatAudioTime(currentTime)}
        onChange={event => seek(event.target.value)}
      />
      <span className="visitor-audio-time">{formatAudioTime(duration)}</span>
    </div>
    {failed && !onPlaybackError && <p className="visitor-audio-error" role="alert">{t('visitor.playbackFailed')}</p>}
  </div>;
}

function formatAudioTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
