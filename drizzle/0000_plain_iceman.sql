CREATE TABLE `trace_cloud_cases` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `trace_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trace_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`reset_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trace_monitor_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`query` text NOT NULL,
	`sources` text NOT NULL,
	`interval_hours` integer NOT NULL,
	`case_id` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`snapshot` text DEFAULT '[]' NOT NULL,
	`has_baseline` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_run_at` text,
	`next_run_at` text NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`lease_until` text,
	FOREIGN KEY (`user_id`) REFERENCES `trace_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trace_monitor_owner_idx` ON `trace_monitor_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `trace_monitor_due_idx` ON `trace_monitor_jobs` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `trace_monitor_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`monitor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`removed_count` integer DEFAULT 0 NOT NULL,
	`request_id` text,
	`summary` text NOT NULL,
	`items` text NOT NULL,
	FOREIGN KEY (`monitor_id`) REFERENCES `trace_monitor_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trace_monitor_runs_job_idx` ON `trace_monitor_runs` (`monitor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `trace_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `trace_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trace_sessions_user_idx` ON `trace_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `trace_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trace_users_username_unique` ON `trace_users` (`username`);