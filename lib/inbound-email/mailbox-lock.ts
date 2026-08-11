import { Prisma, type InboundMailbox } from "@prisma/client";

type MailboxLockDatabase = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "inboundMailbox"
>;

export async function lockOwnedInboundMailbox(
  db: MailboxLockDatabase,
  input: { userId: string; mailboxId?: string }
): Promise<InboundMailbox | null> {
  const locked = input.mailboxId
    ? await db.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InboundMailbox" WHERE "id" = ${input.mailboxId} AND "userId" = ${input.userId} FOR UPDATE`
      )
    : await db.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InboundMailbox" WHERE "userId" = ${input.userId} FOR UPDATE`
      );
  const mailboxId = locked[0]?.id;

  return mailboxId
    ? db.inboundMailbox.findUnique({
        where: { id: mailboxId, userId: input.userId }
      })
    : null;
}
