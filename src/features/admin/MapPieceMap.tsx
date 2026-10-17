import { useEffect, useRef } from 'react';
import { MAP_PIECE_SIZE, mapPieceLabelPoint, mapPieces, type MapPieceCode } from '../../domain/mapPieces';

export function MapPieceMap({
  ariaLabel,
  selectedPiece,
  highlightedPiece,
  onSelect,
}: {
  ariaLabel: string;
  selectedPiece?: MapPieceCode;
  highlightedPiece?: MapPieceCode | null;
  onSelect: (piece: MapPieceCode) => void;
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
        role="button"
        tabIndex={0}
        aria-label={piece.code}
        aria-pressed={filtered}
        className={`piece-map-item${active ? ' is-highlighted' : ''}${filtered ? ' is-filtered' : ''}`}
        onClick={() => onSelect(piece.code)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(piece.code);
          }
        }}
      >
        <polygon points={points.map(([x, y]) => `${x},${y}`).join(' ')} />
        <text x={label[0]} y={label[1]} aria-hidden="true">{piece.code}</text>
      </g>;
    })}
  </svg>;
}
