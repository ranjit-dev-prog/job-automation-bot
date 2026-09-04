-- CreateTable
CREATE TABLE "OutreachEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
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
    CONSTRAINT "OutreachEmail_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "company" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "connectionProfileUrl" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "ConnectionMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConnectionMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobFilter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "location" TEXT,
    "remoteOnly" BOOLEAN NOT NULL DEFAULT false,
    "easyApplyOnly" BOOLEAN NOT NULL DEFAULT true,
    "minMatchScore" INTEGER NOT NULL DEFAULT 60,
    "directApply" BOOLEAN NOT NULL DEFAULT false,
    "minSalary" INTEGER,
    "platforms" TEXT NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 45,
    "searchIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "emailOutreachEnabled" BOOLEAN NOT NULL DEFAULT false,
    "connectionOutreachEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxApplicationsPerDay" INTEGER NOT NULL DEFAULT 20,
    "customRulesJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JobFilter" ("createdAt", "customRulesJson", "delaySeconds", "directApply", "easyApplyOnly", "id", "isActive", "keywords", "location", "maxApplicationsPerDay", "minMatchScore", "minSalary", "name", "platforms", "remoteOnly", "searchIntervalMinutes", "updatedAt", "userId") SELECT "createdAt", "customRulesJson", "delaySeconds", "directApply", "easyApplyOnly", "id", "isActive", "keywords", "location", "maxApplicationsPerDay", "minMatchScore", "minSalary", "name", "platforms", "remoteOnly", "searchIntervalMinutes", "updatedAt", "userId" FROM "JobFilter";
DROP TABLE "JobFilter";
ALTER TABLE "new_JobFilter" RENAME TO "JobFilter";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
