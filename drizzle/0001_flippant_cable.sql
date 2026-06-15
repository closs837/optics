CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`name` text NOT NULL,
	`parameters` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scenarios_watch` ON `scenarios` (`watch_id`);