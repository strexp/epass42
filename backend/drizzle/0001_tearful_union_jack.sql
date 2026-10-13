ALTER TABLE `dsc_application` ADD `dsc_cert_id` integer REFERENCES dsc_cert(id);--> statement-breakpoint
ALTER TABLE `dv_application` ADD `dv_cert_id` integer REFERENCES dv_cert(id);