CREATE TABLE `terminal_cert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dv_cert_id` integer,
	`holder_reference` text NOT NULL,
	`authority_reference` text NOT NULL,
	`subject_cn` text,
	`mnt` text,
	`source` text NOT NULL,
	`cert_der` blob NOT NULL,
	`key_ref` text,
	`key_mode` text,
	`permissions_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`not_before` text,
	`not_after` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`dv_cert_id`) REFERENCES `dv_cert`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_cert_holder_reference_unique` ON `terminal_cert` (`holder_reference`);