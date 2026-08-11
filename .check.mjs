import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
console.log("INDUSTRIES:", (await db.industry.findMany({select:{id:true}})).map(i=>i.id).join(" "));
const org = await db.organization.findFirst({ where: { isShowcase: true } });
const a = await db.agent.findFirst({ where: { organizationId: org.id }, select: { name:true,status:true,certification:true }});
console.log("SHOWCASE AGENT:", JSON.stringify(a));
console.log("PRODUCTS:", (await db.dataProduct.findMany({where:{organizationId:org.id},select:{key:true}})).map(p=>p.key).join(" "));
await db.$disconnect();
