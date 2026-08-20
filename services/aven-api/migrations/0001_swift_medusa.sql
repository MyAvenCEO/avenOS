CREATE TABLE "task_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"label" text NOT NULL,
	"payload_encrypted" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_secrets" ADD CONSTRAINT "task_secrets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_secrets" ADD CONSTRAINT "task_secrets_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_secrets_task_label_unique" ON "task_secrets" USING btree ("task_id","label");--> statement-breakpoint
CREATE INDEX "task_secrets_owner_idx" ON "task_secrets" USING btree ("owner_user_id");