ALTER TABLE "workflow_runs" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;