import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, MapPin } from 'lucide-react';
import { memoryLocationUrl, parseMemoryLocation, type MemoryLocation, type MapPoint } from '../../domain/location';
import { mountMemoryLocationMap } from '../visitor/googleMaps';

function parse(hash: string) {
  const params = new URLSearchParams(hash.split('?')[1]);
  let location: MemoryLocation | null = null;
  try { location = parseMemoryLocation(JSON.parse(params.get('location') ?? 'null')); } catch { /* Invalid preview. */ }
  const language: 'ja' | 'zh' | 'en' = params.get('lang') === 'zh' ? 'zh' : params.get('lang') === 'en' ? 'en' : 'ja';
  return { location, language, pick: params.get('pick') === '1' && location?.source === 'place' } as const;
}

export default function AndroidLocationMap({ hash }: { hash: string }) {
  const [{ location, language, pick }] = useState(() => parse(hash));
  const map = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const googleUrl = memoryLocationUrl(location);
  const strings = {
    ja: ['Google マップで開く', '地図上の地点をタップ', 'この地点を確定', '地図を表示できません', '読み込み中'],
    zh: ['在 Google 地图打开', '点选地图上的位置', '确认此点', '无法显示地图', '加载中'],
    en: ['Open in Google Maps', 'Tap a point on the map', 'Confirm point', 'Map unavailable', 'Loading'],
  }[language];
  useEffect(() => {
    if (!location || !map.current) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    mountMemoryLocationMap({
      mapElement: map.current, location, language: language === 'zh' ? 'zh-CN' : language,
      onReady: () => { if (active) setStatus('ready'); },
      onError: () => { if (active) setStatus('failed'); },
      onPick: pick ? setSelected : undefined,
      onOpen: !pick && googleUrl ? () => window.location.assign(googleUrl) : undefined,
    }).then(dispose => { if (active) cleanup = dispose; else dispose(); })
      .catch(() => { if (active) setStatus('failed'); });
    return () => { active = false; cleanup?.(); };
  }, [location, language, pick, googleUrl]);
  const confirm = selected && new URLSearchParams({ confirmLat: String(selected.lat), confirmLng: String(selected.lng) });
  return <main className="android-location-map">
    <div ref={map} className="android-location-canvas" role="region" aria-label="Google Maps" />
    {status === 'ready' && !pick && <MapPin className="location-pin" size={32} fill="white" aria-hidden="true" />}
    {(!location || status !== 'ready') && <p role="status">{!location || status === 'failed' ? strings[3] : strings[4]}</p>}
    {pick
      ? status === 'ready' && (confirm ? <a href={`./?${confirm}`}><Check size={16} />{strings[2]}</a> : <p>{strings[1]}</p>)
      : googleUrl && <a href={googleUrl}><ArrowUpRight size={16} />{strings[0]}</a>}
  </main>;
}
