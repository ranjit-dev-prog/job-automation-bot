-- AlterTable
ALTER TABLE "Application" ADD COLUMN "matchScore" INTEGER;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "currentCompany" TEXT;
ALTER TABLE "Profile" ADD COLUMN "currentJobTitle" TEXT;
ALTER TABLE "Profile" ADD COLUMN "currentLocation" TEXT;
ALTER TABLE "Profile" ADD COLUMN "currentSalary" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "expectedSalary" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "Profile" ADD COLUMN "noticePeriodDays" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "preferredLocation" TEXT;
ALTER TABLE "Profile" ADD COLUMN "relevantExperienceYears" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "targetRoles" TEXT;
ALTER TABLE "Profile" ADD COLUMN "willingToRelocate" BOOLEAN;
ALTER TABLE "Profile" ADD COLUMN "workAuthorization" TEXT;

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
    "minSalary" INTEGER,
    "platforms" TEXT NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 45,
    "maxApplicationsPerDay" INTEGER NOT NULL DEFAULT 20,
    "customRulesJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JobFilter" ("createdAt", "customRulesJson", "delaySeconds", "easyApplyOnly", "id", "isActive", "keywords", "location", "maxApplicationsPerDay", "minSalary", "name", "platforms", "remoteOnly", "updatedAt", "userId") SELECT "createdAt", "customRulesJson", "delaySeconds", "easyApplyOnly", "id", "isActive", "keywords", "location", "maxApplicationsPerDay", "minSalary", "name", "platforms", "remoteOnly", "updatedAt", "userId" FROM "JobFilter";
DROP TABLE "JobFilter";
ALTER TABLE "new_JobFilter" RENAME TO "JobFilter";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
