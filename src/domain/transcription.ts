export type Transcription = {
  recordingId: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  text: string | null;
  published: boolean;
  version: number;
  errorCode: string | null;
  updatedAt: string;
};

export type TranscriptionResult = {
  configured: boolean;
  consented: boolean;
  transcription: Transcription | null;
};
