ALTER TABLE `dsc_application` ADD `cert_type` text DEFAULT 'dsc' NOT NULL;--> statement-breakpoint
ALTER TABLE `dsc_application` ADD `lds2_types` text;--> statement-breakpoint
ALTER TABLE `dsc_cert` ADD `cert_type` text DEFAULT 'dsc' NOT NULL;--> statement-breakpoint
ALTER TABLE `dsc_cert` ADD `lds2_types` text;