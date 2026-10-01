import type { Tag } from '../domain/tags';

export type ProvisioningJob = {
  id: string; tagId: string; label: string; batch: string; visitorUrl: string;
  version: number; status: 'pending' | 'verified' | 'failed'; errorCode: string | null;
};
export type ManagedTag = Tag & { provisioning: ProvisioningJob | null };
export type OperatorSession = { userId: string; email?: string; role: 'operator' | 'admin' };
export type TagQuery = { search?: string; status?: 'unbound' | 'bound' | 'disabled'; offset?: number; limit?: number };
export type AuditEntry = { id: string | number; operatorId: string; action: string; tagId: string | null; createdAt: string };
export interface AdminRepository {
  getSession(): Promise<OperatorSession | null>;
  signIn(email: string, password: string): Promise<OperatorSession>;
  signOut(): Promise<void>;
  listTags(query?: TagQuery): Promise<{ tags: ManagedTag[]; total: number }>;
  createBatch(rows: { label: string; batch: string }[], requestKey: string): Promise<{ tags: ManagedTag[] }>;
  resetTag(tagId: string): Promise<void>;
  setEnabled(tagId: string, enabled: boolean): Promise<void>;
  getPlaybackUrl(recordingId: string): Promise<string>;
  listJobs(query?: { batch?: string; status?: ProvisioningJob['status'] }): Promise<ProvisioningJob[]>;
  provision(job: ProvisioningJob, status: 'verified' | 'failed', errorCode?: string): Promise<void>;
  getAudit(): Promise<AuditEntry[]>;
  maintenance(): Promise<{ removed: number; pending: number }>;
}
