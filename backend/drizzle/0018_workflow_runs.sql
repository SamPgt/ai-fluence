CREATE TABLE "workflow_node_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"generation_id" uuid,
	"text" text,
	"cost" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"graph" jsonb NOT NULL,
	"estimated_cost" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "thread_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "workflow_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_node_results" ADD CONSTRAINT "workflow_node_results_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_results" ADD CONSTRAINT "workflow_node_results_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_results" ADD CONSTRAINT "workflow_node_results_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_node_results_node_idx" ON "workflow_node_results" USING btree ("workflow_id","node_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_workflow_idx" ON "generations" USING btree ("workflow_id","workflow_node_id");