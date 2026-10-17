import { useEffect, useRef } from 'react';
import { MAP_PIECE_SIZE, mapPieceLabelPoint, mapPieces, type MapPieceCode,type MapPoint } from '../../domain/mapPieces';

export function MapPieceMap({
  ariaLabel,
  selectedPiece,
  highlightedPiece,
  onSelect,
  point,
  pointLabel='Location',
}: {
  ariaLabel: string;
  selectedPiece?: MapPieceCode;
  highlightedPiece?: MapPieceCode | null;
  onSelect?: (piece: MapPieceCode) => void;
  point?:MapPoint|null;
  pointLabel?:string;
}) {
  const highlightedRef = useRef<SVGGElement | null>(null);
  useEffect(() => {
    highlightedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [highlightedPiece]);

  return <svg className="piece-map-svg" viewBox={`0 0 ${MAP_PIECE_SIZE[0]} ${MAP_PIECE_SIZE[1]}`} role="group" aria-label={ariaLabel}>
    {mapPieces.map((piece) => {
      const points = piece.geometry.coordinates[0];
      const label = mapPieceLabelPoint(piece);
      const active = piece.code === highlightedPiece;
      const filtered = piece.code === selectedPiece;
      return <g
        key={piece.code}
        ref={active ? highlightedRef : null}
        role={onSelect?'button':undefined}
        tabIndex={onSelect?0:undefined}
        aria-label={piece.code}
        aria-pressed={onSelect?filtered:undefined}
        className={`piece-map-item${active ? ' is-highlighted' : ''}${filtered ? ' is-filtered' : ''}`}
        onClick={onSelect?() => onSelect(piece.code):undefined}
        onKeyDown={(event) => {
          if (onSelect&&(event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onSelect(piece.code);
          }
        }}
      >
        <polygon points={points.map(([x, y]) => `${x},${MAP_PIECE_SIZE[1]-y}`).join(' ')} />
        <text x={label[0]} y={MAP_PIECE_SIZE[1]-label[1]} aria-hidden="true">{piece.code}</text>
      </g>;
    })}
    {point&&point.every(Number.isFinite)&&point[0]>=0&&point[1]>=0&&point[0]<=MAP_PIECE_SIZE[0]&&point[1]<=MAP_PIECE_SIZE[1]&&<circle className="piece-map-point" cx={point[0]} cy={MAP_PIECE_SIZE[1]-point[1]} r={13} aria-label={pointLabel}><title>{pointLabel}</title></circle>}
  </svg>;
}
