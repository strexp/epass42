PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mnt_config` (
	`mnt` text PRIMARY KEY NOT NULL,
	`use_nia_dsc` integer DEFAULT true NOT NULL,
	`use_nia_dv` integer DEFAULT true NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mnt_config`("mnt", "use_nia_dsc", "updated_by", "updated_at") SELECT "mnt", "use_nia_dsc", "updated_by", "updated_at" FROM `mnt_config`;--> statement-breakpoint
DROP TABLE `mnt_config`;--> statement-breakpoint
ALTER TABLE `__new_mnt_config` RENAME TO `mnt_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;