CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`rule_id` text,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	`block_number` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_watch_time` ON `alerts` (`watch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`metric` text NOT NULL,
	`comparison` text NOT NULL,
	`threshold` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`was_matching` integer DEFAULT 0 NOT NULL,
	`last_triggered_at` integer,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rules_watch` ON `rules` (`watch_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`block_number` text NOT NULL,
	`observed_at` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_snapshots_watch_block` ON `snapshots` (`watch_id`,`block_number`);--> statement-breakpoint
CREATE INDEX `idx_snapshots_watch_time` ON `snapshots` (`watch_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `watches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`address` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_polled_at` integer,
	`last_error` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_watches_owner_address` ON `watches` (`owner_id`,`address`);