import prisma from '../config/prisma';
import logger from '../utils/logger';

export const CANONICAL_MODULES = [
  {
    key: 'DASHBOARD',
    name: 'Dashboard',
    description: 'Executive dashboard, metrics overview, and custom pipeline insights.',
    sortOrder: 1,
  },
  {
    key: 'ATTENDANCE',
    name: 'Attendance',
    description: 'Attendance tracking, shift verification, and check-in geolocation.',
    sortOrder: 2,
  },
  {
    key: 'ADMIN_MANAGEMENT',
    name: 'Admin Management',
    description: 'Users, roles, departments, organization chart, roster sheets, and office tracking.',
    sortOrder: 3,
  },
  {
    key: 'SALARY_MANAGEMENT',
    name: 'Salary Management',
    description: 'Salary calculation engine, multi-stage approval workflows, and payroll records.',
    sortOrder: 4,
  },
  {
    key: 'MASTER_CONFIGURATION',
    name: 'Master Configuration',
    description: 'Lead sources, products, stages, stage rules, target cycles, and dynamic fields.',
    sortOrder: 5,
  },
  {
    key: 'LEADS',
    name: 'Leads & Follow-ups',
    description: 'Lead lifecycle, follow-up scheduling, bulk assignment, and stage transitions.',
    sortOrder: 6,
  },
  {
    key: 'REPORTS',
    name: 'Reports & Analytics',
    description: 'Cross-functional reports, activity summaries, and call performance analytics.',
    sortOrder: 7,
  },
  {
    key: 'SHEETS',
    name: 'Sheets',
    description: 'Custom interactive spreadsheets and versioned data tables.',
    sortOrder: 8,
  },
  {
    key: 'LOB_ANALYSIS',
    name: 'LOB Analysis',
    description: 'Loss of business reason tracking and conversion drop-off analytics.',
    sortOrder: 9,
  },
  {
    key: 'UNLOCK_STAFF',
    name: 'Unlock Staff',
    description: 'Staff emergency unlock and override administration.',
    sortOrder: 10,
  },
  {
    key: 'META_ADS',
    name: 'Meta Ads Integration',
    description: 'Direct Facebook and Instagram lead ad sync with webhook ingestion.',
    sortOrder: 11,
  },
  {
    key: 'TELEPHONY',
    name: 'Telephony',
    description: 'Inbound and outbound telephony integration, agent mapping, and call logs.',
    sortOrder: 12,
  },
  {
    key: 'WHATSAPP_TEMPLATES',
    name: 'WhatsApp Templates',
    description: 'Automated WhatsApp messaging templates and notification presets.',
    sortOrder: 13,
  },
  {
    key: 'AUTOMATIONS',
    name: 'Automations',
    description: 'Automated event triggers, conditional workflows, and rule executions.',
    sortOrder: 14,
  },
];

/**
 * Single Active Sellable Commercial Plan: BASE @ ₹499/user/month with ALL 14 features enabled.
 */
export const DEFAULT_PLANS = [
  {
    code: 'BASE',
    name: 'Base',
    description: 'Complete SEEAKK CRM suite with all platform modules and features.',
    pricePerUserMonth: 499,
    currency: 'INR',
    sortOrder: 1,
    isActive: true,
    isArchived: false,
    enabledModuleKeys: [
      'DASHBOARD',
      'ATTENDANCE',
      'ADMIN_MANAGEMENT',
      'SALARY_MANAGEMENT',
      'MASTER_CONFIGURATION',
      'LEADS',
      'REPORTS',
      'SHEETS',
      'LOB_ANALYSIS',
      'UNLOCK_STAFF',
      'META_ADS',
      'TELEPHONY',
      'WHATSAPP_TEMPLATES',
      'AUTOMATIONS',
    ],
  },
];

export const seedPlansAndModules = async () => {
  logger.info('Starting canonical modules and BASE plan seed...');

  // 1. Seed / Upsert Modules in Parallel
  const modulePromises = CANONICAL_MODULES.map((mod) =>
    prisma.appModule.upsert({
      where: { key: mod.key },
      create: {
        key: mod.key,
        name: mod.name,
        description: mod.description,
        sortOrder: mod.sortOrder,
        isActive: true,
      },
      update: {
        name: mod.name,
        description: mod.description,
        sortOrder: mod.sortOrder,
      },
    })
  );
  const upsertedModules = await Promise.all(modulePromises);
  const moduleMap = new Map<string, string>();
  for (const mod of upsertedModules) {
    moduleMap.set(mod.key, mod.id);
  }

  logger.info(`Upserted ${moduleMap.size} canonical app modules.`);

  // 2. Seed / Upsert BASE Plan
  for (const planDef of DEFAULT_PLANS) {
    const plan = await prisma.plan.upsert({
      where: { code: planDef.code },
      create: {
        code: planDef.code,
        name: planDef.name,
        description: planDef.description,
        pricePerUserMonth: planDef.pricePerUserMonth,
        currency: planDef.currency,
        sortOrder: planDef.sortOrder,
        isActive: planDef.isActive,
        isArchived: planDef.isArchived,
      },
      update: {
        name: planDef.name,
        description: planDef.description,
        pricePerUserMonth: planDef.pricePerUserMonth,
        sortOrder: planDef.sortOrder,
        isActive: planDef.isActive,
        isArchived: planDef.isArchived,
      },
    });

    // Upsert modules for BASE
    for (const mod of CANONICAL_MODULES) {
      const moduleId = moduleMap.get(mod.key);
      if (!moduleId) continue;

      const isEnabled = planDef.enabledModuleKeys.includes(mod.key);

      await prisma.planModule.upsert({
        where: {
          planId_moduleId: {
            planId: plan.id,
            moduleId,
          },
        },
        create: {
          planId: plan.id,
          moduleId,
          enabled: isEnabled,
        },
        update: {
          enabled: isEnabled,
        },
      });
    }
  }

  // 3. Safely deactivate / archive any previously seeded PRO or ENTERPRISE plans
  const inactiveResult = await prisma.plan.updateMany({
    where: {
      code: { in: ['PRO', 'ENTERPRISE'] },
      isActive: true,
    },
    data: {
      isActive: false,
      isArchived: true,
    },
  });

  if (inactiveResult.count > 0) {
    logger.info(`Archived ${inactiveResult.count} unapproved plan records (PRO/ENTERPRISE).`);
  }

  logger.info('Canonical modules and single BASE plan seeded successfully.');
};

if (require.main === module) {
  seedPlansAndModules()
    .then(async () => {
      console.log('Seed completed successfully. BASE plan active with all 14 modules.');
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
