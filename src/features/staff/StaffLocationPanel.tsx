import { useMemo, useState } from 'react';
import { ArrowUp, ExternalLink, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import type { StaffCard } from '../../storage/staffRepository';
import { memoryLocationUrl } from '../../domain/location';
import {
  classifyMapLocation,
  projectLocationToMapMm,
} from '../../domain/mapPieceAssignment';
import { MapPieceMap } from '../admin/MapPieceMap';
import { MemoryLocationMap } from '../visitor/MemoryLocationMap';
import type { MapPointWgs84 } from '../visitor/googleMaps';
import type { StaffMessages } from './staffMessages';

export default function StaffLocationPanel({
  card,
  m,
}: {
  card: StaffCard;
  m: StaffMessages;
}) {
  const location = card.recording?.location;
  const [point, setPoint] = useState<MapPointWgs84 | null>(
      location?.source === 'pin' ? location : null,
    ),
    [zoom, setZoom] = useState(1);
  const projected = useMemo(
    () => (point ? projectLocationToMapMm(point) : null),
    [point],
  );
  const computed = useMemo(
    () => (point ? classifyMapLocation(point) : null),
    [point],
  );
  const saved = card.recording?.pieceAssignment;
  const assignment =
    saved?.source === 'manual' ||
    saved?.pieceCode ||
    saved?.state === 'outside_map'
      ? saved
      : (computed ?? saved);
  const pieceCode = assignment?.pieceCode;
  const state = assignment?.state;
  const source = saved?.source === 'manual' ? m.manual : m.estimate;
  return (
    <div className="staff-location-panel">
      {location ? (
        <>
          <MemoryLocationMap location={location} onPoint={setPoint} />
          <a
            className="staff-map-link"
            href={memoryLocationUrl(location)!}
            target="_blank"
            rel="noreferrer"
          >
            {m.openGoogle}
            <ExternalLink size={15} />
          </a>
        </>
      ) : (
        <p className="staff-empty">{m.noLocation}</p>
      )}
      <div className="staff-map-heading">
        <h3>{m.map}</h3>
        <span>
          <ArrowUp size={15} />N
        </span>
      </div>
      <div className="staff-piece-summary">
        <strong>{pieceCode ?? '—'}</strong>
        <span>
          {state === 'outside_map'
            ? m.outside
            : state === 'needs_review'
              ? m.needsReview
              : pieceCode
                ? source
                : !location
                  ? m.noLocation
                  : m.pendingMap}
        </span>
        {(pieceCode || saved?.source) && state === 'needs_review' && (
          <small>{source}</small>
        )}
      </div>
      <div className="staff-board-tools">
        {[
          {
            label: m.zoomOut,
            Icon: ZoomOut,
            action: () => setZoom((value) => Math.max(1, value - 0.5)),
            disabled: zoom === 1,
          },
          {
            label: m.zoomIn,
            Icon: ZoomIn,
            action: () => setZoom((value) => Math.min(3, value + 0.5)),
            disabled: zoom === 3,
          },
          {
            label: m.fit,
            Icon: Maximize,
            action: () => setZoom(1),
            disabled: false,
          },
        ].map(({ label, Icon, action, disabled }) => (
          <button
            className="staff-icon"
            key={label}
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={action}
          >
            <Icon size={17} />
          </button>
        ))}
      </div>
      <div className="staff-board-viewport">
        <div style={{ width: `${zoom * 100}%` }}>
          <MapPieceMap
            ariaLabel={m.map}
            highlightedPiece={pieceCode}
            point={projected}
            pointLabel={m.selectedPoint}
          />
        </div>
      </div>
    </div>
  );
}
