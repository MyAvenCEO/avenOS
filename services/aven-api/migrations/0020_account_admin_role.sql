ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role" CHECK ("role" IN ('user','admin'));
