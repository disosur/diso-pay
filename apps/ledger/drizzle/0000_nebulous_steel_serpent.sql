CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_transaction_sequence_unique` ON `events` (`transaction_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_idempotency_key_unique` ON `events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `events_transaction_id_index` ON `events` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `events_type_index` ON `events` (`type`);