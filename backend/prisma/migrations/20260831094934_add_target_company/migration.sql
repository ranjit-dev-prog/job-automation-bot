-- CreateTable
CREATE TABLE "TargetCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactName" TEXT,
    "roleOfInterest" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftedAt" DATETIME,
    CONSTRAINT "TargetCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OutreachEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "targetCompanyId" TEXT,
    "company" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachResume" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "OutreachEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachEmail_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OutreachEmail_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "TargetCompany" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OutreachEmail" ("applicationId", "attachResume", "body", "company", "createdAt", "errorMessage", "id", "sentAt", "status", "subject", "toEmail", "userId") SELECT "applicationId", "attachResume", "body", "company", "createdAt", "errorMessage", "id", "sentAt", "status", "subject", "toEmail", "userId" FROM "OutreachEmail";
DROP TABLE "OutreachEmail";
ALTER TABLE "new_OutreachEmail" RENAME TO "OutreachEmail";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
