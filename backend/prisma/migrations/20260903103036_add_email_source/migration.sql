-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TargetCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailSource" TEXT NOT NULL DEFAULT 'guessed',
    "contactName" TEXT,
    "roleOfInterest" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftedAt" DATETIME,
    CONSTRAINT "TargetCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TargetCompany" ("companyName", "contactName", "createdAt", "draftedAt", "email", "id", "notes", "roleOfInterest", "userId") SELECT "companyName", "contactName", "createdAt", "draftedAt", "email", "id", "notes", "roleOfInterest", "userId" FROM "TargetCompany";
DROP TABLE "TargetCompany";
ALTER TABLE "new_TargetCompany" RENAME TO "TargetCompany";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
