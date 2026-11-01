CREATE TABLE "OpeningInstructorGrant" (
    "id" TEXT NOT NULL,
    "canReadContent" BOOLEAN NOT NULL DEFAULT false,
    "canManageTasks" BOOLEAN NOT NULL DEFAULT false,
    "canGrade" BOOLEAN NOT NULL DEFAULT false,
    "canManageSessions" BOOLEAN NOT NULL DEFAULT false,
    "canManageAnnouncements" BOOLEAN NOT NULL DEFAULT false,
    "canViewAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "openingId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "grantedById" TEXT,

    CONSTRAINT "OpeningInstructorGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpeningInstructorGrant_openingId_instructorId_key"
ON "OpeningInstructorGrant"("openingId", "instructorId");

CREATE INDEX "OpeningInstructorGrant_instructorId_idx"
ON "OpeningInstructorGrant"("instructorId");

ALTER TABLE "OpeningInstructorGrant"
ADD CONSTRAINT "OpeningInstructorGrant_openingId_fkey"
FOREIGN KEY ("openingId") REFERENCES "CourseOpening"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpeningInstructorGrant"
ADD CONSTRAINT "OpeningInstructorGrant_instructorId_fkey"
FOREIGN KEY ("instructorId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpeningInstructorGrant"
ADD CONSTRAINT "OpeningInstructorGrant_grantedById_fkey"
FOREIGN KEY ("grantedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
