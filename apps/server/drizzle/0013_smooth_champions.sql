-- Workflow stage per operation. A side table, not a spec field: a PM moving 700 endpoints through
-- "done" must not rewrite the document or append 700 versions to the contract's history.
CREATE TABLE `operation_status` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`op_id` text NOT NULL,
	`stage` text DEFAULT 'design' NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_status_op` ON `operation_status` (`project_id`,`op_id`);