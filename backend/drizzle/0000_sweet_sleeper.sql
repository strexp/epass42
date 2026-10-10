CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`realm` text NOT NULL,
	`provider_id` integer,
	`subject` text NOT NULL,
	`active_mnt` text,
	`email` text,
	`name` text,
	`raw_claims` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `oauth_provider`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_account` ON `account` (`realm`,`provider_id`,`subject`);--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer,
	`enc` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_account_id` integer,
	`realm` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`ip` text,
	`user_agent` text,
	`detail` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `crl` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`csca_key_id` integer,
	`crl_number` integer NOT NULL,
	`this_update` text NOT NULL,
	`next_update` text NOT NULL,
	`der` blob NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`csca_key_id`) REFERENCES `csca_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `csca_key` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serial` text NOT NULL,
	`subject_dn` text NOT NULL,
	`key_algorithm` text NOT NULL,
	`not_before` text,
	`not_after` text,
	`cert_pem` text NOT NULL,
	`key_ref` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csca_key_serial_unique` ON `csca_key` (`serial`);--> statement-breakpoint
CREATE TABLE `dsc_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mnt` text,
	`applicant_account_id` integer,
	`ip` text,
	`key_mode` text NOT NULL,
	`subject_cn` text,
	`csr_pem` text,
	`public_key_pem` text,
	`document_type` text,
	`validity_days` integer,
	`issuance_policy` text,
	`application_url` text,
	`notes` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` text,
	`reject_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`applicant_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dsc_cert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`csca_key_id` integer,
	`serial` text NOT NULL,
	`subject_dn` text NOT NULL,
	`mnt` text,
	`source` text NOT NULL,
	`cert_pem` text NOT NULL,
	`key_ref` text,
	`key_mode` text,
	`issuance_policy` text,
	`application_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`not_before` text,
	`not_after` text,
	`revoked_at` text,
	`revoke_reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`csca_key_id`) REFERENCES `csca_key`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dsc_cert_serial_unique` ON `dsc_cert` (`serial`);--> statement-breakpoint
CREATE TABLE `issuing_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issuing_state` text DEFAULT 'UDN' NOT NULL,
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
CREATE TABLE `mail_token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`sign_request_reference` text,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `maintainer` (
	`mnt` text NOT NULL,
	`realm` text NOT NULL,
	`role` text NOT NULL,
	`note` text,
	PRIMARY KEY(`mnt`, `realm`, `role`)
);
--> statement-breakpoint
CREATE TABLE `master_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`signer_dsc_id` integer,
	`der` blob NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mnt_config` (
	`mnt` text PRIMARY KEY NOT NULL,
	`use_nia_dsc` integer DEFAULT false NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_flow` (
	`state` text PRIMARY KEY NOT NULL,
	`realm` text NOT NULL,
	`provider_id` integer NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_to` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_oauth_flow_expires` ON `oauth_flow` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_provider` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`realm` text NOT NULL,
	`issuer` text NOT NULL,
	`client_id` text NOT NULL,
	`scopes` text,
	`claim_map` text,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_oauth_provider` ON `oauth_provider` (`realm`,`issuer`,`client_id`);--> statement-breakpoint
CREATE TABLE `reveal_token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`sign_request_reference` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`sign_request_reference`) REFERENCES `sign_request`(`reference`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`realm` text NOT NULL,
	`account_id` integer,
	`data` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_session_expires` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sign_request` (
	`reference` text PRIMARY KEY NOT NULL,
	`requester_account_id` integer,
	`mnt` text,
	`ip` text,
	`dsc_selection` text NOT NULL,
	`dsc_cert_id` integer,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`delivery_mode` text DEFAULT 'applicant' NOT NULL,
	`profile_overrides` text,
	`result_artifact_id` text,
	`email` text,
	`reviewed_by` integer,
	`reviewed_at` text,
	`reject_reason` text,
	`consumed_at` text,
	`consumed_by` integer,
	`consumed_channel` text,
	`regenerated_from` text,
	`created_at` text NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`requester_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dsc_cert_id`) REFERENCES `dsc_cert`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`result_artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `system_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `ux_sign_request_mrz` ON `sign_request` (`mnt`, json_extract(`payload_json`, '$.mrz.documentNumber'));
