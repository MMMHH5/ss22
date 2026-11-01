CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "taskRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sessionRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "instructorFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
