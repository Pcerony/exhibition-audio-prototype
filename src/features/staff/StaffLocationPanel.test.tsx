import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import StaffLocationPanel from './StaffLocationPanel';
import { staffMessages } from './staffMessages';
import type { StaffCard } from '../../storage/staffRepository';
vi.mock('../visitor/MemoryLocationMap', () => ({
  MemoryLocationMap: () => <div>map</div>,
}));
it('preserves an administrator manual unresolved assignment instead of replacing it with a computed board', () => {
  const card: StaffCard = {
    id: 'tag',
    label: 'TEST',
    inventoryLabel: 'TEST',
    createdAt: '2026-10-17',
    status: 'bound',
    categoryCode: null,
    recording: {
      id: 'recording',
      duration: 1,
      createdAt: '2026-10-17',
      transcriptionConsent: true,
      transcription: null,
      latestReview: null,
      location: { source: 'pin', lat: 33.5912638547, lng: 130.3986370049 },
      pieceAssignment: {
        state: 'needs_review',
        pieceCode: null,
        source: 'manual',
        version: 2,
        mapVersion: 'fukuoka-road-73-v13',
        updatedAt: null,
      },
    },
  };
  const { container } = render(
    <StaffLocationPanel card={card} m={staffMessages['zh-CN']} />,
  );
  expect(screen.getByText('需核对')).toBeVisible();
  expect(screen.getByText('人工修正')).toBeVisible();
  expect(container.querySelector('.is-highlighted')).toBeNull();
});
