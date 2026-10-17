import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { MemoryLocation } from '../../domain/location';
import { useI18n } from '../../i18n/I18nProvider';
import { mapLanguages } from '../../i18n/visitorMessages';
import { mountMemoryLocationMap,type MapPointWgs84 } from './googleMaps';

export function MemoryLocationMap({ location,onPoint }: { location: MemoryLocation;onPoint?:(point:MapPointWgs84)=>void }) {
  const { locale, t } = useI18n();
  const map = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    setState('loading');
    mountMemoryLocationMap({
      mapElement: map.current!, location, language: mapLanguages[locale],
      onPoint,
      onReady: () => { if (active) setState('ready'); },
      onError: () => { if (active) setState('failed'); },
    }).then(cleanup => {
      if (active) {
        dispose = cleanup;
      } else cleanup();
    }).catch(() => { if (active) setState('failed'); });
    return () => { active = false; dispose?.(); };
  }, [location, locale,onPoint]);

  return <div className="location-map-frame memory-location-map-frame">
    {state === 'failed'
      ? <p className="location-map-fallback" role="alert">{t('location.memoryUnavailable')}</p>
      : <>
        <div ref={map} className="location-map" role="region" aria-label={t('location.map')} />
        {state === 'ready'
          ? <MapPin className="location-pin" size={34} fill="white" aria-hidden="true" />
          : <p className="location-loading" role="status">{t('location.loading')}</p>}
      </>}
  </div>;
}
