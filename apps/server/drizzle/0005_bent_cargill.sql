CREATE TABLE `mock_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mock_op` ON `mock_configs` (`project_id`,`method`,`path`);--> statement-breakpoint
CREATE TABLE `mock_state` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_mock_state` ON `mock_state` (`project_id`,`key`);--> statement-breakpoint
ALTER TABLE `projects` ADD `mock_enabled` integer DEFAULT false NOT NULL;