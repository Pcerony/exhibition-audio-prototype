import { useState } from 'react';
import { createConfiguredStaffRepository } from '../../storage/staffRepository';
import { StaffPage } from './StaffPage';
export default function StaffEntry() {
  const [repository] = useState(createConfiguredStaffRepository);
  return <StaffPage repository={repository} />;
}
