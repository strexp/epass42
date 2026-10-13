ALTER TABLE `dv_application` ADD `dv_class` text DEFAULT 'domestic' NOT NULL;--> statement-breakpoint
ALTER TABLE `dv_application` ADD `override_dv_class` text;--> statement-breakpoint
ALTER TABLE `dv_cert` ADD `dv_class` text DEFAULT 'domestic' NOT NULL;