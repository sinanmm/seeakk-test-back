-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `description` VARCHAR(191) NULL,
    `isSystemRole` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `roles_workspaceId_idx`(`workspaceId`),
    INDEX `roles_workspaceId_status_idx`(`workspaceId`, `status`),
    UNIQUE INDEX `roles_workspaceId_name_key`(`workspaceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `group` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `logoUrl` TEXT NULL,
    `employeeCount` VARCHAR(191) NOT NULL,
    `timeZone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `language` VARCHAR(191) NOT NULL DEFAULT 'en-US',
    `currencyLocale` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `loadSampleData` BOOLEAN NOT NULL DEFAULT false,
    `weeklyOffDays` JSON NOT NULL,
    `weeklyOffColor` VARCHAR(191) NOT NULL DEFAULT '#cbd5e1',
    `ownerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workspaces_ownerId_key`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `workspaceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `departments_workspaceId_idx`(`workspaceId`),
    INDEX `departments_name_idx`(`name`),
    INDEX `departments_status_idx`(`status`),
    INDEX `departments_createdAt_idx`(`createdAt`),
    INDEX `departments_workspaceId_deletedAt_status_createdAt_idx`(`workspaceId`, `deletedAt`, `status`, `createdAt` DESC),
    UNIQUE INDEX `departments_name_workspaceId_key`(`name`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_sources` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `lead_sources_workspaceId_idx`(`workspaceId`),
    INDEX `lead_sources_name_idx`(`name`),
    INDEX `lead_sources_status_idx`(`status`),
    INDEX `lead_sources_workspaceId_status_createdAt_idx`(`workspaceId`, `status`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_stages` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `stageShortForm` VARCHAR(191) NULL,
    `showInCalendar` BOOLEAN NOT NULL DEFAULT true,
    `color` VARCHAR(191) NOT NULL DEFAULT '#10b981',
    `isApprovalRequired` BOOLEAN NOT NULL DEFAULT false,
    `isLOB` BOOLEAN NOT NULL DEFAULT false,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `lead_stages_workspaceId_idx`(`workspaceId`),
    INDEX `lead_stages_name_idx`(`name`),
    INDEX `lead_stages_status_idx`(`status`),
    INDEX `lead_stages_order_idx`(`order`),
    INDEX `lead_stages_workspaceId_status_order_idx`(`workspaceId`, `status`, `order`),
    UNIQUE INDEX `lead_stages_workspaceId_name_key`(`workspaceId`, `name`),
    UNIQUE INDEX `lead_stages_workspaceId_stageShortForm_key`(`workspaceId`, `stageShortForm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stage_rules` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT 'Untitled Rule',
    `inputType` ENUM('TEXT', 'TEXTAREA', 'RADIO', 'SELECT') NOT NULL DEFAULT 'TEXT',
    `options` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 1,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `field` VARCHAR(191) NULL,
    `condition` VARCHAR(191) NULL,
    `value` VARCHAR(191) NULL,
    `isMandatory` BOOLEAN NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `stageId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `stage_rules_workspaceId_idx`(`workspaceId`),
    INDEX `stage_rules_name_idx`(`name`),
    INDEX `stage_rules_status_idx`(`status`),
    INDEX `stage_rules_sortOrder_idx`(`sortOrder`),
    INDEX `stage_rules_stageId_idx`(`stageId`),
    INDEX `stage_rules_workspaceId_status_sortOrder_idx`(`workspaceId`, `status`, `sortOrder`),
    UNIQUE INDEX `stage_rules_workspaceId_name_key`(`workspaceId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_stage_inputs` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `ruleId` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_stage_inputs_leadId_idx`(`leadId`),
    INDEX `lead_stage_inputs_ruleId_idx`(`ruleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offices` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `countryId` VARCHAR(191) NULL,
    `stateId` VARCHAR(191) NULL,
    `districtId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `offices_workspaceId_idx`(`workspaceId`),
    INDEX `offices_name_idx`(`name`),
    INDEX `offices_countryId_idx`(`countryId`),
    INDEX `offices_stateId_idx`(`stateId`),
    INDEX `offices_districtId_idx`(`districtId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `countries` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `countries_workspaceId_idx`(`workspaceId`),
    INDEX `countries_workspaceId_isActive_createdAt_idx`(`workspaceId`, `isActive`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `location_levels` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `countryId` VARCHAR(191) NOT NULL,
    `levelName` VARCHAR(191) NOT NULL,
    `levelOrder` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `location_levels_workspaceId_idx`(`workspaceId`),
    INDEX `location_levels_countryId_isActive_levelOrder_idx`(`countryId`, `isActive`, `levelOrder`),
    UNIQUE INDEX `location_levels_countryId_levelOrder_key`(`countryId`, `levelOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `locations` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('COUNTRY', 'STATE', 'DISTRICT', 'CITY', 'WARD', 'CONSTITUENCY', 'OFFICE') NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `countryId` VARCHAR(191) NULL,
    `levelId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `locations_workspaceId_idx`(`workspaceId`),
    INDEX `locations_parentId_idx`(`parentId`),
    INDEX `locations_countryId_idx`(`countryId`),
    INDEX `locations_levelId_idx`(`levelId`),
    INDEX `locations_workspaceId_countryId_levelId_isActive_idx`(`workspaceId`, `countryId`, `levelId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_location_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_location_assignments_workspaceId_idx`(`workspaceId`),
    UNIQUE INDEX `user_location_assignments_userId_locationId_key`(`userId`, `locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_types` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `target_types_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_cycles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `totalDays` INTEGER NOT NULL DEFAULT 30,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `targetType` ENUM('WEEKLY', 'MONTHLY', 'SEMI_ANNUAL', 'MANUAL') NOT NULL DEFAULT 'MONTHLY',
    `targetMetric` ENUM('LEADS', 'REVENUE', 'FOLLOW_UP') NOT NULL DEFAULT 'LEADS',
    `leadStageId` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `numberOfMonths` INTEGER NULL,
    `lockingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `target_cycles_workspaceId_idx`(`workspaceId`),
    INDEX `target_cycles_workspaceId_status_idx`(`workspaceId`, `status`),
    INDEX `target_cycles_leadStageId_idx`(`leadStageId`),
    UNIQUE INDEX `target_cycles_name_workspaceId_key`(`name`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_cycle_periods` (
    `id` VARCHAR(191) NOT NULL,
    `targetCycleId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `periodIndex` INTEGER NOT NULL,
    `targetCount` INTEGER NOT NULL DEFAULT 0,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `lockingDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_cycle_periods_targetCycleId_idx`(`targetCycleId`),
    INDEX `target_cycle_periods_lockingDate_idx`(`lockingDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetCycleId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `supervisorId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `assignedById` VARCHAR(191) NULL,
    `graceUntil` DATETIME(3) NULL,
    `isLockExempt` BOOLEAN NOT NULL DEFAULT false,
    `exemptUntilPeriodEnd` DATETIME(3) NULL,
    `exemptPeriodId` VARCHAR(191) NULL,
    `lastUnlockDate` DATETIME(3) NULL,
    `lastUnlockedBy` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_assignments_workspaceId_isActive_idx`(`workspaceId`, `isActive`),
    INDEX `target_assignments_targetCycleId_idx`(`targetCycleId`),
    INDEX `target_assignments_exemptPeriodId_idx`(`exemptPeriodId`),
    UNIQUE INDEX `target_assignments_userId_targetCycleId_key`(`userId`, `targetCycleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_performance_logs` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `periodId` VARCHAR(191) NOT NULL,
    `targetCount` INTEGER NOT NULL,
    `achievedCount` INTEGER NOT NULL DEFAULT 0,
    `achievedRevenue` DOUBLE NOT NULL DEFAULT 0,
    `completionPercentage` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `evaluatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `metricType` VARCHAR(191) NULL,
    `leadStageId` VARCHAR(191) NULL,
    `targetValue` DOUBLE NULL,
    `achievedValue` DOUBLE NULL,
    `followupCount` INTEGER NOT NULL DEFAULT 0,
    `revenueAmount` DOUBLE NOT NULL DEFAULT 0,

    INDEX `target_performance_logs_periodId_idx`(`periodId`),
    UNIQUE INDEX `target_performance_logs_assignmentId_periodId_key`(`assignmentId`, `periodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_period_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `periodId` VARCHAR(191) NOT NULL,
    `metricType` VARCHAR(191) NOT NULL,
    `targetValue` DOUBLE NOT NULL DEFAULT 0,
    `achievedValue` DOUBLE NOT NULL DEFAULT 0,
    `completionPercentage` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_period_metrics_periodId_idx`(`periodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_stage_targets` (
    `id` VARCHAR(191) NOT NULL,
    `periodMetricId` VARCHAR(191) NOT NULL,
    `leadStageId` VARCHAR(191) NOT NULL,
    `targetValue` INTEGER NOT NULL,
    `achievedValue` INTEGER NOT NULL DEFAULT 0,
    `completionPercentage` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_stage_targets_periodMetricId_idx`(`periodMetricId`),
    INDEX `target_stage_targets_leadStageId_idx`(`leadStageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_followup_logs` (
    `id` VARCHAR(191) NOT NULL,
    `followUpId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `completedAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `target_followup_logs_followUpId_key`(`followUpId`),
    INDEX `target_followup_logs_userId_completedAt_idx`(`userId`, `completedAt`),
    INDEX `target_followup_logs_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_lock_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NULL,
    `periodId` VARCHAR(191) NULL,
    `lockPeriodId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedBySystem` BOOLEAN NOT NULL DEFAULT true,
    `isInvalidLock` BOOLEAN NOT NULL DEFAULT false,
    `invalidatedAt` DATETIME(3) NULL,

    INDEX `target_lock_logs_userId_lockedAt_idx`(`userId`, `lockedAt`),
    INDEX `target_lock_logs_workspaceId_idx`(`workspaceId`),
    INDEX `target_lock_logs_lockPeriodId_idx`(`lockPeriodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_unlock_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NULL,
    `unlockedById` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `exemptPeriodId` VARCHAR(191) NULL,
    `exemptUntilPeriodEnd` DATETIME(3) NULL,
    `unlockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `target_unlock_logs_userId_unlockedAt_idx`(`userId`, `unlockedAt`),
    INDEX `target_unlock_logs_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_cycle_ranges` (
    `id` VARCHAR(191) NOT NULL,
    `targetCycleId` VARCHAR(191) NOT NULL,
    `startDay` INTEGER NOT NULL,
    `endDay` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `target_cycle_ranges_targetCycleId_idx`(`targetCycleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_life_cycles` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lead_life_cycles_workspaceId_idx`(`workspaceId`),
    INDEX `lead_life_cycles_workspaceId_isDefault_name_idx`(`workspaceId`, `isDefault`, `name`),
    UNIQUE INDEX `lead_life_cycles_name_workspaceId_key`(`name`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `companyName` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `expectedRevenue` DOUBLE NULL,
    `generatedRevenue` DOUBLE NOT NULL DEFAULT 0,
    `assignedToId` VARCHAR(191) NULL,
    `stageId` VARCHAR(191) NULL,
    `lifecycleId` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,
    `nextFollowUpAt` DATETIME(3) NULL,
    `stageEnteredAt` DATETIME(3) NULL,
    `stageExpiresAt` DATETIME(3) NULL,
    `slaAction` ENUM('AUTO_LOB', 'WARN_AND_CHOOSE') NULL,
    `slaWarningDays` INTEGER NULL,
    `approvalState` ENUM('NONE', 'PENDING') NOT NULL DEFAULT 'NONE',
    `pendingApprovalToStageId` VARCHAR(191) NULL,
    `pendingApprovalRequestedAt` DATETIME(3) NULL,
    `isClosed` BOOLEAN NOT NULL DEFAULT false,
    `isLOB` BOOLEAN NOT NULL DEFAULT false,
    `closedAt` DATETIME(3) NULL,
    `closedById` VARCHAR(191) NULL,
    `closureType` ENUM('WON', 'LOST', 'CANCELLED') NULL,
    `earnedRevenue` DOUBLE NULL,
    `revenueApprovedById` VARCHAR(191) NULL,
    `revenueApprovedAt` DATETIME(3) NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `leads_workspaceId_assignedToId_stageId_idx`(`workspaceId`, `assignedToId`, `stageId`),
    INDEX `leads_workspaceId_sourceId_createdAt_idx`(`workspaceId`, `sourceId`, `createdAt`),
    INDEX `leads_workspaceId_deletedAt_idx`(`workspaceId`, `deletedAt`),
    INDEX `leads_workspaceId_isLOB_isClosed_idx`(`workspaceId`, `isLOB`, `isClosed`),
    INDEX `leads_isClosed_idx`(`isClosed`),
    INDEX `leads_workspaceId_isClosed_idx`(`workspaceId`, `isClosed`),
    INDEX `leads_closureType_idx`(`closureType`),
    INDEX `leads_closedAt_idx`(`closedAt` DESC),
    INDEX `leads_nextFollowUpAt_idx`(`nextFollowUpAt`),
    INDEX `leads_workspaceId_isClosed_isLOB_stageExpiresAt_idx`(`workspaceId`, `isClosed`, `isLOB`, `stageExpiresAt`),
    INDEX `leads_workspaceId_stageId_deletedAt_isClosed_idx`(`workspaceId`, `stageId`, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_assignedToId_deletedAt_isClosed_idx`(`workspaceId`, `assignedToId`, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_sourceId_deletedAt_isClosed_idx`(`workspaceId`, `sourceId`, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_lifecycleId_deletedAt_isClosed_idx`(`workspaceId`, `lifecycleId`, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_nextFollowUpAt_deletedAt_isClosed_idx`(`workspaceId`, `nextFollowUpAt`, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_createdAt_deletedAt_isClosed_idx`(`workspaceId`, `createdAt` DESC, `deletedAt`, `isClosed`),
    INDEX `leads_workspaceId_approvalState_pendingApprovalRequestedAt_idx`(`workspaceId`, `approvalState`, `pendingApprovalRequestedAt`),
    INDEX `leads_name_idx`(`name`),
    INDEX `leads_email_idx`(`email`),
    INDEX `leads_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_lob_logs` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `reasonId` VARCHAR(191) NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `previousStageId` VARCHAR(191) NULL,
    `previousStageName` VARCHAR(191) NULL,
    `changedById` VARCHAR(191) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `workspaceId` VARCHAR(191) NOT NULL,

    INDEX `lead_lob_logs_leadId_changedAt_idx`(`leadId`, `changedAt`),
    INDEX `lead_lob_logs_workspaceId_reasonId_idx`(`workspaceId`, `reasonId`),
    INDEX `lead_lob_logs_previousStageId_idx`(`previousStageId`),
    INDEX `lead_lob_logs_workspaceId_previousStageId_idx`(`workspaceId`, `previousStageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_stage_history` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `fromStageId` VARCHAR(191) NULL,
    `fromStageName` VARCHAR(191) NULL,
    `toStageId` VARCHAR(191) NULL,
    `toStageName` VARCHAR(191) NULL,
    `changedById` VARCHAR(191) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `workspaceId` VARCHAR(191) NOT NULL,

    INDEX `lead_stage_history_leadId_changedAt_idx`(`leadId`, `changedAt`),
    INDEX `lead_stage_history_workspaceId_changedAt_idx`(`workspaceId`, `changedAt`),
    INDEX `lead_stage_history_toStageId_changedAt_idx`(`toStageId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lob_reasons` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `lob_reasons_workspaceId_idx`(`workspaceId`),
    INDEX `lob_reasons_status_idx`(`status`),
    INDEX `lob_reasons_workspaceId_status_createdAt_idx`(`workspaceId`, `status`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_stage_approvals` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `fromStageId` VARCHAR(191) NOT NULL,
    `toStageId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'DENIED') NOT NULL DEFAULT 'PENDING',
    `comment` VARCHAR(191) NULL,
    `requestData` JSON NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lead_stage_approvals_workspaceId_idx`(`workspaceId`),
    INDEX `lead_stage_approvals_status_idx`(`status`),
    INDEX `lead_stage_approvals_leadId_idx`(`leadId`),
    INDEX `lead_stage_approvals_assignedToId_idx`(`assignedToId`),
    INDEX `lead_stage_approvals_workspaceId_status_createdAt_idx`(`workspaceId`, `status`, `createdAt` DESC),
    INDEX `lead_stage_approvals_workspaceId_requestedById_createdAt_idx`(`workspaceId`, `requestedById`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_life_cycle_transitions` (
    `id` VARCHAR(191) NOT NULL,
    `lifecycleId` VARCHAR(191) NOT NULL,
    `fromStageId` VARCHAR(191) NOT NULL,
    `toStageId` VARCHAR(191) NOT NULL,
    `numberOfDays` INTEGER NOT NULL,
    `expiryAction` ENUM('AUTO_LOB', 'WARN_AND_CHOOSE') NOT NULL DEFAULT 'WARN_AND_CHOOSE',
    `warningDays` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lead_life_cycle_transitions_lifecycleId_idx`(`lifecycleId`),
    INDEX `lead_life_cycle_transitions_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_dynamic_fields` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `inputType` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `lead_dynamic_fields_workspaceId_sortOrder_idx`(`workspaceId`, `sortOrder`),
    INDEX `lead_dynamic_fields_workspaceId_isActive_inputType_sortOrder_idx`(`workspaceId`, `isActive`, `inputType`, `sortOrder`),
    UNIQUE INDEX `lead_dynamic_fields_name_workspaceId_key`(`name`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_dynamic_options` (
    `id` VARCHAR(191) NOT NULL,
    `fieldId` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,

    INDEX `lead_dynamic_options_fieldId_idx`(`fieldId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_dynamic_values` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `fieldId` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_dynamic_values_leadId_idx`(`leadId`),
    INDEX `lead_dynamic_values_fieldId_idx`(`fieldId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_activities` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `performedById` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_activities_leadId_createdAt_idx`(`leadId`, `createdAt` DESC),
    INDEX `lead_activities_workspaceId_action_createdAt_idx`(`workspaceId`, `action`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_settings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetTypeId` VARCHAR(191) NOT NULL,
    `cycle` ENUM('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM') NOT NULL DEFAULT 'MONTHLY',
    `targetCycleId` VARCHAR(191) NULL,
    `monthlyTargetLeads` INTEGER NOT NULL DEFAULT 0,
    `dailyFollowupTarget` INTEGER NOT NULL DEFAULT 0,
    `revenueTarget` DOUBLE NOT NULL DEFAULT 0,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_settings_userId_workspaceId_idx`(`userId`, `workspaceId`),
    INDEX `target_settings_targetTypeId_idx`(`targetTypeId`),
    INDEX `target_settings_targetCycleId_idx`(`targetCycleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_violations` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` ENUM('DAILY', 'MONTHLY') NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'WARNING',
    `message` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `target_violations_userId_date_idx`(`userId`, `date`),
    INDEX `target_violations_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `username` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `googleId` VARCHAR(191) NULL,
    `isOnboarded` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isEmailVerified` BOOLEAN NOT NULL DEFAULT false,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `verificationToken` VARCHAR(191) NULL,
    `verificationTokenExpires` DATETIME(3) NULL,
    `invitationToken` VARCHAR(191) NULL,
    `invitationExpires` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `roleId` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NULL,
    `departmentId` VARCHAR(191) NULL,
    `officeId` VARCHAR(191) NULL,
    `countryId` VARCHAR(191) NULL,
    `stateId` VARCHAR(191) NULL,
    `districtId` VARCHAR(191) NULL,
    `supervisorId` VARCHAR(191) NULL,
    `assignedTargetCycleId` VARCHAR(191) NULL,
    `targetLockedAt` DATETIME(3) NULL,
    `targetLockReason` VARCHAR(191) NULL,
    `attendanceApplyType` VARCHAR(191) NOT NULL DEFAULT 'FROM_ANYWHERE',
    `attendanceOfficeLocationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_googleId_key`(`googleId`),
    INDEX `users_workspaceId_idx`(`workspaceId`),
    INDEX `users_roleId_idx`(`roleId`),
    INDEX `users_departmentId_idx`(`departmentId`),
    INDEX `users_officeId_idx`(`officeId`),
    INDEX `users_supervisorId_idx`(`supervisorId`),
    INDEX `users_workspaceId_deletedAt_createdAt_idx`(`workspaceId`, `deletedAt`, `createdAt` DESC),
    INDEX `users_workspaceId_roleId_deletedAt_idx`(`workspaceId`, `roleId`, `deletedAt`),
    INDEX `users_workspaceId_supervisorId_deletedAt_idx`(`workspaceId`, `supervisorId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invites` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invites_tokenHash_key`(`tokenHash`),
    INDEX `invites_workspaceId_userId_idx`(`workspaceId`, `userId`),
    INDEX `invites_workspaceId_createdBy_idx`(`workspaceId`, `createdBy`),
    INDEX `invites_workspaceId_expiresAt_idx`(`workspaceId`, `expiresAt`),
    INDEX `invites_workspaceId_usedAt_idx`(`workspaceId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `requestedIp` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`),
    INDEX `password_reset_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_ups` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `completionDescription` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `scheduledAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `isOverdue` BOOLEAN NOT NULL DEFAULT false,
    `overdueAt` DATETIME(3) NULL,
    `completedAfterOverdue` BOOLEAN NOT NULL DEFAULT false,
    `extendedAfterOverdue` BOOLEAN NOT NULL DEFAULT false,
    `recentDescription` VARCHAR(191) NULL,
    `previousFollowupDate` DATETIME(3) NULL,
    `newFollowupDate` DATETIME(3) NULL,
    `snoozedBy` VARCHAR(191) NULL,
    `snoozedAt` DATETIME(3) NULL,
    `reminderActionType` VARCHAR(191) NULL,
    `extensionReasonId` VARCHAR(191) NULL,
    `extensionReasonName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `follow_ups_workspaceId_userId_scheduledAt_idx`(`workspaceId`, `userId`, `scheduledAt`),
    INDEX `follow_ups_workspaceId_status_scheduledAt_idx`(`workspaceId`, `status`, `scheduledAt`),
    INDEX `follow_ups_leadId_idx`(`leadId`),
    INDEX `follow_ups_workspaceId_userId_status_scheduledAt_idx`(`workspaceId`, `userId`, `status`, `scheduledAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `followup_activity_logs` (
    `id` VARCHAR(191) NOT NULL,
    `followUpId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `previousFollowupDate` DATETIME(3) NOT NULL,
    `newFollowupDate` DATETIME(3) NOT NULL,
    `snoozedById` VARCHAR(191) NOT NULL,
    `snoozedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recentDescription` VARCHAR(191) NOT NULL,
    `previousDescription` VARCHAR(191) NULL,
    `reminderActionType` VARCHAR(191) NOT NULL,
    `extensionReasonId` VARCHAR(191) NULL,
    `extensionReasonName` VARCHAR(191) NULL,

    INDEX `followup_activity_logs_followUpId_idx`(`followUpId`),
    INDEX `followup_activity_logs_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `follow_up_images` (
    `id` VARCHAR(191) NOT NULL,
    `followUpId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `follow_up_images_followUpId_idx`(`followUpId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roster_entries` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rosterType` ENUM('HOLIDAY', 'WEEKLY_OFF', 'SHIFT', 'SPECIAL_WORKING_DAY') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `shiftSession` ENUM('DAY', 'NIGHT') NULL,
    `shiftStartTime` VARCHAR(191) NULL,
    `shiftEndTime` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `roster_entries_userId_idx`(`userId`),
    INDEX `roster_entries_startDate_idx`(`startDate`),
    INDEX `roster_entries_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `details` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_userId_idx`(`userId`),
    INDEX `audit_logs_workspaceId_idx`(`workspaceId`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_workspaceId_createdAt_idx`(`workspaceId`, `createdAt` DESC),
    INDEX `audit_logs_userId_createdAt_idx`(`userId`, `createdAt` DESC),
    INDEX `audit_logs_workspaceId_action_createdAt_idx`(`workspaceId`, `action`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `os` VARCHAR(191) NULL,
    `browser` VARCHAR(191) NULL,
    `deviceType` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `lastActive` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `devices_userId_deviceId_key`(`userId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `holidayDate` DATE NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#fda4af',
    `countryId` VARCHAR(191) NULL,
    `stateId` VARCHAR(191) NULL,
    `districtId` VARCHAR(191) NULL,
    `isRecurring` BOOLEAN NOT NULL DEFAULT false,
    `recurrenceRule` VARCHAR(191) NULL,
    `source` ENUM('MANUAL', 'API', 'AI', 'GOOGLE') NOT NULL DEFAULT 'MANUAL',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `holidays_workspaceId_idx`(`workspaceId`),
    INDEX `holidays_countryId_stateId_districtId_idx`(`countryId`, `stateId`, `districtId`),
    INDEX `holidays_holidayDate_idx`(`holidayDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holiday_sync_logs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `source` ENUM('MANUAL', 'API', 'AI', 'GOOGLE') NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `message` TEXT NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `holiday_sync_logs_workspaceId_idx`(`workspaceId`),
    INDEX `holiday_sync_logs_syncedAt_idx`(`syncedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_types` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `module` ENUM('LEADS', 'USERS', 'REPORTS', 'TARGETS', 'FOLLOWUPS', 'ACTIVITY') NOT NULL,
    `modules` JSON NULL,
    `baseDataSource` ENUM('LEADS', 'USERS', 'FOLLOWUPS', 'ACTIVITY') NOT NULL,
    `baseDataSources` JSON NULL,
    `description` VARCHAR(191) NULL,
    `allowedFilters` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `category` VARCHAR(191) NULL DEFAULT 'Leads Report',
    `categories` JSON NULL,
    `trackModules` JSON NULL,
    `enableUserFilter` BOOLEAN NOT NULL DEFAULT false,
    `enableDateFilter` BOOLEAN NOT NULL DEFAULT false,
    `trackActivityTypes` JSON NULL,
    `allowExport` BOOLEAN NOT NULL DEFAULT false,
    `showSummary` BOOLEAN NOT NULL DEFAULT false,
    `showDetailedLogs` BOOLEAN NOT NULL DEFAULT false,

    INDEX `report_types_workspaceId_idx`(`workspaceId`),
    INDEX `report_types_status_idx`(`status`),
    INDEX `report_types_module_idx`(`module`),
    INDEX `report_types_workspaceId_status_module_createdAt_idx`(`workspaceId`, `status`, `module`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_logs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `reportTypeId` VARCHAR(191) NULL,
    `reportId` VARCHAR(191) NULL,
    `generatedById` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `filters` JSON NOT NULL,
    `resultCount` INTEGER NOT NULL DEFAULT 0,
    `meta` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_logs_workspaceId_idx`(`workspaceId`),
    INDEX `report_logs_reportTypeId_idx`(`reportTypeId`),
    INDEX `report_logs_reportId_idx`(`reportId`),
    INDEX `report_logs_generatedById_idx`(`generatedById`),
    INDEX `report_logs_action_idx`(`action`),
    INDEX `report_logs_workspaceId_createdAt_idx`(`workspaceId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `reportName` VARCHAR(191) NOT NULL,
    `reportTypeId` VARCHAR(191) NOT NULL,
    `reportDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isGenerated` BOOLEAN NOT NULL DEFAULT false,
    `generatedFileUrl` VARCHAR(191) NULL,
    `generatedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `reports_workspaceId_idx`(`workspaceId`),
    INDEX `reports_reportTypeId_idx`(`reportTypeId`),
    INDEX `reports_createdById_idx`(`createdById`),
    INDEX `reports_isActive_idx`(`isActive`),
    INDEX `reports_isGenerated_idx`(`isGenerated`),
    INDEX `reports_reportDate_idx`(`reportDate`),
    INDEX `reports_workspaceId_deletedAt_createdAt_idx`(`workspaceId`, `deletedAt`, `createdAt` DESC),
    INDEX `reports_workspaceId_reportTypeId_reportDate_idx`(`workspaceId`, `reportTypeId`, `reportDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_filters` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `filterKey` VARCHAR(191) NOT NULL,
    `filterValue` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `report_filters_reportId_idx`(`reportId`),
    INDEX `report_filters_filterKey_idx`(`filterKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `totalRows` INTEGER NULL DEFAULT 0,
    `processedRows` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `errorFileUrl` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `import_jobs_workspaceId_idx`(`workspaceId`),
    INDEX `import_jobs_status_idx`(`status`),
    INDEX `import_jobs_workspaceId_status_idx`(`workspaceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `revenue_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `approvedById` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `closedStageId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `revenue_transactions_workspaceId_idx`(`workspaceId`),
    INDEX `revenue_transactions_leadId_idx`(`leadId`),
    INDEX `revenue_transactions_userId_idx`(`userId`),
    INDEX `revenue_transactions_approvedById_idx`(`approvedById`),
    INDEX `revenue_transactions_closedStageId_idx`(`closedStageId`),
    INDEX `revenue_transactions_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `checkInTime` DATETIME(3) NULL,
    `checkOutTime` DATETIME(3) NULL,
    `workingHours` DOUBLE NULL,
    `checkoutCompleted` BOOLEAN NOT NULL DEFAULT false,
    `expectedCheckInTime` VARCHAR(191) NULL,
    `expectedCheckOutTime` VARCHAR(191) NULL,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `attendanceType` ENUM('PRESENT', 'HALF_DAY', 'LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'WEEKLY_OFF', 'ABSENT') NOT NULL DEFAULT 'PRESENT',
    `status` ENUM('MARKED', 'AUTO_GENERATED', 'APPROVED', 'PENDING') NOT NULL DEFAULT 'MARKED',
    `warningCount` INTEGER NOT NULL DEFAULT 0,
    `isHoliday` BOOLEAN NOT NULL DEFAULT false,
    `holidayName` VARCHAR(191) NULL,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `lockReason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `calculatedDistanceMeters` DOUBLE NULL,
    `officeLocationId` VARCHAR(191) NULL,
    `isInsideOfficeRadius` BOOLEAN NOT NULL DEFAULT false,
    `gpsAccuracy` DOUBLE NULL,
    `ipAddress` VARCHAR(191) NULL,
    `networkName` VARCHAR(191) NULL,
    `routerIp` VARCHAR(191) NULL,
    `subnet` VARCHAR(191) NULL,
    `attendanceApplyType` VARCHAR(191) NULL DEFAULT 'FROM_ANYWHERE',
    `isOfficeNetwork` BOOLEAN NOT NULL DEFAULT false,
    `deviceInfo` VARCHAR(191) NULL,
    `geoLocation` VARCHAR(191) NULL,
    `approvalStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `rejectedReason` VARCHAR(191) NULL,
    `supervisorId` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` VARCHAR(191) NULL,
    `attachmentUrl` VARCHAR(191) NULL,
    `workSummary` TEXT NULL,
    `achievements` TEXT NULL,
    `pendingTasks` TEXT NULL,
    `challenges` TEXT NULL,
    `additionalNotes` TEXT NULL,
    `rejectedBy` VARCHAR(191) NULL,
    `rejectedAt` DATETIME(3) NULL,

    INDEX `attendance_records_workspaceId_idx`(`workspaceId`),
    INDEX `attendance_records_date_idx`(`date`),
    INDEX `attendance_records_userId_date_idx`(`userId`, `date`),
    INDEX `attendance_records_workspaceId_approvalStatus_date_idx`(`workspaceId`, `approvalStatus`, `date`),
    UNIQUE INDEX `attendance_records_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_warnings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `warningType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_warnings_userId_idx`(`userId`),
    INDEX `attendance_warnings_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_settings` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `cutoffTime` VARCHAR(191) NOT NULL DEFAULT '09:30',
    `enableWarning` BOOLEAN NOT NULL DEFAULT true,
    `warningThreshold` INTEGER NOT NULL DEFAULT 3,
    `enableAutoLock` BOOLEAN NOT NULL DEFAULT false,
    `attendanceStartTime` VARCHAR(191) NOT NULL DEFAULT '08:00',
    `lateMarkTime` VARCHAR(191) NOT NULL DEFAULT '09:45',
    `autoAbsentTime` VARCHAR(191) NOT NULL DEFAULT '12:00',
    `approvalRequired` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_settings_workspaceId_key`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_user_settings` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expectedCheckInTime` VARCHAR(191) NOT NULL,
    `expectedCheckOutTime` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_user_settings_userId_key`(`userId`),
    INDEX `attendance_user_settings_workspaceId_idx`(`workspaceId`),
    INDEX `attendance_user_settings_workspaceId_expectedCheckInTime_idx`(`workspaceId`, `expectedCheckInTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_logs_userId_idx`(`userId`),
    INDEX `attendance_logs_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_networks` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `officeName` VARCHAR(191) NOT NULL,
    `branch` VARCHAR(191) NULL,
    `wifiSsid` VARCHAR(191) NOT NULL,
    `routerIp` VARCHAR(191) NOT NULL,
    `gateway` VARCHAR(191) NULL,
    `allowedIpRanges` VARCHAR(191) NULL,
    `subnet` VARCHAR(191) NULL,
    `macValidation` VARCHAR(191) NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_networks_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_office_locations` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `officeName` VARCHAR(191) NOT NULL,
    `branch` VARCHAR(191) NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `radiusMeters` INTEGER NOT NULL DEFAULT 50,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_office_locations_workspaceId_idx`(`workspaceId`),
    INDEX `attendance_office_locations_workspaceId_isEnabled_idx`(`workspaceId`, `isEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_approval_logs` (
    `id` VARCHAR(191) NOT NULL,
    `attendanceRecordId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_approval_logs_attendanceRecordId_idx`(`attendanceRecordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_notifications` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_notifications_userId_idx`(`userId`),
    INDEX `attendance_notifications_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_audit_logs_userId_idx`(`userId`),
    INDEX `attendance_audit_logs_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `followup_extension_reasons` (
    `id` VARCHAR(191) NOT NULL,
    `reasonName` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `workspaceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `followup_extension_reasons_workspaceId_isActive_sortOrder_re_idx`(`workspaceId`, `isActive`, `sortOrder`, `reasonName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `followup_settings` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `dailyLimitEnabled` BOOLEAN NOT NULL DEFAULT false,
    `dailyLimitCount` INTEGER NOT NULL DEFAULT 10,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `capacityValidationEnabled` BOOLEAN NOT NULL DEFAULT false,
    `bulkExtensionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoDistributionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `defaultBulkExtensionDuration` VARCHAR(191) NOT NULL DEFAULT '1 Day',
    `maxBulkExtensionCount` INTEGER NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `followup_settings_workspaceId_key`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `temporary_bulk_extension_access` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `grantedById` VARCHAR(191) NOT NULL,
    `duration` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `temporary_bulk_extension_access_workspaceId_idx`(`workspaceId`),
    INDEX `temporary_bulk_extension_access_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bulk_followup_extensions` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetDate` DATETIME(3) NOT NULL,
    `extensionReasonId` VARCHAR(191) NULL,
    `extensionReasonName` VARCHAR(191) NULL,
    `customReason` VARCHAR(191) NULL,
    `followupCount` INTEGER NOT NULL,
    `autoDistributed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bulk_followup_extensions_workspaceId_idx`(`workspaceId`),
    INDEX `bulk_followup_extensions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `checkInTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `checkOutTime` VARCHAR(191) NOT NULL DEFAULT '18:00',
    `gracePeriod` INTEGER NOT NULL DEFAULT 15,
    `lateMarkThreshold` VARCHAR(191) NOT NULL DEFAULT '09:45',
    `halfDayThreshold` DOUBLE NOT NULL DEFAULT 4.0,
    `workingHoursRequirement` DOUBLE NOT NULL DEFAULT 8.0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_schedules_userId_key`(`userId`),
    INDEX `attendance_schedules_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_sources` ADD CONSTRAINT `lead_sources_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stages` ADD CONSTRAINT `lead_stages_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stage_rules` ADD CONSTRAINT `stage_rules_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stage_rules` ADD CONSTRAINT `stage_rules_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `lead_stages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_inputs` ADD CONSTRAINT `lead_stage_inputs_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `stage_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `countries` ADD CONSTRAINT `countries_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `countries` ADD CONSTRAINT `countries_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `countries` ADD CONSTRAINT `countries_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `location_levels` ADD CONSTRAINT `location_levels_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `location_levels` ADD CONSTRAINT `location_levels_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `location_levels` ADD CONSTRAINT `location_levels_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `location_levels` ADD CONSTRAINT `location_levels_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `locations_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `locations_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `locations` ADD CONSTRAINT `locations_levelId_fkey` FOREIGN KEY (`levelId`) REFERENCES `location_levels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_location_assignments` ADD CONSTRAINT `user_location_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_location_assignments` ADD CONSTRAINT `user_location_assignments_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `locations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_cycles` ADD CONSTRAINT `target_cycles_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_cycles` ADD CONSTRAINT `target_cycles_leadStageId_fkey` FOREIGN KEY (`leadStageId`) REFERENCES `lead_stages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_cycle_periods` ADD CONSTRAINT `target_cycle_periods_targetCycleId_fkey` FOREIGN KEY (`targetCycleId`) REFERENCES `target_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_assignments` ADD CONSTRAINT `target_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_assignments` ADD CONSTRAINT `target_assignments_targetCycleId_fkey` FOREIGN KEY (`targetCycleId`) REFERENCES `target_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_performance_logs` ADD CONSTRAINT `target_performance_logs_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `target_assignments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_performance_logs` ADD CONSTRAINT `target_performance_logs_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `target_cycle_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_period_metrics` ADD CONSTRAINT `target_period_metrics_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `target_cycle_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_stage_targets` ADD CONSTRAINT `target_stage_targets_periodMetricId_fkey` FOREIGN KEY (`periodMetricId`) REFERENCES `target_period_metrics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_stage_targets` ADD CONSTRAINT `target_stage_targets_leadStageId_fkey` FOREIGN KEY (`leadStageId`) REFERENCES `lead_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_lock_logs` ADD CONSTRAINT `target_lock_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_lock_logs` ADD CONSTRAINT `target_lock_logs_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `target_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_unlock_logs` ADD CONSTRAINT `target_unlock_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_unlock_logs` ADD CONSTRAINT `target_unlock_logs_unlockedById_fkey` FOREIGN KEY (`unlockedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_unlock_logs` ADD CONSTRAINT `target_unlock_logs_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `target_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_cycle_ranges` ADD CONSTRAINT `target_cycle_ranges_targetCycleId_fkey` FOREIGN KEY (`targetCycleId`) REFERENCES `target_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_life_cycles` ADD CONSTRAINT `lead_life_cycles_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_stageId_fkey` FOREIGN KEY (`stageId`) REFERENCES `lead_stages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_lifecycleId_fkey` FOREIGN KEY (`lifecycleId`) REFERENCES `lead_life_cycles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `lead_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_revenueApprovedById_fkey` FOREIGN KEY (`revenueApprovedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `leads` ADD CONSTRAINT `leads_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_lob_logs` ADD CONSTRAINT `lead_lob_logs_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_history` ADD CONSTRAINT `lead_stage_history_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_history` ADD CONSTRAINT `lead_stage_history_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lob_reasons` ADD CONSTRAINT `lob_reasons_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lob_reasons` ADD CONSTRAINT `lob_reasons_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lob_reasons` ADD CONSTRAINT `lob_reasons_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_fromStageId_fkey` FOREIGN KEY (`fromStageId`) REFERENCES `lead_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_toStageId_fkey` FOREIGN KEY (`toStageId`) REFERENCES `lead_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_stage_approvals` ADD CONSTRAINT `lead_stage_approvals_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_life_cycle_transitions` ADD CONSTRAINT `lead_life_cycle_transitions_lifecycleId_fkey` FOREIGN KEY (`lifecycleId`) REFERENCES `lead_life_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_dynamic_fields` ADD CONSTRAINT `lead_dynamic_fields_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_dynamic_options` ADD CONSTRAINT `lead_dynamic_options_fieldId_fkey` FOREIGN KEY (`fieldId`) REFERENCES `lead_dynamic_fields`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_dynamic_values` ADD CONSTRAINT `lead_dynamic_values_fieldId_fkey` FOREIGN KEY (`fieldId`) REFERENCES `lead_dynamic_fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_activities` ADD CONSTRAINT `lead_activities_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_settings` ADD CONSTRAINT `target_settings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_settings` ADD CONSTRAINT `target_settings_targetTypeId_fkey` FOREIGN KEY (`targetTypeId`) REFERENCES `target_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_settings` ADD CONSTRAINT `target_settings_targetCycleId_fkey` FOREIGN KEY (`targetCycleId`) REFERENCES `target_cycles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_violations` ADD CONSTRAINT `target_violations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_officeId_fkey` FOREIGN KEY (`officeId`) REFERENCES `offices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_supervisorId_fkey` FOREIGN KEY (`supervisorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_assignedTargetCycleId_fkey` FOREIGN KEY (`assignedTargetCycleId`) REFERENCES `target_cycles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_attendanceOfficeLocationId_fkey` FOREIGN KEY (`attendanceOfficeLocationId`) REFERENCES `attendance_office_locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `invites_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `invites_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `invites_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `followup_activity_logs` ADD CONSTRAINT `followup_activity_logs_followUpId_fkey` FOREIGN KEY (`followUpId`) REFERENCES `follow_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `followup_activity_logs` ADD CONSTRAINT `followup_activity_logs_snoozedById_fkey` FOREIGN KEY (`snoozedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `follow_up_images` ADD CONSTRAINT `follow_up_images_followUpId_fkey` FOREIGN KEY (`followUpId`) REFERENCES `follow_ups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roster_entries` ADD CONSTRAINT `roster_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `devices` ADD CONSTRAINT `devices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_districtId_fkey` FOREIGN KEY (`districtId`) REFERENCES `locations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holiday_sync_logs` ADD CONSTRAINT `holiday_sync_logs_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_types` ADD CONSTRAINT `report_types_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_types` ADD CONSTRAINT `report_types_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_types` ADD CONSTRAINT `report_types_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_logs` ADD CONSTRAINT `report_logs_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_logs` ADD CONSTRAINT `report_logs_reportTypeId_fkey` FOREIGN KEY (`reportTypeId`) REFERENCES `report_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_logs` ADD CONSTRAINT `report_logs_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_logs` ADD CONSTRAINT `report_logs_generatedById_fkey` FOREIGN KEY (`generatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reportTypeId_fkey` FOREIGN KEY (`reportTypeId`) REFERENCES `report_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_filters` ADD CONSTRAINT `report_filters_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revenue_transactions` ADD CONSTRAINT `revenue_transactions_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revenue_transactions` ADD CONSTRAINT `revenue_transactions_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revenue_transactions` ADD CONSTRAINT `revenue_transactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revenue_transactions` ADD CONSTRAINT `revenue_transactions_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revenue_transactions` ADD CONSTRAINT `revenue_transactions_closedStageId_fkey` FOREIGN KEY (`closedStageId`) REFERENCES `lead_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_user_settings` ADD CONSTRAINT `attendance_user_settings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `followup_extension_reasons` ADD CONSTRAINT `followup_extension_reasons_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `followup_settings` ADD CONSTRAINT `followup_settings_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `temporary_bulk_extension_access` ADD CONSTRAINT `temporary_bulk_extension_access_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `temporary_bulk_extension_access` ADD CONSTRAINT `temporary_bulk_extension_access_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `temporary_bulk_extension_access` ADD CONSTRAINT `temporary_bulk_extension_access_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bulk_followup_extensions` ADD CONSTRAINT `bulk_followup_extensions_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bulk_followup_extensions` ADD CONSTRAINT `bulk_followup_extensions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_schedules` ADD CONSTRAINT `attendance_schedules_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

