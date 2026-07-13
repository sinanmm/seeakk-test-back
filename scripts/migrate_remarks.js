const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting LeadRemarks migration...');
  const leads = await prisma.lead.findMany({
    where: {
      remarks: {
        not: null,
      },
      remarksList: {
        none: {}
      }
    },
    select: {
      id: true,
      remarks: true,
      createdById: true,
      workspaceId: true,
      createdAt: true
    }
  });

  console.log(`Found ${leads.length} leads to migrate.`);

  for (const lead of leads) {
    if (!lead.remarks || lead.remarks.trim().length === 0) continue;
    await prisma.leadRemark.create({
      data: {
        text: lead.remarks.trim(),
        leadId: lead.id,
        createdById: lead.createdById,
        workspaceId: lead.workspaceId,
        createdAt: lead.createdAt
      }
    });
  }

  console.log('Migration complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
