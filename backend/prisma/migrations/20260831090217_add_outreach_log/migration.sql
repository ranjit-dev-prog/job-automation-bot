-- CreateTable
CREATE TABLE "OutreachLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outreachEmailId" TEXT,
    "connectionMessageId" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "result" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_outreachEmailId_fkey" FOREIGN KEY ("outreachEmailId") REFERENCES "OutreachEmail" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_connectionMessageId_fkey" FOREIGN KEY ("connectionMessageId") REFERENCES "ConnectionMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
