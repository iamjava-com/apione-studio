-- Groups are organisation only — no members, no permissions. `projects.group_id` is nullable and
-- null means ungrouped, so existing projects need no backfill and the list stays exactly as it was.
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `group_id` text REFERENCES groups(id);