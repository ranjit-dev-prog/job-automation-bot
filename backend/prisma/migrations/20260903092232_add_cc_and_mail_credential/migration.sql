-- AlterTable
ALTER TABLE "OutreachEmail" ADD COLUMN "ccEmails" TEXT;

-- CreateTable
CREATE TABLE "MailCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "gmailUser" TEXT NOT NULL,
    "gmailAppPasswordEnc" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MailCredential_userId_key" ON "MailCredential"("userId");
