-- Mocks are keyed by the operation's `x-apione-id`, not by its address: method+path is something
-- the author edits, so a row holding one goes stale the moment the spec changes.
DROP INDEX IF EXISTS `uniq_mock_op`;--> statement-breakpoint
DROP TABLE `mock_configs`;--> statement-breakpoint
CREATE TABLE `mock_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`op_id` text NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mock_op` ON `mock_configs` (`project_id`,`op_id`);
