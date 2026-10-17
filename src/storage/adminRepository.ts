import type { Tag } from '../domain/tags';
import type { TranscriptionResult } from '../domain/transcription';

export type ProvisioningJob = {
  id: string; tagId: string; label: string; batch: string; visitorUrl: string;
  version: number; status: 'pending' | 'verified' | 'failed'; errorCode: string | null;
  categoryId?: string | null; recordingStatus?: 'unbound' | 'bound' | 'disabled';
  categoryCode?: Tag['categoryCode']; batchDate?: string | null; serialNumber?: string | null; inventoryLabel?: string;
  tagVersion?: number; leased?: boolean; leaseExpiresAt?: string | null;
};
export type Category = { id: string; name: string; code: string; nextNumber: number };
export type BulkOperation = 'move' | 'delete' | 'reset';
export type BulkCard = { id: string; version: number; label: string };
export type BulkGroup = { kind: 'empty' | 'recorded'; cards: BulkCard[]; recordingCount: number };
export type BulkApply = { operation: BulkOperation; cards: BulkCard[]; kind: BulkGroup['kind']; targetCategoryId?: string; requestKey: string };
export type AdminTranscriptionState = 'not_consented' | 'pending' | 'processing' | 'draft' | 'published' | 'failed';
export type AdminTranscriptionSummary = {
  consented: boolean;
  status: 'pending' | 'processing' | 'ready' | 'failed' | null;
  published: boolean;
};
export type PieceAssignmentState = 'not_applicable' | 'pending' | 'assigned' | 'needs_review' | 'outside_map';
export type PieceAssignmentSource = 'automatic' | 'manual' | null;
export type PieceAssignmentSummary = {
  state: PieceAssignmentState; pieceCode: string | null; source: PieceAssignmentSource;
  mapVersion: string | null; version: number; updatedAt: string | null;
};
export type PieceAssignmentUpdate = {
  recordingId: string; expectedVersion: number;
  state: 'assigned' | 'needs_review' | 'outside_map'; pieceCode: string | null; mapVersion: string;
};
export type ManagedRecording = NonNullable<Tag['recording']> & { transcriptionSummary?: AdminTranscriptionSummary; pieceAssignment?: PieceAssignmentSummary };
export type ManagedTag = Omit<Tag, 'recording'> & { recording: ManagedRecording | null; provisioning: ProvisioningJob | null; attachment?: Pick<ProvisioningJob, 'status'> | null; entryChannel?: 'nfc' | 'qr'; version?: number };
export type OperatorSession = { userId: string; email?: string; role: 'operator' | 'admin' };
export type QrEntry = { id: string; label: string; visitorUrl: string; entryChannel: 'qr' };
export type TagQuery = { search?: string; status?: 'unbound' | 'bound' | 'disabled'; transcriptionState?: AdminTranscriptionState; pieceCode?: string; offset?: number; limit?: number; categoryId?: string; batchDate?: string; uncategorized?: boolean; sort?: 'recorded_desc' | 'recorded_asc' | 'number' };
export type AuditEntry = { id: string | number; operatorId: string; action: string; tagId: string | null; createdAt: string; details?: Record<string, unknown> | null };
export interface AdminRepository {
  getTranscription(recordingId: string): Promise<TranscriptionResult>;
  retryTranscription(recordingId: string, version: number): Promise<void>;
  saveTranscription(recordingId: string, version: number, text: string, published: boolean): Promise<void>;
  listCategories(): Promise<Category[]>;
  createCategory(name: string, requestKey: string): Promise<Category>;
  renameCategory(categoryId: string, name: string): Promise<void>;
  createQrEntry(requestKey: string): Promise<QrEntry>;
  createCards(count: number, requestKey: string): Promise<{ tags: ManagedTag[] }>;
  previewBulk(tagIds: string[], operation: BulkOperation, targetCategoryId?: string): Promise<{ groups: BulkGroup[] }>;
  applyBulk(input: BulkApply): Promise<void>;
  getSession(): Promise<OperatorSession | null>;
  signIn(email: string, password: string): Promise<OperatorSession>;
  signOut(): Promise<void>;
  listTags(query?: TagQuery): Promise<{ tags: ManagedTag[]; total: number }>;
  setPieceAssignment(input: PieceAssignmentUpdate): Promise<PieceAssignmentSummary>;
  createBatch(rows: { label: string; batch: string }[], requestKey: string): Promise<{ tags: ManagedTag[] }>;
  resetTag(tagId: string): Promise<void>;
  setEnabled(tagId: string, enabled: boolean): Promise<void>;
  getPlaybackUrl(recordingId: string): Promise<string>;
  listJobs(query?: { batch?: string; categoryId?: string; status?: ProvisioningJob['status'] }): Promise<ProvisioningJob[]>;
  provision(job: ProvisioningJob, status: 'verified' | 'failed', leaseToken: string, errorCode?: string): Promise<void>;
  getAudit(): Promise<AuditEntry[]>;
  maintenance(): Promise<{ removed: number; pending: number }>;
}
