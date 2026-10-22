PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_issuing_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issuing_state` text NOT NULL,
	`issuing_authority` text,
	`personalization_device` text,
	`dg13_policy` text,
	`endorsements_json` text,
	`defaults_json` text,
	`updated_by` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_issuing_profile`("id", "issuing_state", "issuing_authority", "personalization_device", "dg13_policy", "endorsements_json", "defaults_json", "updated_by", "updated_at") SELECT "id", "issuing_state", "issuing_authority", "personalization_device", "dg13_policy", "endorsements_json", "defaults_json", "updated_by", "updated_at" FROM `issuing_profile`;--> statement-breakpoint
DROP TABLE `issuing_profile`;--> statement-breakpoint
ALTER TABLE `__new_issuing_profile` RENAME TO `issuing_profile`;--> statement-breakpoint
PRAGMA foreign_keys=ON;