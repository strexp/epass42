CREATE TABLE `cvca_key` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holder_reference` text NOT NULL,
	`fingerprint_sha256` text NOT NULL,
	`authority_reference` text NOT NULL,
	`subject_cn` text,
	`key_algorithm` text NOT NULL,
	`cert_der` blob NOT NULL,
	`key_ref` text NOT NULL,
	`status` text DEFAULT 'current' NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`not_before` text,
	`not_after` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cvca_key_fingerprint_sha256_unique` ON `cvca_key` (`fingerprint_sha256`);--> statement-breakpoint
CREATE TABLE `dv_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mnt` text,
	`applicant_account_id` integer,
	`ip` text,
	`key_mode` text NOT NULL,
	`subject_cn` text,
	`holder_mnemonic` text,
	`csr_pem` text,
	`public_key_pem` text,
	`permissions_json` text,
	`validity_days` integer,
	`application_url` text,
	`notes` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`override_permissions_json` text,
	`reviewed_by` integer,
	`reviewed_at` text,
	`reject_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`applicant_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dv_cert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cvca_key_id` integer,
	`holder_reference` text NOT NULL,
	`authority_reference` text NOT NULL,
	`subject_cn` text,
	`mnt` text,
	`source` text NOT NULL,
	`cert_der` blob NOT NULL,
	`key_ref` text,
	`key_mode` text,
	`permissions_json` text,
	`application_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`not_before` text,
	`not_after` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cvca_key_id`) REFERENCES `cvca_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dv_cert_holder_reference_unique` ON `dv_cert` (`holder_reference`);