import type {
  BackgroundJob,
  BackgroundJobErrorClass,
  BackgroundJobType,
  EnqueueBackgroundJob,
} from "../../background-jobs.js";

export interface BackgroundJobPort {
  enqueue(input: EnqueueBackgroundJob): Promise<BackgroundJob>;
  leaseByDedupeKey(
    jobType: BackgroundJobType,
    dedupeKey: string,
    workerId: string,
    now: Date,
  ): Promise<BackgroundJob | null>;
  complete(jobId: string, workerId: string, now: Date): Promise<BackgroundJob>;
  fail(
    jobId: string,
    workerId: string,
    errorClass: BackgroundJobErrorClass,
    now: Date,
  ): Promise<BackgroundJob>;
}
