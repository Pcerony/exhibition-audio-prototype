import { useEffect, useRef, useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import type { MemoryLocation } from '../../domain/location';
import { useI18n } from '../../i18n/I18nProvider';
import { mountLocationMap } from './googleMaps';

export function LocationPicker({ onDone }: { onDone: (location: MemoryLocation | null) => void }) {
  const { locale, t } = useI18n();
  const map = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MemoryLocation | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    mountLocationMap({
      mapElement: map.current!, searchElement: search.current!, language: locale === 'ja-JP' ? 'ja' : 'zh-CN',
      onSelect: (location) => { if (active) setSelected(location); },
      onError: () => { if (active) setFailed(true); },
    }).then((cleanup) => { if (active) { dispose = cleanup; setReady(true); } else cleanup(); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; dispose?.(); };
  }, []);
  return <section className="location-picker">
    <h1>{t('location.title')}</h1>
    <div ref={search} className="location-search" />
    <div className="location-map-frame">
      <div ref={map} className="location-map" aria-label={t('location.map')} />
      {ready && <MapPin className="location-pin" size={34} fill="white" aria-hidden="true" />}
      {!ready && !failed && <p className="location-loading" role="status">{t('location.loading')}</p>}
    </div>
    {failed && <p className="inline-error" role="alert">{t('location.failed')}</p>}
    <div className="location-actions">
      <button className="primary-action" disabled={!selected} onClick={() => onDone(selected)}><Check size={18} />{t('location.confirm')}</button>
      <button className="secondary-action" onClick={() => onDone(null)}>{t('location.skip')}</button>
    </div>
    <p className="privacy-note">{t('location.notice')}</p>
  </section>;
}
