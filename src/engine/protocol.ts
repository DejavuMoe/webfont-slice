import type { SubsetRequest, SubsetResult } from '../app/ports';
import type { FontInspection } from '../core/font-inspection';

export type { SubsetRequest, SubsetResult };

export interface InspectOptions {
  /** 用两次实测子集化校准字形体积估算系数。 */
  readonly calibrate: boolean;
}

export interface EngineWorkerApi {
  inspect(file: File, options: InspectOptions): Promise<FontInspection>;
  open(key: string, file: File): Promise<void>;
  subset(key: string, request: SubsetRequest): Promise<SubsetResult>;
  close(): Promise<void>;
}
