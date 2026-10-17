import { useState } from 'react';
import { QrFallbackPage } from '../admin/QrFallbackPage';
import { createConfiguredStaffRepository } from '../../storage/staffRepository';

export default function StaffQrEntry() {
  const [repository] = useState(createConfiguredStaffRepository);
  return <QrFallbackPage repository={repository} loginMode="staff" backHref="#/staff" />;
}
